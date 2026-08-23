import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Cult4Config } from "./config.js";
import { getConfig } from "./config.js";
import type { CultDatabase } from "./db.js";
import { Cult4Error, id, now, type ActionIntent } from "./domain.js";
import { bootstrapEmployee } from "./employee.js";
import {
  type OpenCodeRunner,
  CliOpenCodeRunner,
  resolveOpenCodeModel,
} from "./opencode.js";
import { configuredProviderOptions } from "./secrets.js";
import { evaluateAction } from "./policy.js";
import { transitionWorkItem } from "./work.js";
import { audit } from "./audit.js";
import {
  finalizeVersionedWork,
  organizationRepository,
  prepareWritableRepository,
  releaseRepositoryLock,
  runGit,
} from "./git.js";

const allowedTypes = new Set([
  "ORGANIZATION_MAINTENANCE",
  "SKILL_CANDIDATE",
  "TOOL_IMPROVEMENT",
  "EMPLOYEE_CHANGE",
  "FOUNDATION_CHANGE",
]);

export async function runOrganizationMaintenance(
  db: CultDatabase,
  workItemId: string,
  runner: OpenCodeRunner = new CliOpenCodeRunner(),
  config: Cult4Config = getConfig(),
): Promise<{
  ok: boolean;
  sessionId?: string;
  errorCode?: string;
  resultSha?: string;
}> {
  const work = db
    .prepare("SELECT * FROM work_item WHERE id=?")
    .get(workItemId) as Record<string, unknown> | undefined;
  if (!work || work.business_id || !allowedTypes.has(String(work.type)))
    throw new Cult4Error(
      "WorkItem is not organization maintenance.",
      "ORGANIZATION_MAINTENANCE_REQUIRED",
    );
  if (work.status !== "READY")
    throw new Cult4Error(
      "Organization maintenance WorkItem is not ready.",
      "WORK_NOT_READY",
    );
  const employeeId = String(work.assigned_to ?? "employee-operator");
  const employee = db
    .prepare(
      "SELECT opencode_agent_name,model FROM employee WHERE id=? AND status='ACTIVE'",
    )
    .get(employeeId) as
    { opencode_agent_name: string; model: string | null } | undefined;
  if (!employee)
    throw new Cult4Error(
      "Maintenance Employee is inactive.",
      "EMPLOYEE_NOT_FOUND",
    );
  const foundationChange = work.type === "FOUNDATION_CHANGE";
  const repository = organizationRepository(db);
  if (foundationChange) {
    const currentCommit = runGit(
      ["rev-parse", "HEAD"],
      config.organizationPath,
    ).stdout;
    if (work.subject_version !== currentCommit)
      throw new Cult4Error(
        "Foundation change must target the exact current organization commit.",
        "SUBJECT_VERSION_MISMATCH",
      );
    const intent: ActionIntent = {
      actionType: "FOUNDATION_CHANGE",
      actorId: employeeId,
      subjectType: String(work.subject_type ?? "GIT_COMMIT"),
      subjectId: String(work.subject_id ?? "cult4-organization"),
      subjectVersion: currentCommit,
      workItemId,
    };
    const decision = evaluateAction(db, intent, true);
    if (!decision.allowed)
      throw new Cult4Error(
        "Foundation change approvals are incomplete.",
        "ACTION_BLOCKED",
        decision,
      );
  }
  const prepared = prepareWritableRepository(
    db,
    repository.id,
    workItemId,
    `organization:${process.pid}`,
  );
  db.prepare(
    "INSERT OR REPLACE INTO organization_maintenance(work_item_id,repository_id,base_sha,created_at) VALUES(?,?,?,?)",
  ).run(workItemId, repository.id, prepared.baseSha, now());
  mkdirSync(config.runtimePath, { recursive: true, mode: 0o700 });
  const runtimeConfig = join(
    config.runtimePath,
    `opencode-organization-${workItemId}.json`,
  );
  writeFileSync(
    runtimeConfig,
    `${JSON.stringify(organizationSessionConfig(config, foundationChange), null, 2)}\n`,
    { mode: 0o600 },
  );
  transitionWorkItem(db, workItemId, "RUNNING", "system");
  const mission = bootstrapEmployee(db, employeeId, workItemId);
  const runId = id("run");
  db.prepare(
    "INSERT INTO employee_run(id,employee_id,work_item_id,status,created_at) VALUES(?,?,?,'RUNNING',?)",
  ).run(runId, employeeId, workItemId, now());
  try {
    const result = await runner.runTask({
      directory: config.organizationPath,
      agentName: employee.opencode_agent_name,
      prompt: `${mission.prompt}\n\nThis is an explicit organization-maintenance session. ${foundationChange ? "The exact Foundation change gates are satisfied." : "Foundation files remain mechanically denied."}`,
      timeoutMs: 900_000,
      configFile: runtimeConfig,
      environment: {
        CULT4_EMPLOYEE: employeeId,
        CULT4_WORK_ITEM: workItemId,
      },
      model: resolveOpenCodeModel(employee.model),
    });
    let resultSha: string | undefined;
    let finalizationError: Cult4Error | undefined;
    if (result.ok)
      try {
        resultSha = finalizeVersionedWork(db, {
          repositoryId: repository.id,
          workItemId,
          employeeId,
          purpose: String(work.title),
          requireChanges: true,
          organization: true,
        }).sha;
      } catch (error) {
        finalizationError =
          error instanceof Cult4Error
            ? error
            : new Cult4Error(String(error), "ORGANIZATION_FINALIZATION_FAILED");
      }
    else releaseRepositoryLock(db, repository.id, workItemId);
    const effectiveOk = result.ok && !finalizationError && Boolean(resultSha);
    db.transaction(() => {
      db.prepare(
        "UPDATE employee_run SET session_id=?,status=?,duration_ms=?,cost_cents=?,input_tokens=?,output_tokens=?,error_code=?,finished_at=? WHERE id=?",
      ).run(
        result.sessionId ?? null,
        effectiveOk ? "COMPLETED" : "FAILED",
        result.durationMs,
        result.costCents,
        result.inputTokens,
        result.outputTokens,
        finalizationError?.code ?? result.errorCode ?? null,
        now(),
        runId,
      );
      const current = db
        .prepare("SELECT status FROM work_item WHERE id=?")
        .get(workItemId) as { status: string };
      if (current.status === "RUNNING")
        transitionWorkItem(
          db,
          workItemId,
          effectiveOk ? "DONE" : "FAILED",
          "system",
          finalizationError?.message ?? result.finalText ?? result.errorSummary,
        );
      if (effectiveOk)
        db.prepare(
          "UPDATE organization_maintenance SET result_sha=?,completed_at=? WHERE work_item_id=?",
        ).run(resultSha, now(), workItemId);
      audit(db, {
        type: "ORGANIZATION_MAINTENANCE_RUN",
        actorId: employeeId,
        subjectType: String(work.subject_type ?? "ORGANIZATION"),
        subjectId: String(work.subject_id ?? "cult4-organization"),
        subjectVersion: work.subject_version
          ? String(work.subject_version)
          : undefined,
        data: {
          runId,
          foundationChange,
          ok: effectiveOk,
          baseSha: prepared.baseSha,
          resultSha,
        },
      });
      if (effectiveOk)
        audit(db, {
          type: "ORGANIZATION_UPDATED",
          actorId: employeeId,
          subjectType: "GIT_COMMIT",
          subjectId: repository.id,
          subjectVersion: resultSha,
          data: { workItemId, baseSha: prepared.baseSha },
        });
    })();
    return {
      ok: effectiveOk,
      ...(result.sessionId ? { sessionId: result.sessionId } : {}),
      ...((finalizationError?.code ?? result.errorCode)
        ? { errorCode: finalizationError?.code ?? result.errorCode }
        : {}),
      ...(resultSha ? { resultSha } : {}),
    };
  } finally {
    try {
      unlinkSync(runtimeConfig);
    } catch {
      // Best-effort cleanup; the file contains policy only and no secret.
    }
  }
}

export function organizationSessionConfig(
  config: Cult4Config,
  foundationChange: boolean,
): unknown {
  return {
    $schema: "https://opencode.ai/config.json",
    ...configuredProviderOptions(config),
    permission: {
      read: {
        "*": "allow",
        [`${config.secretsPath}/**`]: "deny",
        [`${config.databasePath}*`]: "deny",
      },
      edit: {
        "*": "allow",
        "opencode.json": "deny",
        ...(foundationChange
          ? {}
          : { "foundation/FOUNDATION.md": "deny", "foundation/**": "deny" }),
        [`${config.secretsPath}/**`]: "deny",
      },
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
        ...(foundationChange
          ? {}
          : { "*foundation/FOUNDATION.md*": "deny", "*foundation/*": "deny" }),
      },
      external_directory: "deny",
      question: "deny",
      task: "allow",
      webfetch: "allow",
      websearch: "allow",
    },
  };
}
