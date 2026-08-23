import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, now, type WorkStatus } from "./domain.js";
import {
  assertMarketDesignExecution,
  assertMarketWorkCompletion,
} from "./market.js";
import {
  assertFoundationRequestCompletion,
  assertWorkRequestLinks,
} from "./requirements.js";
import { recordWorkCapabilities } from "./staffing.js";

const transitions: Record<WorkStatus, WorkStatus[]> = {
  PROPOSED: ["READY", "CANCELLED"],
  READY: [
    "RUNNING",
    "BLOCKED",
    "WAITING_GATE",
    "WAITING_HUMAN",
    "WAITING_EXTERNAL",
    "CANCELLED",
  ],
  RUNNING: [
    "READY",
    "DONE",
    "FAILED",
    "BLOCKED",
    "WAITING_GATE",
    "WAITING_HUMAN",
    "WAITING_EXTERNAL",
    "CANCELLED",
  ],
  WAITING_GATE: ["READY", "BLOCKED", "CANCELLED"],
  WAITING_HUMAN: ["READY", "DONE", "BLOCKED", "CANCELLED"],
  WAITING_EXTERNAL: ["READY", "BLOCKED", "CANCELLED"],
  BLOCKED: ["READY", "FAILED", "CANCELLED"],
  FAILED: [],
  DONE: [],
  CANCELLED: [],
};

export interface CreateWorkInput {
  businessId?: string;
  type: string;
  title: string;
  goal: string;
  createdBy: string;
  status?: WorkStatus;
  priority?: number;
  risk?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  assignedTo?: string;
  parentId?: string;
  subjectType?: string;
  subjectId?: string;
  subjectVersion?: string;
  repositoryId?: string;
  requiredCapabilities?: string[];
}

