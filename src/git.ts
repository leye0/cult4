import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CultDatabase } from "./db.js";
import { immediateTransaction } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, now } from "./domain.js";
import { createWorkItem } from "./work.js";

export type RepositoryHealth =
  | "HEALTHY"
  | "DIRTY"
  | "LOCAL_ONLY"
  | "MISSING"
  | "REMOTE_UNREACHABLE"
  | "REMOTE_NOT_PRIVATE"
  | "AHEAD"
  | "BEHIND"
  | "DIVERGED"
  | "SHA_MISMATCH"
  | "STALE_WORKTREE"
  | "WRONG_BRANCH"
  | "REMOTE_URL_MISMATCH";

export interface RepositoryRecord {
  id: string;
  owner_type: "organization" | "business";
  owner_id: string | null;
  local_path: string;
  remote_name: string;
  remote_url: string;
  default_branch: "main";
  current_sha: string | null;
  remote_sha: string | null;
  privacy_verified: number;
  privacy_verified_at: string | null;
  sync_status: string;
}

export interface RepositoryInspection {
  health: RepositoryHealth;
  localSha?: string;
  remoteSha?: string;
  branch?: string;
  dirty: boolean;
  remoteUrl?: string;
  reasons: string[];
}

export function githubRemoteUrl(
  owner: string,
  name: string,
  protocol: "https" | "ssh",
): string {
  return protocol === "ssh"
    ? `git@github.com:${owner}/${name}.git`
    : `https://github.com/${owner}/${name}.git`;
}

function configuredGitHubProtocol(): "https" | "ssh" {
  try {
    return execFileSync(
      "gh",
      ["config", "get", "git_protocol", "--host", "github.com"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 10_000,
      },
    ).trim() === "ssh"
      ? "ssh"
      : "https";
  } catch {
    return "https";
  }
}

function redact(text: string): string {
  return text
    .replace(/https?:\/\/[^/@\s]+@/g, "https://<redacted>@")
    .replace(/(token|password|secret|key)=([^\s&]+)/gi, "$1=<redacted>");
}

export function runGit(
  args: string[],
  cwd: string,
  options: { allowFailure?: boolean; timeoutMs?: number } = {},
): { ok: boolean; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeoutMs ?? 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout.trim(), stderr: "" };
  } catch (error) {
    const candidate = error as {
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    const stderr = redact(
      String(candidate.stderr ?? candidate.message ?? "Git command failed"),
    ).slice(0, 4000);
    if (options.allowFailure)
      return {
        ok: false,
        stdout: String(candidate.stdout ?? "").trim(),
        stderr,
      };
    throw new Cult4Error(stderr, "GIT_COMMAND_FAILED", {
      command: ["git", ...args].map((part) => redact(part)),
    });
  }
}

function gitText(args: string[], cwd: string): string {
  return runGit(args, cwd).stdout;
}

export function assertSafeRemoteUrl(url: string): void {
  if (!url.trim())
    throw new Cult4Error("Remote URL is required.", "REMOTE_REQUIRED");
  if (/https?:\/\/[^/@]+@/i.test(url) || /[?&](token|key|password)=/i.test(url))
    throw new Cult4Error(
      "Remote URL must not contain embedded credentials.",
      "REMOTE_CONTAINS_CREDENTIALS",
    );
}

