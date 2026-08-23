import { createHash } from "node:crypto";
import type { CultDatabase } from "./db.js";
import { audit } from "./audit.js";
import { Cult4Error, id, json, now } from "./domain.js";
import { createHumanRequest } from "./human.js";
import { createWorkItem } from "./work.js";
import { requireGate } from "./approval.js";

export function createProduct(
  db: CultDatabase,
  input: {
    businessId: string;
    name: string;
    fulfillmentKind: "PHYSICAL" | "DIGITAL" | "SERVICE";
    productFamily?: string;
    commercial?: boolean;
    creative?: boolean;
    cultureSensitive?: boolean;
    trendSensitive?: boolean;
    identitySensitive?: boolean;
    outsourcedManufacturing?: boolean;
    targetSegment?: string;
    market?: string;
    language?: string;
    geography?: string;
  },
): string {
  const productId = id("product");
  db.prepare(
    "INSERT INTO product(id,business_id,name,fulfillment_kind,product_family,commercial,creative,culture_sensitive,trend_sensitive,identity_sensitive,outsourced_manufacturing,target_segment,market,language,geography,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    productId,
    input.businessId,
    input.name,
    input.fulfillmentKind,
    input.productFamily ?? null,
    input.commercial === false ? 0 : 1,
    input.creative ? 1 : 0,
    input.cultureSensitive ? 1 : 0,
    input.trendSensitive ? 1 : 0,
    input.identitySensitive ? 1 : 0,
    input.outsourcedManufacturing ? 1 : 0,
    input.targetSegment ?? null,
    input.market ?? null,
    input.language ?? null,
    input.geography ?? null,
    now(),
  );
  return productId;
}
export function createSupplier(
  db: CultDatabase,
  input: { name: string; type: string; externalRef?: string },
): string {
  const supplierId = id("supplier");
  db.prepare(
    "INSERT INTO supplier(id,name,type,external_ref,created_at) VALUES(?,?,?,?,?)",
  ).run(supplierId, input.name, input.type, input.externalRef ?? null, now());
  return supplierId;
}
export function createProductVersion(
  db: CultDatabase,
  input: {
    productId: string;
    version: string;
    contentHash: string;
    artifactVersionId?: string;
    supplierId?: string;
    material?: string;
    process?: string;
    packaging?: string;
    shippingMethod?: string;
  },
): string {
  const versionId = id("product-version");
  db.prepare(
    `INSERT INTO product_version(id,product_id,version,content_hash,artifact_version_id,supplier_id,material,process,packaging,shipping_method,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,'DRAFT',?)`,
  ).run(
    versionId,
    input.productId,
    input.version,
    input.contentHash,
    input.artifactVersionId ?? null,
    input.supplierId ?? null,
    input.material ?? null,
    input.process ?? null,
    input.packaging ?? null,
    input.shippingMethod ?? null,
    now(),
  );
  return versionId;
}
export function createSampleOrder(
  db: CultDatabase,
  input: {
    productVersionId: string;
    supplierId: string;
    spendRequestId?: string;
    commitmentId?: string;
  },
): string {
  const product = db
    .prepare(
      "SELECT p.fulfillment_kind FROM product_version pv JOIN product p ON p.id=pv.product_id WHERE pv.id=?",
    )
    .get(input.productVersionId) as { fulfillment_kind: string } | undefined;
  if (!product || product.fulfillment_kind !== "PHYSICAL")
    throw new Cult4Error(
      "A real sample order requires a physical product version.",
      "SAMPLE_NOT_PHYSICAL",
    );
  if (input.spendRequestId) {
    const spend = db
      .prepare("SELECT status FROM spend_request WHERE id=?")
      .get(input.spendRequestId) as { status: string } | undefined;
    if (spend?.status !== "AUTHORIZED")
      throw new Cult4Error(
        "Sample spend is not authorized.",
        "SPEND_NOT_AUTHORIZED",
      );
  }
  const orderId = id("sample-order");
  db.prepare(
    "INSERT INTO sample_order(id,product_version_id,supplier_id,spend_request_id,commitment_id,status) VALUES(?,?,?,?,?,'AUTHORIZED')",
  ).run(
    orderId,
    input.productVersionId,
    input.supplierId,
    input.spendRequestId ?? null,
    input.commitmentId ?? null,
  );
  return orderId;
}
export function markSampleOrdered(
  db: CultDatabase,
  orderId: string,
  externalOrderRef: string,
): void {
  if (!externalOrderRef)
    throw new Cult4Error(
      "External order reference required.",
      "EXTERNAL_REFERENCE_REQUIRED",
    );
  const result = db
    .prepare(
      "UPDATE sample_order SET status='ORDERED',external_order_ref=?,ordered_at=? WHERE id=? AND status='AUTHORIZED'",
    )
    .run(externalOrderRef, now(), orderId);
  if (!result.changes)
    throw new Cult4Error(
      "Sample order cannot be ordered.",
      "INVALID_SAMPLE_TRANSITION",
    );
}
export function markSampleShipped(db: CultDatabase, orderId: string): void {
  const result = db
    .prepare(
      "UPDATE sample_order SET status='SHIPPED',shipped_at=? WHERE id=? AND status='ORDERED'",
    )
    .run(now(), orderId);
  if (!result.changes)
    throw new Cult4Error(
      "Sample cannot be marked shipped.",
      "INVALID_SAMPLE_TRANSITION",
    );
}
export function markSampleReceived(db: CultDatabase, orderId: string): string {
  const order = db
    .prepare(
      `SELECT so.*,pv.content_hash,p.business_id FROM sample_order so JOIN product_version pv ON pv.id=so.product_version_id JOIN product p ON p.id=pv.product_id WHERE so.id=? AND so.status IN ('ORDERED','SHIPPED')`,
    )
    .get(orderId) as Record<string, unknown> | undefined;
  if (!order)
    throw new Cult4Error(
      "Sample cannot be received.",
      "INVALID_SAMPLE_TRANSITION",
    );
  return db.transaction(() => {
    db.prepare(
      "UPDATE sample_order SET status='RECEIVED',received_at=? WHERE id=?",
    ).run(now(), orderId);
    const gateId = requireGate(db, {
      responsibility: "physical_product_approval",
      authority: "APPROVE_PHYSICAL_SAMPLE",
      policyId: "PHYSICAL_PRODUCT_COMMERCIAL_RELEASE",
      policyVersion: 1,
      humanOnly: true,
      independent: true,
      subjectType: "PRODUCT_VERSION",
      subjectId: String(order.product_version_id),
      subjectVersion: String(order.content_hash),
    });
    return createHumanRequest(db, {
      businessId: String(order.business_id),
      gateId,
      type: "PHYSICAL_INSPECTION",
      requestedResponsibility: "physical_product_approval",
      subjectType: "PRODUCT_VERSION",
      subjectId: String(order.product_version_id),
      subjectVersion: String(order.content_hash),
      title: "Inspect real physical product sample",
      context:
        "Inspect visual quality, print sharpness, color fidelity, cut/alignment, material, size/function, packaging, shipping damage, delivery experience, listing-vs-reality, and overall perceived quality.",
      options: ["Approve", "Reject", "Add notes"],
    });
  })();
}
const requiredInspection = [
  "visual_quality",
  "print_sharpness",
  "color_fidelity",
  "cut_alignment",
  "material",
  "size_function",
  "packaging",
  "shipping_damage",
  "delivery_experience",
  "listing_vs_reality",
  "overall_quality",
];
export function recordPhysicalInspection(
  db: CultDatabase,
  input: {
    sampleOrderId: string;
    result: "PASS" | "FAIL";
    inspectedBy: string;
    checklist: Record<string, string | boolean>;
    notes?: string;
    photos?: string[];
  },
): string {
  const order = db
    .prepare(
      `SELECT so.*,pv.content_hash,p.business_id FROM sample_order so JOIN product_version pv ON pv.id=so.product_version_id JOIN product p ON p.id=pv.product_id WHERE so.id=? AND so.status='RECEIVED'`,
    )
    .get(input.sampleOrderId) as Record<string, unknown> | undefined;
  if (!order)
    throw new Cult4Error(
      "Received real sample not found.",
      "SAMPLE_NOT_RECEIVED",
    );
  const missing = requiredInspection.filter(
    (key) => input.checklist[key] === undefined,
  );
  if (missing.length)
    throw new Cult4Error(
      `Inspection checklist incomplete: ${missing.join(", ")}`,
      "INSPECTION_INCOMPLETE",
    );
  const actor = db
    .prepare("SELECT kind FROM actor WHERE id=? AND status='ACTIVE'")
    .get(input.inspectedBy) as { kind: string } | undefined;
  if (actor?.kind !== "HUMAN")
    throw new Cult4Error(
      "Physical inspection requires a human.",
      "HUMAN_REQUIRED",
    );
  const sampleId = id("physical-sample");
  db.transaction(() => {
    db.prepare(
      "INSERT INTO physical_sample(id,sample_order_id,product_version_id,is_real,inspection_result,inspected_by,checklist_json,notes,photos_json,inspected_at) VALUES(?,?,?,1,?,?,?,?,?,?)",
    ).run(
      sampleId,
      input.sampleOrderId,
      order.product_version_id,
      input.result,
      input.inspectedBy,
      json(input.checklist),
      input.notes ?? null,
      json(input.photos ?? []),
      now(),
    );
    db.prepare("UPDATE sample_order SET status='INSPECTED' WHERE id=?").run(
      input.sampleOrderId,
    );
    if (input.result === "FAIL")
      createWorkItem(db, {
        businessId: String(order.business_id),
        type: "CORRECT_PHYSICAL_PRODUCT",
        title: "Correct failed physical sample",
        goal: input.notes ?? "Correct the failed sample or replace supplier.",
        createdBy: "system",
        status: "READY",
        risk: "HIGH",
        subjectType: "PRODUCT_VERSION",
        subjectId: String(order.product_version_id),
        subjectVersion: String(order.content_hash),
      });
    audit(db, {
      type: "PHYSICAL_SAMPLE_INSPECTED",
      actorId: input.inspectedBy,
      businessId: String(order.business_id),
      subjectType: "PRODUCT_VERSION",
      subjectId: String(order.product_version_id),
      subjectVersion: String(order.content_hash),
      data: { sampleId, result: input.result },
    });
  })();
  return sampleId;
}
export function supplierContextHash(input: {
  supplierId: string;
  productFamily: string;
  material?: string;
  process?: string;
  packaging?: string;
  shippingMethod?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.supplierId,
        input.productFamily,
        input.material ?? "",
        input.process ?? "",
        input.packaging ?? "",
        input.shippingMethod ?? "",
      ]),
    )
    .digest("hex");
}
export function qualifySupplier(
  db: CultDatabase,
  input: {
    supplierId: string;
    productFamily: string;
    material?: string;
    process?: string;
    packaging?: string;
    shippingMethod?: string;
    result: "PASS" | "CONDITIONAL" | "FAIL";
    qualifiedBy: string;
    evidenceRef: string;
    sampleOrderId?: string;
    expiresAt?: string;
  },
): string {
  const actor = db
    .prepare("SELECT kind FROM actor WHERE id=? AND status='ACTIVE'")
    .get(input.qualifiedBy) as { kind: string } | undefined;
  if (actor?.kind !== "HUMAN")
    throw new Cult4Error(
      "Supplier qualification requires a human.",
      "HUMAN_REQUIRED",
    );
  if (input.result !== "FAIL" && !input.sampleOrderId)
    throw new Cult4Error(
      "Qualification requires a real sample.",
      "SUPPLIER_SAMPLE_REQUIRED",
    );
  if (input.sampleOrderId) {
    const sample = db
      .prepare(
        "SELECT ps.inspection_result,ps.is_real,so.supplier_id FROM physical_sample ps JOIN sample_order so ON so.id=ps.sample_order_id WHERE so.id=?",
      )
      .get(input.sampleOrderId) as Record<string, unknown> | undefined;
    if (
      !sample ||
      !Number(sample.is_real) ||
      sample.inspection_result !== "PASS" ||
      sample.supplier_id !== input.supplierId
    )
      throw new Cult4Error(
        "Qualification sample is missing, failed, or belongs to another supplier.",
        "SUPPLIER_SAMPLE_INVALID",
      );
  }
  const qualificationId = id("supplier-qualification");
  const contextHash = supplierContextHash(input);
  db.prepare(
    `INSERT INTO supplier_qualification(id,supplier_id,product_family,material,process,packaging,shipping_method,context_hash,result,qualified_by,evidence_ref,qualified_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    qualificationId,
    input.supplierId,
    input.productFamily,
    input.material ?? "",
    input.process ?? "",
    input.packaging ?? "",
    input.shippingMethod ?? "",
    contextHash,
    input.result,
    input.qualifiedBy,
    input.evidenceRef,
    now(),
    input.expiresAt ?? null,
  );
  return qualificationId;
}
export function invalidateQualification(
  db: CultDatabase,
  qualificationId: string,
  reason: string,
): void {
  const result = db
    .prepare(
      "UPDATE supplier_qualification SET result='EXPIRED',invalidated_at=?,invalidation_reason=? WHERE id=? AND result IN ('PASS','CONDITIONAL')",
    )
    .run(now(), reason, qualificationId);
  if (!result.changes)
    throw new Cult4Error(
      "Active supplier qualification not found.",
      "QUALIFICATION_NOT_FOUND",
    );
  audit(db, {
    type: "SUPPLIER_CHANGE_DETECTED",
    actorId: "system",
    subjectType: "SUPPLIER_QUALIFICATION",
    subjectId: qualificationId,
    data: { reason },
  });
}
export function hasApplicableQualification(
  db: CultDatabase,
  productVersionId: string,
  at = now(),
): boolean {
  const version = db
    .prepare(
      `SELECT pv.*,p.product_family FROM product_version pv JOIN product p ON p.id=pv.product_id WHERE pv.id=?`,
    )
    .get(productVersionId) as Record<string, unknown> | undefined;
  if (!version || !version.supplier_id || !version.product_family) return false;
  const hash = supplierContextHash({
    supplierId: String(version.supplier_id),
    productFamily: String(version.product_family),
    material: String(version.material ?? ""),
    process: String(version.process ?? ""),
    packaging: String(version.packaging ?? ""),
    shippingMethod: String(version.shipping_method ?? ""),
  });
  return Boolean(
    db
      .prepare(
        "SELECT 1 FROM supplier_qualification WHERE supplier_id=? AND context_hash=? AND result IN ('PASS','CONDITIONAL') AND invalidated_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
      )
      .get(version.supplier_id, hash, at),
  );
}
