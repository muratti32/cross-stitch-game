/**
 * An expo-sqlite handle over `node:sqlite`, so a suite runs the real schema and
 * SQL. `node:sqlite` needs Node 22.5+, so on older runtimes (CI is on Node 20)
 * `nodeSqliteAvailable` is false and those suites skip.
 */
type SqlParam = string | number | null | Uint8Array;
interface NodeSqliteStatement {
  all(...params: SqlParam[]): unknown[];
  get(...params: SqlParam[]): unknown;
  run(...params: SqlParam[]): unknown;
}
export interface NodeSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): NodeSqliteStatement;
}
interface NodeSqliteModule {
  DatabaseSync: new (path: string) => NodeSqliteDatabase;
}

function loadSqlite(): NodeSqliteModule | null {
  try {
    return require('node:sqlite') as NodeSqliteModule;
  } catch {
    return null;
  }
}

export const nodeSqliteAvailable = loadSqlite() !== null;

/** Each filename keeps its database across reopen, like a file on the device. */
export function createNodeSqliteFiles() {
  const files = new Map<string, NodeSqliteDatabase>();

  return {
    clear: () => files.clear(),
    raw: (filename: string): NodeSqliteDatabase => {
      const database = files.get(filename);
      if (database === undefined) throw new Error(`${filename} is not open`);
      return database;
    },
    open: (filename: string): object => {
      const sqlite = loadSqlite();
      if (sqlite === null) throw new Error('node:sqlite is not available');
      const database = files.get(filename) ?? new sqlite.DatabaseSync(':memory:');
      files.set(filename, database);
      return {
        execAsync: async (sql: string) => database.exec(sql),
        getFirstAsync: async (sql: string, ...params: SqlParam[]) => database.prepare(sql).get(...params) ?? null,
        getAllAsync: async (sql: string, ...params: SqlParam[]) => database.prepare(sql).all(...params),
        runAsync: async (sql: string, ...params: SqlParam[]) => database.prepare(sql).run(...params),
        withTransactionAsync: async (action: () => Promise<void>) => {
          database.exec('BEGIN');
          try {
            await action();
            database.exec('COMMIT');
          } catch (error) {
            database.exec('ROLLBACK');
            throw error;
          }
        },
        closeAsync: async () => undefined,
      };
    },
  };
}
