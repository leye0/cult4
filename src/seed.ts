import type { CultDatabase } from "./db.js";
import { now } from "./domain.js";
import { audit } from "./audit.js";

const responsibilities = [
  ["operations", "Portfolio operation and work continuity"],
  ["strategy", "Business strategy and objectives"],
  ["research_integrity", "Evidence quality and research discipline"],
  ["creative_quality", "Creative quality"],
  ["release_quality", "Independent release quality"],
  ["testing_toolchain", "Testing tools and regression health"],
  ["software_engineering", "Maintainable software delivery and integration"],
  ["budget_integrity", "Budget integrity and financial sanity"],
  ["intellectual_property_compliance", "Commercial IP compliance"],
  ["physical_product_approval", "Human inspection of physical products"],
  ["supplier_qualification", "Supplier process qualification"],
  ["foundation_integrity", "Foundation change governance"],
  ["unit_economics", "Final unit economics"],
  [
    "CULTURAL_MARKET_INTELLIGENCE",
    "Current evidence about human markets and cultural context",
  ],
] as const;
const authorities = [
  ["OPERATE", "Operate work"],
  ["APPROVE_RELEASE_QUALITY", "Approve independent release quality"],
  ["APPROVE_LOW_RISK_SPEND", "Approve low risk spend"],
  ["APPROVE_TREASURER_SPEND", "Approve delegated spend"],
  ["APPROVE_HIGH_RISK_SPEND", "Approve high risk spend"],
  ["APPROVE_PUBLIC_AI_ART", "Human approval of public AI visuals"],
  ["APPROVE_IP_CLEARANCE", "Approve low risk IP clearance"],
  ["APPROVE_LEGAL_RISK", "Approve escalated legal risk"],
  ["APPROVE_PHYSICAL_SAMPLE", "Approve a real physical sample"],
  ["APPROVE_SUPPLIER", "Approve supplier qualification"],
  ["MODIFY_FOUNDATION", "Approve Foundation changes"],
  ["APPROVE_UNIT_ECONOMICS", "Approve unit economics"],
  ["APPROVE_BUSINESS_CASE", "Approve evidence-backed business case"],
  [
    "APPROVE_MARKET_RELEVANCE",
    "Approve use of a qualifying current MarketStudy for an exact subject",
  ],
] as const;
const employees = [
  [
    "operator",
    "Operator",
    "Own portfolio continuity, structure work dynamically, and route responsibilities.",
    "Operate businesses without bypassing deterministic gates.",
    ["operations"],
    ["OPERATE"],
  ],
  [
    "strategist",
    "Strategist",
    "Develop reconstructible strategies, objectives, alternatives, and experiments.",
    "Turn evidence into disciplined strategic options.",
    ["strategy"],
    ["APPROVE_BUSINESS_CASE"],
  ],
  [
    "researcher",
    "Researcher",
    "Collect contextual evidence with provenance, contradiction, and calibrated certainty.",
    "Research official, primary, community, and internal sources appropriately.",
    ["research_integrity"],
    [],
  ],
  [
    "cultural-market-intelligence",
    "Cultural & Market Intelligence Analyst",
    "Understand the current human market and cultural context. Never treat model memory as current market evidence. Preserve provenance, freshness, contradictions, uncertainty, saturation, backlash, commercial signals and market gaps. Distinguish cultural popularity from willingness to pay and opportunity. Consolidate delegated findings into structured Cult4 evidence. Do not approve strategy, IP, artistic quality, physical quality or spending unless separately authorized.",
    "Produce and maintain current evidence about human preferences, communities, language, culture and commercial opportunity.",
    ["CULTURAL_MARKET_INTELLIGENCE"],
    ["APPROVE_MARKET_RELEVANCE"],
  ],
  [
    "designer",
    "Designer",
    "Create traceable commercial artifacts and candidate concepts.",
    "Produce original, provenance-rich creative work for independent review.",
    ["creative_quality"],
    [],
  ],
  [
    "builder",
    "Builder",
    "Implement maintainable software from explicit request-linked WorkItems and specialist handoffs.",
    "Build, test, integrate, and document software without substituting personal product or market assumptions for specialist evidence.",
    ["software_engineering"],
    [],
  ],
  [
    "qa",
    "QA Analyst",
    "Independently validate exact subject versions and maintain testing methods.",
    "Protect release quality without silently fixing and self-approving.",
    ["release_quality", "testing_toolchain"],
    ["APPROVE_RELEASE_QUALITY"],
  ],
  [
    "treasurer",
    "Treasurer",
    "Analyze economics and protect delegated budget integrity.",
    "Separate financial sense from authorization and use the spend broker.",
    ["budget_integrity", "unit_economics"],
    ["APPROVE_TREASURER_SPEND", "APPROVE_UNIT_ECONOMICS"],
  ],
  [
    "ip-reviewer",
    "IP Reviewer",
    "Conservatively assess commercial IP provenance and uncertainty.",
    "Document searches and escalate uncertainty rather than auto-pass.",
    ["intellectual_property_compliance"],
    ["APPROVE_IP_CLEARANCE"],
  ],
] as const;
const capabilityMap: Record<string, string[]> = {
  operator: ["plan_work", "manage_organization"],
  builder: ["software_engineering", "integration_implementation"],
  strategist: ["strategy", "design_experiment"],
  researcher: ["research", "record_evidence"],
  "cultural-market-intelligence": [
    "market_research",
    "community_analysis",
    "marketplace_analysis",
    "saturation_analysis",
    "customer_language_analysis",
  ],
  designer: ["create_artifact"],
  qa: ["test_release", "inspect_visual_asset"],
  treasurer: ["unit_economics", "budget_analysis"],
  "ip-reviewer": ["copyright_risk_review", "license_review"],
};

