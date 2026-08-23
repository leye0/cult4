import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cult4Config } from "./config.js";
import { getConfig } from "./config.js";
import type { CultDatabase } from "./db.js";
import { Cult4Error, id, now } from "./domain.js";
import { audit } from "./audit.js";
import { grantApproval, requireGate } from "./approval.js";
import { repositoryById, runGit } from "./git.js";
import { evaluateAction } from "./policy.js";
import { bootstrapEmployee } from "./employee.js";
import {
  CliOpenCodeRunner,
  resolveOpenCodeModel,
  type OpenCodeRunner,
} from "./opencode.js";
import { transitionWorkItem } from "./work.js";
import { configuredProviderOptions } from "./secrets.js";
import { z } from "zod";

function fullCommit(path: string, sha: string): string {
  if (!/^[0-9a-f]{7,64}$/i.test(sha))
    throw new Cult4Error(
      "Review requires a Git commit SHA.",
      "INVALID_SUBJECT_VERSION",
    );
  const resolved = runGit(["rev-parse", `${sha}^{commit}`], path, {
    allowFailure: true,
  });
  if (!resolved.ok || !/^[0-9a-f]{40,64}$/i.test(resolved.stdout))
    throw new Cult4Error(
      "Review commit does not exist.",
      "GIT_COMMIT_NOT_FOUND",
    );
  return resolved.stdout;
}

export function createQaWorktree(
  db: CultDatabase,
  repositoryId: string,
  commitSha: string,
  qaWorkItemId: string,
  config: Cult4Config = getConfig(),
): string {
  const repo = repositoryById(db, repositoryId);
  if (repo.owner_type !== "business" || !repo.owner_id)
    throw new Cult4Error(
      "QA worktree requires a Business repository.",
      "QA_BUSINESS_REQUIRED",
    );
  const sha = fullCommit(repo.local_path, commitSha);
  if (
    !db
      .prepare(
        "SELECT 1 FROM git_commit WHERE repository_id=? AND sha=? AND pushed_at IS NOT NULL",
      )
      .get(repositoryId, sha)
  )
    throw new Cult4Error(
      "QA requires a pushed Cult4 commit.",
      "QA_COMMIT_NOT_DURABLE",
    );
  const work = db
    .prepare(
      "SELECT business_id,subject_version,repository_id,assigned_to FROM work_item WHERE id=?",
    )
    .get(qaWorkItemId) as
    | {
        business_id: string | null;
        subject_version: string | null;
        repository_id: string | null;
        assigned_to: string | null;
      }
    | undefined;
  if (!work || work.business_id !== repo.owner_id)
    throw new Cult4Error(
      "QA WorkItem does not belong to repository Business.",
      "QA_WORK_MISMATCH",
    );
  if (work.subject_version && work.subject_version !== sha)
    throw new Cult4Error(
      "QA WorkItem targets another SHA.",
      "SUBJECT_VERSION_MISMATCH",
    );
  if (work.repository_id && work.repository_id !== repositoryId)
    throw new Cult4Error(
      "QA WorkItem targets another repository.",
      "REPOSITORY_MISMATCH",
    );
  const target = join(
    config.runtimePath,
    "worktrees",
    repo.id,
    `qa-${qaWorkItemId}`,
    sha.slice(0, 12),
  );
  if (existsSync(target))
    throw new Cult4Error(
      "QA worktree already exists.",
      "REVIEW_WORKTREE_EXISTS",
    );
  mkdirSync(join(target, ".."), { recursive: true, mode: 0o700 });
  runGit(["worktree", "add", "--detach", target, sha], repo.local_path);
  const actual = runGit(["rev-parse", "HEAD"], target).stdout;
  const symbolic = runGit(["symbolic-ref", "-q", "HEAD"], target, {
    allowFailure: true,
  });
  const dirty = runGit(["status", "--porcelain"], target).stdout;
  if (actual !== sha || symbolic.ok || dirty) {
    runGit(["worktree", "remove", "--force", target], repo.local_path, {
      allowFailure: true,
    });
    throw new Cult4Error(
      "QA worktree invariants failed.",
      "QA_WORKTREE_INVALID",
    );
  }
  db.transaction(() => {
    db.prepare(
      "UPDATE work_item SET repository_id=?,subject_type='GIT_COMMIT',subject_id=?,subject_version=?,updated_at=? WHERE id=?",
    ).run(repositoryId, repositoryId, sha, now(), qaWorkItemId);
    db.prepare(
      `INSERT INTO review_worktree(work_item_id,business_id,commit_sha,path,status,created_at,repository_id)
       VALUES(?,?,?,?,'ACTIVE',?,?)`,
    ).run(qaWorkItemId, repo.owner_id, sha, target, now(), repositoryId);
    audit(db, {
      type: "QA_WORKTREE_CREATED",
      actorId: "system",
      businessId: repo.owner_id ?? undefined,
      subjectType: "GIT_COMMIT",
      subjectId: repositoryId,
      subjectVersion: sha,
      data: { workItemId: qaWorkItemId, path: target },
    });
    audit(db, {
      type: "QA_STARTED",
      actorId: String(work.assigned_to ?? "employee-qa"),
      businessId: repo.owner_id ?? undefined,
      subjectType: "GIT_COMMIT",
      subjectId: repositoryId,
      subjectVersion: sha,
      data: { workItemId: qaWorkItemId },
    });
  })();
  return target;
}