function githubName(url: string): string | undefined {
  const match = url.match(
    /(?:github\.com[/:])([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
  );
  return match ? `${match[1]}/${match[2]}` : undefined;
}

export function verifyPrivateRemote(url: string): boolean {
  assertSafeRemoteUrl(url);
  if (
    process.env.CULT4_TEST_PRIVATE_REMOTES === "1" &&
    (url.startsWith("file://") || url.startsWith("/") || url.startsWith("../"))
  )
    return true;
  const name = githubName(url);
  if (!name) return false;
  try {
    const raw = execFileSync(
      "gh",
      ["repo", "view", name, "--json", "visibility"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30_000,
      },
    );
    return (
      (JSON.parse(raw) as { visibility?: string }).visibility === "PRIVATE"
    );
  } catch {
    return false;
  }
}

export function repositoryById(
  db: CultDatabase,
  repositoryId: string,
): RepositoryRecord {
  const row = db
    .prepare("SELECT * FROM repository WHERE id=?")
    .get(repositoryId) as RepositoryRecord | undefined;
  if (!row)
    throw new Cult4Error("Repository not registered.", "REPOSITORY_NOT_FOUND");
  return row;
}

export function organizationRepository(db: CultDatabase): RepositoryRecord {
  const row = db
    .prepare("SELECT * FROM repository WHERE owner_type='organization'")
    .get() as RepositoryRecord | undefined;
  if (!row)
    throw new Cult4Error(
      "Organization repository is not registered.",
      "REPOSITORY_NOT_FOUND",
    );
  return row;
}

export function businessRepository(
  db: CultDatabase,
  businessId: string,
): RepositoryRecord {
  const row = db
    .prepare(
      "SELECT * FROM repository WHERE owner_type='business' AND owner_id=?",
    )
    .get(businessId) as RepositoryRecord | undefined;
  if (!row)
    throw new Cult4Error(
      "Business repository is not registered.",
      "REPOSITORY_NOT_FOUND",
    );
  return row;
}

export function registerLocalRepository(
  db: CultDatabase,
  input: {
    ownerType: "organization" | "business";
    ownerId?: string;
    localPath: string;
  },
): string {
  const path = realpathSync(input.localPath);
  const head = gitText(["rev-parse", "HEAD"], path);
  const branch = gitText(["branch", "--show-current"], path);
  if (branch !== "main")
    throw new Cult4Error(
      "Persistent repository must use main.",
      "WRONG_BRANCH",
    );
  const existing = db
    .prepare("SELECT id FROM repository WHERE owner_type=? AND owner_id IS ?")
    .get(input.ownerType, input.ownerId ?? null) as { id: string } | undefined;
  const repositoryId =
    existing?.id ??
    (input.ownerType === "organization"
      ? "repo-organization"
      : `repo-${input.ownerId}`);
  const remote = runGit(["remote", "get-url", "origin"], path, {
    allowFailure: true,
  });
  const at = now();
  db.prepare(
    `INSERT INTO repository(id,owner_type,owner_id,local_path,remote_url,current_sha,sync_status,created_at,updated_at)
     VALUES(?,?,?,?,?,?,'local_only',?,?)
     ON CONFLICT(id) DO UPDATE SET local_path=excluded.local_path,current_sha=excluded.current_sha,remote_url=CASE WHEN repository.remote_url='' THEN excluded.remote_url ELSE repository.remote_url END,updated_at=excluded.updated_at`,
  ).run(
    repositoryId,
    input.ownerType,
    input.ownerId ?? null,
    path,
    remote.ok ? remote.stdout : "",
    head,
    at,
    at,
  );
  if (!existing)
    audit(db, {
      type: "REPO_PROVISIONED",
      actorId: "system",
      subjectType: "REPOSITORY",
      subjectId: repositoryId,
      subjectVersion: head,
      data: { ownerType: input.ownerType, ownerId: input.ownerId },
    });
  return repositoryId;
}

export function connectRemote(
  db: CultDatabase,
  repositoryId: string,
  remoteUrl: string,
): RepositoryInspection {
  assertSafeRemoteUrl(remoteUrl);
  const repo = repositoryById(db, repositoryId);
  const current = runGit(
    ["remote", "get-url", repo.remote_name],
    repo.local_path,
    {
      allowFailure: true,
    },
  );
  if (current.ok && current.stdout !== remoteUrl)
    throw new Cult4Error(
      "Existing origin differs from requested remote.",
      "REMOTE_URL_MISMATCH",
    );
  if (!current.ok)
    gitText(["remote", "add", repo.remote_name, remoteUrl], repo.local_path);
  if (!verifyPrivateRemote(remoteUrl)) {
    db.prepare(
      "UPDATE repository SET remote_url=?,privacy_verified=0,sync_status='remote_not_private',last_verified_at=?,updated_at=? WHERE id=?",
    ).run(remoteUrl, now(), now(), repositoryId);
    throw new Cult4Error(
      "Remote visibility is not verified PRIVATE.",
      "REMOTE_NOT_PRIVATE",
    );
  }
  const head = gitText(["rev-parse", "HEAD"], repo.local_path);
  gitText(["push", "-u", repo.remote_name, "main"], repo.local_path);
  const remoteSha = remoteHead(repo.local_path, repo.remote_name);
  if (remoteSha !== head)
    throw new Cult4Error(
      "Pushed SHA was not confirmed remotely.",
      "REMOTE_SHA_MISMATCH",
    );
  const at = now();
  db.transaction(() => {
    db.prepare(
      `UPDATE repository SET remote_url=?,current_sha=?,remote_sha=?,privacy_verified=1,privacy_verified_at=?,sync_status='synced',last_push_at=?,last_verified_at=?,updated_at=? WHERE id=?`,
    ).run(remoteUrl, head, remoteSha, at, at, at, at, repositoryId);
    db.prepare(
      `INSERT OR IGNORE INTO git_commit(id,repository_id,sha,branch,purpose,message,pushed_at,remote_verified_at,created_at)
       VALUES(?,?,?,'main','initial','Initial repository state',?,?,?)`,
    ).run(id("commit"), repositoryId, head, at, at, at);
    if (repo.owner_type === "business" && repo.owner_id)
      db.prepare("UPDATE business SET status='ACTIVE' WHERE id=?").run(
        repo.owner_id,
      );
    audit(db, {
      type: "REMOTE_CONNECTED",
      actorId: "system",
      subjectType: "REPOSITORY",
      subjectId: repositoryId,
      subjectVersion: head,
      data: { remoteUrl, privacy: "PRIVATE" },
    });
    audit(db, {
      type: "PRIVACY_VERIFIED",
      actorId: "system",
      subjectType: "REPOSITORY",
      subjectId: repositoryId,
      subjectVersion: head,
      data: { visibility: "PRIVATE" },
    });
  })();
  return inspectRepository(db, repositoryId);
}

export function createPrivateGitHubRemote(
  db: CultDatabase,
  repositoryId: string,
  owner: string,
  name: string,
): RepositoryInspection {
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(name))
    throw new Cult4Error(
      "Unsafe GitHub owner or repository name.",
      "INVALID_GITHUB_REPOSITORY",
    );
  try {
    execFileSync("gh", ["repo", "create", `${owner}/${name}`, "--private"], {
      cwd: repositoryById(db, repositoryId).local_path,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  } catch (error) {
    throw new Cult4Error(
      redact(String((error as { stderr?: string }).stderr ?? error)),
      "GITHUB_PROVISIONING_FAILED",
    );
  }
  return connectRemote(
    db,
    repositoryId,
    githubRemoteUrl(owner, name, configuredGitHubProtocol()),
  );
}

function remoteHead(path: string, remote = "origin"): string {
  const line = gitText(["ls-remote", remote, "refs/heads/main"], path);
  const sha = line.split(/\s+/)[0];
  if (!/^[0-9a-f]{40,64}$/i.test(sha ?? ""))
    throw new Cult4Error("Remote main is missing.", "REMOTE_MAIN_MISSING");
  return sha!;
}

function isAncestor(path: string, older: string, newer: string): boolean {
  return runGit(["merge-base", "--is-ancestor", older, newer], path, {
    allowFailure: true,
  }).ok;
}

export function inspectRepository(
  db: CultDatabase,
  repositoryId: string,
  options: { fetch?: boolean; verifyPrivacy?: boolean } = {},
): RepositoryInspection {
  const repo = repositoryById(db, repositoryId);
  const reasons: string[] = [];
  if (!existsSync(repo.local_path))
    return { health: "MISSING", dirty: false, reasons: ["LOCAL_PATH_MISSING"] };
  if (
    !runGit(["rev-parse", "--is-inside-work-tree"], repo.local_path, {
      allowFailure: true,
    }).ok
  )
    return {
      health: "MISSING",
      dirty: false,
      reasons: ["NOT_A_GIT_REPOSITORY"],
    };
  const branch = gitText(["branch", "--show-current"], repo.local_path);
  const status = gitText(["status", "--porcelain"], repo.local_path);
  const dirty = Boolean(status);
  const localSha = gitText(["rev-parse", "HEAD"], repo.local_path);
  const remote = runGit(
    ["remote", "get-url", repo.remote_name],
    repo.local_path,
    {
      allowFailure: true,
    },
  );
  if (!remote.ok || !repo.remote_url)
    return {
      health: "LOCAL_ONLY",
      localSha,
      branch,
      dirty,
      reasons: ["ORIGIN_MISSING"],
    };
  if (remote.stdout !== repo.remote_url)
    return {
      health: "REMOTE_URL_MISMATCH",
      localSha,
      branch,
      dirty,
      remoteUrl: remote.stdout,
      reasons: ["ORIGIN_DIFFERS_FROM_SQLITE"],
    };
  if (branch !== repo.default_branch)
    return {
      health: "WRONG_BRANCH",
      localSha,
      branch,
      dirty,
      remoteUrl: remote.stdout,
      reasons: ["BRANCH_NOT_MAIN"],
    };
  if (dirty)
    return {
      health: "DIRTY",
      localSha,
      branch,
      dirty,
      remoteUrl: remote.stdout,
      reasons: ["WORKTREE_DIRTY"],
    };
  if (options.verifyPrivacy !== false && !verifyPrivateRemote(repo.remote_url))
    return {
      health: "REMOTE_NOT_PRIVATE",
      localSha,
      branch,
      dirty,
      remoteUrl: remote.stdout,
      reasons: ["PRIVACY_NOT_PRIVATE"],
    };
  if (options.fetch) {
    const fetched = runGit(
      ["fetch", repo.remote_name, "main"],
      repo.local_path,
      {
        allowFailure: true,
        timeoutMs: 60_000,
      },
    );
    if (!fetched.ok)
      return {
        health: "REMOTE_UNREACHABLE",
        localSha,
        branch,
        dirty,
        remoteUrl: remote.stdout,
        reasons: ["FETCH_FAILED"],
      };
  }
  let remoteSha: string;
  try {
    remoteSha = remoteHead(repo.local_path, repo.remote_name);
  } catch {
    return {
      health: "REMOTE_UNREACHABLE",
      localSha,
      branch,
      dirty,
      remoteUrl: remote.stdout,
      reasons: ["REMOTE_MAIN_MISSING"],
    };
  }
  let health: RepositoryHealth = "HEALTHY";
  if (localSha !== remoteSha)
    health = isAncestor(repo.local_path, localSha, remoteSha)
      ? "BEHIND"
      : isAncestor(repo.local_path, remoteSha, localSha)
        ? "AHEAD"
        : "DIVERGED";
  else if (repo.current_sha && localSha !== repo.current_sha)
    health = "SHA_MISMATCH";
  if (health === "HEALTHY") {
    const registered = new Set([
      repo.local_path,
      ...(
        db
          .prepare(
            "SELECT path FROM review_worktree WHERE repository_id=? AND status='ACTIVE'",
          )
          .all(repositoryId) as Array<{ path: string }>
      ).map((row) => row.path),
    ]);
    const worktrees = runGit(
      ["worktree", "list", "--porcelain"],
      repo.local_path,
      { allowFailure: true },
    )
      .stdout.split(/\r?\n/)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice(9));
    if (worktrees.some((path) => !registered.has(path)))
      health = "STALE_WORKTREE";
  }
  return {
    health,
    localSha,
    remoteSha,
    branch,
    dirty,
    remoteUrl: remote.stdout,
    reasons,
  };
}

function syncStatus(health: RepositoryHealth): string {
  const values: Record<RepositoryHealth, string> = {
    HEALTHY: "synced",
    DIRTY: "dirty",
    LOCAL_ONLY: "local_only",
    MISSING: "missing",
    REMOTE_UNREACHABLE: "unreachable",
    REMOTE_NOT_PRIVATE: "remote_not_private",
    AHEAD: "ahead",
    BEHIND: "behind",
    DIVERGED: "diverged",
    SHA_MISMATCH: "sha_mismatch",
    STALE_WORKTREE: "dirty",
    WRONG_BRANCH: "sha_mismatch",
    REMOTE_URL_MISMATCH: "sha_mismatch",
  };
  return values[health];
}

export function refreshRepositoryState(
  db: CultDatabase,
  repositoryId: string,
  options: { fetch?: boolean; verifyPrivacy?: boolean } = {},
): RepositoryInspection {
  const inspection = inspectRepository(db, repositoryId, options);
  const at = now();
  db.prepare(
    `UPDATE repository SET remote_sha=?,sync_status=?,privacy_verified=?,privacy_verified_at=CASE WHEN ?=1 THEN ? ELSE privacy_verified_at END,last_fetch_at=CASE WHEN ?=1 THEN ? ELSE last_fetch_at END,last_verified_at=?,updated_at=? WHERE id=?`,
  ).run(
    inspection.remoteSha ?? null,
    syncStatus(inspection.health),
    inspection.health === "REMOTE_NOT_PRIVATE"
      ? 0
      : repositoryById(db, repositoryId).privacy_verified,
    inspection.health === "HEALTHY" ? 1 : 0,
    at,
    options.fetch ? 1 : 0,
    at,
    at,
    at,
    repositoryId,
  );
  return inspection;
}

export function acquireRepositoryLock(
  db: CultDatabase,
  repositoryId: string,
  workItemId: string,
  holder: string,
  ttlMs = 20 * 60_000,
): void {
  immediateTransaction(db, () => {
    db.prepare("DELETE FROM repository_lock WHERE expires_at<=?").run(now());
    const existing = db
      .prepare(
        "SELECT holder_work_item_id,holder FROM repository_lock WHERE repository_id=?",
      )
      .get(repositoryId) as
      { holder_work_item_id: string; holder: string } | undefined;
    if (existing) {
      const pid = existing.holder
          .split(":")
          .map(Number)
          .find(
            (candidate) => Number.isSafeInteger(candidate) && candidate > 0,
          ),
        alive = (() => {
          if (!pid) return true;
          try {
            process.kill(pid, 0);
            return true;
          } catch {
            return false;
          }
        })();
      if (!alive) {
        db.prepare(
          "DELETE FROM repository_lock WHERE repository_id=? AND holder=?",
        ).run(repositoryId, existing.holder);
        db.prepare("DELETE FROM runtime_lock WHERE owner=?").run(
          existing.holder,
        );
        db.prepare(
          `UPDATE employee_run SET status='CANCELLED',error_code='HOST_INTERRUPTED',finished_at=?
           WHERE work_item_id=? AND status='RUNNING'`,
        ).run(now(), existing.holder_work_item_id);
        const work = db
          .prepare("SELECT status,business_id FROM work_item WHERE id=?")
          .get(existing.holder_work_item_id) as
          { status: string; business_id: string | null } | undefined;
        if (work?.status === "RUNNING") {
          db.prepare(
            `UPDATE work_item SET status='READY',result='Recovered after an interrupted Cult4 host.',
             lock_owner=NULL,lock_expires_at=NULL,updated_at=? WHERE id=?`,
          ).run(now(), existing.holder_work_item_id);
          audit(db, {
            type: "WORK_STATUS_CHANGED",
            actorId: "system",
            businessId: work.business_id ?? undefined,
            subjectType: "WORK_ITEM",
            subjectId: existing.holder_work_item_id,
            data: { from: "RUNNING", to: "READY", recovery: "dead-host" },
          });
        }
      }
    }
    try {
      db.prepare(
        "INSERT INTO repository_lock(repository_id,holder_work_item_id,holder,acquired_at,expires_at) VALUES(?,?,?,?,?)",
      ).run(
        repositoryId,
        workItemId,
        holder,
        now(),
        new Date(Date.now() + ttlMs).toISOString(),
      );
    } catch {
      throw new Cult4Error(
        "Repository already has an active writer.",
        "REPOSITORY_LOCKED",
      );
    }
  });
}

export function releaseRepositoryLock(
  db: CultDatabase,
  repositoryId: string,
  workItemId: string,
): void {
  db.prepare(
    "DELETE FROM repository_lock WHERE repository_id=? AND holder_work_item_id=?",
  ).run(repositoryId, workItemId);
}

export function prepareWritableRepository(
  db: CultDatabase,
  repositoryId: string,
  workItemId: string,
  holder: string,
): { baseSha: string; path: string } {
  acquireRepositoryLock(db, repositoryId, workItemId, holder);
  try {
    const inspection = refreshRepositoryState(db, repositoryId, {
      fetch: true,
      verifyPrivacy: true,
    });
    const repo = repositoryById(db, repositoryId);
    if (inspection.health !== "HEALTHY" || !inspection.localSha)
      throw new Cult4Error(
        `Repository is not writable: ${inspection.health}.`,
        `REPOSITORY_${inspection.health}`,
        inspection,
      );
    if (inspection.localSha !== repo.current_sha)
      throw new Cult4Error(
        "Local SHA differs from SQLite.",
        "REPOSITORY_SHA_MISMATCH",
      );
    db.transaction(() => {
      db.prepare(
        "UPDATE work_item SET repository_id=?,base_sha=?,updated_at=? WHERE id=?",
      ).run(repositoryId, inspection.localSha, now(), workItemId);
      audit(db, {
        type: "WORK_STARTED_AT_SHA",
        actorId: "system",
        subjectType: "GIT_COMMIT",
        subjectId: repositoryId,
        subjectVersion: inspection.localSha,
        data: { workItemId },
      });
    })();
    return { baseSha: inspection.localSha, path: repo.local_path };
  } catch (error) {
    releaseRepositoryLock(db, repositoryId, workItemId);
    throw error;
  }
}

export function recoverStagedOperatorWork(
  db: CultDatabase,
  input: {
    repositoryId: string;
    businessId: string;
    employeeId: string;
  },
):
  | ({ workItemId: string } & ReturnType<typeof finalizeVersionedWork>)
  | undefined {
  const repo = repositoryById(db, input.repositoryId);
  const files = changedFiles(repo.local_path).sort();
  if (!files.length) return undefined;
  const staged = gitText(
    ["diff", "--cached", "--name-only", "-z"],
    repo.local_path,
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  if (
    staged.length !== files.length ||
    staged.some((file, index) => file !== files[index])
  )
    return undefined;
  const head = gitText(["rev-parse", "HEAD"], repo.local_path);
  if (!repo.current_sha || head !== repo.current_sha) return undefined;
  const branch = gitText(["branch", "--show-current"], repo.local_path);
  if (branch !== repo.default_branch) return undefined;
  const origin = gitText(
    ["remote", "get-url", repo.remote_name],
    repo.local_path,
  );
  if (origin !== repo.remote_url) return undefined;
  const fetched = runGit(
    ["fetch", repo.remote_name, repo.default_branch],
    repo.local_path,
    { allowFailure: true, timeoutMs: 60_000 },
  );
  if (!fetched.ok || remoteHead(repo.local_path, repo.remote_name) !== head)
    return undefined;
  const work = db
    .prepare(
      `SELECT w.id,w.title FROM work_item w
       WHERE w.business_id=? AND w.type='OPERATOR_INTERACTION' AND w.status='DONE'
         AND (w.repository_id IS NULL OR w.repository_id=?)
         AND (w.base_sha IS NULL OR w.base_sha=?)
         AND NOT EXISTS(SELECT 1 FROM git_commit c WHERE c.work_item_id=w.id)
       ORDER BY w.updated_at DESC LIMIT 1`,
    )
    .get(input.businessId, input.repositoryId, head) as
    { id: string; title: string } | undefined;
  if (!work) return undefined;
  acquireRepositoryLock(
    db,
    input.repositoryId,
    work.id,
    `legacy-interactive-recovery:${input.employeeId}`,
  );
  db.transaction(() => {
    db.prepare(
      "UPDATE work_item SET repository_id=?,base_sha=?,updated_at=? WHERE id=?",
    ).run(input.repositoryId, head, now(), work.id);
    audit(db, {
      type: "LEGACY_OPERATOR_WORK_RECOVERY_PREPARED",
      actorId: "system",
      businessId: input.businessId,
      subjectType: "WORK_ITEM",
      subjectId: work.id,
      subjectVersion: head,
      data: { repositoryId: input.repositoryId, files },
    });
  })();
  const finalized = finalizeVersionedWork(db, {
    repositoryId: input.repositoryId,
    workItemId: work.id,
    employeeId: input.employeeId,
    purpose: work.title,
  });
  return { workItemId: work.id, ...finalized };
}

function changedFiles(path: string): string[] {
  const worktree = runGit(
    [
      "ls-files",
      "--modified",
      "--deleted",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    path,
  ).stdout;
  const staged = runGit(
    ["diff", "--cached", "--name-only", "--diff-filter=ACDMRTUXB", "-z"],
    path,
  ).stdout;
  return [...new Set(`${worktree}\0${staged}`.split("\0").filter(Boolean))];
}

function assertAllowedFiles(files: string[]): void {
  const forbidden = files.find((file) =>
    /(^|\/)(\.env(?:\..*)?|secrets?|credentials?|state\.db(?:-.*)?|node_modules|runtime)(\/|$)/i.test(
      file,
    ),
  );
  if (forbidden)
    throw new Cult4Error(
      `Versioned change includes forbidden path: ${forbidden}`,
      "FORBIDDEN_VERSIONED_PATH",
    );
}

function runApplicableChecks(path: string): string[] {
  const packagePath = join(path, "package.json");
  if (!existsSync(packagePath)) return [];
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const ran: string[] = [];
  for (const name of ["lint", "typecheck", "test"])
    if (pkg.scripts?.[name]) {
      try {
        execFileSync("npm", ["run", name], {
          cwd: path,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 10 * 60_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        ran.push(name);
      } catch (error) {
        throw new Cult4Error(
          redact(String((error as { stderr?: string }).stderr ?? error)).slice(
            0,
            4000,
          ),
          "VERSIONED_CHECK_FAILED",
          { check: name },
        );
      }
    }
  return ran;
}

export function finalizeVersionedWork(
  db: CultDatabase,
  input: {
    repositoryId: string;
    workItemId: string;
    employeeId: string;
    purpose?: string;
    requireChanges?: boolean;
    organization?: boolean;
    checkpoint?: boolean;
  },
): {
  sha: string;
  changed: boolean;
  checks: string[];
  qaWorkItemId?: string;
} {
  const repo = repositoryById(db, input.repositoryId);
  const work = db
    .prepare("SELECT title,base_sha,status,type FROM work_item WHERE id=?")
    .get(input.workItemId) as
    | { title: string; base_sha: string | null; status: string; type: string }
    | undefined;
  if (!work?.base_sha)
    throw new Cult4Error("Work has no prepared base SHA.", "BASE_SHA_MISSING");
  try {
    const head = gitText(["rev-parse", "HEAD"], repo.local_path);
    if (head !== work.base_sha)
      throw new Cult4Error(
        "Agent changed Git history; Cult4 must own commits.",
        "UNEXPECTED_GIT_HISTORY_CHANGE",
      );
    const files = changedFiles(repo.local_path);
    assertAllowedFiles(files);
    if (!files.length) {
      if (input.requireChanges)
        throw new Cult4Error(
          "No versioned change was produced.",
          "NO_VERSIONED_CHANGE",
        );
      return { sha: head, changed: false, checks: [] };
    }
    const checks = input.checkpoint ? [] : runApplicableChecks(repo.local_path);
    gitText(["add", "--all"], repo.local_path);
    const shortTitle = work.title
      .replace(/[\r\n]+/g, " ")
      .trim()
      .slice(0, 72);
    const message = input.checkpoint
      ? `cult4 checkpoint(#${input.workItemId}): ${shortTitle}`
      : input.organization
        ? `cult4(org #${input.workItemId}): ${shortTitle}`
        : `cult4(#${input.workItemId}): ${shortTitle}`;
    const foundationApproval =
      work.type === "FOUNDATION_CHANGE"
        ? (db
            .prepare(
              `SELECT a.id FROM gate g JOIN approval a ON a.id=g.satisfied_by_approval_id
               WHERE g.work_item_id=? AND g.policy_id='FOUNDATION_CHANGE' AND g.human_only=1
                 AND g.status='SATISFIED'
                 AND a.decision='APPROVE' AND a.subject_version=?
               ORDER BY a.created_at DESC LIMIT 1`,
            )
            .get(input.workItemId, work.base_sha) as { id: string } | undefined)
        : undefined;
    if (work.type === "FOUNDATION_CHANGE" && !foundationApproval)
      throw new Cult4Error(
        "Foundation commit has no exact satisfied human approval.",
        "FOUNDATION_APPROVAL_MISSING",
      );
    const trailers = [
      `Cult4-Work-Item: ${input.workItemId}`,
      `Cult4-Employee: ${input.employeeId}`,
      `Cult4-Base-SHA: ${work.base_sha}`,
      ...(input.organization ? [`Cult4-Maintenance-Type: ${work.type}`] : []),
      ...(work.type === "FOUNDATION_CHANGE"
        ? [
            "Cult4-Foundation-Change: true",
            `Cult4-Human-Approval: ${foundationApproval?.id}`,
          ]
        : []),
    ].join("\n");
    gitText(
      [
        "-c",
        "user.name=Cult4",
        "-c",
        "user.email=cult4@localhost",
        "commit",
        "-m",
        message,
        "-m",
        trailers,
      ],
      repo.local_path,
    );
    const sha = gitText(["rev-parse", "HEAD"], repo.local_path);
    audit(db, {
      type: "COMMIT_CREATED",
      actorId: input.employeeId,
      subjectType: "GIT_COMMIT",
      subjectId: input.repositoryId,
      subjectVersion: sha,
      data: { workItemId: input.workItemId, baseSha: work.base_sha, checks },
    });
    if (gitText(["status", "--porcelain"], repo.local_path))
      throw new Cult4Error(
        "Repository is dirty after commit.",
        "REPOSITORY_DIRTY_AFTER_COMMIT",
      );
    const pushed = runGit(["push", repo.remote_name, "main"], repo.local_path, {
      allowFailure: true,
      timeoutMs: 60_000,
    });
    if (!pushed.ok) {
      db.prepare(
        "UPDATE repository SET sync_status='ahead',updated_at=? WHERE id=?",
      ).run(now(), input.repositoryId);
      db.prepare(
        "UPDATE work_item SET status='BLOCKED',result='BLOCKED_GIT_SYNC',result_sha=?,updated_at=? WHERE id=?",
      ).run(sha, now(), input.workItemId);
      throw new Cult4Error(
        "Commit exists locally but push failed.",
        "BLOCKED_GIT_SYNC",
      );
    }
    const remoteSha = remoteHead(repo.local_path, repo.remote_name);
    if (remoteSha !== sha)
      throw new Cult4Error(
        "Remote did not confirm exact commit.",
        "REMOTE_SHA_MISMATCH",
      );
    const parent = gitText(["rev-parse", `${sha}^`], repo.local_path);
    const at = now();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO git_commit(id,repository_id,sha,parent_sha,branch,work_item_id,employee_id,purpose,message,pushed_at,remote_verified_at,created_at)
         VALUES(?,?,?,?, 'main',?,?,?,?,?,?,?)`,
      ).run(
        id("commit"),
        input.repositoryId,
        sha,
        parent,
        input.workItemId,
        input.employeeId,
        input.purpose ?? work.title,
        message,
        at,
        at,
        at,
      );
      db.prepare(
        "UPDATE repository SET current_sha=?,remote_sha=?,sync_status='synced',last_push_at=?,last_verified_at=?,updated_at=? WHERE id=?",
      ).run(sha, sha, at, at, at, input.repositoryId);
      db.prepare(
        "UPDATE work_item SET subject_type='GIT_COMMIT',subject_id=?,subject_version=?,result_sha=?,updated_at=? WHERE id=?",
      ).run(input.repositoryId, sha, sha, at, input.workItemId);
      audit(db, {
        type: "COMMIT_PUSHED",
        actorId: input.employeeId,
        subjectType: "GIT_COMMIT",
        subjectId: input.repositoryId,
        subjectVersion: sha,
        data: { workItemId: input.workItemId, baseSha: work.base_sha, checks },
      });
    })();
    const qaWorkItemId = input.organization
      ? undefined
      : createWorkItem(db, {
          businessId: repo.owner_id ?? undefined,
          type: "DIGITAL_QA",
          title: `Independent QA for ${work.title}`,
          goal: `Review exact commit ${sha} without modifying it. Record tests, failures, evidence, and a PASS or FAIL bound only to this repository and SHA.`,
          createdBy: input.employeeId,
          assignedTo: "employee-qa",
          parentId: input.workItemId,
          status: "READY",
          priority: 90,
          risk: "MEDIUM",
          subjectType: "GIT_COMMIT",
          subjectId: input.repositoryId,
          subjectVersion: sha,
          repositoryId: input.repositoryId,
        });
    if (qaWorkItemId)
      db.prepare(
        `INSERT INTO work_request(work_item_id,request_id,contribution)
         SELECT ?,request_id,'VALIDATES' FROM work_request WHERE work_item_id=?`,
      ).run(qaWorkItemId, input.workItemId);
    return {
      sha,
      changed: true,
      checks,
      ...(qaWorkItemId ? { qaWorkItemId } : {}),
    };
  } finally {
    releaseRepositoryLock(db, input.repositoryId, input.workItemId);
  }
}

export function restoreRepository(
  db: CultDatabase,
  repositoryId: string,
): RepositoryInspection {
  const repo = repositoryById(db, repositoryId);
  if (!repo.remote_url || !repo.current_sha)
    throw new Cult4Error(
      "Repository has no durable remote state.",
      "RESTORE_REMOTE_MISSING",
    );
  assertSafeRemoteUrl(repo.remote_url);
  if (!existsSync(repo.local_path)) {
    mkdirSync(dirname(repo.local_path), { recursive: true, mode: 0o700 });
    runGit(
      ["clone", "--branch", "main", repo.remote_url, repo.local_path],
      dirname(repo.local_path),
    );
  } else {
    const dirty = gitText(["status", "--porcelain"], repo.local_path);
    if (dirty)
      throw new Cult4Error(
        "Dirty repository cannot be restored.",
        "RESTORE_DIRTY_WORKTREE",
      );
    const origin = gitText(["remote", "get-url", "origin"], repo.local_path);
    if (origin !== repo.remote_url)
      throw new Cult4Error(
        "Remote differs from SQLite.",
        "REMOTE_URL_MISMATCH",
      );
    gitText(["fetch", "origin", "main"], repo.local_path);
    const local = gitText(["rev-parse", "HEAD"], repo.local_path);
    const remote = remoteHead(repo.local_path);
    if (local !== remote) {
      if (
        remote !== repo.current_sha ||
        !isAncestor(repo.local_path, local, remote)
      )
        throw new Cult4Error(
          "Repository is divergent.",
          "RESTORE_REPOSITORY_DIVERGED",
        );
      gitText(["merge", "--ff-only", "origin/main"], repo.local_path);
    }
  }
  const inspection = inspectRepository(db, repositoryId, {
    fetch: true,
    verifyPrivacy: true,
  });
  if (
    inspection.health !== "HEALTHY" ||
    inspection.localSha !== repo.current_sha
  )
    throw new Cult4Error(
      "Restored repository SHA is inconsistent.",
      "RESTORE_SHA_MISMATCH",
    );
  audit(db, {
    type: "RESTORE_PERFORMED",
    actorId: "system",
    subjectType: "REPOSITORY",
    subjectId: repositoryId,
    subjectVersion: inspection.localSha,
  });
  return inspection;
}

export function removeMissingWorkingCopyForTest(path: string): void {
  if (process.env.NODE_ENV !== "test")
    throw new Cult4Error("Test-only helper refused.", "TEST_ONLY");
  rmSync(resolve(path), { recursive: true, force: true });
}
