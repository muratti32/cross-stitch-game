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

  async put(
    key: string,
    data: Buffer,
    contentType?: string,
  ): Promise<void> {
    void contentType;
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

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.storageDir, key);
    try {
      await fs.unlink(filePath);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = path.join(this.storageDir, key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<readonly string[]> {
    const keys: string[] = [];
    await this.collectKeys(this.storageDir, keys);
    return keys;
  }

  publicUrl(key: string): string {
    return `/v1/catalog-previews/${key}`;
  }

  private async collectKeys(directory: string, keys: string[]): Promise<void> {
    let entries: readonly import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error: unknown) {
      if (isMissingFileError(error)) {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await this.collectKeys(entryPath, keys);
      } else if (entry.isFile()) {
        keys.push(path.relative(this.storageDir, entryPath));
      }
    }
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
