import { createHash } from "node:crypto";
import { z } from "zod";
import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, now } from "./domain.js";
import {
  cancelHumanRequest,
  createHumanRequest,
  resolveHumanRequest,
} from "./human.js";
import { transitionWorkItem } from "./work.js";
import {
  assertMandateRequestCoverage,
  messageDispositionSchema,
  officialRequestSchema,
  persistMandateRequestCoverage,
} from "./requirements.js";

const meaningful = z.string().trim().min(10);
const detail = z.string().trim().min(40);
export const businessMandateInputSchema = z.object({
  purpose: meaningful,
  customer: meaningful,
  offer: meaningful,
  narrative: z.string().trim().min(160),
  spirit: z.string().trim().min(80),
  voice: detail,
  taste: detail,
  emotionalTerritory: detail,
  qualityBar: detail,
  autonomyMode: z.enum(["ASSISTED", "SUPERVISED", "BOUNDED_AUTONOMOUS"]),
  constraints: z.array(meaningful).min(1),
  allowedWithoutApproval: z.array(meaningful).min(1),
  requiresApproval: z.array(meaningful).min(1),
  prohibited: z.array(meaningful).min(1),
  antiGoals: z.array(meaningful).min(1),
  successSignals: z.array(meaningful).min(1),
  stopConditions: z.array(meaningful).min(1),
  humanInputs: z.array(meaningful).min(1),
  unresolvedQuestions: z.array(meaningful),
  officialRequests: z.array(officialRequestSchema).min(1),
  messageDispositions: z.array(messageDispositionSchema),
  budget: z
    .object({
      currency: z.string().trim().min(3).max(3),
      maxExplorationSpendCents: z.number().int().min(0),
      maxSpendWithoutApprovalCents: z.number().int().min(0),
      maxSingleSpendCents: z.number().int().min(0),
    })
    .refine(
      (budget) =>
        budget.maxSpendWithoutApprovalCents <= budget.maxSingleSpendCents &&
        budget.maxSingleSpendCents <= budget.maxExplorationSpendCents,
      "Spend limits must increase from no-approval to single-spend to total exploration budget.",
    ),
});

export type BusinessMandateInput = z.infer<typeof businessMandateInputSchema>;

export interface BusinessMandateRecord {
  id: string;
  business_id: string;
  version: number;
  status: "DRAFT" | "CONFIRMED" | "REJECTED" | "SUPERSEDED";
  purpose: string;
  customer: string;
  offer: string;
  narrative: string;
  spirit: string;
  autonomy_mode: "ASSISTED" | "SUPERVISED" | "BOUNDED_AUTONOMOUS";
  contract_json: string;
  anti_goals_json: string;
  human_inputs_json: string;
  unresolved_questions_json: string;
  content_hash: string;
  proposed_by: string;
  created_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

function canonicalContent(
  input: BusinessMandateInput,
): Record<string, unknown> {
  return {
    purpose: input.purpose,
    customer: input.customer,
    offer: input.offer,
    narrative: input.narrative,
    spirit: input.spirit,
    voice: input.voice,
    taste: input.taste,
    emotionalTerritory: input.emotionalTerritory,
    qualityBar: input.qualityBar,
    autonomyMode: input.autonomyMode,
    constraints: input.constraints,
    allowedWithoutApproval: input.allowedWithoutApproval,
    requiresApproval: input.requiresApproval,
    prohibited: input.prohibited,
    antiGoals: input.antiGoals,
    successSignals: input.successSignals,
    stopConditions: input.stopConditions,
    humanInputs: input.humanInputs,
    unresolvedQuestions: input.unresolvedQuestions,
    officialRequests: input.officialRequests,
    messageDispositions: input.messageDispositions,
    budget: input.budget,
  };
}

export function hasConfirmedBusinessMandate(
  db: CultDatabase,
  businessId: string,
): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM business_mandate WHERE business_id=? AND status='CONFIRMED'",
      )
      .get(businessId),
  );
}

export function getBusinessMandate(
  db: CultDatabase,
  mandateId: string,
): BusinessMandateRecord {
  const mandate = db
    .prepare("SELECT * FROM business_mandate WHERE id=?")
    .get(mandateId) as BusinessMandateRecord | undefined;
  if (!mandate)
    throw new Cult4Error("Business mandate not found.", "MANDATE_NOT_FOUND");
  return mandate;
}

