import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { DataSource, In, Not } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import { readImageDimensions } from '../conversion/image-dimensions';
import { decodePatternArtifactV1 } from './pattern-artifact-encoder';
import { CategoryEntity, CatalogSubmissionEntity, TagEntity } from './entities';
import { OBJECT_STORAGE, ObjectStorage } from './storage/object-storage.interface';

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_PIXELS = 2048 * 2048;

@Injectable()
export class CatalogPrecheckService {
  constructor(
    private readonly config: AppConfigService,
    private readonly dataSource: DataSource,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async run(submissionId: string): Promise<CatalogSubmissionEntity> {
    const repository = this.dataSource.getRepository(CatalogSubmissionEntity);
    const submission = await repository.findOneBy({ id: submissionId });
    if (submission === null) throw new Error(`Catalog Submission ${submissionId} not found`);

    const [artifact, preview] = await Promise.all([
      this.storage.get(submission.artifactObjectKey),
      this.storage.get(submission.previewObjectKey),
    ]);
    const metadataErrors = await this.validateMetadata(submission);
    const technicalErrors = this.validateTechnical(submission, artifact, preview);
    let previewPhash: string | null = null;
    if (preview !== null && preview.length <= MAX_PREVIEW_BYTES) {
      try {
        previewPhash = perceptualHash(preview);
      } catch {
        // Technical evidence records an unsafe or malformed preview. Let the
        // snapshot reach quarantine so a moderator can reject it.
      }
    }
    const moderationEvidence = await this.moderate(
      submission,
      previewPhash === null ? null : preview,
    );
    const similarityEvidence = previewPhash === null
      ? []
      : await this.findSimilar(submission.id, previewPhash);
    const metadataValid = metadataErrors.length === 0;
    const technicalValid = technicalErrors.length === 0;
    const safetyConcern = moderationEvidence.flagged === true;

    submission.metadataErrors = metadataErrors;
    submission.metadataValid = metadataValid;
    submission.moderationEvidence = moderationEvidence;
    submission.previewPhash = previewPhash;
    submission.similarityEvidence = similarityEvidence;
    submission.technicalErrors = technicalErrors;
    submission.technicalValid = technicalValid;
    submission.precheckCompletedAt = new Date();
    submission.status =
      metadataValid && technicalValid && !safetyConcern
        ? 'review_pending'
        : 'quarantined';
    return repository.save(submission);
  }

  async markFailed(processingJobId: string): Promise<void> {
    await this.dataSource.getRepository(CatalogSubmissionEntity).update(
      { processingJobId, status: 'precheck_pending' },
      { status: 'precheck_failed' },
    );
  }

  async revalidateInvariants(submission: CatalogSubmissionEntity): Promise<{
    metadataErrors: string[];
    technicalErrors: string[];
  }> {
    const [artifact, preview, metadataErrors] = await Promise.all([
      this.storage.get(submission.artifactObjectKey),
      this.storage.get(submission.previewObjectKey),
      this.validateMetadata(submission),
    ]);
    return {
      metadataErrors,
      technicalErrors: this.validateTechnical(submission, artifact, preview),
    };
  }

  private async validateMetadata(submission: CatalogSubmissionEntity): Promise<string[]> {
    return this.validateMetadataFields({
      categoryCode: submission.categoryCode,
      description: submission.description,
      sourceLanguage: submission.sourceLanguage,
      tagCodes: submission.tagCodes,
      title: submission.title,
    });
  }

  async validateMetadataFields(input: {
    categoryCode: string;
    description: string;
    sourceLanguage: string;
    tagCodes: string[];
    title: string;
  }): Promise<string[]> {
    const errors: string[] = [];
    if (
      input.title !== normalizeText(input.title) ||
      input.title.length < 1 ||
      input.title.length > 120
    ) {
      errors.push('Title is not normalized or is outside the allowed length');
    }
    if (
      input.description !== normalizeText(input.description) ||
      input.description.length < 1 ||
      input.description.length > 2000
    ) {
      errors.push('Description is not normalized or is outside the allowed length');
    }
    if (input.sourceLanguage !== 'en') errors.push('Source language is not supported');
    if (new Set(input.tagCodes).size !== input.tagCodes.length || input.tagCodes.length > 5) {
      errors.push('Tag codes must be distinct and limited to five');
    }
    const [category, tags] = await Promise.all([
      this.dataSource.getRepository(CategoryEntity).findOneBy({
        active: true,
        code: input.categoryCode,
      }),
      input.tagCodes.length === 0
        ? Promise.resolve([])
        : this.dataSource.getRepository(TagEntity).findBy({
            active: true,
            code: In(input.tagCodes),
          }),
    ]);
    if (category === null) errors.push('Category is unknown or inactive');
    if (tags.length !== input.tagCodes.length) errors.push('One or more tags are unknown or inactive');
    return errors;
  }

  private validateTechnical(
    submission: CatalogSubmissionEntity,
    artifact: Buffer | null,
    preview: Buffer | null,
  ): string[] {
    const errors: string[] = [];
    if (artifact === null) return ['Pattern Artifact is missing'];
    if (artifact.length > MAX_ARTIFACT_BYTES) errors.push('Pattern Artifact exceeds decompression limits');
    if (artifact.length !== submission.artifactByteLength) errors.push('Pattern Artifact byte length differs from snapshot');
    if (sha256(artifact) !== submission.artifactChecksum.trim()) errors.push('Pattern Artifact checksum differs from snapshot');

    let decoded: ReturnType<typeof decodePatternArtifactV1> | null = null;
    try {
      decoded = decodePatternArtifactV1(artifact);
    } catch {
      errors.push('Pattern Artifact cannot be decoded safely');
    }
    if (decoded !== null) {
      if (decoded.schemaVersion !== 1 || submission.artifactSchemaVersion !== 1) errors.push('Pattern Artifact schema version is unsupported');
      if (decoded.width !== submission.width || decoded.height !== submission.height) errors.push('Pattern Artifact dimensions differ from snapshot');
      if (decoded.grid.length !== decoded.width * decoded.height) errors.push('Pattern grid length is invalid');
      if (decoded.palette.length !== submission.paletteSize || decoded.palette.length < 1 || decoded.palette.length > 255) errors.push('Pattern palette is invalid');
      if (decoded.palette.some((entry) => !/^#[0-9A-Fa-f]{6}$/.test(entry.rgbHex) || entry.dmcCode.trim().length === 0)) errors.push('Pattern palette contains malformed entries');
      if ([...decoded.grid].some((index) => index > decoded.palette.length)) errors.push('Pattern grid references an unknown palette entry');
    }

    if (preview === null) return [...errors, 'Pattern Preview is missing'];
    if (preview.length > MAX_PREVIEW_BYTES) errors.push('Pattern Preview exceeds size limits');
    if (sha256(preview) !== submission.previewChecksum.trim()) errors.push('Pattern Preview checksum differs from snapshot');
    if (decoded !== null) {
      try {
        if (!previewMatchesArtifact(preview, decoded)) errors.push('Pattern Preview does not represent the Pattern Artifact');
      } catch {
        errors.push('Pattern Preview cannot be decoded safely');
      }
    }
    return errors;
  }

  private async moderate(
    submission: CatalogSubmissionEntity,
    preview: Buffer | null,
  ): Promise<Record<string, unknown>> {
    return this.moderateContent(`Title: ${submission.title}\nDescription: ${submission.description}`, preview);
  }

  async moderateText(title: string, description: string): Promise<Record<string, unknown>> {
    return this.moderateContent(`Title: ${title}\nDescription: ${description}`, null);
  }

  private async moderateContent(
    text: string,
    preview: Buffer | null,
  ): Promise<Record<string, unknown>> {
    if (!this.config.openAiModerationEnabled) {
      return { checked: false, flagged: false, model: 'omni-moderation-latest' };
    }
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('Catalog Precheck moderation is unavailable');
    const input: Array<Record<string, unknown>> = [
      { text, type: 'text' },
    ];
    if (preview !== null) {
      input.push({
        image_url: { url: `data:image/png;base64,${preview.toString('base64')}` },
        type: 'image_url',
      });
    }
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/moderations', {
        body: JSON.stringify({
          input,
          model: 'omni-moderation-latest',
        }),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        method: 'POST',
      });
    } catch {
      throw new ServiceUnavailableException('Catalog Precheck moderation is unavailable');
    }
    if (!response.ok) throw new ServiceUnavailableException('Catalog Precheck moderation is unavailable');
    let body: { results?: Array<{ categories?: unknown; category_scores?: unknown; flagged?: unknown }> };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new ServiceUnavailableException('Catalog Precheck moderation is unavailable');
    }
    const result = body.results?.[0];
    if (typeof result?.flagged !== 'boolean') {
      throw new ServiceUnavailableException('Catalog Precheck moderation is unavailable');
    }
    return {
      categories: result.categories ?? {},
      categoryScores: result.category_scores ?? {},
      checked: true,
      flagged: result.flagged,
      model: 'omni-moderation-latest',
    };
  }

  private async findSimilar(
    submissionId: string,
    previewPhash: string,
  ): Promise<Array<{ submissionId: string; distance: number }>> {
    const candidates = await this.dataSource.getRepository(CatalogSubmissionEntity).find({
      select: { id: true, previewPhash: true },
      where: { id: Not(submissionId) },
    });
    return candidates
      .filter((candidate) => candidate.previewPhash !== null)
      .map((candidate) => ({
        distance: hammingDistance(previewPhash, candidate.previewPhash as string),
        submissionId: candidate.id,
      }))
      .filter((candidate) => candidate.distance <= 5)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 20);
  }
}

