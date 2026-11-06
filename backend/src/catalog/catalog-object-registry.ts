import type { EntityManager } from 'typeorm';

/** Records a stored object, so the storage reconciler does not report it as an orphan. */
export async function registerCatalogObject(
  manager: EntityManager,
  objectKey: string,
  checksum: string,
  byteLength: number,
): Promise<void> {
  await manager.query(
    `INSERT INTO "storage"."object_registry" ("object_key", "checksum", "byte_length", "state", "missing")
     VALUES ($1, $2, $3, 'available', false)
     ON CONFLICT ("object_key") DO UPDATE SET "checksum" = EXCLUDED."checksum", "byte_length" = EXCLUDED."byte_length", "state" = 'available', "missing" = false`,
    [objectKey, checksum, byteLength],
  );
}
