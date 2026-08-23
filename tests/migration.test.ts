import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";

describe("initial SQLite schema", () => {
  it("creates the complete current schema from an empty database", () => {
    const root = mkdtempSync(join(tmpdir(), "cult4-migration-"));
    const databasePath = join(root, "state.db");
    const config = {
      home: root,
      databasePath,
      objectsPath: join(root, "objects"),
      runtimePath: join(root, "runtime"),
      secretsPath: join(root, "secrets"),
      businessesPath: join(root, "businesses"),
      organizationPath: join(root, "organization"),
      agentsPath: join(root, "agents"),
      toolsPath: join(root, "tools"),
      skillsPath: join(root, "skills"),
    };
    for (const path of [
      config.objectsPath,
      config.runtimePath,
      config.secretsPath,
      config.businessesPath,
    ])
      mkdirSync(path, { recursive: true, mode: 0o700 });
    const database = openDatabase(config);
    expect(
      database
        .prepare("SELECT max(version) version FROM schema_migration")
        .get(),
    ).toEqual({ version: 4 });
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
    expect(
      database
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name IN (${requiredTables.map(() => "?").join(",")}) ORDER BY name`,
        )
        .all(...requiredTables),
    ).toEqual(requiredTables.sort().map((name) => ({ name })));
    expect(
      database
        .prepare("PRAGMA table_info(business)")
        .all()
        .some((column) =>
          Boolean(
            column &&
            typeof column === "object" &&
            "name" in column &&
            column.name === "confirmed_mandate_id",
          ),
        ),
    ).toBe(true);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    database.close();
  });

  it("rejects an incomplete pre-release schema with an actionable error", () => {
    const root = mkdtempSync(join(tmpdir(), "cult4-pre-release-schema-"));
    const databasePath = join(root, "state.db");
    const legacy = new Database(databasePath);
    legacy.exec(
      "CREATE TABLE schema_migration(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    legacy
      .prepare("INSERT INTO schema_migration(version,applied_at) VALUES(1,?)")
      .run(new Date().toISOString());
    legacy.close();
    const config = {
      home: root,
      databasePath,
      objectsPath: join(root, "objects"),
      runtimePath: join(root, "runtime"),
      secretsPath: join(root, "secrets"),
      businessesPath: join(root, "businesses"),
      organizationPath: join(root, "organization"),
      agentsPath: join(root, "agents"),
      toolsPath: join(root, "tools"),
      skillsPath: join(root, "skills"),
    };
    expect(() => openDatabase(config)).toThrowError(
      /incompatible pre-release schema/,
    );
  });
});