export function latestBusinessMandate(
  db: CultDatabase,
  businessId: string,
): BusinessMandateRecord | undefined {
  return db
    .prepare(
      "SELECT * FROM business_mandate WHERE business_id=? ORDER BY version DESC LIMIT 1",
    )
    .get(businessId) as BusinessMandateRecord | undefined;
}

export function proposeBusinessMandate(
  db: CultDatabase,
  inputValue: unknown,
  context: { businessId: string; workItemId: string; proposedBy: string },
): { mandateId: string; contentHash: string; humanRequestId: string } {
  if (context.proposedBy !== "employee-operator")
    throw new Cult4Error(
      "Only the Operator may propose a business mandate.",
      "MANDATE_PROPOSER_DENIED",
    );
  const work = db
    .prepare("SELECT type FROM work_item WHERE id=? AND business_id=?")
    .get(context.workItemId, context.businessId) as
    { type: string } | undefined;
  if (!work || work.type !== "OPERATOR_INTERACTION")
    throw new Cult4Error(
      "A business mandate must come from a human-directed Operator interaction.",
      "MANDATE_CONVERSATION_REQUIRED",
    );
  const input = businessMandateInputSchema.parse(inputValue);
  const content = canonicalContent(input);
  const contentHash = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
  const duplicate = db
    .prepare(
      "SELECT id FROM business_mandate WHERE business_id=? AND content_hash=?",
    )
    .get(context.businessId, contentHash) as { id: string } | undefined;
  if (duplicate)
    throw new Cult4Error(
      "This exact business mandate was already proposed.",
      "MANDATE_ALREADY_PROPOSED",
      { mandateId: duplicate.id, contentHash },
    );
  const version = (
    db
      .prepare(
        "SELECT COALESCE(max(version),0)+1 version FROM business_mandate WHERE business_id=?",
      )
      .get(context.businessId) as { version: number }
  ).version;
  const mandateId = id("mandate");
  const previousRequests = db
    .prepare(
      `SELECT hr.id FROM human_request hr JOIN business_mandate bm ON bm.id=hr.subject_id
       WHERE bm.business_id=? AND hr.subject_type='BUSINESS_MANDATE' AND hr.status IN ('PENDING','REMINDER_DUE','OVERDUE')`,
    )
    .all(context.businessId) as Array<{ id: string }>;
  let humanRequestId = "";
  db.transaction(() => {
    db.prepare(
      "UPDATE business_mandate SET status='SUPERSEDED' WHERE business_id=? AND status='DRAFT'",
    ).run(context.businessId);
    db.prepare(
      `INSERT INTO business_mandate(
        id,business_id,version,status,purpose,customer,offer,narrative,spirit,autonomy_mode,
        contract_json,anti_goals_json,human_inputs_json,unresolved_questions_json,content_hash,proposed_by,created_at
      ) VALUES(?,?,?,'DRAFT',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      mandateId,
      context.businessId,
      version,
      input.purpose,
      input.customer,
      input.offer,
      input.narrative,
      input.spirit,
      input.autonomyMode,
      JSON.stringify({
        voice: input.voice,
        taste: input.taste,
        emotionalTerritory: input.emotionalTerritory,
        qualityBar: input.qualityBar,
        constraints: input.constraints,
        allowedWithoutApproval: input.allowedWithoutApproval,
        requiresApproval: input.requiresApproval,
        prohibited: input.prohibited,
        successSignals: input.successSignals,
        stopConditions: input.stopConditions,
        budget: input.budget,
        officialRequests: input.officialRequests.map((request) => ({
          statement: request.statement,
          kind: request.kind,
          priority: request.priority,
          acceptanceCriteria: request.acceptanceCriteria,
          disposition: request.disposition,
          contractReference: request.contractReference,
          rationale: request.rationale,
          sourceMessageIds: request.sourceMessageIds,
        })),
        messageDispositions: input.messageDispositions,
      }),
      JSON.stringify(input.antiGoals),
      JSON.stringify(input.humanInputs),
      JSON.stringify(input.unresolvedQuestions),
      contentHash,
      context.proposedBy,
      now(),
    );
    persistMandateRequestCoverage(db, {
      businessId: context.businessId,
      workItemId: context.workItemId,
      mandateId,
      actorId: context.proposedBy,
      officialRequests: input.officialRequests,
      messageDispositions: input.messageDispositions,
    });
    audit(db, {
      type: "BUSINESS_MANDATE_PROPOSED",
      actorId: context.proposedBy,
      businessId: context.businessId,
      subjectType: "BUSINESS_MANDATE",
      subjectId: mandateId,
      subjectVersion: contentHash,
      data: { version, autonomyMode: input.autonomyMode },
    });
    for (const request of previousRequests) cancelHumanRequest(db, request.id);
    humanRequestId = createHumanRequest(db, {
      businessId: context.businessId,
      workItemId: context.workItemId,
      type: "APPROVAL",
      subjectType: "BUSINESS_MANDATE",
      subjectId: mandateId,
      subjectVersion: contentHash,
      title: `Confirm business mandate v${version}`,
      context: `Confirm that the operating contract, narrative spirit, and ${input.officialRequests.length} official human request(s) faithfully represent the entire Intake. Every captured human message has been linked or explicitly dispositioned.`,
      recommendation:
        "Revise anything that feels generic, reductive, or unlike the intended business before approval.",
      options: ["APPROVE_EXACT_VERSION", "REVISE", "REJECT"],
    });
  })();
  return { mandateId, contentHash, humanRequestId };
}

export function confirmBusinessMandate(
  db: CultDatabase,
  mandateId: string,
  actorId = "human-owner",
  expectedHash?: string,
): BusinessMandateRecord {
  const mandate = getBusinessMandate(db, mandateId);
  if (mandate.status !== "DRAFT")
    throw new Cult4Error(
      "Business mandate is not awaiting confirmation.",
      "MANDATE_NOT_DRAFT",
    );
  if (expectedHash && mandate.content_hash !== expectedHash)
    throw new Cult4Error(
      "Business mandate version does not match the reviewed version.",
      "MANDATE_VERSION_MISMATCH",
    );
  const request = db
    .prepare(
      `SELECT id,subject_version FROM human_request
       WHERE subject_type='BUSINESS_MANDATE' AND subject_id=? AND status IN ('PENDING','REMINDER_DUE','OVERDUE')
       ORDER BY requested_at DESC LIMIT 1`,
    )
    .get(mandateId) as { id: string; subject_version: string } | undefined;
  if (!request || request.subject_version !== mandate.content_hash)
    throw new Cult4Error(
      "Exact mandate confirmation request is missing.",
      "MANDATE_CONFIRMATION_MISSING",
    );
  assertMandateRequestCoverage(db, mandateId);
  resolveHumanRequest(db, request.id, actorId, true);
  db.transaction(() => {
    db.prepare(
      "UPDATE business_mandate SET status='SUPERSEDED' WHERE business_id=? AND status='CONFIRMED'",
    ).run(mandate.business_id);
    db.prepare(
      "UPDATE business_mandate SET status='CONFIRMED',confirmed_by=?,confirmed_at=? WHERE id=?",
    ).run(actorId, now(), mandateId);
    db.prepare("UPDATE business SET confirmed_mandate_id=? WHERE id=?").run(
      mandateId,
      mandate.business_id,
    );
    audit(db, {
      type: "BUSINESS_MANDATE_CONFIRMED",
      actorId,
      businessId: mandate.business_id,
      subjectType: "BUSINESS_MANDATE",
      subjectId: mandateId,
      subjectVersion: mandate.content_hash,
      data: { version: mandate.version },
    });
  })();
  const foundation = db
    .prepare(
      `SELECT id,status FROM work_item
       WHERE business_id=? AND type='BUSINESS_FOUNDATION'
         AND status NOT IN ('DONE','FAILED','CANCELLED')
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(mandate.business_id) as { id: string; status: string } | undefined;
  if (foundation) {
    db.prepare(
      "UPDATE work_item SET subject_type='BUSINESS_MANDATE',subject_id=?,subject_version=?,updated_at=? WHERE id=?",
    ).run(mandateId, mandate.content_hash, now(), foundation.id);
    if (foundation.status === "PROPOSED")
      transitionWorkItem(db, foundation.id, "READY", actorId);
  }
  const interaction = db
    .prepare("SELECT work_item_id FROM human_request WHERE id=?")
    .get(request.id) as { work_item_id: string | null };
  if (interaction.work_item_id) {
    const state = db
      .prepare("SELECT status FROM work_item WHERE id=?")
      .get(interaction.work_item_id) as { status: string };
    if (state.status === "WAITING_HUMAN")
      transitionWorkItem(db, interaction.work_item_id, "DONE", actorId);
  }
  return getBusinessMandate(db, mandateId);
}

export function rejectBusinessMandate(
  db: CultDatabase,
  mandateId: string,
  actorId = "human-owner",
  notes?: string,
): BusinessMandateRecord {
  const mandate = getBusinessMandate(db, mandateId);
  if (mandate.status !== "DRAFT")
    throw new Cult4Error(
      "Business mandate is not awaiting review.",
      "MANDATE_NOT_DRAFT",
    );
  const request = db
    .prepare(
      `SELECT id,work_item_id FROM human_request
       WHERE subject_type='BUSINESS_MANDATE' AND subject_id=? AND subject_version=? AND status IN ('PENDING','REMINDER_DUE','OVERDUE')
       ORDER BY requested_at DESC LIMIT 1`,
    )
    .get(mandateId, mandate.content_hash) as
    { id: string; work_item_id: string | null } | undefined;
  if (!request)
    throw new Cult4Error(
      "Exact mandate confirmation request is missing.",
      "MANDATE_CONFIRMATION_MISSING",
    );
  resolveHumanRequest(db, request.id, actorId, false, notes);
  db.prepare("UPDATE business_mandate SET status='REJECTED' WHERE id=?").run(
    mandateId,
  );
  audit(db, {
    type: "BUSINESS_MANDATE_REJECTED",
    actorId,
    businessId: mandate.business_id,
    subjectType: "BUSINESS_MANDATE",
    subjectId: mandateId,
    subjectVersion: mandate.content_hash,
    data: { version: mandate.version, notes },
  });
  if (request.work_item_id) {
    const state = db
      .prepare("SELECT status FROM work_item WHERE id=?")
      .get(request.work_item_id) as { status: string };
    if (state.status === "WAITING_HUMAN")
      transitionWorkItem(db, request.work_item_id, "BLOCKED", actorId, notes);
  }
  return getBusinessMandate(db, mandateId);
}

export function formatBusinessMandate(mandate: BusinessMandateRecord): string {
  const contract = JSON.parse(mandate.contract_json) as Record<string, unknown>;
  const antiGoals = JSON.parse(mandate.anti_goals_json) as string[];
  const humanInputs = JSON.parse(mandate.human_inputs_json) as string[];
  const unresolved = JSON.parse(mandate.unresolved_questions_json) as string[];
  const lines = (label: string, values: unknown): string[] => [
    label,
    ...((values as string[] | undefined) ?? []).map((value) => `- ${value}`),
  ];
  const budget = contract.budget as
    | {
        currency?: string;
        maxExplorationSpendCents?: number;
        maxSpendWithoutApprovalCents?: number;
        maxSingleSpendCents?: number;
      }
    | undefined;
  const officialRequests = (contract.officialRequests ?? []) as Array<{
    statement: string;
    priority: string;
    disposition: string;
    acceptanceCriteria: string;
    contractReference: string;
    sourceMessageIds: string[];
  }>;
  return [
    `MANDAT D’ENTREPRISE — v${mandate.version}`,
    `Version exacte: ${mandate.content_hash}`,
    "",
    `Raison d’être: ${mandate.purpose}`,
    `Client: ${mandate.customer}`,
    `Offre: ${mandate.offer}`,
    `Mode d’autonomie: ${mandate.autonomy_mode}`,
    "",
    "DESCRIPTION VIVANTE",
    mandate.narrative,
    "",
    "ESPRIT À PRÉSERVER",
    mandate.spirit,
    "",
    `Voix: ${String(contract.voice)}`,
    `Goût: ${String(contract.taste)}`,
    `Territoire émotionnel: ${String(contract.emotionalTerritory)}`,
    `Barre de qualité: ${String(contract.qualityBar)}`,
    "",
    "CONTRAT OPÉRATIONNEL",
    ...lines("Contraintes", contract.constraints),
    ...lines(
      "Autorisé sans nouvelle approbation",
      contract.allowedWithoutApproval,
    ),
    ...lines("Approbation humaine requise", contract.requiresApproval),
    ...lines("Interdit", contract.prohibited),
    ...lines("Signaux de réussite", contract.successSignals),
    ...lines("Conditions d’arrêt", contract.stopConditions),
    "",
    "DEMANDES OFFICIELLES DE L’UTILISATEUR",
    ...officialRequests.flatMap((request) => [
      `- [${request.priority}] [${request.disposition}] ${request.statement}`,
      `  Acceptation: ${request.acceptanceCriteria}`,
      `  Contrat: ${request.contractReference}`,
      `  Sources Intake: ${request.sourceMessageIds.join(", ")}`,
    ]),
    `Budget d’exploration maximal: ${budget?.maxExplorationSpendCents ?? 0} unités mineures (${budget?.currency ?? "devise inconnue"})`,
    `Dépense permise sans approbation: ${budget?.maxSpendWithoutApprovalCents ?? 0} unités mineures (${budget?.currency ?? "devise inconnue"})`,
    `Dépense unitaire maximale: ${budget?.maxSingleSpendCents ?? 0} unités mineures (${budget?.currency ?? "devise inconnue"})`,
    "",
    ...lines("ANTI-OBJECTIFS", antiGoals),
    ...lines("PAROLES ET INTENTIONS HUMAINES RETENUES", humanInputs),
    ...(unresolved.length
      ? lines("QUESTIONS ENCORE OUVERTES", unresolved)
      : ["QUESTIONS ENCORE OUVERTES", "- Aucune"]),
  ].join("\n");
}

export function formatMandateRequestCoverage(
  db: CultDatabase,
  mandateId: string,
): string {
  const requests = db
    .prepare(
      `SELECT r.id,r.statement,r.kind,r.priority,r.acceptance_criteria,
         mr.disposition,mr.contract_reference,mr.rationale
       FROM mandate_request mr JOIN official_request r ON r.id=mr.request_id
       WHERE mr.mandate_id=? ORDER BY r.created_at`,
    )
    .all(mandateId) as Array<Record<string, string>>;
  const lines = ["TRAÇABILITÉ EXACTE DE L’INTAKE"];
  for (const request of requests) {
    lines.push(
      "",
      `[${request.priority}] [${request.disposition}] ${request.statement}`,
      `Critère d’acceptation: ${request.acceptance_criteria}`,
      `Lien contractuel: ${request.contract_reference}`,
      `Justification: ${request.rationale}`,
      "Messages utilisateur sources:",
    );
    const sources = db
      .prepare(
        `SELECT im.ordinal,im.content FROM official_request_source ors
         JOIN intake_message im ON im.id=ors.intake_message_id
         WHERE ors.request_id=? ORDER BY im.ordinal`,
      )
      .all(request.id) as Array<{ ordinal: number; content: string }>;
    for (const source of sources)
      lines.push(`  #${source.ordinal + 1}: ${source.content}`);
  }
  const dispositions = db
    .prepare(
      `SELECT im.ordinal,im.content,imd.disposition,imd.rationale
       FROM intake_message_disposition imd
       JOIN intake_message im ON im.id=imd.intake_message_id
       JOIN human_request hr ON hr.work_item_id=im.work_item_id
       WHERE hr.subject_type='BUSINESS_MANDATE' AND hr.subject_id=?
       ORDER BY im.ordinal`,
    )
    .all(mandateId) as Array<{
    ordinal: number;
    content: string;
    disposition: string;
    rationale: string;
  }>;
  if (dispositions.length) {
    lines.push("", "MESSAGES SANS DEMANDE OFFICIELLE — À VÉRIFIER");
    for (const item of dispositions)
      lines.push(
        `#${item.ordinal + 1} [${item.disposition}] ${item.content}`,
        `  Justification: ${item.rationale}`,
      );
  }
  return lines.join("\n");
}
