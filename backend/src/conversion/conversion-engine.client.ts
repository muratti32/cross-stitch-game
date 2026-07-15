import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';

export interface EnginePaletteEntry {
  dmc_code: string;
  name: string;
  rgb_hex: string;
}

export interface ConversionEngineResponse {
  dmc_palette_version: string;
  engine_version: string;
  grid: string;
  palette: EnginePaletteEntry[];
  preview_png: string;
  recipe_version: string;
  statistics: {
    distinct_colors: number;
    height: number;
    total_stitchable_cells: number;
    width: number;
  };
}

export class ConversionEngineRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = ConversionEngineRequestError.name;
  }
}

@Injectable()
export class ConversionEngineClient {
  private readonly endpoint: string;

  constructor(config: AppConfigService) {
    this.endpoint = `${config.conversionEngineUrl.replace(/\/$/, '')}/v1/convert`;
  }

  async convert(input: {
    artwork: Buffer;
    contentType: string;
    maxColors: number;
    shortEdgeCells: number;
  }): Promise<ConversionEngineResponse> {
    const form = new FormData();
    form.append(
      'artwork',
      new Blob([new Uint8Array(input.artwork)], { type: input.contentType }),
      input.contentType === 'image/png' ? 'artwork.png' : 'artwork.jpg',
    );
    form.append('short_edge_cells', String(input.shortEdgeCells));
    form.append('max_colors', String(input.maxColors));
    form.append('recipe_version', 'v1');

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        body: form,
        method: 'POST',
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error: unknown) {
      throw new ConversionEngineRequestError(
        `Conversion Engine request failed: ${errorMessage(error)}`,
        true,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ConversionEngineRequestError(
        `Conversion Engine returned non-JSON status ${response.status}`,
        response.status >= 500,
      );
    }

    if (!response.ok) {
      const message = readErrorMessage(body);
      throw new ConversionEngineRequestError(
        `Conversion Engine rejected the artwork: ${message}`,
        response.status === 429 || response.status >= 500,
      );
    }
    if (!isEngineResponse(body)) {
      throw new ConversionEngineRequestError(
        'Conversion Engine returned a malformed response',
        false,
      );
    }
    return body;
  }
}

function isEngineResponse(value: unknown): value is ConversionEngineResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.dmc_palette_version !== 'string' ||
    typeof record.engine_version !== 'string' ||
    typeof record.grid !== 'string' ||
    !Array.isArray(record.palette) ||
    typeof record.preview_png !== 'string' ||
    record.recipe_version !== 'v1' ||
    typeof record.statistics !== 'object' ||
    record.statistics === null
  ) {
    return false;
  }
  if (
    !record.palette.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).dmc_code === 'string' &&
        typeof (entry as Record<string, unknown>).name === 'string' &&
        typeof (entry as Record<string, unknown>).rgb_hex === 'string',
    )
  ) {
    return false;
  }
  const statistics = record.statistics as Record<string, unknown>;
  return (
    Number.isInteger(statistics.distinct_colors) &&
    Number.isInteger(statistics.height) &&
    Number.isInteger(statistics.total_stitchable_cells) &&
    Number.isInteger(statistics.width)
  );
}

function readErrorMessage(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    const message = (value as Record<string, unknown>).message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return 'unknown conversion error';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