export function removeQaWorktree(db: CultDatabase, qaWorkItemId: string): void {
  const row = db
    .prepare(
      "SELECT rw.path,rw.repository_id,r.local_path FROM review_worktree rw JOIN repository r ON r.id=rw.repository_id WHERE rw.work_item_id=? AND rw.status='ACTIVE'",
    )
    .get(qaWorkItemId) as
    { path: string; repository_id: string; local_path: string } | undefined;
  if (!row) return;
  runGit(["worktree", "remove", "--force", row.path], row.local_path);
  runGit(["worktree", "prune"], row.local_path);
  if (existsSync(row.path))
    throw new Cult4Error(
      "QA worktree path remains after cleanup.",
      "QA_CLEANUP_REQUIRED",
    );
  db.prepare(
    "UPDATE review_worktree SET status='REMOVED',removed_at=? WHERE work_item_id=?",
  ).run(now(), qaWorkItemId);
  audit(db, {
    type: "QA_WORKTREE_REMOVED",
    actorId: "system",
    subjectType: "WORK_ITEM",
    subjectId: qaWorkItemId,
  });
}

export function completeQaReview(
  db: CultDatabase,
  input: {
    workItemId: string;
    qaEmployeeId: string;
    result: "PASS" | "FAIL" | "CONDITIONAL_PASS";
    testsRun: string[];
    failures?: string[];
    evidence?: string[];
    notes?: string;
  },
): { reviewId: string; approvalId?: string } {
  const work = db
    .prepare(
      "SELECT repository_id,subject_version,business_id,assigned_to,created_at FROM work_item WHERE id=?",
    )
    .get(input.workItemId) as
    | {
        repository_id: string | null;
        subject_version: string | null;
        business_id: string | null;
        assigned_to: string | null;
        created_at: string;
      }
    | undefined;
  if (!work?.repository_id || !work.subject_version)
    throw new Cult4Error(
      "QA WorkItem has no exact repository and SHA.",
      "QA_SUBJECT_MISSING",
    );
  if (work.assigned_to && work.assigned_to !== input.qaEmployeeId)
    throw new Cult4Error(
      "QA WorkItem belongs to another Employee.",
      "WORK_ASSIGNMENT_MISMATCH",
    );
  const commit = db
    .prepare(
      "SELECT employee_id FROM git_commit WHERE repository_id=? AND sha=?",
    )
    .get(work.repository_id, work.subject_version) as
    { employee_id: string | null } | undefined;
  if (!commit)
    throw new Cult4Error(
      "Reviewed commit is not registered.",
      "GIT_COMMIT_NOT_FOUND",
    );
  if (commit.employee_id === input.qaEmployeeId)
    throw new Cult4Error(
      "Commit producer cannot perform independent QA.",
      "SELF_REVIEW_FORBIDDEN",
    );
  const reviewId = id("qa-review");
  let approvalId: string | undefined;
  try {
    db.prepare(
      `INSERT INTO qa_review(id,work_item_id,repository_id,reviewed_sha,qa_employee_id,result,tests_run,failures,evidence,notes,started_at,completed_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      reviewId,
      input.workItemId,
      work.repository_id,
      work.subject_version,
      input.qaEmployeeId,
      input.result,
      JSON.stringify(input.testsRun),
      JSON.stringify(input.failures ?? []),
      JSON.stringify(input.evidence ?? []),
      input.notes ?? null,
      work.created_at,
      now(),
    );
    if (input.result === "PASS") {
      const gateId = requireGate(db, {
        repositoryId: work.repository_id,
        workItemId: input.workItemId,
        responsibility: "release_quality",
        authority: "APPROVE_RELEASE_QUALITY",
        policyId: "PRODUCTION_RELEASE",
        policyVersion: 1,
        subjectType: "GIT_COMMIT",
        subjectId: work.repository_id,
        subjectVersion: work.subject_version,
        producerActorId: commit.employee_id ?? undefined,
        independent: true,
      });
      approvalId = grantApproval(db, gateId, input.qaEmployeeId, input.notes);
    }
    audit(db, {
      type: input.result === "PASS" ? "QA_PASSED" : "QA_FAILED",
      actorId: input.qaEmployeeId,
      businessId: work.business_id ?? undefined,
      subjectType: "GIT_COMMIT",
      subjectId: work.repository_id,
      subjectVersion: work.subject_version,
      data: {
        reviewId,
        workItemId: input.workItemId,
        testsRun: input.testsRun,
      },
    });
    return { reviewId, ...(approvalId ? { approvalId } : {}) };
  } finally {
    removeQaWorktree(db, input.workItemId);
  }
}

export function createReleaseCandidate(
  db: CultDatabase,
  repositoryId: string,
  sha: string,
  createdBy: string,
): string {
  const repo = repositoryById(db, repositoryId);
  const exact = fullCommit(repo.local_path, sha);
  if (
    !db
      .prepare(
        "SELECT 1 FROM git_commit WHERE repository_id=? AND sha=? AND pushed_at IS NOT NULL AND remote_verified_at IS NOT NULL",
      )
      .get(repositoryId, exact)
  )
    throw new Cult4Error(
      "Release candidate is not a durable commit.",
      "RELEASE_COMMIT_NOT_DURABLE",
    );
  const candidateId = id("release-candidate");
  db.prepare(
    "INSERT INTO release_candidate(id,repository_id,sha,created_by,status,created_at) VALUES(?,?,?,?,'PROPOSED',?)",
  ).run(candidateId, repositoryId, exact, createdBy, now());
  return candidateId;
}

export function approveReleaseCandidate(
  db: CultDatabase,
  candidateId: string,
  actorId: string,
): { allowed: boolean; reasons: string[] } {
  const candidate = db
    .prepare(
      `SELECT rc.repository_id,rc.sha,r.owner_id business_id FROM release_candidate rc
       JOIN repository r ON r.id=rc.repository_id WHERE rc.id=? AND rc.status='PROPOSED'`,
    )
    .get(candidateId) as
    | { repository_id: string; sha: string; business_id: string | null }
    | undefined;
  if (!candidate)
    throw new Cult4Error(
      "Release candidate not found.",
      "RELEASE_CANDIDATE_NOT_FOUND",
    );
  const decision = evaluateAction(
    db,
    {
      actionType: "RELEASE_CODE",
      actorId,
      businessId: candidate.business_id ?? undefined,
      subjectType: "GIT_COMMIT",
      subjectId: candidate.repository_id,
      subjectVersion: candidate.sha,
    },
    true,
  );
  if (decision.allowed)
    db.prepare("UPDATE release_candidate SET status='APPROVED' WHERE id=?").run(
      candidateId,
    );
  return { allowed: decision.allowed, reasons: decision.denialReasons };
}

const qaReportSchema = z.object({
  result: z.enum(["PASS", "FAIL", "CONDITIONAL_PASS"]),
  testsRun: z.array(z.string()),
  failures: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

function parseQaReport(
  text: string | undefined,
): z.infer<typeof qaReportSchema> {
  if (!text)
    return {
      result: "FAIL",
      testsRun: [],
      failures: ["QA agent returned no structured report."],
      evidence: [],
    };
  const start = text.lastIndexOf("{");
  try {
    return qaReportSchema.parse(JSON.parse(text.slice(start)));
  } catch {
    return {
      result: "FAIL",
      testsRun: [],
      failures: ["QA agent returned an invalid structured report."],
      evidence: [text.slice(-2000)],
    };
  }
}

export function qaSessionConfig(config: Cult4Config): unknown {
  return {
    $schema: "https://opencode.ai/config.json",
    ...configuredProviderOptions(config),
    permission: {
      read: {
        "*": "allow",
        "*.env": "deny",
        "*.env.*": "deny",
        [`${config.secretsPath}/**`]: "deny",
        [`${config.databasePath}*`]: "deny",
      },
      edit: "deny",
      bash: {
        "*": "allow",
        "git commit*": "deny",
        "git push*": "deny",
        "git reset*": "deny",
        "git rebase*": "deny",
        "git checkout*": "deny",
        "git switch*": "deny",
        "git merge*": "deny",
        "git worktree*": "deny",
        "git *commit*": "deny",
        "git *push*": "deny",
        "git *reset*": "deny",
        "git *rebase*": "deny",
        "git *checkout*": "deny",
        "git *switch*": "deny",
        "git *merge*": "deny",
        "git *worktree*": "deny",
        "*secrets*": "deny",
        "*state.db*": "deny",
      },
      external_directory: {
        "*": "deny",
        [`${config.organizationPath}/**`]: "allow",
      },
      question: "deny",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
    },
  };
}

export async function runQaWorkItem(
  db: CultDatabase,
  workItemId: string,
  runner: OpenCodeRunner = new CliOpenCodeRunner(),
  config: Cult4Config = getConfig(),
): Promise<{
  ok: boolean;
  result: "PASS" | "FAIL" | "CONDITIONAL_PASS";
  approvalId?: string;
  sessionId?: string;
  costCents: number;
}> {
  const work = db
    .prepare(
      "SELECT repository_id,subject_version,assigned_to,status FROM work_item WHERE id=? AND type='DIGITAL_QA'",
    )
    .get(workItemId) as
    | {
        repository_id: string | null;
        subject_version: string | null;
        assigned_to: string | null;
        status: string;
      }
    | undefined;
  if (!work?.repository_id || !work.subject_version || work.status !== "READY")
    throw new Cult4Error(
      "QA WorkItem is not ready or lacks an exact SHA.",
      "QA_WORK_NOT_READY",
    );
  const employeeId = work.assigned_to ?? "employee-qa";
  const employee = db
    .prepare(
      "SELECT opencode_agent_name,model FROM employee WHERE id=? AND status='ACTIVE'",
    )
    .get(employeeId) as
    { opencode_agent_name: string; model: string | null } | undefined;
  if (!employee)
    throw new Cult4Error("QA Employee is missing.", "EMPLOYEE_NOT_FOUND");
  const path = createQaWorktree(
    db,
    work.repository_id,
    work.subject_version,
    workItemId,
    config,
  );
  const runtimeConfig = join(
    config.runtimePath,
    `opencode-qa-${workItemId}.json`,
  );
  writeFileSync(
    runtimeConfig,
    `${JSON.stringify(qaSessionConfig(config), null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  transitionWorkItem(db, workItemId, "RUNNING", "system");
  const runId = id("run");
  db.prepare(
    "INSERT INTO employee_run(id,employee_id,work_item_id,status,created_at) VALUES(?,?,?,'RUNNING',?)",
  ).run(runId, employeeId, workItemId, now());
  try {
    const mission = bootstrapEmployee(db, employeeId, workItemId);
    const run = await runner.runTask({
      directory: path,
      agentName: employee.opencode_agent_name,
      prompt: `${mission.prompt}\n\nYou are independent QA on immutable commit ${work.subject_version}. Do not modify files or Git history. Run applicable checks and inspect evidence. End with only one JSON object: {"result":"PASS|FAIL|CONDITIONAL_PASS","testsRun":["..."],"failures":["..."],"evidence":["..."],"notes":"..."}.`,
      timeoutMs: 15 * 60_000,
      configFile: runtimeConfig,
      environment: {
        CULT4_EMPLOYEE: employeeId,
        CULT4_WORK_ITEM: workItemId,
      },
      model: resolveOpenCodeModel(employee.model),
    });
    const report = run.ok
      ? parseQaReport(run.finalText)
      : {
          result: "FAIL" as const,
          testsRun: [],
          failures: [
            run.errorSummary ?? run.errorCode ?? "QA execution failed",
          ],
          evidence: [],
        };
    db.prepare(
      "UPDATE employee_run SET session_id=?,status=?,duration_ms=?,cost_cents=?,input_tokens=?,output_tokens=?,error_code=?,finished_at=? WHERE id=?",
    ).run(
      run.sessionId ?? null,
      run.ok ? "COMPLETED" : "FAILED",
      run.durationMs,
      run.costCents,
      run.inputTokens,
      run.outputTokens,
      run.errorCode ?? null,
      now(),
      runId,
    );
    const completed = completeQaReview(db, {
      workItemId,
      qaEmployeeId: employeeId,
      ...report,
    });
    const terminalStatus = run.ok ? "DONE" : "FAILED";
    const currentStatus = (
      db.prepare("SELECT status FROM work_item WHERE id=?").get(workItemId) as {
        status: string;
      }
    ).status;
    if (currentStatus === "RUNNING")
      transitionWorkItem(
        db,
        workItemId,
        terminalStatus,
        "system",
        JSON.stringify(report),
      );
    else if (currentStatus !== terminalStatus)
      throw new Cult4Error(
        `QA host result ${terminalStatus} conflicts with WorkItem status ${currentStatus}.`,
        "QA_WORK_STATUS_CONFLICT",
      );
    return {
      ok: run.ok && report.result === "PASS",
      result: report.result,
      ...(completed.approvalId ? { approvalId: completed.approvalId } : {}),
      ...(run.sessionId ? { sessionId: run.sessionId } : {}),
      costCents: run.costCents,
    };
  } finally {
    removeQaWorktree(db, workItemId);
    try {
      unlinkSync(runtimeConfig);
    } catch {
      // The policy file contains no credentials.
    }
  }
}

// Backward-compatible narrow wrappers.
export function createReviewWorktree(
  db: CultDatabase,
  workItemId: string,
  commitSha: string,
  config: Cult4Config = getConfig(),
): string {
  const work = db
    .prepare("SELECT repository_id,business_id FROM work_item WHERE id=?")
    .get(workItemId) as
    { repository_id: string | null; business_id: string | null } | undefined;
  const repositoryId =
    work?.repository_id ??
    (work?.business_id
      ? (
          db
            .prepare(
              "SELECT id FROM repository WHERE owner_type='business' AND owner_id=?",
            )
            .get(work.business_id) as { id: string } | undefined
        )?.id
      : undefined);
  if (!repositoryId)
    throw new Cult4Error("QA repository is missing.", "REPOSITORY_NOT_FOUND");
  return createQaWorktree(db, repositoryId, commitSha, workItemId, config);
}

export function removeReviewWorktree(
  db: CultDatabase,
  _businessId: string,
  path: string,
): void {
  const row = db
    .prepare(
      "SELECT work_item_id FROM review_worktree WHERE path=? AND status='ACTIVE'",
    )
    .get(path) as { work_item_id: string } | undefined;
  if (row) removeQaWorktree(db, row.work_item_id);
}
