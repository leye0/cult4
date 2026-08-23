import type { CultDatabase } from "./db.js";
import { createWorkItem } from "./work.js";

const LEARNING_INTERVAL = 4;

export function maybeScheduleCapabilityDevelopment(
  db: CultDatabase,
  input: {
    employeeId: string;
    businessId: string;
    sourceWorkItemId: string;
    successful: boolean;
  },
): string | undefined {
  const source = db
    .prepare("SELECT type,title FROM work_item WHERE id=?")
    .get(input.sourceWorkItemId) as { type: string; title: string } | undefined;
  if (!source || source.type === "CAPABILITY_DEVELOPMENT") return undefined;
  const open = db
    .prepare(
      `SELECT id FROM work_item
       WHERE business_id=? AND type='CAPABILITY_DEVELOPMENT' AND assigned_to=?
         AND status NOT IN ('DONE','FAILED','CANCELLED')
       ORDER BY created_at LIMIT 1`,
    )
    .get(input.businessId, input.employeeId) as { id: string } | undefined;
  if (open) return open.id;
  const runs = (
    db
      .prepare(
        `SELECT count(*) count FROM employee_run er
         JOIN work_item w ON w.id=er.work_item_id
         WHERE er.employee_id=? AND w.business_id=?
           AND w.type<>'CAPABILITY_DEVELOPMENT'
           AND er.status IN ('COMPLETED','FAILED')`,
      )
      .get(input.employeeId, input.businessId) as { count: number }
  ).count;
  if (input.successful && runs % LEARNING_INTERVAL !== 0) return undefined;
  return createWorkItem(db, {
    businessId: input.businessId,
    type: "CAPABILITY_DEVELOPMENT",
    title: `Improve ${input.employeeId.replace(/^employee-/, "")} practice`,
    goal: `Review recent measured experience, including ${source.title}. Persist a calibrated employee-business postmortem. Identify method, Skill, playbook, tool, evaluation, or staffing improvements that transfer beyond this Business and submit evidence-backed improvement or knowledge-promotion proposals. Do not edit the Business product or self-approve organizational changes.`,
    createdBy: "system",
    assignedTo: input.employeeId,
    parentId: input.sourceWorkItemId,
    requiredCapabilities: ["practice_development"],
    status: "READY",
    priority: input.successful ? 40 : 85,
    risk: "LOW",
  });
}
