import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, now } from "./domain.js";

export const officialRequestSchema = z.object({
  statement: z.string().trim().min(10),
  kind: z.enum([
    "OUTCOME",
    "CAPABILITY",
    "INTEGRATION",
    "CONSTRAINT",
    "PREFERENCE",
    "IDEA",
    "QUALITY",
    "OPERATION",
  ]),
  priority: z.enum(["MUST", "SHOULD", "MAY"]),
  acceptanceCriteria: z.string().trim().min(20),
  sourceMessageIds: z.array(z.string().min(1)).min(1),
  disposition: z.enum([
    "COMMITTED",
    "IDEA_TO_EXPLORE",
    "DEFERRED",
    "REJECTED",
    "SUPERSEDED_BY_USER",
  ]),
  contractReference: z.string().trim().min(3),
  rationale: z.string().trim().min(10),
  deviationRequestId: z.string().optional(),
});

export const messageDispositionSchema = z.object({
  messageId: z.string().min(1),
  disposition: z.enum([
    "NON_SUBSTANTIVE",
    "CONTEXT_ONLY",
    "SUPERSEDED_BY_USER",
  ]),
  rationale: z.string().trim().min(10),
});

export type OfficialRequestInput = z.infer<typeof officialRequestSchema>;
export type MessageDispositionInput = z.infer<typeof messageDispositionSchema>;

type ExportedSession = {
  info?: { id?: string };
  messages?: Array<{
    info?: { id?: string; role?: string; time?: { created?: number } };
    parts?: Array<{ type?: string; text?: string }>;
  }>;
};

