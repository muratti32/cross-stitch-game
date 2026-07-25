export interface ObjectStorage {
  put(key: string, data: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  publicUrl(key: string): string;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(): Promise<readonly string[]>;
}

// DI token for the active ObjectStorage implementation (Local in development,
// R2 once R2_* configuration is present). Consumers inject this token rather
// than a concrete class so the backing store can change without touching them.
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');
