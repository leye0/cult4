CREATE TABLE business_control(
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business(id),
  slug TEXT NOT NULL,
  description TEXT NOT NULL,
  validation_command TEXT NOT NULL,
  required_actions_json TEXT NOT NULL,
  code_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('EXPERIMENTAL','TESTED','QA_VERIFIED','STALE')),
  declared_by TEXT NOT NULL REFERENCES actor(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(business_id,slug)
);

CREATE TABLE control_validation(
  id TEXT PRIMARY KEY,
  control_id TEXT NOT NULL REFERENCES business_control(id),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_version TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  code_version TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('PASS','FAIL')),
  level TEXT NOT NULL CHECK(level IN ('TESTED','QA_VERIFIED')),
  validated_by TEXT NOT NULL REFERENCES actor(id),
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE TABLE decision_claim(
  decision_id TEXT NOT NULL REFERENCES decision(id),
  claim_id TEXT NOT NULL REFERENCES claim(id),
  material INTEGER NOT NULL DEFAULT 1 CHECK(material IN (0,1)),
  PRIMARY KEY(decision_id,claim_id)
);

CREATE TABLE action_assurance(
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business(id),
  work_item_id TEXT REFERENCES work_item(id),
  decision_id TEXT NOT NULL REFERENCES decision(id),
  action_type TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_version TEXT NOT NULL,
  assessed_by TEXT NOT NULL REFERENCES actor(id),
  assessed_at TEXT NOT NULL,
  UNIQUE(business_id,decision_id,action_type,subject_type,subject_id,subject_version)
);

CREATE INDEX control_validation_subject_idx
  ON control_validation(subject_type,subject_id,subject_version,result,level);
CREATE INDEX business_control_action_idx ON business_control(business_id,status);
CREATE INDEX action_assurance_subject_idx
  ON action_assurance(business_id,subject_type,subject_id,subject_version);

INSERT INTO business_policy(
  id,business_id,rule_type,parameters,created_by,effective_from,status
)
SELECT 'policy-assurance-' || id,id,'REQUIRE_ASSURANCE','{}','system',
       strftime('%Y-%m-%dT%H:%M:%fZ','now'),'ACTIVE'
FROM business;
