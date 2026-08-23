import { randomUUID } from "node:crypto";

export class Cult4Error extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "Cult4Error";
  }
}

export const id = (prefix: string): string =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`;
export const now = (): string => new Date().toISOString();
export const json = (value: unknown): string => JSON.stringify(value ?? null);
export const parseJson = <T>(
  value: string | null | undefined,
  fallback: T,
): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export type ActorKind = "HUMAN" | "EMPLOYEE" | "SYSTEM";
export type WorkStatus =
  | "PROPOSED"
  | "READY"
  | "RUNNING"
  | "WAITING_GATE"
  | "WAITING_HUMAN"
  | "WAITING_EXTERNAL"
  | "BLOCKED"
  | "FAILED"
  | "DONE"
  | "CANCELLED";
export type GateStatus =
  "REQUIRED" | "PENDING" | "SATISFIED" | "REJECTED" | "INVALIDATED" | "EXPIRED";
export type HumanRequestStatus =
  | "PENDING"
  | "REMINDER_DUE"
  | "OVERDUE"
  | "RESOLVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";
export type ActionType =
  | "PUBLISH_PRODUCT"
  | "SPEND_MONEY"
  | "CREATE_EXTERNAL_ACCOUNT"
  | "SEND_PUBLIC_MESSAGE"
  | "SIGN_COMMITMENT"
  | "RELEASE_CODE"
  | "ORDER_PHYSICAL_SAMPLE"
  | "DESIGN_READY"
  | "FOUNDATION_CHANGE";
export type PolicyOutcome = "ALLOW" | "BLOCK" | "DENY";

export interface GateRequirement {
  repositoryId?: string;
  responsibility: string;
  authority: string;
  policyId: string;
  policyVersion: number;
  humanOnly?: boolean;
  independent?: boolean;
  subjectType?: string;
  subjectId?: string;
  subjectVersion?: string;
  marketStudyId?: string;
  expiresAt?: string;
}

export interface ActionIntent {
  actionType: ActionType;
  actorId: string;
  businessId?: string;
  subjectType: string;
  subjectId: string;
  subjectVersion: string;
  workItemId?: string;
  amount?: number;
  currency?: string;
  destination?: string;
  metadata?: Record<string, unknown>;
}

export interface PolicyDecision {
  outcome: PolicyOutcome;
  allowed: boolean;
  requiredGates: GateRequirement[];
  missingGates: Array<GateRequirement & { gateId?: string }>;
  denialReasons: string[];
  applicablePolicies: string[];
}

export interface EmployeeRunResult {
  ok: boolean;
  exitCode: number | null;
  sessionId?: string;
  finalText?: string;
  durationMs: number;
  timedOut: boolean;
  errorCode?: string;
  errorSummary?: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
}
