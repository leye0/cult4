CREATE TABLE intake_message (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business(id),
  work_item_id TEXT NOT NULL REFERENCES work_item(id),
  session_id TEXT NOT NULL,
  external_message_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id,external_message_id),
  UNIQUE(session_id,ordinal)
);

CREATE TABLE official_request (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business(id),
  statement TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('OUTCOME','CAPABILITY','INTEGRATION','CONSTRAINT','PREFERENCE','IDEA','QUALITY','OPERATION')),
  priority TEXT NOT NULL CHECK(priority IN ('MUST','SHOULD','MAY')),
  acceptance_criteria TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','SATISFIED','SUPERSEDED','WITHDRAWN')),
  created_by TEXT NOT NULL REFERENCES actor(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE official_request_source (
  request_id TEXT NOT NULL REFERENCES official_request(id),
  intake_message_id TEXT NOT NULL REFERENCES intake_message(id),
  PRIMARY KEY(request_id,intake_message_id)
);

CREATE TABLE intake_message_disposition (
  intake_message_id TEXT PRIMARY KEY REFERENCES intake_message(id),
  disposition TEXT NOT NULL CHECK(disposition IN ('NON_SUBSTANTIVE','CONTEXT_ONLY','SUPERSEDED_BY_USER')),
  rationale TEXT NOT NULL,
  decided_by TEXT NOT NULL REFERENCES actor(id),
  decided_at TEXT NOT NULL
);

CREATE TABLE mandate_request (
  mandate_id TEXT NOT NULL REFERENCES business_mandate(id),
  request_id TEXT NOT NULL REFERENCES official_request(id),
  disposition TEXT NOT NULL CHECK(disposition IN ('COMMITTED','IDEA_TO_EXPLORE','DEFERRED','REJECTED','SUPERSEDED_BY_USER')),
  contract_reference TEXT NOT NULL,
  rationale TEXT NOT NULL,
  deviation_request_id TEXT REFERENCES human_request(id),
  PRIMARY KEY(mandate_id,request_id)
);

CREATE TABLE work_request (
  work_item_id TEXT NOT NULL REFERENCES work_item(id),
  request_id TEXT NOT NULL REFERENCES official_request(id),
  contribution TEXT NOT NULL DEFAULT 'IMPLEMENTS' CHECK(contribution IN ('IMPLEMENTS','RESEARCHES','VALIDATES','DOCUMENTS')),
  PRIMARY KEY(work_item_id,request_id)
);

CREATE TABLE request_verification (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES official_request(id),
  work_item_id TEXT NOT NULL REFERENCES work_item(id),
  qa_work_item_id TEXT NOT NULL REFERENCES work_item(id),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_version TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('PASS','FAIL','PARTIAL')),
  evidence_json TEXT NOT NULL,
  verified_by TEXT NOT NULL REFERENCES actor(id),
  created_at TEXT NOT NULL
);

CREATE INDEX intake_message_business_idx ON intake_message(business_id,ordinal);
CREATE INDEX official_request_business_idx ON official_request(business_id,status,priority);
CREATE INDEX work_request_request_idx ON work_request(request_id,work_item_id);
CREATE INDEX request_verification_request_idx ON request_verification(request_id,created_at DESC);
