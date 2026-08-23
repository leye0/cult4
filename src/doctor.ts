import { execFileSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { Cult4Config } from "./config.js";
import { LATEST_SCHEMA_VERSION, type CultDatabase } from "./db.js";
import { CORE_POLICY_VERSIONS } from "./policy.js";
import {
  inspectRepository,
  refreshRepositoryState,
  repositoryById,
  restoreRepository,
  runGit,
  verifyPrivateRemote,
  type RepositoryHealth,
} from "./git.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  detail: string;
}

function check(
  name: string,
  ok: boolean,
  detail: string,
  severity: DoctorCheck["severity"] = "ERROR",
): DoctorCheck {
  return { name, ok, detail, severity: ok ? "INFO" : severity };
}

function commandVersion(command: string): string | undefined {
  try {
    return execFileSync(command, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    }).trim();
  } catch {
    return undefined;
  }
}

function healthSeverity(health: RepositoryHealth): DoctorCheck["severity"] {
  if (health === "REMOTE_NOT_PRIVATE") return "CRITICAL";
  if (health === "LOCAL_ONLY" || health === "REMOTE_UNREACHABLE")
    return "ERROR";
  return health === "HEALTHY" ? "INFO" : "ERROR";
}

export function doctor(db: CultDatabase, config: Cult4Config): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const git = commandVersion("git"),
    opencode = commandVersion("opencode");
  checks.push(
    check("git", Boolean(git), git ?? "not found", "CRITICAL"),
    check("opencode", Boolean(opencode), opencode ?? "not found", "CRITICAL"),
  );
  try {
    const integrity = (
      db.pragma("integrity_check") as Array<{ integrity_check: string }>
    )[0]?.integrity_check;
    checks.push(
      check(
        "database",
        integrity === "ok",
        integrity ?? "no result",
        "CRITICAL",
      ),
    );
  } catch (error) {
    checks.push(check("database", false, String(error), "CRITICAL"));
  }
  const migration = db
    .prepare("SELECT max(version) version FROM schema_migration")
    .get() as { version: number };
  checks.push(
    check(
      "migrations",
      migration.version === LATEST_SCHEMA_VERSION,
      `schema ${migration.version}`,
      "CRITICAL",
    ),
  );
  const secretMode = existsSync(config.secretsPath)
    ? statSync(config.secretsPath).mode & 0o777
    : 0;
  checks.push(
    check(
      "secrets permissions",
      secretMode === 0o700,
      secretMode.toString(8),
      "CRITICAL",
    ),
  );

  const repositories = db
    .prepare("SELECT id FROM repository ORDER BY owner_type,owner_id")
    .all() as Array<{ id: string }>;
  checks.push(
    check(
      "GIT000 repositories registered",
      repositories.length > 0,
      `${repositories.length} repositories`,
      "CRITICAL",
    ),
  );
  for (const { id } of repositories) {
    const repo = repositoryById(db, id);
    const prefix = `${repo.owner_type}:${repo.owner_id ?? "organization"}`;
    const pathExists = existsSync(repo.local_path);
    const validGit =
      pathExists &&
      runGit(["rev-parse", "--is-inside-work-tree"], repo.local_path, {
        allowFailure: true,
      }).ok;
    const gitValue = (args: string[]): string =>
      validGit
        ? runGit(args, repo.local_path, { allowFailure: true }).stdout
        : "";
    const branch = gitValue(["branch", "--show-current"]);
    const porcelain = gitValue(["status", "--porcelain"]);
    const origin = gitValue(["remote", "get-url", repo.remote_name]);
    const localSha = gitValue(["rev-parse", "HEAD"]);
    const remoteResult =
      validGit && origin
        ? runGit(
            ["ls-remote", repo.remote_name, "refs/heads/main"],
            repo.local_path,
            { allowFailure: true },
          )
        : { ok: false, stdout: "", stderr: "origin unavailable" };
    const remoteSha = remoteResult.stdout.split(/\s+/)[0] ?? "";
    const remoteMainExists =
      remoteResult.ok && /^[0-9a-f]{40,64}$/i.test(remoteSha);
    const privateRemote =
      Boolean(repo.remote_url) && verifyPrivateRemote(repo.remote_url);
    const localIsRemoteAncestor =
      Boolean(localSha && remoteMainExists) &&
      runGit(
        ["merge-base", "--is-ancestor", localSha, remoteSha],
        repo.local_path,
        {
          allowFailure: true,
        },
      ).ok;
    const remoteIsLocalAncestor =
      Boolean(localSha && remoteMainExists) &&
      runGit(
        ["merge-base", "--is-ancestor", remoteSha, localSha],
        repo.local_path,
        {
          allowFailure: true,
        },
      ).ok;
    let inspection;
    try {
      inspection = inspectRepository(db, id, {
        fetch: true,
        verifyPrivacy: true,
      });
    } catch (error) {
      checks.push(check(`${id} Git integrity`, false, String(error), "ERROR"));
    }
    checks.push(
      check(`${prefix} GIT001 path`, pathExists, repo.local_path, "ERROR"),
      check(
        `${prefix} GIT002 repository`,
        validGit,
        validGit ? "valid Git worktree" : "not a Git worktree",
        "ERROR",
      ),
      check(
        `${prefix} GIT003 branch`,
        branch === "main",
        branch || "missing",
        "ERROR",
      ),
      check(
        `${prefix} GIT004 clean`,
        validGit && !porcelain,
        porcelain ? "dirty" : validGit ? "clean" : "unavailable",
        "ERROR",
      ),
      check(
        `${prefix} GIT005 origin`,
        Boolean(origin),
        origin || "missing",
        "ERROR",
      ),
      check(
        `${prefix} GIT006 remote URL`,
        Boolean(origin) && origin === repo.remote_url,
        origin === repo.remote_url ? "matches SQLite" : "differs from SQLite",
        "ERROR",
      ),
      check(
        `${prefix} GIT007 credentials`,
        !/https?:\/\/[^/@]+@/i.test(repo.remote_url),
        "remote URL contains no embedded credentials",
        "CRITICAL",
      ),
      check(
        `${prefix} GIT008 reachable`,
        remoteResult.ok,
        remoteResult.ok ? "origin reachable" : remoteResult.stderr,
        "ERROR",
      ),
      check(
        `${prefix} GIT009 private`,
        privateRemote,
        privateRemote ? "PRIVATE verified" : "PUBLIC or unverifiable",
        "CRITICAL",
      ),
      check(
        `${prefix} GIT010 remote main`,
        remoteMainExists,
        remoteMainExists ? remoteSha : "origin/main missing",
        "ERROR",
      ),
      check(
        `${prefix} GIT011 local SHA`,
        Boolean(localSha),
        localSha || "missing",
      ),
      check(
        `${prefix} GIT012 remote SHA`,
        remoteMainExists,
        remoteSha || "missing",
      ),
      check(
        `${prefix} GIT013 SQLite SHA`,
        Boolean(repo.current_sha),
        repo.current_sha ?? "missing",
        "CRITICAL",
      ),
      check(
        `${prefix} GIT014 local == remote`,
        Boolean(localSha) && localSha === remoteSha,
        `local=${localSha || "?"} remote=${remoteSha || "?"}`,
      ),
      check(
        `${prefix} GIT015 local == SQLite`,
        Boolean(localSha) && localSha === repo.current_sha,
        `local=${localSha || "?"} sqlite=${repo.current_sha ?? "?"}`,
      ),
      check(
        `${prefix} GIT016 not diverged`,
        Boolean(localSha && remoteMainExists) &&
          (localIsRemoteAncestor || remoteIsLocalAncestor),
        localIsRemoteAncestor || remoteIsLocalAncestor
          ? "history related"
          : "histories diverged or unavailable",
        "ERROR",
      ),
      check(
        `${prefix} repository health`,
        inspection?.health === "HEALTHY",
        inspection?.health ?? "inspection failed",
        inspection ? healthSeverity(inspection.health) : "ERROR",
      ),
    );
    if (repo.privacy_verified_at) {
      const age = Date.now() - Date.parse(repo.privacy_verified_at);
      checks.push(
        check(
          `${prefix} privacy freshness`,
          age <= 7 * 24 * 60 * 60_000,
          `${Math.floor(age / (24 * 60 * 60_000))} days old`,
          "WARNING",
        ),
      );
    }
    if (validGit) {
      const listed = runGit(
        ["worktree", "list", "--porcelain"],
        repo.local_path,
        {
          allowFailure: true,
        },
      ).stdout;
      const actual = listed
        .split(/\r?\n/)
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice(9));
      const expected = [
        repo.local_path,
        ...(
          db
            .prepare(
              "SELECT path FROM review_worktree WHERE repository_id=? AND status='ACTIVE'",
            )
            .all(id) as Array<{ path: string }>
        ).map((row) => row.path),
      ];
      const unexpected = actual.filter((path) => !expected.includes(path));
      checks.push(
        check(
          `${prefix} GIT017 worktrees`,
          !unexpected.length,
          unexpected.join(", ") || "no stale worktrees",
          "ERROR",
        ),
      );
    }
  }

  const activeQa = db
    .prepare(
      "SELECT path,commit_sha FROM review_worktree WHERE status='ACTIVE'",
    )
    .all() as Array<{ path: string; commit_sha: string }>;
  for (const qa of activeQa) {
    const actual = existsSync(qa.path)
      ? runGit(["rev-parse", "HEAD"], qa.path, { allowFailure: true }).stdout
      : "";
    checks.push(
      check(
        "GIT018 active QA worktree SHA",
        actual === qa.commit_sha,
        `${actual || "missing"} expected ${qa.commit_sha}`,
        "ERROR",
      ),
    );
  }
  const staleQa = db
    .prepare("SELECT path FROM review_worktree WHERE status='REMOVED'")
    .all() as Array<{ path: string }>;
  checks.push(
    check(
      "GIT019 completed QA cleanup",
      staleQa.every((row) => !existsSync(row.path)),
      "completed worktrees absent",
      "ERROR",
    ),
  );
  const orphanApprovals = (
    db
      .prepare(
        `SELECT count(*) count FROM approval a LEFT JOIN git_commit c ON c.repository_id=a.repository_id AND c.sha=a.subject_version
         WHERE a.subject_type='GIT_COMMIT' AND (a.repository_id IS NULL OR c.id IS NULL)`,
      )
      .get() as { count: number }
  ).count;
  checks.push(
    check(
      "GIT020 approval commits",
      orphanApprovals === 0,
      `${orphanApprovals} orphan approvals`,
      "CRITICAL",
    ),
  );
  checks.push(
    check(
      "GIT021 Foundation path",
      existsSync(join(config.organizationPath, "foundation/FOUNDATION.md")) &&
        !existsSync(join(config.organizationPath, "FOUNDATION.md")),
      "foundation/FOUNDATION.md canonical and root copy absent",
      "ERROR",
    ),
  );
  const expected = db
    .prepare("SELECT opencode_agent_name FROM employee WHERE status='ACTIVE'")
    .all() as Array<{ opencode_agent_name: string }>;
  checks.push(
    check(
      "employee agents",
      expected.every((e) =>
        existsSync(join(config.agentsPath, `${e.opencode_agent_name}.md`)),
      ) && existsSync(join(config.agentsPath, "cult4-intake.md")),
      `${expected.length} active plus restricted intake`,
      "ERROR",
    ),
    check(
      "Cult4 tools",
      existsSync(join(config.toolsPath, "cult4.ts")),
      join(config.toolsPath, "cult4.ts"),
      "ERROR",
    ),
    check(
      "core policies",
      Object.keys(CORE_POLICY_VERSIONS).length === 9 &&
        "BUSINESS_ASSURANCE" in CORE_POLICY_VERSIONS,
      Object.entries(CORE_POLICY_VERSIONS)
        .map(([key, version]) => `${key}@${version}`)
        .join(", "),
      "CRITICAL",
    ),
  );
  const marketEmployee = db
    .prepare(
      "SELECT 1 FROM employee WHERE slug='cultural-market-intelligence' AND status='ACTIVE'",
    )
    .get();
  const marketOwner = db
    .prepare(
      `SELECT 1 FROM responsibility_owner ro JOIN responsibility r ON r.id=ro.responsibility_id JOIN employee e ON e.id=ro.actor_id WHERE r.slug='CULTURAL_MARKET_INTELLIGENCE' AND e.slug='cultural-market-intelligence' AND ro.active=1 AND e.status='ACTIVE'`,
    )
    .get();
  const malformedStudies = (
    db
      .prepare(
        "SELECT count(*) count FROM market_study WHERE status='COMPLETE' AND (completed_at IS NULL OR valid_until IS NULL OR confidence IS NULL)",
      )
      .get() as { count: number }
  ).count;
  const designBypasses = (
    db
      .prepare(
        `SELECT count(*) count FROM work_item w JOIN product_version pv ON w.subject_type='PRODUCT_VERSION' AND pv.id=w.subject_id JOIN product p ON p.id=pv.product_id WHERE w.type IN ('DESIGN','CREATIVE_PRODUCTION') AND w.status IN ('READY','RUNNING','DONE') AND p.commercial=1 AND (p.creative=1 OR p.culture_sensitive=1 OR p.trend_sensitive=1 OR p.identity_sensitive=1) AND NOT EXISTS(SELECT 1 FROM gate g WHERE g.work_item_id=w.id AND g.policy_id='MARKET_RELEVANCE_REQUIRED')`,
      )
      .get() as { count: number }
  ).count;
  checks.push(
    check(
      "Market Intelligence employee",
      Boolean(marketEmployee),
      marketEmployee ? "seeded and active" : "missing or inactive",
      "CRITICAL",
    ),
    check(
      "Market Intelligence responsibility",
      Boolean(marketOwner),
      marketOwner ? "owned by seeded analyst" : "owner missing",
      "CRITICAL",
    ),
    check(
      "MARKET_RELEVANCE policy",
      "MARKET_RELEVANCE_REQUIRED" in CORE_POLICY_VERSIONS,
      `MARKET_RELEVANCE_REQUIRED@${CORE_POLICY_VERSIONS.MARKET_RELEVANCE_REQUIRED}`,
      "CRITICAL",
    ),
    check(
      "complete MarketStudy structure",
      malformedStudies === 0,
      `${malformedStudies} malformed complete studies`,
      "CRITICAL",
    ),
    check(
      "culture-sensitive design gates",
      designBypasses === 0,
      `${designBypasses} active design work items bypassing MARKET_RELEVANCE`,
      "CRITICAL",
    ),
  );
  return checks;
}

