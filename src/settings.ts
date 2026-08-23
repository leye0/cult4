import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import type { Cult4Config } from "./config.js";
import { ensureHome } from "./config.js";
import { Cult4Error } from "./domain.js";

interface Cult4Settings {
  schemaVersion: 1;
  githubOwner?: string;
}

export interface ConfiguredValue {
  value?: string;
  source: "environment" | "settings" | "unset";
}

export function validateGithubOwner(value: string): string {
  const owner = value.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(owner))
    throw new Cult4Error(
      "GitHub owner may contain only letters, numbers, dots, underscores, and hyphens.",
      "INVALID_GITHUB_OWNER",
    );
  return owner;
}

function readSettings(config: Cult4Config): Cult4Settings {
  if (!existsSync(config.settingsPath)) return { schemaVersion: 1 };
  if (lstatSync(config.settingsPath).isSymbolicLink())
    throw new Cult4Error(
      "Cult4 settings file may not be a symlink.",
      "UNSAFE_SETTINGS_FILE",
    );
  try {
    const parsed = JSON.parse(readFileSync(config.settingsPath, "utf8")) as {
      schemaVersion?: unknown;
      githubOwner?: unknown;
    };
    if (parsed.schemaVersion !== 1)
      throw new Error("Unsupported settings schema version.");
    return {
      schemaVersion: 1,
      ...(typeof parsed.githubOwner === "string"
        ? { githubOwner: validateGithubOwner(parsed.githubOwner) }
        : {}),
    };
  } catch (error) {
    if (error instanceof Cult4Error) throw error;
    throw new Cult4Error(
      `Cult4 settings are invalid: ${error instanceof Error ? error.message : String(error)}`,
      "INVALID_SETTINGS",
    );
  }
}

function writeSettings(config: Cult4Config, settings: Cult4Settings): void {
  ensureHome(config);
  const temporary = `${config.settingsPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, config.settingsPath);
  chmodSync(config.settingsPath, 0o600);
}

export function configuredGithubOwner(
  config: Cult4Config,
  environment: NodeJS.ProcessEnv = process.env,
): ConfiguredValue {
  const environmentOwner = environment.CULT4_GITHUB_OWNER?.trim();
  if (environmentOwner)
    return {
      value: validateGithubOwner(environmentOwner),
      source: "environment",
    };
  const owner = readSettings(config).githubOwner;
  return owner ? { value: owner, source: "settings" } : { source: "unset" };
}

export function setGithubOwner(config: Cult4Config, value: string): string {
  const owner = validateGithubOwner(value);
  writeSettings(config, { ...readSettings(config), githubOwner: owner });
  return owner;
}

export function unsetGithubOwner(config: Cult4Config): void {
  const settings = readSettings(config);
  delete settings.githubOwner;
  writeSettings(config, settings);
}
