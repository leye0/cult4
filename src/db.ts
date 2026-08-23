import Database from "better-sqlite3";
import { chmodSync, mkdirSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import type { Cult4Config } from "./config.js";
import { ensureHome, getConfig } from "./config.js";
import { Cult4Error } from "./domain.js";

export type CultDatabase = Database.Database;
export const LATEST_SCHEMA_VERSION = 4;

export function immediateTransaction<T>(
  db: CultDatabase,
  operation: () => T,
): T {
  if (db.inTransaction) return operation();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    if (db.inTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

export function openDatabase(config: Cult4Config = getConfig()): CultDatabase {
  ensureHome(config);
  mkdirSync(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const db = new Database(config.databasePath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = FULL");
  migrate(db);
  chmodSync(config.databasePath, 0o600);
  return db;
}

export function openMemoryDatabase(): CultDatabase {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: CultDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  `);
  const applied = new Set(
    (
      db.prepare("SELECT version FROM schema_migration").all() as Array<{
        version: number;
      }>
    ).map((x) => x.version),
  );
  if (
    applied.size > 0 &&
    !db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_mandate'",
      )
      .get()
  )
    throw new Cult4Error(
      "Database uses an incompatible pre-release schema and must be backed up and recreated. Missing: business_mandate.",
      "PRE_RELEASE_SCHEMA_RESET_REQUIRED",
    );
  for (let version = 1; version <= LATEST_SCHEMA_VERSION; version += 1) {
    if (applied.has(version)) continue;
    db.transaction(() => {
      db.exec(loadMigration(version));
      db.prepare(
        "INSERT INTO schema_migration(version,applied_at) VALUES(?,?)",
      ).run(version, new Date().toISOString());
    })();
  }
  const requiredTables = [
    "business_mandate",
    "financial_threshold",
    "market_study",
    "repository",
    "business_control",
    "control_validation",
    "decision_claim",
    "action_assurance",
    "intake_message",
    "official_request",
    "mandate_request",
    "work_request",
    "request_verification",
    "work_capability_requirement",
    "improvement_review",
  ];
  const existingTables = new Set(
    (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>
    ).map(({ name }) => name),
  );
  const missingTables = requiredTables.filter(
    (table) => !existingTables.has(table),
  );
  if (missingTables.length)
    throw new Cult4Error(
      `Database uses an incompatible pre-release schema and must be backed up and recreated. Missing: ${missingTables.join(", ")}.`,
      "PRE_RELEASE_SCHEMA_RESET_REQUIRED",
    );
}

function loadMigration(version: number): string {
  const names: Record<number, string> = {
    1: "001_initial.sql",
    2: "002_business_assurance.sql",
    3: "003_request_traceability.sql",
    4: "004_specialized_staffing.sql",
  };
  const name = names[version];
  if (!name) throw new Error(`Unknown Cult4 migration: ${version}`);
  const candidates = [
    new URL(`../foundation/migrations/${name}`, import.meta.url),
    new URL(`../../foundation/migrations/${name}`, import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error(`Cult4 migration not found: ${name}`);
}
