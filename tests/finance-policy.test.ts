import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openMemoryDatabase, type CultDatabase } from "../src/db.js";
import { seedFoundation } from "../src/seed.js";
import { now } from "../src/domain.js";
import { configureBusinessFinancialThresholds } from "../src/finance-policy.js";
import { createBudget, requestSpend } from "../src/finance.js";

describe("configurable financial floors", () => {
  let db: CultDatabase;
  beforeEach(() => {
    db = openMemoryDatabase();
    seedFoundation(db);
    db.prepare(
      "INSERT INTO business(id,slug,name,repo_path,status,created_at) VALUES('business','business','Business','/tmp/business','ACTIVE',?)",
    ).run(now());
  });
  afterEach(() => db.close());
  it("allows stricter business thresholds and refuses policy weakening", () => {
    expect(() =>
      configureBusinessFinancialThresholds(db, {
        businessId: "business",
        currency: "USD",
        autoMax: 3000,
        treasurerMax: 10000,
        createdBy: "human-owner",
      }),
    ).toThrow(/stricter/);
    configureBusinessFinancialThresholds(db, {
      businessId: "business",
      currency: "USD",
      autoMax: 1000,
      treasurerMax: 5000,
      createdBy: "human-owner",
    });
    const budget = createBudget(db, {
      businessId: "business",
      category: "ops",
      currency: "USD",
      limitAmount: 5000,
      periodStart: "2020-01-01T00:00:00.000Z",
      periodEnd: "2099-01-01T00:00:00.000Z",
      createdBy: "human-owner",
    });
    expect(
      requestSpend(db, {
        businessId: "business",
        requestedBy: "employee-operator",
        amount: 1500,
        currency: "USD",
        vendor: "Vendor",
        purpose: "Purpose",
        budgetId: budget,
      }).status,
    ).toBe("WAITING_APPROVAL");
  });
});