function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function previewMatchesArtifact(
  bytes: Buffer,
  artifact: ReturnType<typeof decodePatternArtifactV1>,
): boolean {
  const dimensions = readImageDimensions(bytes);
  if (dimensions.contentType !== 'image/png') return false;
  if (dimensions.width * dimensions.height > MAX_PREVIEW_PIXELS) return false;
  const png = PNG.sync.read(bytes, { checkCRC: true });
  if (png.width % artifact.width !== 0 || png.height % artifact.height !== 0) return false;
  const scaleX = png.width / artifact.width;
  const scaleY = png.height / artifact.height;
  if (scaleX !== scaleY || scaleX < 1) return false;
  for (let row = 0; row < artifact.height; row++) {
    for (let column = 0; column < artifact.width; column++) {
      const cell = artifact.grid[row * artifact.width + column];
      const expected = cell === 0 ? null : artifact.palette[cell - 1]?.rgbHex;
      for (let y = row * scaleY; y < (row + 1) * scaleY; y++) {
        for (let x = column * scaleX; x < (column + 1) * scaleX; x++) {
          const offset = (y * png.width + x) * 4;
          if (expected === null) {
            const transparent = png.data[offset + 3] === 0;
            const white = png.data[offset] === 255 && png.data[offset + 1] === 255 && png.data[offset + 2] === 255;
            if (!transparent && !white) return false;
          } else if (
            png.data[offset] !== parseInt(expected.slice(1, 3), 16) ||
            png.data[offset + 1] !== parseInt(expected.slice(3, 5), 16) ||
            png.data[offset + 2] !== parseInt(expected.slice(5, 7), 16) ||
            png.data[offset + 3] !== 255
          ) {
            return false;
          }
        }
      }
    }
  }
  return true;
}

