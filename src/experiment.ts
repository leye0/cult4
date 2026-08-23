import type { CultDatabase } from "./db.js";
import { Cult4Error, id, now } from "./domain.js";
export function createHypothesis(
  db: CultDatabase,
  input: {
    businessId: string;
    statement: string;
    rationale: string;
    createdBy: string;
  },
): string {
  const hypothesisId = id("hypothesis");
  db.prepare(
    "INSERT INTO hypothesis(id,business_id,statement,rationale,status,created_by,created_at) VALUES(?,?,?,?,'PROPOSED',?,?)",
  ).run(
    hypothesisId,
    input.businessId,
    input.statement,
    input.rationale,
    input.createdBy,
    now(),
  );
  return hypothesisId;
}
export function createMetric(
  db: CultDatabase,
  input: {
    businessId: string;
    slug: string;
    name: string;
    unit: string;
    direction: "INCREASE" | "DECREASE" | "TARGET";
  },
): string {
  const metricId = id("metric");
  db.prepare(
    "INSERT INTO metric(id,business_id,slug,name,unit,direction) VALUES(?,?,?,?,?,?)",
  ).run(
    metricId,
    input.businessId,
    input.slug,
    input.name,
    input.unit,
    input.direction,
  );
  return metricId;
}
export function createExperiment(
  db: CultDatabase,
  input: {
    hypothesisId: string;
    design: string;
    metricId?: string;
    successCondition?: string;
    stopCondition?: string;
    maxDownside?: number;
    budgetId?: string;
    sampleOrDuration?: string;
    validationAlternative?: string;
  },
): string {
  const experimentId = id("experiment");
  db.prepare(
    `INSERT INTO experiment(id,hypothesis_id,design,metric_id,success_condition,stop_condition,max_downside,budget_id,sample_or_duration,status,validation_alternative,created_at) VALUES(?,?,?,?,?,?,?,?,?,'DRAFT',?,?)`,
  ).run(
    experimentId,
    input.hypothesisId,
    input.design,
    input.metricId ?? null,
    input.successCondition ?? null,
    input.stopCondition ?? null,
    input.maxDownside ?? null,
    input.budgetId ?? null,
    input.sampleOrDuration ?? null,
    input.validationAlternative ?? null,
    now(),
  );
  return experimentId;
}
export function readyExperiment(db: CultDatabase, experimentId: string): void {
  const row = db
    .prepare("SELECT * FROM experiment WHERE id=? AND status='DRAFT'")
    .get(experimentId) as Record<string, unknown> | undefined;
  if (!row)
    throw new Cult4Error("Draft experiment not found.", "EXPERIMENT_NOT_FOUND");
  const testable =
    row.metric_id &&
    row.success_condition &&
    row.stop_condition &&
    row.max_downside !== null &&
    row.sample_or_duration;
  if (!testable && !row.validation_alternative)
    throw new Cult4Error(
      "Experiment requires metric, success, stop, downside, and sample/duration, or a documented alternative.",
      "EXPERIMENT_NOT_READY",
    );
  db.prepare("UPDATE experiment SET status='READY' WHERE id=?").run(
    experimentId,
  );
}
export function recordMeasurement(
  db: CultDatabase,
  input: {
    metricId: string;
    value: number;
    sourceRef?: string;
    recordedBy: string;
    observedAt?: string;
  },
): string {
  const measurementId = id("measurement");
  db.prepare(
    "INSERT INTO metric_measurement(id,metric_id,value,observed_at,source_ref,recorded_by) VALUES(?,?,?,?,?,?)",
  ).run(
    measurementId,
    input.metricId,
    input.value,
    input.observedAt ?? now(),
    input.sourceRef ?? null,
    input.recordedBy,
  );
  return measurementId;
}