export function createWorkItem(
  db: CultDatabase,
  input: CreateWorkInput,
): string {
  const workId = id("work"),
    timestamp = now();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO work_item(id,business_id,type,title,goal,status,priority,risk,created_by,assigned_to,parent_id,subject_type,subject_id,subject_version,repository_id,created_at,updated_at)
      VALUES(@id,@businessId,@type,@title,@goal,@status,@priority,@risk,@createdBy,@assignedTo,@parentId,@subjectType,@subjectId,@subjectVersion,@repositoryId,@at,@at)`,
    ).run({
      id: workId,
      businessId: input.businessId ?? null,
      type: input.type,
      title: input.title,
      goal: input.goal,
      status: input.status ?? "PROPOSED",
      priority: input.priority ?? 50,
      risk: input.risk ?? "LOW",
      createdBy: input.createdBy,
      assignedTo: input.assignedTo ?? null,
      parentId: input.parentId ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      subjectVersion: input.subjectVersion ?? null,
      repositoryId: input.repositoryId ?? null,
      at: timestamp,
    });
    recordWorkCapabilities(db, workId, input.requiredCapabilities ?? []);
    audit(db, {
      type: "WORK_CREATED",
      actorId: input.createdBy,
      businessId: input.businessId,
      subjectType: "WORK_ITEM",
      subjectId: workId,
      data: { type: input.type, title: input.title },
    });
  })();
  return workId;
}

export function addDependency(
  db: CultDatabase,
  workId: string,
  dependsOn: string,
): void {
  if (
    !db.prepare("SELECT 1 FROM work_item WHERE id=?").get(workId) ||
    !db.prepare("SELECT 1 FROM work_item WHERE id=?").get(dependsOn)
  )
    throw new Cult4Error("Unknown work item.", "WORK_NOT_FOUND");
  const cycle = db
    .prepare(
      `WITH RECURSIVE reachable(id) AS (SELECT depends_on_work_id FROM work_dependency WHERE work_id=? UNION SELECT wd.depends_on_work_id FROM work_dependency wd JOIN reachable r ON wd.work_id=r.id) SELECT 1 FROM reachable WHERE id=?`,
    )
    .get(dependsOn, workId);
  if (cycle || workId === dependsOn)
    throw new Cult4Error(
      "Dependency would create a cycle.",
      "WORK_DEPENDENCY_CYCLE",
    );
  db.prepare(
    "INSERT INTO work_dependency(work_id,depends_on_work_id) VALUES(?,?)",
  ).run(workId, dependsOn);
}

export function transitionWorkItem(
  db: CultDatabase,
  workId: string,
  to: WorkStatus,
  actorId: string,
  result?: string,
): void {
  const row = db
    .prepare(
      "SELECT status,business_id,type,subject_type,subject_id FROM work_item WHERE id=?",
    )
    .get(workId) as
    | {
        status: WorkStatus;
        business_id: string | null;
        type: string;
        subject_type: string | null;
        subject_id: string | null;
      }
    | undefined;
  if (!row) throw new Cult4Error("Work item not found.", "WORK_NOT_FOUND");
  if (!transitions[row.status].includes(to))
    throw new Cult4Error(
      `Invalid work transition ${row.status} -> ${to}.`,
      "INVALID_WORK_TRANSITION",
    );
  if (to === "DONE") assertMarketWorkCompletion(db, row);
  if (to === "DONE")
    assertFoundationRequestCompletion(db, row.business_id, row.type);
  if (to === "RUNNING") {
    assertMarketDesignExecution(db, workId, row);
    assertWorkRequestLinks(db, workId, row.type, row.business_id);
  }
  db.transaction(() => {
    db.prepare(
      "UPDATE work_item SET status=?,result=COALESCE(?,result),lock_owner=NULL,lock_expires_at=NULL,updated_at=? WHERE id=?",
    ).run(to, result ?? null, now(), workId);
    audit(db, {
      type: "WORK_STATUS_CHANGED",
      actorId,
      businessId: row.business_id ?? undefined,
      subjectType: "WORK_ITEM",
      subjectId: workId,
      data: { from: row.status, to },
    });
  })();
}

export function listReadyWork(
  db: CultDatabase,
  limit = 20,
  businessId?: string,
): unknown[] {
  return db
    .prepare(
      `SELECT w.* FROM work_item w JOIN business b ON b.id=w.business_id AND b.status='ACTIVE'
    WHERE w.status='READY' AND w.type<>'OPERATOR_INTERACTION'
    AND (? IS NULL OR w.business_id=?)
    AND (w.assigned_to IS NULL OR EXISTS(
      SELECT 1 FROM employee eligible_employee
      WHERE eligible_employee.id=w.assigned_to AND eligible_employee.status='ACTIVE'
    ))
    AND (w.lock_expires_at IS NULL OR w.lock_expires_at<=?)
    AND (NOT EXISTS(SELECT 1 FROM work_item foundation WHERE foundation.business_id=w.business_id AND foundation.type='BUSINESS_FOUNDATION')
      OR EXISTS(SELECT 1 FROM business_mandate bm WHERE bm.business_id=w.business_id AND bm.status='CONFIRMED' AND bm.autonomy_mode<>'ASSISTED'))
    AND NOT EXISTS(SELECT 1 FROM work_dependency d JOIN work_item p ON p.id=d.depends_on_work_id WHERE d.work_id=w.id AND p.status<>'DONE')
    AND NOT EXISTS(SELECT 1 FROM gate g WHERE g.work_item_id=w.id AND g.status IN ('REQUIRED','PENDING','REJECTED','INVALIDATED','EXPIRED'))
    ORDER BY CASE WHEN w.type='DIGITAL_QA' THEN 1 ELSE 0 END DESC,
      w.priority DESC,w.created_at ASC LIMIT ?`,
    )
    .all(businessId ?? null, businessId ?? null, now(), limit);
}

export function claimWorkItem(
  db: CultDatabase,
  workId: string,
  owner: string,
  ttlSeconds = 900,
): boolean {
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return (
    db
      .prepare(
        "UPDATE work_item SET lock_owner=?,lock_expires_at=? WHERE id=? AND status='READY' AND (lock_expires_at IS NULL OR lock_expires_at<=?)",
      )
      .run(owner, expires, workId, now()).changes === 1
  );
}

export function reevaluateWaitingWork(db: CultDatabase): number {
  const rows = db
    .prepare(
      "SELECT id,status FROM work_item WHERE status IN ('WAITING_GATE','WAITING_HUMAN')",
    )
    .all() as Array<{ id: string; status: WorkStatus }>;
  let changed = 0;
  for (const row of rows) {
    const gates = db
      .prepare("SELECT status FROM gate WHERE work_item_id=?")
      .all(row.id) as Array<{ status: string }>;
    const requests = db
      .prepare("SELECT status FROM human_request WHERE work_item_id=?")
      .all(row.id) as Array<{ status: string }>;
    if (
      gates.some((g) => g.status === "REJECTED") ||
      requests.some((r) => r.status === "REJECTED")
    ) {
      transitionWorkItem(db, row.id, "BLOCKED", "system");
      changed++;
      continue;
    }
    if (
      gates.every((g) => g.status === "SATISFIED") &&
      requests.every(
        (r) => !["PENDING", "REMINDER_DUE", "OVERDUE"].includes(r.status),
      )
    ) {
      transitionWorkItem(db, row.id, "READY", "system");
      changed++;
    }
  }
  const failed = db
    .prepare(
      `SELECT DISTINCT w.id FROM work_item w JOIN work_dependency d ON d.work_id=w.id JOIN work_item dependency ON dependency.id=d.depends_on_work_id WHERE w.status='READY' AND dependency.status IN ('FAILED','CANCELLED')`,
    )
    .all() as Array<{ id: string }>;
  for (const row of failed) {
    transitionWorkItem(
      db,
      row.id,
      "BLOCKED",
      "system",
      "A required dependency failed or was cancelled.",
    );
    changed++;
  }
  return changed;
}
