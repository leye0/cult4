import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Cult4Config } from "./config.js";
import { getConfig } from "./config.js";
import { Cult4Error } from "./domain.js";

export interface StoredObject {
  hash: string;
  ref: string;
  size: number;
}

export function storeObject(
  content: Buffer,
  config: Cult4Config = getConfig(),
): StoredObject {
  const hash = createHash("sha256").update(content).digest("hex");
  const directory = join(config.objectsPath, hash.slice(0, 2));
  const path = join(directory, hash);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!existsSync(path))
    writeFileSync(path, content, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  return { hash, ref: `sha256:${hash}`, size: content.byteLength };
}

export function readObject(
  ref: string,
  config: Cult4Config = getConfig(),
): Buffer {
  const match = /^sha256:([0-9a-f]{64})$/.exec(ref);
  if (!match?.[1])
    throw new Cult4Error("Invalid object reference.", "OBJECT_REF_INVALID");
  const content = readFileSync(
    join(config.objectsPath, match[1].slice(0, 2), match[1]),
  );
  if (createHash("sha256").update(content).digest("hex") !== match[1])
    throw new Cult4Error("Stored object hash mismatch.", "OBJECT_CORRUPTED");
  return content;
}