/** Performs only the explicitly safe doctor repairs; never resets or discards work. */
export function repairDoctor(db: CultDatabase, config: Cult4Config): string[] {
  const repaired: string[] = [];
  const repositories = db.prepare("SELECT id FROM repository").all() as Array<{
    id: string;
  }>;
  for (const { id } of repositories) {
    const repo = repositoryById(db, id);
    if (!existsSync(repo.local_path)) {
      restoreRepository(db, id);
      repaired.push(`${id}: cloned missing working copy`);
      continue;
    }
    if (
      runGit(["rev-parse", "--is-inside-work-tree"], repo.local_path, {
        allowFailure: true,
      }).ok
    ) {
      runGit(["worktree", "prune"], repo.local_path);
      repaired.push(`${id}: pruned worktree metadata`);
      refreshRepositoryState(db, id, { fetch: true, verifyPrivacy: true });
      repaired.push(`${id}: refreshed remote and privacy state`);
    }
  }
  const runtimeRoot = resolve(config.runtimePath);
  const removed = db
    .prepare("SELECT path FROM review_worktree WHERE status='REMOVED'")
    .all() as Array<{ path: string }>;
  for (const row of removed) {
    const target = resolve(row.path);
    const rel = relative(runtimeRoot, target);
    if (
      existsSync(target) &&
      rel &&
      !rel.startsWith("..") &&
      !isAbsolute(rel)
    ) {
      rmSync(target, { recursive: true, force: true });
      repaired.push(`removed stale QA runtime ${target}`);
    }
  }
  return repaired;
}
