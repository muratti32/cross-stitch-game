import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { createTypeOrmOptions } from './typeorm-options';

/**
 * A migration file that is never added to `createTypeOrmOptions`'s `migrations` array is
 * silently skipped: `migration:run` reads that array, not the directory. Issue #106's
 * `AddCommerceOwnerToTransactionBindings` shipped that way and never ran anywhere.
 */
describe('migration registration', () => {
  const migrationsDirectory = join(__dirname, 'migrations');

  function migrationClassNamesOnDisk(): readonly string[] {
    return readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .map((file) => {
        // `1788912000000-AddCommerceOwnerToTransactionBindings.ts`
        // -> `AddCommerceOwnerToTransactionBindings1788912000000`
        const [timestamp, ...rest] = file.replace(/\.ts$/, '').split('-');
        return `${rest.join('-')}${timestamp}`;
      });
  }

  function registeredMigrationClassNames(): readonly string[] {
    const options = createTypeOrmOptions('postgres://user:password@localhost:5432/database');
    const migrations = options.migrations;
    if (!Array.isArray(migrations)) {
      throw new Error('Migrations must be registered as an array of classes');
    }
    return (migrations as readonly unknown[]).map((migration) => {
      if (typeof migration !== 'function') {
        throw new Error('Migrations must be registered as classes, not glob paths');
      }
      return (migration as { readonly name: string }).name;
    });
  }

  it('registers every migration file so migration:run cannot silently skip one', () => {
    const onDisk = [...migrationClassNamesOnDisk()].sort();
    const registered = [...registeredMigrationClassNames()].sort();

    expect(registered).toEqual(onDisk);
  });

  it('registers migrations in ascending timestamp order', () => {
    const timestamps = registeredMigrationClassNames().map((name) => {
      const match = /(\d{13})$/.exec(name);
      if (match === null) {
        throw new Error(`Migration class ${name} does not end with a 13-digit timestamp`);
      }
      return Number(match[1]);
    });

    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right));
  });
});
