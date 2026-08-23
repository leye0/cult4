import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Cult4Error } from "./domain.js";

export interface Cult4Config {
  home: string;
  databasePath: string;
  objectsPath: string;
  runtimePath: string;
  secretsPath: string;
  settingsPath: string;
  businessesPath: string;
  organizationPath: string;
  agentsPath: string;
  toolsPath: string;
  skillsPath: string;
}

export function getConfig(
  environment: NodeJS.ProcessEnv = process.env,
): Cult4Config {
  const home = resolve(environment.CULT4_HOME ?? join(homedir(), ".cult4"));
  const configRoot = resolve(
    environment.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
  );
  return {
    home,
    databasePath: join(home, "state.db"),
    objectsPath: join(home, "objects"),
    runtimePath: join(home, "runtime"),
    secretsPath: join(home, "secrets"),
    settingsPath: join(home, "config.json"),
    businessesPath: join(home, "businesses"),
    organizationPath: resolve(
      environment.CULT4_ORGANIZATION_PATH ?? join(home, "organization"),
    ),
    agentsPath: resolve(
      environment.CULT4_OPENCODE_AGENTS_PATH ??
        join(configRoot, "opencode", "agents"),
    ),
    toolsPath: resolve(
      environment.CULT4_OPENCODE_TOOLS_PATH ??
        join(configRoot, "opencode", "tools"),
    ),
    skillsPath: resolve(
      environment.CULT4_OPENCODE_SKILLS_PATH ??
        join(configRoot, "opencode", "skills"),
    ),
  };
}

export function ensureHome(config = getConfig()): void {
  for (const directory of [
    config.home,
    config.objectsPath,
    config.runtimePath,
    config.secretsPath,
    config.businessesPath,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    if (lstatSync(directory).isSymbolicLink())
      throw new Cult4Error(
        `Security directory may not be a symlink: ${directory}`,
        "UNSAFE_HOME",
      );
  }
}

export function safePathWithin(
  baseInput: string,
  candidateInput: string,
  allowMissing = true,
): string {
  const base = realpathSync(baseInput);
  if (isAbsolute(candidateInput))
    throw new Cult4Error(
      "Path must be relative to its registered repository.",
      "UNSAFE_PATH",
    );
  const candidate = resolve(base, candidateInput);
  const rel = relative(base, candidate);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Cult4Error(
      "Path escapes its registered repository.",
      "UNSAFE_PATH",
    );
  let cursor = candidate;
  while (!existsSync(cursor)) {
    if (!allowMissing)
      throw new Cult4Error(
        `Path does not exist: ${candidateInput}`,
        "PATH_NOT_FOUND",
      );
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const resolved = realpathSync(cursor);
  const resolvedRel = relative(base, resolved);
  if (
    resolvedRel === ".." ||
    resolvedRel.startsWith(`..${sep}`) ||
    isAbsolute(resolvedRel)
  )
    throw new Cult4Error(
      "Path traverses a symlink outside its repository.",
      "UNSAFE_PATH",
    );
  return candidate;
}
