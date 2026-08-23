import { immediateTransaction, type CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, now } from "./domain.js";
import { expireApprovals } from "./approval.js";
import { processHumanRequestTimers } from "./human.js";
import { bootstrapEmployee } from "./employee.js";
import {
  claimWorkItem,
  createWorkItem,
  listReadyWork,
  reevaluateWaitingWork,
  transitionWorkItem,
} from "./work.js";
import { resolveBusinessRepo } from "./repo.js";
import {
  CliOpenCodeRunner,
  resolveOpenCodeModel,
  type OpenCodeProgressEvent,
  type OpenCodeRunner,
} from "./opencode.js";
import {
  businessRepository,
  finalizeVersionedWork,
  prepareWritableRepository,
  releaseRepositoryLock,
} from "./git.js";
import { runQaWorkItem } from "./review.js";
import { expireMarketStudies } from "./market.js";
import { invalidateUnassuredFinancialRequests } from "./assurance.js";
import { assertWorkAssignmentQualified } from "./staffing.js";
import { maybeScheduleCapabilityDevelopment } from "./learning.js";

export interface TickOptions {
  maxWorkItems?: number;
  maxDurationMs?: number;
  maxCostCents?: number;
  businessId?: string;
  runner?: OpenCodeRunner;
  shouldStop?: () => boolean;
  onProgress?: (event: TickProgressEvent) => void;
  onModelProgress?: (event: OpenCodeProgressEvent) => void;
  signal?: AbortSignal;
}
export type TickProgressEvent =
  | {
      type: "work_started";
      workItemId: string;
      title: string;
      workType: string;
      employeeId: string;
    }
  | {
      type: "work_finished";
      workItemId: string;
      title: string;
      ok: boolean;
      costCents: number;
      durationMs: number;
      errorCode?: string;
    };
