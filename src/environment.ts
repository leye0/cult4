import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Load operator-owned configuration without discovering .env files in business tool subprocesses. */
export function loadCult4Environment(
  command: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const explicit = environment.CULT4_ENV_FILE;
  if (command === "__tool" && !explicit) return undefined;
  const path = resolve(explicit ?? ".env");
  if (!existsSync(path)) return undefined;
  process.loadEnvFile(path);
  return path;
}