export function syncIntakeTranscript(
  db: CultDatabase,
  input: {
    businessId: string;
    workItemId: string;
    sessionId: string;
    opencodeBinary?: string;
  },
): { captured: number; messageIds: string[] } {
  let exported: ExportedSession;
  try {
    exported = readOpenCodeSession(input.sessionId, input.opencodeBinary);
  } catch (error) {
    throw new Cult4Error(
      `The exact Intake transcript could not be captured: ${error instanceof Error ? error.message : String(error)}`,
      "INTAKE_TRANSCRIPT_UNAVAILABLE",
    );
  }
  if (exported.info?.id !== input.sessionId)
    throw new Cult4Error(
      "OpenCode exported a different Intake session.",
      "INTAKE_TRANSCRIPT_MISMATCH",
    );
  const userMessages = (exported.messages ?? [])
    .filter((message) => message.info?.role === "user")
    .map((message, ordinal) => ({
      externalId: message.info?.id,
      ordinal,
      content: (message.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n")
        .trim(),
    }))
    .filter(
      (
        message,
      ): message is {
        externalId: string;
        ordinal: number;
        content: string;
      } => Boolean(message.externalId && message.content),
    );
  if (!userMessages.length)
    throw new Cult4Error(
      "The Intake session contains no capturable human message.",
      "INTAKE_TRANSCRIPT_EMPTY",
    );
  const capturedIds: string[] = [];
  db.transaction(() => {
    for (const message of userMessages) {
      const existing = db
        .prepare(
          "SELECT id,content_hash FROM intake_message WHERE session_id=? AND external_message_id=?",
        )
        .get(input.sessionId, message.externalId) as
        { id: string; content_hash: string } | undefined;
      const hash = createHash("sha256").update(message.content).digest("hex");
      if (existing && existing.content_hash !== hash)
        throw new Cult4Error(
          "A captured human message changed after ingestion.",
          "INTAKE_MESSAGE_MUTATED",
        );
      const messageId = existing?.id ?? id("intake");
      if (!existing)
        db.prepare(
          `INSERT INTO intake_message(id,business_id,work_item_id,session_id,external_message_id,ordinal,content,content_hash,created_at)
           VALUES(?,?,?,?,?,?,?,?,?)`,
        ).run(
          messageId,
          input.businessId,
          input.workItemId,
          input.sessionId,
          message.externalId,
          message.ordinal,
          message.content,
          hash,
          now(),
        );
      capturedIds.push(messageId);
    }
  })();
  return { captured: capturedIds.length, messageIds: capturedIds };
}

function readOpenCodeSession(
  sessionId: string,
  opencodeBinary?: string,
): ExportedSession {
  const dataRoot = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
  const databasePath = join(dataRoot, "opencode", "opencode.db");
  if (existsSync(databasePath)) {
    const source = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
    try {
      const session = source
        .prepare("SELECT id FROM session WHERE id=?")
        .get(sessionId) as { id: string } | undefined;
      if (!session)
        throw new Error(`OpenCode session ${sessionId} was not found.`);
      const rows = source
        .prepare(
          `SELECT m.id message_id,m.data message_data,p.data part_data
           FROM message m LEFT JOIN part p ON p.message_id=m.id
           WHERE m.session_id=? ORDER BY m.time_created,m.id,p.id`,
        )
        .all(sessionId) as Array<{
        message_id: string;
        message_data: string;
        part_data: string | null;
      }>;
      const messages = new Map<
        string,
        NonNullable<ExportedSession["messages"]>[number]
      >();
      for (const row of rows) {
        const messageData = JSON.parse(row.message_data) as {
          role?: string;
          time?: { created?: number };
        };
        const message = messages.get(row.message_id) ?? {
          info: {
            id: row.message_id,
            role: messageData.role,
            time: messageData.time,
          },
          parts: [],
        };
        if (row.part_data) {
          const part = JSON.parse(row.part_data) as {
            type?: string;
            text?: string;
          };
          message.parts!.push(part);
        }
        messages.set(row.message_id, message);
      }
      return { info: { id: session.id }, messages: [...messages.values()] };
    } finally {
      source.close();
    }
  }
  return JSON.parse(
    execFileSync(
      opencodeBinary ?? "opencode",
      ["export", sessionId, "--pure", "--sanitize"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    ),
  ) as ExportedSession;
}

export function persistMandateRequestCoverage(
  db: CultDatabase,
  input: {
    businessId: string;
    workItemId: string;
    mandateId: string;
    actorId: string;
    officialRequests: OfficialRequestInput[];
    messageDispositions: MessageDispositionInput[];
  },
): string[] {
  const messages = db
    .prepare(
      "SELECT id FROM intake_message WHERE business_id=? ORDER BY created_at,ordinal",
    )
    .all(input.businessId) as Array<{ id: string }>;
  if (!messages.length)
    throw new Cult4Error(
      "No exact human Intake transcript is attached to this mandate.",
      "INTAKE_TRANSCRIPT_REQUIRED",
    );
  const known = new Set(messages.map(({ id }) => id));
  const referenced = new Set(
    input.officialRequests.flatMap((request) => request.sourceMessageIds),
  );
  const disposed = new Set(
    input.messageDispositions.map((item) => item.messageId),
  );
  for (const messageId of [...referenced, ...disposed])
    if (!known.has(messageId))
      throw new Cult4Error(
        "Mandate coverage references a message outside this exact Intake.",
        "INTAKE_MESSAGE_SCOPE_MISMATCH",
      );
  const uncovered = messages.filter(
    ({ id }) => !referenced.has(id) && !disposed.has(id),
  );
  if (uncovered.length)
    throw new Cult4Error(
      "Every human Intake message must be linked to an official request or explicitly dispositioned.",
      "INTAKE_COVERAGE_INCOMPLETE",
      { messageIds: uncovered.map(({ id }) => id) },
    );
  const requestIds: string[] = [];
  db.transaction(() => {
    for (const request of input.officialRequests) {
      if (
        ["DEFERRED", "REJECTED"].includes(request.disposition) &&
        !approvedDeviation(db, input.businessId, request.deviationRequestId)
      )
        throw new Cult4Error(
          "Deferring or rejecting a human request requires an explicitly resolved Human Request.",
          "REQUEST_DEVIATION_APPROVAL_REQUIRED",
        );
      const requestId = id("request");
      const timestamp = now();
      db.prepare(
        `INSERT INTO official_request(id,business_id,statement,kind,priority,acceptance_criteria,status,created_by,created_at,updated_at)
         VALUES(?,?,?,?,?,?,'ACTIVE',?,?,?)`,
      ).run(
        requestId,
        input.businessId,
        request.statement,
        request.kind,
        request.priority,
        request.acceptanceCriteria,
        input.actorId,
        timestamp,
        timestamp,
      );
      for (const messageId of request.sourceMessageIds)
        db.prepare(
          "INSERT INTO official_request_source(request_id,intake_message_id) VALUES(?,?)",
        ).run(requestId, messageId);
      db.prepare(
        `INSERT INTO mandate_request(mandate_id,request_id,disposition,contract_reference,rationale,deviation_request_id)
         VALUES(?,?,?,?,?,?)`,
      ).run(
        input.mandateId,
        requestId,
        request.disposition,
        request.contractReference,
        request.rationale,
        request.deviationRequestId ?? null,
      );
      requestIds.push(requestId);
    }
    for (const disposition of input.messageDispositions)
      db.prepare(
        `INSERT INTO intake_message_disposition(intake_message_id,disposition,rationale,decided_by,decided_at)
         VALUES(?,?,?,?,?)`,
      ).run(
        disposition.messageId,
        disposition.disposition,
        disposition.rationale,
        input.actorId,
        now(),
      );
    audit(db, {
      type: "MANDATE_REQUEST_COVERAGE_RECORDED",
      actorId: input.actorId,
      businessId: input.businessId,
      subjectType: "BUSINESS_MANDATE",
      subjectId: input.mandateId,
      data: { requestIds, messageCount: messages.length },
    });
  })();
  return requestIds;
}

export function assertMandateRequestCoverage(
  db: CultDatabase,
  mandateId: string,
): void {
  const mandate = db
    .prepare("SELECT business_id,created_at FROM business_mandate WHERE id=?")
    .get(mandateId) as { business_id: string; created_at: string } | undefined;
  if (!mandate) throw new Cult4Error("Mandate not found.", "MANDATE_NOT_FOUND");
  const intakeWork = db
    .prepare(
      `SELECT work_item_id FROM human_request
       WHERE subject_type='BUSINESS_MANDATE' AND subject_id=?
       ORDER BY requested_at DESC LIMIT 1`,
    )
    .get(mandateId) as { work_item_id: string | null } | undefined;
  if (!intakeWork?.work_item_id)
    throw new Cult4Error(
      "Mandate has no exact Intake work context.",
      "INTAKE_TRANSCRIPT_REQUIRED",
    );
  const missing = db
    .prepare(
      `SELECT im.id FROM intake_message im
       WHERE im.business_id=?
         AND im.created_at<=?
         AND NOT EXISTS(
           SELECT 1 FROM official_request_source ors
           JOIN mandate_request mr ON mr.request_id=ors.request_id
           WHERE ors.intake_message_id=im.id AND mr.mandate_id=?
         )
         AND NOT EXISTS(
           SELECT 1 FROM intake_message_disposition imd
           WHERE imd.intake_message_id=im.id
         )`,
    )
    .all(mandate.business_id, mandate.created_at, mandateId) as Array<{
    id: string;
  }>;
  if (missing.length)
    throw new Cult4Error(
      "The exact Intake gained human messages that are absent from the proposed contract.",
      "INTAKE_COVERAGE_INCOMPLETE",
      { messageIds: missing.map(({ id }) => id) },
    );
  const requestCount = (
    db
      .prepare("SELECT count(*) count FROM mandate_request WHERE mandate_id=?")
      .get(mandateId) as { count: number }
  ).count;
  if (!requestCount)
    throw new Cult4Error(
      "Mandate has no official human requests.",
      "MANDATE_REQUESTS_REQUIRED",
    );
  const invalidDeviations = db
    .prepare(
      `SELECT mr.request_id FROM mandate_request mr
       LEFT JOIN human_request hr ON hr.id=mr.deviation_request_id
       WHERE mr.mandate_id=? AND mr.disposition IN ('DEFERRED','REJECTED')
         AND (hr.id IS NULL OR hr.status<>'RESOLVED' OR hr.requested_responsibility<>'SCOPE_DEVIATION')`,
    )
    .all(mandateId);
  if (invalidDeviations.length)
    throw new Cult4Error(
      "A contract deviation lacks explicit human resolution.",
      "REQUEST_DEVIATION_APPROVAL_REQUIRED",
      { requests: invalidDeviations },
    );
}

function approvedDeviation(
  db: CultDatabase,
  businessId: string,
  humanRequestId?: string,
): boolean {
  if (!humanRequestId) return false;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM human_request
         WHERE id=? AND business_id=? AND type='DECISION'
           AND requested_responsibility='SCOPE_DEVIATION' AND status='RESOLVED'`,
      )
      .get(humanRequestId, businessId),
  );
}

export function linkWorkRequests(
  db: CultDatabase,
  workItemId: string,
  businessId: string,
  requestIds: string[],
  contribution = "IMPLEMENTS",
): void {
  if (!requestIds.length)
    throw new Cult4Error(
      "Ordinary Business work must identify the official human requests it serves.",
      "WORK_REQUEST_LINK_REQUIRED",
    );
  const count = (
    db
      .prepare(
        `SELECT count(*) count FROM official_request
         WHERE business_id=? AND status='ACTIVE' AND id IN (${requestIds.map(() => "?").join(",")})`,
      )
      .get(businessId, ...requestIds) as { count: number }
  ).count;
  if (count !== new Set(requestIds).size)
    throw new Cult4Error(
      "A WorkItem may only serve active official requests in its own Business.",
      "WORK_REQUEST_SCOPE_MISMATCH",
    );
  for (const requestId of new Set(requestIds))
    db.prepare(
      "INSERT INTO work_request(work_item_id,request_id,contribution) VALUES(?,?,?)",
    ).run(workItemId, requestId, contribution);
}

export function assertWorkRequestLinks(
  db: CultDatabase,
  workItemId: string,
  type: string,
  businessId: string | null,
): void {
  if (!businessId || exemptWorkType(type)) return;
  if (
    db
      .prepare("SELECT 1 FROM official_request WHERE business_id=?")
      .get(businessId) &&
    !db
      .prepare("SELECT 1 FROM work_request WHERE work_item_id=?")
      .get(workItemId)
  )
    throw new Cult4Error(
      "This WorkItem is not traceable to an official human request.",
      "WORK_REQUEST_LINK_REQUIRED",
    );
}

export function assertFoundationRequestCompletion(
  db: CultDatabase,
  businessId: string | null,
  type: string,
): void {
  if (!businessId || type !== "BUSINESS_FOUNDATION") return;
  const missing = db
    .prepare(
      `SELECT r.id,r.statement FROM official_request r
       JOIN mandate_request mr ON mr.request_id=r.id
       JOIN business b ON b.confirmed_mandate_id=mr.mandate_id
       WHERE r.business_id=? AND r.status='ACTIVE'
         AND mr.disposition IN ('COMMITTED','IDEA_TO_EXPLORE')
         AND NOT EXISTS(
           SELECT 1 FROM request_verification rv
           WHERE rv.request_id=r.id AND rv.result='PASS'
         )`,
    )
    .all(businessId);
  if (missing.length)
    throw new Cult4Error(
      "Business foundation cannot be completed while official human requests lack verified acceptance evidence.",
      "REQUEST_COVERAGE_INCOMPLETE",
      { missing },
    );
}

export function recordRequestVerification(
  db: CultDatabase,
  input: {
    requestId: string;
    workItemId: string;
    qaWorkItemId: string;
    qaEmployeeId: string;
    subjectType: string;
    subjectId: string;
    subjectVersion: string;
    result: "PASS" | "FAIL" | "PARTIAL";
    evidence: string[];
  },
): string {
  const qa = db
    .prepare(
      `SELECT business_id,type,assigned_to,subject_type,subject_id,subject_version
       FROM work_item WHERE id=?`,
    )
    .get(input.qaWorkItemId) as
    | {
        business_id: string;
        type: string;
        assigned_to: string | null;
        subject_type: string | null;
        subject_id: string | null;
        subject_version: string | null;
      }
    | undefined;
  if (
    !qa ||
    qa.type !== "DIGITAL_QA" ||
    qa.assigned_to !== input.qaEmployeeId ||
    qa.subject_type !== input.subjectType ||
    qa.subject_id !== input.subjectId ||
    qa.subject_version !== input.subjectVersion
  )
    throw new Cult4Error(
      "Requirement verification must come from the assigned independent QA on the exact subject version.",
      "REQUEST_VERIFICATION_DENIED",
    );
  if (
    !db
      .prepare(
        `SELECT 1 FROM work_request wr
         JOIN work_item w ON w.id=wr.work_item_id
         JOIN official_request r ON r.id=wr.request_id
         WHERE wr.work_item_id=? AND wr.request_id=? AND r.business_id=w.business_id AND w.business_id=?`,
      )
      .get(input.workItemId, input.requestId, qa.business_id)
  )
    throw new Cult4Error(
      "The verified work is not linked to this official human request.",
      "REQUEST_VERIFICATION_SCOPE_MISMATCH",
    );
  const verificationId = id("request-verification");
  db.prepare(
    `INSERT INTO request_verification(id,request_id,work_item_id,qa_work_item_id,subject_type,subject_id,subject_version,result,evidence_json,verified_by,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    verificationId,
    input.requestId,
    input.workItemId,
    input.qaWorkItemId,
    input.subjectType,
    input.subjectId,
    input.subjectVersion,
    input.result,
    JSON.stringify(input.evidence),
    input.qaEmployeeId,
    now(),
  );
  audit(db, {
    type: "OFFICIAL_REQUEST_VERIFIED",
    actorId: input.qaEmployeeId,
    businessId: qa.business_id,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    subjectVersion: input.subjectVersion,
    data: { verificationId, requestId: input.requestId, result: input.result },
  });
  return verificationId;
}

function exemptWorkType(type: string): boolean {
  return [
    "OPERATOR_INTERACTION",
    "DIGITAL_QA",
    "ASSURANCE_REPAIR",
    "BUSINESS_RECOVERY",
    "BUSINESS_FOUNDATION",
    "CAPABILITY_DEVELOPMENT",
    "IMPROVEMENT_REVIEW",
  ].includes(type);
}
