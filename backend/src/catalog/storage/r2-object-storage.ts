import { Injectable } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { AppConfigService } from '../../config/app-config.service';
import type { ObjectStorage } from './object-storage.interface';

interface R2ClientContext {
  client: S3Client;
  bucket: string;
}

// Cloudflare R2 is S3-compatible, so the AWS SDK v3 S3 client talks to it
// directly against the account-scoped R2 endpoint. Credentials are read lazily
// (not in the constructor) because Nest instantiates every registered
// provider at bootstrap, including this one in environments that select
// LocalObjectStorage instead; eager validation here would crash local dev.
@Injectable()
export class R2ObjectStorage implements ObjectStorage {
  private context: R2ClientContext | undefined;

  constructor(private readonly configService: AppConfigService) {}

  async put(key: string, data: Buffer, contentType?: string): Promise<void> {
    const { client, bucket } = this.getContext();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    const { client, bucket } = this.getContext();
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!result.Body) {
        return null;
      }
      const bytes = await result.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const { client, bucket } = this.getContext();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (error: unknown) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const { client, bucket } = this.getContext();
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  async list(): Promise<readonly string[]> {
    const { client, bucket } = this.getContext();
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key !== undefined) {
          keys.push(object.Key);
        }
      }
      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);

    return keys;
  }

  publicUrl(key: string): string {
    const publicHostname = this.configService.r2PublicHostname;
    // Official/Community Pattern Previews are meant to be served from a
    // public CDN (ADR-0018); without a configured hostname, fall back to the
    // backend proxy path so previews still resolve in environments that
    // haven't attached a CDN domain to the bucket yet.
    if (publicHostname !== undefined) {
      return `https://${publicHostname}/${key}`;
    }
    return `/v1/catalog-previews/${key}`;
  }

  private getContext(): R2ClientContext {
    if (this.context !== undefined) {
      return this.context;
    }

    const accountId = this.configService.r2AccountId;
    const accessKeyId = this.configService.r2AccessKeyId;
    const secretAccessKey = this.configService.r2SecretAccessKey;
    const bucket = this.configService.r2BucketName;

    if (
      accountId === undefined ||
      accessKeyId === undefined ||
      secretAccessKey === undefined ||
      bucket === undefined
    ) {
      throw new Error(
        'R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME are required to use R2ObjectStorage',
      );
    }

    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    this.context = { client, bucket };
    return this.context;
  }
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  if (name === 'NotFound' || name === 'NoSuchKey') {
    return true;
  }
  const statusCode = (error as { $metadata?: { httpStatusCode?: unknown } })
    .$metadata?.httpStatusCode;
  return statusCode === 404;
}
