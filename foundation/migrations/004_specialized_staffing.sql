CREATE TABLE work_capability_requirement (
  work_item_id TEXT NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  capability_id TEXT NOT NULL REFERENCES capability(id),
  PRIMARY KEY(work_item_id, capability_id)
);

CREATE INDEX work_capability_requirement_capability_idx
  ON work_capability_requirement(capability_id, work_item_id);

CREATE TABLE improvement_review (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES improvement_proposal(id),
  review_work_item_id TEXT NOT NULL UNIQUE REFERENCES work_item(id),
  reviewed_by TEXT NOT NULL REFERENCES actor(id),
  decision TEXT NOT NULL CHECK(decision IN ('APPROVE','REJECT')),
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