export interface TickResult {
  processed: number;
  costCents: number;
  stoppedEarly: boolean;
  results: Array<{ workItemId: string; ok: boolean; errorCode?: string }>;
  timers: {
    approvalsExpired: number;
    human: ReturnType<typeof processHumanRequestTimers>;
    workReevaluated: number;
    marketStudiesExpired: number;
    marketRefreshWorkCreated: number;
    unassuredRequestsInvalidated: number;
  };
}
function acquireTickLock(db: CultDatabase, owner: string, ttlMs: number): void {
  const expires = new Date(Date.now() + ttlMs).toISOString();
  immediateTransaction(db, () => {
    db.prepare(
      "DELETE FROM runtime_lock WHERE name='tick' AND expires_at<=?",
    ).run(now());
    const stale = db
      .prepare("SELECT owner FROM runtime_lock WHERE name='tick'")
      .get() as { owner: string } | undefined;
    if (stale) {
      const pid = Number(stale.owner.split(":", 1)[0]);
      let alive = Number.isSafeInteger(pid) && pid > 0;
      if (alive)
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
        }
      if (!alive)
        db.prepare(
          "DELETE FROM runtime_lock WHERE name='tick' AND owner=?",
        ).run(stale.owner);
    }
    try {
      db.prepare(
        "INSERT INTO runtime_lock(name,owner,expires_at) VALUES('tick',?,?)",
      ).run(owner, expires);
    } catch {
      throw new Cult4Error("Another cult tick is active.", "TICK_LOCKED");
    }
  });
}
export async function tick(
  db: CultDatabase,
  options: TickOptions = {},
): Promise<TickResult> {
  const maxWorkItems =
      options.maxWorkItems ??
      Number(process.env.CULT4_TICK_MAX_WORK_ITEMS ?? 1),
    maxDurationMs =
      options.maxDurationMs ??
      Number(process.env.CULT4_TICK_MAX_DURATION_MS ?? 900000),
    maxCostCents =
      options.maxCostCents ??
      Number(process.env.CULT4_TICK_MAX_COST_CENTS ?? 1000),
    runner = options.runner ?? new CliOpenCodeRunner(),
    owner = `${process.pid}:${id("tick")}`;
  acquireTickLock(db, owner, maxDurationMs + 60000);
  const started = Date.now(),
    results: TickResult["results"] = [];
  let costCents = 0;
  const human = processHumanRequestTimers(db);
  const approvalsExpired = expireApprovals(db);
  const expiredStudies = expireMarketStudies(db);
  const unassuredRequestsInvalidated = invalidateUnassuredFinancialRequests(db);
  let marketRefreshWorkCreated = 0;
  for (const studyId of expiredStudies) {
    const study = db
      .prepare("SELECT business_id FROM market_study WHERE id=?")
      .get(studyId) as { business_id: string };
    const exists = db
      .prepare(
        "SELECT 1 FROM work_item WHERE type='MARKET_STUDY_REFRESH' AND subject_id=? AND status NOT IN ('DONE','FAILED','CANCELLED')",
      )
      .get(studyId);
    if (!exists) {
      createWorkItem(db, {
        businessId: study.business_id,
        type: "MARKET_STUDY_REFRESH",
        title: "Refresh expired market study",
        goal: "Reuse prior context, obtain fresh evidence, and create a new complete applicable MarketStudy.",
        createdBy: "system",
        assignedTo: "employee-cultural-market-intelligence",
        status: "READY",
        priority: 75,
        risk: "MEDIUM",
        subjectType: "MARKET_STUDY",
        subjectId: studyId,
        subjectVersion: now(),
      });
      marketRefreshWorkCreated++;
    }
  }
  const workReevaluated = reevaluateWaitingWork(db);
  try {
    while (
      results.length < maxWorkItems &&
      Date.now() - started < maxDurationMs &&
      costCents < maxCostCents &&
      !options.shouldStop?.()
    ) {
      const candidate = (
        listReadyWork(db, 20, options.businessId) as Array<
          Record<string, unknown>
        >
      )[0];
      if (!candidate) break;
      const workItemId = String(candidate.id),
        employeeId = String(candidate.assigned_to ?? "employee-operator"),
        title = String(candidate.title),
        workStarted = Date.now();
      if (
        !claimWorkItem(db, workItemId, owner, Math.ceil(maxDurationMs / 1000))
      )
        continue;
      options.onProgress?.({
        type: "work_started",
        workItemId,
        title,
        workType: String(candidate.type),
        employeeId,
      });
      try {
        assertWorkAssignmentQualified(db, workItemId);
      } catch (error) {
        const errorCode =
          error instanceof Cult4Error ? error.code : "WORK_ASSIGNMENT_INVALID";
        transitionWorkItem(
          db,
          workItemId,
          "BLOCKED",
          "system",
          error instanceof Error ? error.message : String(error),
        );
        results.push({ workItemId, ok: false, errorCode });
        options.onProgress?.({
          type: "work_finished",
          workItemId,
          title,
          ok: false,
          costCents: 0,
          durationMs: Date.now() - workStarted,
          errorCode,
        });
        continue;
      }
      if (String(candidate.type) === "DIGITAL_QA") {
        try {
          const qa = await runQaWorkItem(db, workItemId, runner);
          costCents += qa.costCents;
          maybeScheduleCapabilityDevelopment(db, {
            employeeId,
            businessId: String(candidate.business_id),
            sourceWorkItemId: workItemId,
            successful: qa.ok,
          });
          results.push({
            workItemId,
            ok: qa.ok,
            ...(!qa.ok ? { errorCode: `QA_${qa.result}` } : {}),
          });
          options.onProgress?.({
            type: "work_finished",
            workItemId,
            title,
            ok: qa.ok,
            costCents: qa.costCents,
            durationMs: Date.now() - workStarted,
            ...(!qa.ok ? { errorCode: `QA_${qa.result}` } : {}),
          });
        } catch (error) {
          const current = db
            .prepare("SELECT status FROM work_item WHERE id=?")
            .get(workItemId) as { status: string };
          if (current.status === "READY" || current.status === "RUNNING")
            transitionWorkItem(
              db,
              workItemId,
              "FAILED",
              "system",
              error instanceof Error ? error.message : String(error),
            );
          results.push({
            workItemId,
            ok: false,
            errorCode:
              error instanceof Cult4Error ? error.code : "QA_EXECUTION_FAILED",
          });
          options.onProgress?.({
            type: "work_finished",
            workItemId,
            title,
            ok: false,
            costCents: 0,
            durationMs: Date.now() - workStarted,
            errorCode:
              error instanceof Cult4Error ? error.code : "QA_EXECUTION_FAILED",
          });
        }
        continue;
      }
      const businessId = String(candidate.business_id);
      let repositoryId: string;
      try {
        repositoryId = businessRepository(db, businessId).id;
        prepareWritableRepository(db, repositoryId, workItemId, owner);
      } catch (error) {
        const errorCode =
          error instanceof Cult4Error
            ? error.code
            : "REPOSITORY_PREPARATION_FAILED";
        transitionWorkItem(
          db,
          workItemId,
          "BLOCKED",
          "system",
          error instanceof Error ? error.message : String(error),
        );
        results.push({
          workItemId,
          ok: false,
          errorCode,
        });
        options.onProgress?.({
          type: "work_finished",
          workItemId,
          title,
          ok: false,
          costCents: 0,
          durationMs: Date.now() - workStarted,
          errorCode,
        });
        continue;
      }
      transitionWorkItem(db, workItemId, "RUNNING", "system");
      const employee = db
        .prepare(
          "SELECT opencode_agent_name,model FROM employee WHERE id=? AND status='ACTIVE'",
        )
        .get(employeeId) as
        { opencode_agent_name: string; model: string | null } | undefined;
      if (!employee) {
        transitionWorkItem(
          db,
          workItemId,
          "FAILED",
          "system",
          "Assigned employee is inactive or missing.",
        );
        results.push({
          workItemId,
          ok: false,
          errorCode: "EMPLOYEE_NOT_FOUND",
        });
        options.onProgress?.({
          type: "work_finished",
          workItemId,
          title,
          ok: false,
          costCents: 0,
          durationMs: Date.now() - workStarted,
          errorCode: "EMPLOYEE_NOT_FOUND",
        });
        continue;
      }
      const directory = resolveBusinessRepo(db, businessId),
        mission = bootstrapEmployee(db, employeeId, workItemId);
      const runId = id("run"),
        runStarted = now();
      db.prepare(
        "INSERT INTO employee_run(id,employee_id,work_item_id,status,created_at) VALUES(?,?,?,'RUNNING',?)",
      ).run(runId, employeeId, workItemId, runStarted);
      const remaining = Math.max(1000, maxDurationMs - (Date.now() - started));
      const run = await runner.runTask({
        directory,
        agentName: employee.opencode_agent_name,
        model: resolveOpenCodeModel(employee.model),
        prompt: mission.prompt,
        timeoutMs: remaining,
        environment: {
          CULT4_EMPLOYEE: employeeId,
          CULT4_WORK_ITEM: workItemId,
        },
        onProgress: options.onModelProgress,
        signal: options.signal,
      });
      let gitError: Cult4Error | undefined;
      const cancelled = run.errorCode === "MODEL_CANCELLED";
      if (run.ok || cancelled)
        try {
          finalizeVersionedWork(db, {
            repositoryId,
            workItemId,
            employeeId,
            purpose: String(candidate.title),
            checkpoint: cancelled,
          });
        } catch (error) {
          gitError =
            error instanceof Cult4Error
              ? error
              : new Cult4Error(
                  error instanceof Error ? error.message : String(error),
                  "GIT_FINALIZATION_FAILED",
                );
        }
      else releaseRepositoryLock(db, repositoryId, workItemId);
      const effectiveOk = run.ok && !gitError;
      costCents += run.costCents;
      immediateTransaction(db, () => {
        db.prepare(
          `UPDATE employee_run SET session_id=?,status=?,duration_ms=?,cost_cents=?,input_tokens=?,output_tokens=?,error_code=?,finished_at=? WHERE id=?`,
        ).run(
          run.sessionId ?? null,
          effectiveOk ? "COMPLETED" : cancelled ? "CANCELLED" : "FAILED",
          run.durationMs,
          run.costCents,
          run.inputTokens,
          run.outputTokens,
          gitError?.code ?? run.errorCode ?? null,
          now(),
          runId,
        );
        db.prepare(
          "INSERT INTO employee_experience(id,employee_id,business_id,work_item_id,summary,outcome,created_at) VALUES(?,?,?,?,?,?,?)",
        ).run(
          id("experience"),
          employeeId,
          businessId,
          workItemId,
          (
            run.finalText ??
            run.errorSummary ??
            run.errorCode ??
            "No summary"
          ).slice(0, 4000),
          effectiveOk
            ? "SESSION_COMPLETED"
            : cancelled
              ? "SESSION_CANCELLED"
              : "SESSION_FAILED",
          now(),
        );
        const current = db
          .prepare("SELECT status FROM work_item WHERE id=?")
          .get(workItemId) as { status: string };
        if (current.status === "RUNNING")
          transitionWorkItem(
            db,
            workItemId,
            cancelled ? "READY" : effectiveOk ? "READY" : "FAILED",
            "system",
            cancelled
              ? options.signal?.reason === "CULT4_IMMEDIATE_STOP"
                ? "Autopilot stopped by Ctrl+C after a durable checkpoint."
                : "Autopilot stopped by ESC after a durable checkpoint."
              : effectiveOk
                ? (run.finalText ??
                  "Session yielded without a terminal work transition.")
                : (gitError?.message ?? run.errorSummary ?? run.errorCode),
          );
        audit(db, {
          type: "EMPLOYEE_RUN_COMPLETED",
          actorId: employeeId,
          businessId,
          subjectType: "WORK_ITEM",
          subjectId: workItemId,
          data: {
            runId,
            ok: effectiveOk,
            sessionId: run.sessionId,
            costCents: run.costCents,
            errorCode: gitError?.code ?? run.errorCode,
          },
        });
      });
      if (!cancelled)
        maybeScheduleCapabilityDevelopment(db, {
          employeeId,
          businessId,
          sourceWorkItemId: workItemId,
          successful: effectiveOk,
        });
      results.push({
        workItemId,
        ok: effectiveOk,
        ...((gitError?.code ?? run.errorCode)
          ? { errorCode: gitError?.code ?? run.errorCode }
          : {}),
      });
      options.onProgress?.({
        type: "work_finished",
        workItemId,
        title,
        ok: effectiveOk,
        costCents: run.costCents,
        durationMs: run.durationMs,
        ...((gitError?.code ?? run.errorCode)
          ? { errorCode: gitError?.code ?? run.errorCode }
          : {}),
      });
    }
    return {
      processed: results.length,
      costCents,
      stoppedEarly: Boolean(options.shouldStop?.()),
      results,
      timers: {
        approvalsExpired,
        human,
        workReevaluated,
        marketStudiesExpired: expiredStudies.length,
        marketRefreshWorkCreated,
        unassuredRequestsInvalidated,
      },
    };
  } finally {
    db.prepare("DELETE FROM runtime_lock WHERE name='tick' AND owner=?").run(
      owner,
    );
  }
}
