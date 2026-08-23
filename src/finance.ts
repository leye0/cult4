import { immediateTransaction, type CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, now, type ActionIntent } from "./domain.js";
import { evaluateAction } from "./policy.js";
import { createHumanRequest } from "./human.js";
import { createWorkItem } from "./work.js";

export function createBudget(
  db: CultDatabase,
  input: {
    businessId: string;
    category: string;
    currency: string;
    limitAmount: number;
    periodStart: string;
    periodEnd: string;
    createdBy: string;
  },
): string {
  if (!Number.isInteger(input.limitAmount) || input.limitAmount < 0)
    throw new Cult4Error(
      "Budget amount must be non-negative minor units.",
      "INVALID_AMOUNT",
    );
  const budgetId = id("budget");
  db.prepare(
    "INSERT INTO budget(id,business_id,category,currency,limit_amount,period_start,period_end,status,created_by) VALUES(?,?,?,?,?,?,?,'ACTIVE',?)",
  ).run(
    budgetId,
    input.businessId,
    input.category,
    input.currency,
    input.limitAmount,
    input.periodStart,
    input.periodEnd,
    input.createdBy,
  );
  return budgetId;
}
export function availableBudget(db: CultDatabase, budgetId: string): number {
  const row = db
    .prepare(
      `SELECT b.limit_amount-COALESCE((SELECT sum(t.amount) FROM transaction_entry t WHERE t.budget_id=b.id),0)-COALESCE((SELECT sum(c.amount) FROM commitment c WHERE c.budget_id=b.id AND c.status='ACTIVE'),0) available FROM budget b WHERE b.id=? AND b.status='ACTIVE' AND b.period_start<=? AND b.period_end>=?`,
    )
    .get(budgetId, now(), now()) as { available: number } | undefined;
  if (!row)
    throw new Cult4Error(
      "Active current budget not found.",
      "BUDGET_NOT_FOUND",
    );
  return row.available;
}
export interface SpendInput {
  businessId: string;
  requestedBy: string;
  amount: number;
  currency: string;
  vendor: string;
  purpose: string;
  budgetId: string;
  relatedWorkItemId?: string;
  risk?: "LOW" | "MEDIUM" | "HIGH";
  legalRisk?: boolean;
  recurring?: boolean;
  idempotencyKey?: string;
}
export interface SpendResult {
  status: "AUTHORIZED" | "DENIED" | "WAITING_APPROVAL";
  spendRequestId: string;
  commitmentId?: string;
  gateIds?: string[];
  reasons?: string[];
}
export function requestSpend(db: CultDatabase, input: SpendInput): SpendResult {
  if (!Number.isInteger(input.amount) || input.amount <= 0)
    throw new Cult4Error(
      "Spend amount must be positive integer minor units.",
      "INVALID_AMOUNT",
    );
  const key = input.idempotencyKey ?? id("spend-key");
  const existing = db
    .prepare(
      "SELECT id,status,commitment_id,gate_id FROM spend_request WHERE idempotency_key=?",
    )
    .get(key) as Record<string, unknown> | undefined;
  if (existing)
    return {
      status:
        existing.status === "AUTHORIZED"
          ? "AUTHORIZED"
          : existing.status === "WAITING_APPROVAL"
            ? "WAITING_APPROVAL"
            : "DENIED",
      spendRequestId: String(existing.id),
      ...(existing.commitment_id
        ? { commitmentId: String(existing.commitment_id) }
        : {}),
      ...(existing.gate_id ? { gateIds: [String(existing.gate_id)] } : {}),
    };
  return immediateTransaction(db, () => {
    const budget = db
      .prepare(
        "SELECT * FROM budget WHERE id=? AND business_id=? AND status='ACTIVE' AND period_start<=? AND period_end>=?",
      )
      .get(input.budgetId, input.businessId, now(), now()) as
      Record<string, unknown> | undefined;
    const spendRequestId = id("spend");
    const deny = (reason: string): SpendResult => {
      db.prepare(
        `INSERT INTO spend_request(id,business_id,requested_by,amount,currency,vendor,purpose,budget_id,related_work_item_id,risk,legal_risk,recurring,status,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'DENIED',?,?,?)`,
      ).run(
        spendRequestId,
        input.businessId,
        input.requestedBy,
        input.amount,
        input.currency,
        input.vendor,
        input.purpose,
        input.budgetId,
        input.relatedWorkItemId ?? null,
        input.risk ?? "LOW",
        input.legalRisk ? 1 : 0,
        input.recurring ? 1 : 0,
        key,
        now(),
        now(),
      );
      audit(db, {
        type: "SPEND_REQUESTED",
        actorId: input.requestedBy,
        businessId: input.businessId,
        subjectType: "SPEND_REQUEST",
        subjectId: spendRequestId,
        data: {
          amount: input.amount,
          currency: input.currency,
          status: "DENIED",
          reason,
        },
      });
      return { status: "DENIED", spendRequestId, reasons: [reason] };
    };
    if (!budget) return deny("BUDGET_NOT_FOUND");
    if (budget.currency !== input.currency) return deny("CURRENCY_MISMATCH");
    if (availableBudget(db, input.budgetId) < input.amount)
      return deny("INSUFFICIENT_AVAILABLE_BUDGET");
    const intent: ActionIntent = {
      actionType: "SPEND_MONEY",
      actorId: input.requestedBy,
      businessId: input.businessId,
      subjectType: "SPEND_REQUEST",
      subjectId: spendRequestId,
      subjectVersion: key,
      workItemId: input.relatedWorkItemId,
      amount: input.amount,
      currency: input.currency,
      destination: input.vendor,
      metadata: {
        legalRisk: input.legalRisk ?? false,
        recurring: input.recurring ?? false,
        risk: input.risk ?? "LOW",
      },
    };
    const decision = evaluateAction(db, intent, true);
    if (decision.outcome === "DENY")
      return deny(decision.denialReasons.join(","));
    const gateIds = decision.missingGates.flatMap((g) =>
      g.gateId ? [g.gateId] : [],
    );
    db.prepare(
      `INSERT INTO spend_request(id,business_id,requested_by,amount,currency,vendor,purpose,budget_id,related_work_item_id,risk,legal_risk,recurring,status,gate_id,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      spendRequestId,
      input.businessId,
      input.requestedBy,
      input.amount,
      input.currency,
      input.vendor,
      input.purpose,
      input.budgetId,
      input.relatedWorkItemId ?? null,
      input.risk ?? "LOW",
      input.legalRisk ? 1 : 0,
      input.recurring ? 1 : 0,
      gateIds.length ? "WAITING_APPROVAL" : "REQUESTED",
      gateIds[0] ?? null,
      key,
      now(),
      now(),
    );
    audit(db, {
      type: "SPEND_REQUESTED",
      actorId: input.requestedBy,
      businessId: input.businessId,
      subjectType: "SPEND_REQUEST",
      subjectId: spendRequestId,
      subjectVersion: key,
      data: {
        amount: input.amount,
        currency: input.currency,
        status: gateIds.length ? "WAITING_APPROVAL" : "REQUESTED",
        gateIds,
      },
    });
    if (gateIds.length) {
      const humanGate = decision.missingGates.find(
        (g) => g.humanOnly && g.gateId,
      );
      if (humanGate?.gateId)
        createHumanRequest(db, {
          businessId: input.businessId,
          workItemId: input.relatedWorkItemId,
          gateId: humanGate.gateId,
          type: "APPROVAL",
          requestedResponsibility: humanGate.responsibility,
          subjectType: "SPEND_REQUEST",
          subjectId: spendRequestId,
          subjectVersion: key,
          title: `Approve ${input.currency} ${(input.amount / 100).toFixed(2)} spend`,
          context: `Blocked spend to ${input.vendor}. Purpose: ${input.purpose}. Risk: ${input.risk ?? "LOW"}. Budget availability was verified at request time; it will be checked again when reserving funds.`,
          recommendation:
            "Approve only if the commitment and risk are acceptable.",
          options: ["Approve", "Reject"],
          expiresAt: undefined,
        });
      for (const agentGate of decision.missingGates.filter(
        (candidate) => !candidate.humanOnly && candidate.gateId,
      )) {
        const owner = db
          .prepare(
            `SELECT ro.actor_id FROM responsibility_owner ro JOIN responsibility r ON r.id=ro.responsibility_id JOIN actor a ON a.id=ro.actor_id WHERE r.slug=? AND ro.active=1 AND a.kind='EMPLOYEE' AND a.status='ACTIVE' AND (ro.business_id IS NULL OR ro.business_id=?) ORDER BY ro.business_id DESC LIMIT 1`,
          )
          .get(agentGate.responsibility, input.businessId) as
          { actor_id: string } | undefined;
        if (owner)
          createWorkItem(db, {
            businessId: input.businessId,
            type: "FINANCIAL_REVIEW",
            title: `Review spend to ${input.vendor}`,
            goal: `Independently assess and approve or reject gate ${agentGate.gateId} for ${input.currency} ${(input.amount / 100).toFixed(2)}: ${input.purpose}`,
            createdBy: "system",
            assignedTo: owner.actor_id,
            status: "READY",
            risk: input.risk === "HIGH" ? "HIGH" : "MEDIUM",
            subjectType: "SPEND_REQUEST",
            subjectId: spendRequestId,
            subjectVersion: key,
          });
      }
      return { status: "WAITING_APPROVAL", spendRequestId, gateIds };
    }
    return authorizeCommitment(db, spendRequestId, "system");
  });
}
export function authorizeCommitment(
  db: CultDatabase,
  spendRequestId: string,
  authorizedBy: string,
): SpendResult {
  return immediateTransaction(db, () => {
    const request = db
      .prepare("SELECT * FROM spend_request WHERE id=?")
      .get(spendRequestId) as Record<string, unknown> | undefined;
    if (!request)
      throw new Cult4Error(
        "Spend request not found.",
        "SPEND_REQUEST_NOT_FOUND",
      );
    if (request.status === "AUTHORIZED")
      return {
        status: "AUTHORIZED",
        spendRequestId,
        commitmentId: String(request.commitment_id),
      };
    if (!["REQUESTED", "WAITING_APPROVAL"].includes(String(request.status)))
      throw new Cult4Error(
        "Spend request cannot be authorized.",
        "SPEND_NOT_AUTHORIZABLE",
      );
    if (request.gate_id) {
      const gate = db
        .prepare("SELECT status FROM gate WHERE id=?")
        .get(request.gate_id) as { status: string } | undefined;
      if (gate?.status !== "SATISFIED")
        throw new Cult4Error(
          "Spend approval gate is unsatisfied.",
          "ACTION_BLOCKED",
        );
    }
    if (availableBudget(db, String(request.budget_id)) < Number(request.amount))
      throw new Cult4Error(
        "Budget no longer has sufficient available funds.",
        "INSUFFICIENT_AVAILABLE_BUDGET",
      );
    const commitmentId = id("commitment");
    db.prepare(
      "INSERT INTO commitment(id,budget_id,spend_request_id,amount,currency,counterparty,purpose,status,authorized_by,created_at) VALUES(?,?,?,?,?,?,?,'ACTIVE',?,?)",
    ).run(
      commitmentId,
      request.budget_id,
      spendRequestId,
      request.amount,
      request.currency,
      request.vendor,
      request.purpose,
      authorizedBy,
      now(),
    );
    db.prepare(
      "UPDATE spend_request SET status='AUTHORIZED',commitment_id=?,updated_at=? WHERE id=?",
    ).run(commitmentId, now(), spendRequestId);
    audit(db, {
      type: "SPEND_AUTHORIZED",
      actorId: authorizedBy,
      businessId: String(request.business_id),
      subjectType: "SPEND_REQUEST",
      subjectId: spendRequestId,
      subjectVersion: String(request.idempotency_key),
      data: {
        commitmentId,
        amount: request.amount,
        currency: request.currency,
      },
    });
    return { status: "AUTHORIZED", spendRequestId, commitmentId };
  });
}
export function recordTransaction(
  db: CultDatabase,
  input: {
    businessId: string;
    budgetId?: string;
    commitmentId?: string;
    amount: number;
    currency: string;
    category: string;
    counterparty?: string;
    externalReference: string;
    source: string;
    occurredAt?: string;
  },
): string {
  if (!Number.isInteger(input.amount) || input.amount <= 0)
    throw new Cult4Error(
      "Transaction amount must be positive minor units.",
      "INVALID_AMOUNT",
    );
  const transactionId = id("transaction");
  immediateTransaction(db, () => {
    db.prepare(
      "INSERT INTO transaction_entry(id,business_id,budget_id,commitment_id,amount,currency,category,counterparty,occurred_at,external_reference,source) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      transactionId,
      input.businessId,
      input.budgetId ?? null,
      input.commitmentId ?? null,
      input.amount,
      input.currency,
      input.category,
      input.counterparty ?? null,
      input.occurredAt ?? now(),
      input.externalReference,
      input.source,
    );
    if (input.commitmentId)
      db.prepare(
        "UPDATE commitment SET status='SETTLED',external_ref=? WHERE id=?",
      ).run(input.externalReference, input.commitmentId);
  });
  return transactionId;
}