export function perceptualHash(bytes: Buffer): string {
  const dimensions = readImageDimensions(bytes);
  if (dimensions.contentType !== 'image/png') throw new Error('Preview must be PNG');
  if (dimensions.width * dimensions.height > MAX_PREVIEW_PIXELS) {
    throw new Error('Preview exceeds pixel limit');
  }
  const png = PNG.sync.read(bytes, { checkCRC: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    let previous = grayscaleAt(png, 0, y);
    for (let x = 1; x < 9; x++) {
      const current = grayscaleAt(png, x, y);
      bits = (bits << 1n) | (previous > current ? 1n : 0n);
      previous = current;
    }
  }
  return bits.toString(16).padStart(16, '0');
}

function grayscaleAt(png: PNG, sampleX: number, sampleY: number): number {
  const x = Math.min(png.width - 1, Math.floor(((sampleX + 0.5) * png.width) / 9));
  const y = Math.min(png.height - 1, Math.floor(((sampleY + 0.5) * png.height) / 8));
  const offset = (y * png.width + x) * 4;
  const alpha = png.data[offset + 3] / 255;
  const red = png.data[offset] * alpha + 255 * (1 - alpha);
  const green = png.data[offset + 1] * alpha + 255 * (1 - alpha);
  const blue = png.data[offset + 2] * alpha + 255 * (1 - alpha);
  return Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
}

function hammingDistance(left: string, right: string): number {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let distance = 0;
  while (value !== 0n) {
    distance += Number(value & 1n);
    value >>= 1n;
  }
  return distance;
}
