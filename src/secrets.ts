import { chmodSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cult4Config } from "./config.js";

export function openRouterSecretPath(config: Cult4Config): string {
  return join(config.secretsPath, "openrouter-api-key");
}

/** Import a provider credential into the protected Cult4 store without logging it. */
export function provisionProviderSecrets(
  config: Cult4Config,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const key = environment.OPENROUTER_API_KEY?.trim();
  if (!key) return [];
  const destination = openRouterSecretPath(config);
  const temporary = `${destination}.${process.pid}.tmp`;
  writeFileSync(temporary, key, { mode: 0o600, flag: "wx" });
  chmodSync(temporary, 0o600);
  renameSync(temporary, destination);
  chmodSync(destination, 0o600);
  return [destination];
}

export function configuredProviderOptions(
  config: Cult4Config,
): Record<string, unknown> {
  const path = openRouterSecretPath(config);
  if (!existsSync(path)) return {};
  return {
    provider: {
      openrouter: {
        options: { apiKey: `{file:${path}}` },
      },
    },
  };
}