export function seedFoundation(db: CultDatabase): void {
  const createdAt = now();
  db.transaction(() => {
    db.prepare(
      "INSERT OR IGNORE INTO actor(id,kind,name,status,created_at) VALUES('system','SYSTEM','Cult4 Foundation','ACTIVE',?)",
    ).run(createdAt);
    db.prepare(
      "INSERT OR IGNORE INTO actor(id,kind,name,status,created_at) VALUES('human-owner','HUMAN','Human Owner','ACTIVE',?)",
    ).run(createdAt);
    for (const [slug, description] of responsibilities)
      db.prepare(
        "INSERT OR IGNORE INTO responsibility(id,slug,description) VALUES(?,?,?)",
      ).run(`resp-${slug}`, slug, description);
    for (const [slug, description] of authorities)
      db.prepare(
        "INSERT OR IGNORE INTO authority(id,slug,description) VALUES(?,?,?)",
      ).run(`auth-${slug.toLowerCase()}`, slug, description);
    db.prepare(
      "INSERT OR IGNORE INTO financial_threshold(id,scope_type,scope_id,currency,auto_max,treasurer_max,version,active,created_by,created_at) VALUES('threshold-org-usd-1','ORGANIZATION','organization','USD',2500,10000,1,1,'human-owner',?)",
    ).run(createdAt);
    for (const authority of [
      "APPROVE_HIGH_RISK_SPEND",
      "APPROVE_PUBLIC_AI_ART",
      "APPROVE_LEGAL_RISK",
      "APPROVE_PHYSICAL_SAMPLE",
      "APPROVE_SUPPLIER",
      "MODIFY_FOUNDATION",
    ]) {
      db.prepare(
        "INSERT OR IGNORE INTO actor_authority(id,actor_id,authority_id,business_id,active) VALUES(?,?,?,NULL,1)",
      ).run(
        `aa-human-${authority.toLowerCase()}`,
        "human-owner",
        `auth-${authority.toLowerCase()}`,
      );
    }
    for (const responsibility of [
      "creative_quality",
      "budget_integrity",
      "intellectual_property_compliance",
      "physical_product_approval",
      "supplier_qualification",
      "foundation_integrity",
    ]) {
      db.prepare(
        "INSERT OR IGNORE INTO responsibility_owner(id,responsibility_id,actor_id,business_id,active) VALUES(?,?,?,NULL,1)",
      ).run(
        `ro-human-${responsibility}`,
        `resp-${responsibility}`,
        "human-owner",
      );
    }
    for (const [
      slug,
      name,
      charter,
      description,
      owned,
      granted,
    ] of employees) {
      const employeeId = `employee-${slug}`;
      db.prepare(
        "INSERT OR IGNORE INTO actor(id,kind,name,status,created_at) VALUES(?, 'EMPLOYEE',?,'ACTIVE',?)",
      ).run(employeeId, name, createdAt);
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO employee(id,slug,charter,description,opencode_agent_name,status,creation_reason,specialties,created_at,updated_at)
        VALUES(?,?,?,?,?,'ACTIVE','Foundation seed','[]',?,?)`,
        )
        .run(
          employeeId,
          slug,
          charter,
          description,
          `cult4-${slug}`,
          createdAt,
          createdAt,
        );
      for (const responsibility of owned)
        db.prepare(
          "INSERT OR IGNORE INTO responsibility_owner(id,responsibility_id,actor_id,business_id,active) VALUES(?,?,?,NULL,1)",
        ).run(
          `ro-${slug}-${responsibility}`,
          `resp-${responsibility}`,
          employeeId,
        );
      for (const authority of granted)
        db.prepare(
          "INSERT OR IGNORE INTO actor_authority(id,actor_id,authority_id,business_id,active) VALUES(?,?,?,NULL,1)",
        ).run(
          `aa-${slug}-${authority.toLowerCase()}`,
          employeeId,
          `auth-${authority.toLowerCase()}`,
        );
      for (const capability of capabilityMap[slug] ?? []) {
        db.prepare(
          "INSERT OR IGNORE INTO capability(id,slug,description) VALUES(?,?,?)",
        ).run(`cap-${capability}`, capability, capability.replaceAll("_", " "));
        db.prepare(
          "INSERT OR IGNORE INTO employee_capability(employee_id,capability_id,level) VALUES(?,?, 'PROFICIENT')",
        ).run(employeeId, `cap-${capability}`);
      }
      db.prepare(
        "INSERT OR IGNORE INTO capability(id,slug,description) VALUES('cap-practice_development','practice_development','improve professional practice from measured experience')",
      ).run();
      db.prepare(
        "INSERT OR IGNORE INTO employee_capability(employee_id,capability_id,level) VALUES(?,'cap-practice_development','PROFICIENT')",
      ).run(employeeId);
      if (result.changes)
        audit(db, {
          type: "EMPLOYEE_CREATED",
          actorId: "system",
          subjectType: "EMPLOYEE",
          subjectId: employeeId,
          data: { seed: true },
        });
    }
    for (const [slug, kind, owner, maintainer] of [
      ["research-method", "SKILL", "research_integrity", "researcher"],
      [
        "commercial-ip-review",
        "SKILL",
        "intellectual_property_compliance",
        "ip-reviewer",
      ],
      [
        "physical-product-inspection",
        "SKILL",
        "physical_product_approval",
        null,
      ],
      ["unit-economics", "SKILL", "unit_economics", "treasurer"],
      ["experiment-design", "SKILL", "strategy", "strategist"],
      ["work-orchestration", "PLAYBOOK", "operations", "operator"],
      ["software-engineering", "SKILL", "software_engineering", "builder"],
      ["software-quality", "PLAYBOOK", "testing_toolchain", "qa"],
      ["commercial-artifact-design", "SKILL", "creative_quality", "designer"],
      [
        "market-study",
        "SKILL",
        "CULTURAL_MARKET_INTELLIGENCE",
        "cultural-market-intelligence",
      ],
      [
        "community-research",
        "SKILL",
        "CULTURAL_MARKET_INTELLIGENCE",
        "cultural-market-intelligence",
      ],
      [
        "marketplace-research",
        "SKILL",
        "CULTURAL_MARKET_INTELLIGENCE",
        "cultural-market-intelligence",
      ],
    ] as const) {
      db.prepare(
        "INSERT OR IGNORE INTO organizational_asset(id,kind,slug,owner_responsibility_id,maintainer_employee_id,status,version,description,created_at) VALUES(?,?,?,?,?,'ACTIVE','1.0.0',?,?)",
      ).run(
        `asset-${slug}`,
        kind,
        slug,
        `resp-${owner}`,
        maintainer ? `employee-${maintainer}` : null,
        `${slug.replaceAll("-", " ")} organization skill`,
        createdAt,
      );
      if (maintainer)
        db.prepare(
          "INSERT OR IGNORE INTO employee_asset(employee_id,asset_id,relationship) VALUES(?,?,'MAINTAINER')",
        ).run(`employee-${maintainer}`, `asset-${slug}`);
    }
    db.prepare(
      `INSERT OR IGNORE INTO work_capability_requirement(work_item_id,capability_id)
       SELECT id,'cap-software_engineering' FROM work_item
       WHERE type IN ('BUILD','ENGINEERING','VERSIONED_BUILD','LIVE_INTEGRATION','LIVE_TICK')
         AND status IN ('PROPOSED','READY','WAITING_GATE','WAITING_HUMAN','WAITING_EXTERNAL')`,
    ).run();
    db.prepare(
      `UPDATE work_item SET assigned_to='employee-builder',updated_at=?
       WHERE type IN ('BUILD','ENGINEERING','VERSIONED_BUILD','LIVE_INTEGRATION','LIVE_TICK')
         AND assigned_to='employee-operator'
         AND status IN ('PROPOSED','READY','WAITING_GATE','WAITING_HUMAN','WAITING_EXTERNAL')`,
    ).run(createdAt);
  })();
}
