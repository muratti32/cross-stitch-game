import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import type { ObjectStorage } from './object-storage.interface';

@Injectable()
export class LocalObjectStorage implements ObjectStorage {
  private readonly storageDir: string;

  constructor(private readonly configService: AppConfigService) {
    this.storageDir = path.resolve(this.configService.storageLocalDir);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const filePath = path.join(this.storageDir, key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async get(key: string): Promise<Buffer | null> {
    const filePath = path.join(this.storageDir, key);
    try {
      return await fs.readFile(filePath);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'ENOENT'
      ) {
        return null;
      }
      throw error;
    }
  }

  publicUrl(key: string): string {
    return `/v1/catalog-previews/${key}`;
  }
}
