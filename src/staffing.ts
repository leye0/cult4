import type { CultDatabase } from "./db.js";
import { Cult4Error } from "./domain.js";

const workTypeCapabilities: Record<string, string[]> = {
  BUSINESS_FOUNDATION: ["plan_work"],
  BUILD: ["software_engineering"],
  ENGINEERING: ["software_engineering"],
  VERSIONED_BUILD: ["software_engineering"],
  LIVE_INTEGRATION: ["software_engineering"],
  LIVE_TICK: ["software_engineering"],
  VALIDATE: ["test_release"],
  DIGITAL_QA: ["test_release"],
  RESEARCH: ["research"],
  MARKET_STUDY: ["market_research"],
  MARKET_STUDY_REFRESH: ["market_research"],
  STRATEGY: ["strategy"],
  CREATIVE_BRIEF: ["strategy"],
  DESIGN: ["create_artifact"],
  FINANCE: ["unit_economics"],
  IP_REVIEW: ["copyright_risk_review"],
  CAPABILITY_DEVELOPMENT: ["practice_development"],
};

const coordinationCapabilities = new Set(["plan_work", "manage_organization"]);

export function requiredCapabilitiesForWork(
  type: string,
  declared: string[] = [],
): string[] {
  return [
    ...new Set([...(workTypeCapabilities[type] ?? []), ...declared]),
  ].sort();
}

function employeeAssets(db: CultDatabase, employeeId: string): number {
  return (
    db
      .prepare(
        `SELECT count(*) count FROM employee_asset ea
         JOIN organizational_asset oa ON oa.id=ea.asset_id
         WHERE ea.employee_id=? AND oa.status='ACTIVE'`,
      )
      .get(employeeId) as { count: number }
  ).count;
}

export function assertEmployeeQualified(
  db: CultDatabase,
  employeeId: string,
  capabilities: string[],
): void {
  const employee = db
    .prepare("SELECT slug,status FROM employee WHERE id=?")
    .get(employeeId) as { slug: string; status: string } | undefined;
  if (!employee || employee.status !== "ACTIVE")
    throw new Cult4Error(
      "Assigned employee is missing or inactive.",
      "EMPLOYEE_NOT_FOUND",
    );
  if (
    employee.slug === "operator" &&
    capabilities.some((capability) => !coordinationCapabilities.has(capability))
  )
    throw new Cult4Error(
      "The Operator coordinates specialized work and may not execute it in place of a qualified employee.",
      "OPERATOR_SPECIALIZATION_VIOLATION",
      { employeeId, capabilities },
    );
  const possessed = new Set(
    (
      db
        .prepare(
          `SELECT c.slug FROM employee_capability ec
           JOIN capability c ON c.id=ec.capability_id
           WHERE ec.employee_id=?`,
        )
        .all(employeeId) as Array<{ slug: string }>
    ).map(({ slug }) => slug),
  );
  const missing = capabilities.filter(
    (capability) => !possessed.has(capability),
  );
  if (missing.length)
    throw new Cult4Error(
      `Assigned employee lacks required capabilities: ${missing.join(", ")}.`,
      "WORK_ASSIGNMENT_CAPABILITY_MISMATCH",
      { employeeId, missing },
    );
  if (capabilities.length && employeeAssets(db, employeeId) === 0)
    throw new Cult4Error(
      "Assigned employee has capabilities but no active organizational skill, playbook, tool, or research method.",
      "EMPLOYEE_NOT_OPERATIONALLY_EQUIPPED",
      { employeeId, capabilities },
    );
}

export function routeQualifiedEmployee(
  db: CultDatabase,
  capabilities: string[],
  requestedEmployeeId?: string,
): string {
  if (!capabilities.length)
    throw new Cult4Error(
      "Ordinary work requires at least one explicit or type-derived capability.",
      "WORK_CAPABILITIES_REQUIRED",
    );
  const known = (
    db
      .prepare(
        `SELECT count(*) count FROM capability
         WHERE slug IN (${capabilities.map(() => "?").join(",")})`,
      )
      .get(...capabilities) as { count: number }
  ).count;
  if (known !== new Set(capabilities).size)
    throw new Cult4Error(
      "Work requires an unknown organizational capability.",
      "CAPABILITY_NOT_FOUND",
      { capabilities },
    );
  if (requestedEmployeeId) {
    assertEmployeeQualified(db, requestedEmployeeId, capabilities);
    return requestedEmployeeId;
  }
  const candidates = db
    .prepare(
      `SELECT e.id,
         (SELECT count(*) FROM work_item w WHERE w.assigned_to=e.id AND w.status IN ('PROPOSED','READY','RUNNING','WAITING_GATE','WAITING_HUMAN','WAITING_EXTERNAL')) load
       FROM employee e
       WHERE e.status='ACTIVE'
         AND NOT EXISTS(
           SELECT 1 FROM capability required
           WHERE required.slug IN (${capabilities.map(() => "?").join(",")})
             AND NOT EXISTS(
               SELECT 1 FROM employee_capability ec
               WHERE ec.employee_id=e.id AND ec.capability_id=required.id
             )
         )
       ORDER BY load,e.slug`,
    )
    .all(...capabilities) as Array<{ id: string; load: number }>;
  for (const candidate of candidates)
    try {
      assertEmployeeQualified(db, candidate.id, capabilities);
      return candidate.id;
    } catch {
      // Continue until an active, capable, operationally equipped employee is found.
    }
  throw new Cult4Error(
    `No active and operationally equipped employee can satisfy: ${capabilities.join(", ")}.`,
    "ORGANIZATIONAL_CAPABILITY_GAP",
    { capabilities },
  );
}

export function recordWorkCapabilities(
  db: CultDatabase,
  workItemId: string,
  capabilities: string[],
): void {
  for (const capability of capabilities) {
    const row = db
      .prepare("SELECT id FROM capability WHERE slug=?")
      .get(capability) as { id: string } | undefined;
    if (!row)
      throw new Cult4Error(
        `Unknown organizational capability: ${capability}.`,
        "CAPABILITY_NOT_FOUND",
      );
    db.prepare(
      "INSERT OR IGNORE INTO work_capability_requirement(work_item_id,capability_id) VALUES(?,?)",
    ).run(workItemId, row.id);
  }
}

export function workCapabilities(
  db: CultDatabase,
  workItemId: string,
): string[] {
  return (
    db
      .prepare(
        `SELECT c.slug FROM work_capability_requirement wcr
         JOIN capability c ON c.id=wcr.capability_id
         WHERE wcr.work_item_id=? ORDER BY c.slug`,
      )
      .all(workItemId) as Array<{ slug: string }>
  ).map(({ slug }) => slug);
}

export function assertWorkAssignmentQualified(
  db: CultDatabase,
  workItemId: string,
): void {
  const work = db
    .prepare("SELECT assigned_to FROM work_item WHERE id=?")
    .get(workItemId) as { assigned_to: string | null } | undefined;
  if (!work) throw new Cult4Error("Work item not found.", "WORK_NOT_FOUND");
  const capabilities = workCapabilities(db, workItemId);
  if (!capabilities.length) return;
  if (!work.assigned_to)
    throw new Cult4Error(
      "Specialized work has no assigned employee.",
      "WORK_ASSIGNMENT_REQUIRED",
    );
  assertEmployeeQualified(db, work.assigned_to, capabilities);
}
