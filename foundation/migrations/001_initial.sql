CREATE TABLE actor(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('HUMAN','EMPLOYEE','SYSTEM')), name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE','SUSPENDED')), created_at TEXT NOT NULL);

CREATE TABLE actor_authority(id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES actor(id), authority_id TEXT NOT NULL REFERENCES authority(id), business_id TEXT REFERENCES business(id), max_amount INTEGER, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), UNIQUE(actor_id,authority_id,business_id));

CREATE TABLE approval(id TEXT PRIMARY KEY, gate_id TEXT NOT NULL REFERENCES gate(id), actor_id TEXT NOT NULL REFERENCES actor(id), authority_id TEXT NOT NULL REFERENCES authority(id), subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, subject_version TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('APPROVE','REJECT')), notes TEXT, created_at TEXT NOT NULL, expires_at TEXT, policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL, repository_id TEXT REFERENCES repository(id));

CREATE TABLE artifact(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), type TEXT NOT NULL, purpose TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES actor(id), public_facing INTEGER NOT NULL DEFAULT 0, commercial INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, creative INTEGER NOT NULL DEFAULT 0 CHECK(creative IN (0,1)), culture_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(culture_sensitive IN (0,1)), trend_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(trend_sensitive IN (0,1)), identity_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(identity_sensitive IN (0,1)));

CREATE TABLE artifact_source(id TEXT PRIMARY KEY, artifact_version_id TEXT NOT NULL REFERENCES artifact_version(id), source_type TEXT NOT NULL, source_ref TEXT NOT NULL, license_status TEXT NOT NULL, notes TEXT);

CREATE TABLE artifact_version(id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL REFERENCES artifact(id), content_hash TEXT NOT NULL, locator TEXT NOT NULL, ai_generated INTEGER NOT NULL DEFAULT 0, model_or_tool TEXT, creation_metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(artifact_id,content_hash));

CREATE TABLE audit_event(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, actor_id TEXT REFERENCES actor(id), business_id TEXT REFERENCES business(id), subject_type TEXT, subject_id TEXT, subject_version TEXT, data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);

CREATE TABLE authority(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL);

CREATE TABLE budget(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), category TEXT NOT NULL, currency TEXT NOT NULL, limit_amount INTEGER NOT NULL CHECK(limit_amount>=0), period_start TEXT NOT NULL, period_end TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAUSED','CLOSED')), created_by TEXT NOT NULL REFERENCES actor(id));

CREATE TABLE business(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, repo_path TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK(status IN ('ACTIVE','PAUSED','ARCHIVED')), created_at TEXT NOT NULL, confirmed_mandate_id TEXT REFERENCES business_mandate(id));

CREATE TABLE business_channel(business_id TEXT NOT NULL REFERENCES business(id),channel_id TEXT NOT NULL REFERENCES channel(id),PRIMARY KEY(business_id,channel_id));

CREATE TABLE business_mandate(
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business(id),
  version INTEGER NOT NULL CHECK(version>0),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','CONFIRMED','REJECTED','SUPERSEDED')),
  purpose TEXT NOT NULL,
  customer TEXT NOT NULL,
  offer TEXT NOT NULL,
  narrative TEXT NOT NULL,
  spirit TEXT NOT NULL,
  autonomy_mode TEXT NOT NULL CHECK(autonomy_mode IN ('ASSISTED','SUPERVISED','BOUNDED_AUTONOMOUS')),
  contract_json TEXT NOT NULL,
  anti_goals_json TEXT NOT NULL,
  human_inputs_json TEXT NOT NULL,
  unresolved_questions_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  proposed_by TEXT NOT NULL REFERENCES actor(id),
  created_at TEXT NOT NULL,
  confirmed_by TEXT REFERENCES actor(id),
  confirmed_at TEXT,
  UNIQUE(business_id,version),
  UNIQUE(business_id,content_hash)
);

CREATE TABLE business_policy(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), rule_type TEXT NOT NULL, parameters TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES actor(id), effective_from TEXT NOT NULL, effective_until TEXT, status TEXT NOT NULL CHECK(status IN ('ACTIVE','INACTIVE','EXPIRED')));

CREATE TABLE business_segment(business_id TEXT NOT NULL REFERENCES business(id),segment_id TEXT NOT NULL REFERENCES customer_segment(id),PRIMARY KEY(business_id,segment_id));

CREATE TABLE capability(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL);

CREATE TABLE channel(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE claim(id TEXT PRIMARY KEY, business_id TEXT REFERENCES business(id), statement TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('HYPOTHESIS','SUPPORTED','CONTRADICTED','UNRESOLVED')), created_by TEXT NOT NULL REFERENCES actor(id), created_at TEXT NOT NULL);

CREATE TABLE commitment(id TEXT PRIMARY KEY, budget_id TEXT NOT NULL REFERENCES budget(id), spend_request_id TEXT UNIQUE REFERENCES spend_request(id), amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL, counterparty TEXT, purpose TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('ACTIVE','SETTLED','RELEASED','CANCELLED')), authorized_by TEXT REFERENCES actor(id), external_ref TEXT, created_at TEXT NOT NULL);

CREATE TABLE creative_brief(
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business(id),
  initiative_id TEXT,
  market_study_id TEXT NOT NULL REFERENCES market_study(id),
  strategist_employee_id TEXT NOT NULL REFERENCES employee(id),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','READY','SUPERSEDED','INVALIDATED')),
  target_audience TEXT NOT NULL,
  desired_response TEXT,
  cultural_context TEXT NOT NULL,
  relevant_tropes TEXT,
  customer_language TEXT,
  aesthetic_territory TEXT,
  saturated_ideas_to_avoid TEXT,
  ip_danger_areas TEXT,
  commercial_constraints TEXT,
  relevant_claim_ids TEXT NOT NULL DEFAULT '[]',
  relevant_signal_ids TEXT NOT NULL DEFAULT '[]',
  valid_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE customer_segment(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), name TEXT NOT NULL, definition TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE decision(id TEXT PRIMARY KEY, business_id TEXT REFERENCES business(id), work_item_id TEXT REFERENCES work_item(id), statement TEXT NOT NULL, rationale TEXT NOT NULL, alternatives TEXT NOT NULL, unknowns TEXT NOT NULL, risk TEXT NOT NULL, budget_id TEXT, subject_type TEXT, subject_id TEXT, subject_version TEXT, policy_snapshot_id TEXT REFERENCES policy_snapshot(id), created_by TEXT NOT NULL REFERENCES actor(id), approved_by TEXT REFERENCES actor(id), effective_at TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE decision_evidence(decision_id TEXT NOT NULL REFERENCES decision(id), evidence_id TEXT NOT NULL REFERENCES evidence(id), PRIMARY KEY(decision_id,evidence_id));

CREATE TABLE employee(id TEXT PRIMARY KEY REFERENCES actor(id), slug TEXT NOT NULL UNIQUE, charter TEXT NOT NULL, description TEXT NOT NULL, opencode_agent_name TEXT NOT NULL UNIQUE, model TEXT, status TEXT NOT NULL CHECK(status IN ('PROPOSED','EVALUATING','ACTIVE','INACTIVE','RETIRED')), creation_reason TEXT NOT NULL, specialties TEXT NOT NULL DEFAULT '[]', metrics_json TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE employee_asset(employee_id TEXT NOT NULL REFERENCES employee(id),asset_id TEXT NOT NULL REFERENCES organizational_asset(id),relationship TEXT NOT NULL CHECK(relationship IN ('OWNER','MAINTAINER','USER')),PRIMARY KEY(employee_id,asset_id,relationship));

CREATE TABLE employee_capability(employee_id TEXT NOT NULL REFERENCES employee(id), capability_id TEXT NOT NULL REFERENCES capability(id), level TEXT, PRIMARY KEY(employee_id,capability_id));

CREATE TABLE employee_experience(id TEXT PRIMARY KEY,employee_id TEXT NOT NULL REFERENCES employee(id),business_id TEXT REFERENCES business(id),work_item_id TEXT REFERENCES work_item(id),summary TEXT NOT NULL,outcome TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE TABLE employee_run(id TEXT PRIMARY KEY, employee_id TEXT NOT NULL REFERENCES employee(id), work_item_id TEXT NOT NULL REFERENCES work_item(id), session_id TEXT, status TEXT NOT NULL, duration_ms INTEGER, cost_cents INTEGER, input_tokens INTEGER, output_tokens INTEGER, error_code TEXT, created_at TEXT NOT NULL, finished_at TEXT);

CREATE TABLE evidence(id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES claim(id), source_id TEXT REFERENCES source(id), summary TEXT NOT NULL, reliability REAL CHECK(reliability IS NULL OR reliability BETWEEN 0 AND 1), applicability REAL CHECK(applicability IS NULL OR applicability BETWEEN 0 AND 1), confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1), contradiction INTEGER NOT NULL DEFAULT 0 CHECK(contradiction IN (0,1)), observed_at TEXT, created_by TEXT NOT NULL REFERENCES actor(id), created_at TEXT NOT NULL, observation_type TEXT NOT NULL DEFAULT 'OBSERVED' CHECK(observation_type IN ('OBSERVED','ESTIMATED','INFERRED','UNKNOWN')), metadata_json TEXT NOT NULL DEFAULT '{}');

CREATE TABLE experiment(id TEXT PRIMARY KEY, hypothesis_id TEXT NOT NULL REFERENCES hypothesis(id), design TEXT NOT NULL, metric_id TEXT REFERENCES metric(id), success_condition TEXT, stop_condition TEXT, max_downside INTEGER, budget_id TEXT, sample_or_duration TEXT, status TEXT NOT NULL CHECK(status IN ('DRAFT','READY','RUNNING','STOPPED','COMPLETED','CANCELLED')), started_at TEXT, ended_at TEXT, result TEXT, validation_alternative TEXT, created_at TEXT NOT NULL);

CREATE TABLE financial_threshold(id TEXT PRIMARY KEY,scope_type TEXT NOT NULL CHECK(scope_type IN ('ORGANIZATION','BUSINESS')),scope_id TEXT NOT NULL,currency TEXT NOT NULL,auto_max INTEGER NOT NULL CHECK(auto_max>=0),treasurer_max INTEGER NOT NULL CHECK(treasurer_max>=auto_max),version INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),created_by TEXT NOT NULL REFERENCES actor(id),created_at TEXT NOT NULL,UNIQUE(scope_type,scope_id,currency,version));

CREATE TABLE gate(id TEXT PRIMARY KEY, work_item_id TEXT REFERENCES work_item(id), responsibility_id TEXT NOT NULL REFERENCES responsibility(id), authority_id TEXT NOT NULL REFERENCES authority(id), subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, subject_version TEXT NOT NULL, policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('REQUIRED','PENDING','SATISFIED','REJECTED','INVALIDATED','EXPIRED')), human_only INTEGER NOT NULL DEFAULT 0, independent INTEGER NOT NULL DEFAULT 0, producer_actor_id TEXT REFERENCES actor(id), satisfied_by_approval_id TEXT, created_at TEXT NOT NULL, expires_at TEXT, repository_id TEXT REFERENCES repository(id), market_study_id TEXT REFERENCES market_study(id), UNIQUE(responsibility_id,subject_type,subject_id,subject_version,policy_id,policy_version));

CREATE TABLE git_commit(
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repository(id),
  sha TEXT NOT NULL,
  parent_sha TEXT,
  branch TEXT NOT NULL CHECK(branch='main'),
  work_item_id TEXT REFERENCES work_item(id),
  employee_id TEXT REFERENCES actor(id),
  purpose TEXT,
  message TEXT,
  pushed_at TEXT,
  remote_verified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(repository_id,sha)
);

CREATE TABLE human_request(
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES business(id),
  work_item_id TEXT REFERENCES work_item(id),
  gate_id TEXT REFERENCES gate(id),
  type TEXT NOT NULL CHECK(type IN ('APPROVAL','DECISION','INFORMATION','PHYSICAL_ACTION','IDENTITY_VERIFICATION','AESTHETIC_REVIEW','LEGAL_REVIEW','PHYSICAL_INSPECTION','CULTURAL_JUDGMENT','LOCAL_LANGUAGE_JUDGMENT','BRAND_RISK_JUDGMENT')),
  requested_responsibility TEXT,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  subject_version TEXT NOT NULL,
  title TEXT NOT NULL,
  context TEXT NOT NULL,
  recommendation TEXT,
  options_json TEXT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','REMINDER_DUE','OVERDUE','RESOLVED','REJECTED','EXPIRED','CANCELLED')),
  requested_at TEXT NOT NULL,
  remind_at TEXT,
  expires_at TEXT,
  resolved_at TEXT,
  resolved_by TEXT REFERENCES actor(id)
);

CREATE TABLE hypothesis(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), statement TEXT NOT NULL, rationale TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PROPOSED','TESTING','SUPPORTED','REJECTED','INCONCLUSIVE')), created_by TEXT NOT NULL REFERENCES actor(id), created_at TEXT NOT NULL);

CREATE TABLE improvement_proposal(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('SKILL_CANDIDATE','TOOL_IMPROVEMENT','EMPLOYEE_CHANGE','FOUNDATION_CHANGE')), owner_responsibility TEXT, proposed_by TEXT NOT NULL REFERENCES actor(id), business_id TEXT REFERENCES business(id), title TEXT NOT NULL, rationale TEXT NOT NULL, evidence_ref TEXT, status TEXT NOT NULL CHECK(status IN ('PROPOSED','REVIEW','APPROVED','REJECTED','IMPLEMENTED')), created_at TEXT NOT NULL);

CREATE TABLE ip_clearance(id TEXT PRIMARY KEY, artifact_version_id TEXT NOT NULL REFERENCES artifact_version(id), risk TEXT NOT NULL CHECK(risk IN ('LOW','MEDIUM','HIGH','UNCERTAIN')), search_status TEXT NOT NULL CHECK(search_status IN ('SEARCHED','FOUND','NOT_FOUND','UNCERTAIN')), reviewer_id TEXT NOT NULL REFERENCES actor(id), evidence_ref TEXT NOT NULL, notes TEXT, created_at TEXT NOT NULL);

CREATE TABLE knowledge_promotion(id TEXT PRIMARY KEY, source_memory_id TEXT NOT NULL REFERENCES memory(id), promoted_memory_id TEXT REFERENCES memory(id), proposed_by TEXT NOT NULL REFERENCES actor(id), reviewed_by TEXT REFERENCES actor(id), status TEXT NOT NULL CHECK(status IN ('PROPOSED','APPROVED','REJECTED')), rationale TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);

CREATE TABLE market_signal(
  id TEXT PRIMARY KEY,
  market_study_id TEXT NOT NULL REFERENCES market_study(id),
  kind TEXT NOT NULL CHECK(kind IN ('CULTURAL','COMMERCIAL','OPPORTUNITY','SATURATION','RISK')),
  subtype TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  lifecycle TEXT CHECK(lifecycle IS NULL OR lifecycle IN ('EMERGING','RISING','MAINSTREAM','SATURATED','DECLINING','DEAD','UNKNOWN')),
  confidence TEXT NOT NULL CHECK(confidence IN ('LOW','MEDIUM','HIGH','UNKNOWN')),
  observed_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE market_signal_evidence(
  market_signal_id TEXT NOT NULL REFERENCES market_signal(id),
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  PRIMARY KEY(market_signal_id,evidence_id)
);

CREATE TABLE market_study(
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL REFERENCES business(id),
  initiative_id TEXT,
  target_segment TEXT NOT NULL,
  market TEXT NOT NULL,
  language TEXT,
  geography TEXT,
  research_question TEXT NOT NULL,
  methodology TEXT,
  limitations TEXT,
  counter_signal_summary TEXT,
  counter_signal_searched INTEGER NOT NULL DEFAULT 0 CHECK(counter_signal_searched IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('DRAFT','RESEARCHING','COMPLETE','EXPIRED','INVALIDATED')),
  confidence TEXT CHECK(confidence IS NULL OR confidence IN ('LOW','MEDIUM','HIGH')),
  analyst_employee_id TEXT NOT NULL REFERENCES employee(id),
  organization_sha TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  valid_until TEXT,
  summary TEXT,
  replaces_market_study_id TEXT REFERENCES market_study(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(valid_until IS NULL OR completed_at IS NULL OR valid_until>completed_at)
);

CREATE TABLE market_study_evidence(
  market_study_id TEXT NOT NULL REFERENCES market_study(id),
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  role TEXT NOT NULL CHECK(role IN ('SUPPORTING','CONTRADICTING','CONTEXTUAL','COMMERCIAL','SATURATION','CULTURAL','RISK','METHODOLOGY')),
  PRIMARY KEY(market_study_id,evidence_id)
);

CREATE TABLE memory(id TEXT PRIMARY KEY, scope_type TEXT NOT NULL CHECK(scope_type IN ('organization','employee','business','employee_business')), scope_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('observation','hypothesis','verified_fact','external_evidence','procedure','postmortem','decision','warning')), title TEXT NOT NULL, content TEXT NOT NULL, source_ref TEXT, confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1), status TEXT NOT NULL CHECK(status IN ('active','superseded','invalidated','expired','revalidate')), supersedes_id TEXT REFERENCES memory(id), created_by TEXT NOT NULL REFERENCES actor(id), created_at TEXT NOT NULL, last_verified_at TEXT, expires_at TEXT);

CREATE VIRTUAL TABLE memory_fts USING fts5(memory_id UNINDEXED,title,content,tokenize='unicode61');

CREATE TRIGGER memory_fts_insert AFTER INSERT ON memory BEGIN INSERT INTO memory_fts(memory_id,title,content) VALUES(new.id,new.title,new.content); END;

CREATE TRIGGER memory_fts_update AFTER UPDATE OF title,content ON memory BEGIN DELETE FROM memory_fts WHERE memory_id=old.id; INSERT INTO memory_fts(memory_id,title,content) VALUES(new.id,new.title,new.content); END;

CREATE TRIGGER memory_fts_delete AFTER DELETE ON memory BEGIN DELETE FROM memory_fts WHERE memory_id=old.id; END;

CREATE TABLE metric(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), slug TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('INCREASE','DECREASE','TARGET')), UNIQUE(business_id,slug));

CREATE TABLE metric_measurement(id TEXT PRIMARY KEY, metric_id TEXT NOT NULL REFERENCES metric(id), value REAL NOT NULL, observed_at TEXT NOT NULL, source_ref TEXT, recorded_by TEXT NOT NULL REFERENCES actor(id));

CREATE TABLE objective(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), title TEXT NOT NULL, outcome TEXT NOT NULL, status TEXT NOT NULL, target_date TEXT, created_by TEXT NOT NULL REFERENCES actor(id), created_at TEXT NOT NULL);

CREATE TABLE objective_capability(objective_id TEXT NOT NULL REFERENCES objective(id),capability_id TEXT NOT NULL REFERENCES capability(id),PRIMARY KEY(objective_id,capability_id));

CREATE TABLE organization_maintenance(
  work_item_id TEXT PRIMARY KEY REFERENCES work_item(id),
  repository_id TEXT NOT NULL REFERENCES repository(id),
  base_sha TEXT NOT NULL,
  result_sha TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE organizational_asset(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('SKILL','TOOL','PLAYBOOK','RESEARCH_METHOD')),slug TEXT NOT NULL UNIQUE,owner_responsibility_id TEXT NOT NULL REFERENCES responsibility(id),maintainer_employee_id TEXT REFERENCES employee(id),status TEXT NOT NULL,version TEXT NOT NULL,description TEXT NOT NULL,known_limits TEXT,usage_conditions TEXT,permission_policy TEXT,last_evaluated_at TEXT,created_at TEXT NOT NULL);

CREATE TABLE physical_sample(id TEXT PRIMARY KEY, sample_order_id TEXT NOT NULL UNIQUE REFERENCES sample_order(id), product_version_id TEXT NOT NULL REFERENCES product_version(id), is_real INTEGER NOT NULL CHECK(is_real IN (0,1)), inspection_result TEXT CHECK(inspection_result IN ('PASS','FAIL')), inspected_by TEXT REFERENCES actor(id), checklist_json TEXT, notes TEXT, photos_json TEXT, inspected_at TEXT);

CREATE TABLE policy_snapshot(id TEXT PRIMARY KEY, policies_json TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE product(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), name TEXT NOT NULL, fulfillment_kind TEXT NOT NULL CHECK(fulfillment_kind IN ('PHYSICAL','DIGITAL','SERVICE')), product_family TEXT, created_at TEXT NOT NULL, commercial INTEGER NOT NULL DEFAULT 1 CHECK(commercial IN (0,1)), creative INTEGER NOT NULL DEFAULT 0 CHECK(creative IN (0,1)), culture_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(culture_sensitive IN (0,1)), trend_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(trend_sensitive IN (0,1)), identity_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(identity_sensitive IN (0,1)), outsourced_manufacturing INTEGER NOT NULL DEFAULT 0 CHECK(outsourced_manufacturing IN (0,1)), target_segment TEXT, market TEXT, language TEXT, geography TEXT);

CREATE TABLE product_version(id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES product(id), version TEXT NOT NULL, content_hash TEXT NOT NULL, artifact_version_id TEXT REFERENCES artifact_version(id), supplier_id TEXT REFERENCES supplier(id), material TEXT, process TEXT, packaging TEXT, shipping_method TEXT, status TEXT NOT NULL CHECK(status IN ('DRAFT','VALIDATING','READY','RELEASED','RETIRED')), created_at TEXT NOT NULL, UNIQUE(product_id,version));

CREATE TABLE qa_review(
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL UNIQUE REFERENCES work_item(id),
  repository_id TEXT NOT NULL REFERENCES repository(id),
  reviewed_sha TEXT NOT NULL,
  qa_employee_id TEXT NOT NULL REFERENCES actor(id),
  result TEXT NOT NULL CHECK(result IN ('PASS','FAIL','CONDITIONAL_PASS')),
  tests_run TEXT NOT NULL DEFAULT '[]',
  failures TEXT NOT NULL DEFAULT '[]',
  evidence TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE release_candidate(
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repository(id),
  sha TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES actor(id),
  status TEXT NOT NULL CHECK(status IN ('PROPOSED','APPROVED','RELEASED','REJECTED')),
  created_at TEXT NOT NULL,
  UNIQUE(repository_id,sha)
);

CREATE TABLE repository(
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK(owner_type IN ('organization','business')),
  owner_id TEXT,
  local_path TEXT NOT NULL UNIQUE,
  remote_name TEXT NOT NULL DEFAULT 'origin',
  remote_url TEXT NOT NULL DEFAULT '',
  default_branch TEXT NOT NULL DEFAULT 'main' CHECK(default_branch='main'),
  current_sha TEXT,
  remote_sha TEXT,
  privacy_verified INTEGER NOT NULL DEFAULT 0 CHECK(privacy_verified IN (0,1)),
  privacy_verified_at TEXT,
  sync_status TEXT NOT NULL CHECK(sync_status IN ('local_only','synced','ahead','behind','diverged','dirty','missing','unreachable','remote_not_private','sha_mismatch')),
  last_fetch_at TEXT,
  last_push_at TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_type,owner_id)
);

CREATE TABLE repository_lock(
  repository_id TEXT PRIMARY KEY REFERENCES repository(id),
  holder_work_item_id TEXT NOT NULL REFERENCES work_item(id),
  holder TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE responsibility(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, description TEXT NOT NULL);

CREATE TABLE responsibility_owner(id TEXT PRIMARY KEY, responsibility_id TEXT NOT NULL REFERENCES responsibility(id), actor_id TEXT NOT NULL REFERENCES actor(id), business_id TEXT REFERENCES business(id), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), UNIQUE(responsibility_id,actor_id,business_id));

CREATE TABLE review_worktree(work_item_id TEXT PRIMARY KEY REFERENCES work_item(id),business_id TEXT NOT NULL REFERENCES business(id),commit_sha TEXT NOT NULL,path TEXT NOT NULL UNIQUE,status TEXT NOT NULL CHECK(status IN ('ACTIVE','REMOVED')),created_at TEXT NOT NULL,removed_at TEXT, repository_id TEXT REFERENCES repository(id));

CREATE TABLE risk(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), subject_type TEXT, subject_id TEXT, description TEXT NOT NULL, severity TEXT NOT NULL, likelihood TEXT NOT NULL, status TEXT NOT NULL, mitigation TEXT, owner_id TEXT REFERENCES actor(id), created_at TEXT NOT NULL);

CREATE TABLE runtime_lock(name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at TEXT NOT NULL);

CREATE TABLE sample_order(id TEXT PRIMARY KEY, product_version_id TEXT NOT NULL REFERENCES product_version(id), supplier_id TEXT NOT NULL REFERENCES supplier(id), spend_request_id TEXT REFERENCES spend_request(id), commitment_id TEXT REFERENCES commitment(id), status TEXT NOT NULL CHECK(status IN ('REQUESTED','AUTHORIZED','ORDERED','SHIPPED','RECEIVED','INSPECTED','CANCELLED')), external_order_ref TEXT, ordered_at TEXT, shipped_at TEXT, received_at TEXT);

CREATE TABLE service(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), name TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE source(id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, author TEXT, publisher TEXT, locator TEXT, publication_date TEXT, accessed_at TEXT NOT NULL, access_notes TEXT, license_notes TEXT, metadata_json TEXT NOT NULL DEFAULT '{}');

CREATE TABLE spend_request(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), requested_by TEXT NOT NULL REFERENCES actor(id), amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL, vendor TEXT NOT NULL, purpose TEXT NOT NULL, budget_id TEXT REFERENCES budget(id), related_work_item_id TEXT REFERENCES work_item(id), risk TEXT NOT NULL, legal_risk INTEGER NOT NULL DEFAULT 0, recurring INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('REQUESTED','WAITING_APPROVAL','AUTHORIZED','DENIED','EXECUTED','CANCELLED')), gate_id TEXT REFERENCES gate(id), commitment_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE supplier(id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, external_ref TEXT, created_at TEXT NOT NULL);

CREATE TABLE supplier_qualification(id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES supplier(id), product_family TEXT NOT NULL, material TEXT NOT NULL DEFAULT '', process TEXT NOT NULL DEFAULT '', packaging TEXT NOT NULL DEFAULT '', shipping_method TEXT NOT NULL DEFAULT '', context_hash TEXT NOT NULL, result TEXT NOT NULL CHECK(result IN ('PASS','CONDITIONAL','FAIL','EXPIRED')), qualified_by TEXT NOT NULL REFERENCES actor(id), evidence_ref TEXT NOT NULL, qualified_at TEXT NOT NULL, expires_at TEXT, invalidated_at TEXT, invalidation_reason TEXT);

CREATE TABLE transaction_entry(id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES business(id), budget_id TEXT REFERENCES budget(id), commitment_id TEXT REFERENCES commitment(id), amount INTEGER NOT NULL CHECK(amount>0), currency TEXT NOT NULL, category TEXT NOT NULL, counterparty TEXT, occurred_at TEXT NOT NULL, external_reference TEXT, source TEXT NOT NULL, UNIQUE(source,external_reference));

CREATE TABLE work_dependency(work_id TEXT NOT NULL REFERENCES work_item(id), depends_on_work_id TEXT NOT NULL REFERENCES work_item(id), PRIMARY KEY(work_id,depends_on_work_id), CHECK(work_id<>depends_on_work_id));

CREATE TABLE work_item(id TEXT PRIMARY KEY, business_id TEXT REFERENCES business(id), type TEXT NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PROPOSED','READY','RUNNING','WAITING_GATE','WAITING_HUMAN','WAITING_EXTERNAL','BLOCKED','FAILED','DONE','CANCELLED')), priority INTEGER NOT NULL DEFAULT 50 CHECK(priority BETWEEN 0 AND 100), risk TEXT NOT NULL DEFAULT 'LOW' CHECK(risk IN ('LOW','MEDIUM','HIGH','CRITICAL')), created_by TEXT NOT NULL REFERENCES actor(id), assigned_to TEXT REFERENCES actor(id), parent_id TEXT REFERENCES work_item(id), subject_type TEXT, subject_id TEXT, subject_version TEXT, result TEXT, lock_owner TEXT, lock_expires_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, repository_id TEXT REFERENCES repository(id), base_sha TEXT, result_sha TEXT);

CREATE TABLE work_objective(work_item_id TEXT NOT NULL REFERENCES work_item(id),objective_id TEXT NOT NULL REFERENCES objective(id),PRIMARY KEY(work_item_id,objective_id));

CREATE INDEX approval_gate_idx ON approval(gate_id,decision,expires_at);

CREATE UNIQUE INDEX business_confirmed_mandate_idx ON business_mandate(business_id) WHERE status='CONFIRMED';

CREATE INDEX business_mandate_status_idx ON business_mandate(business_id,status,version DESC);

CREATE INDEX idx_creative_brief_study ON creative_brief(market_study_id);

CREATE INDEX idx_market_signal_study ON market_signal(market_study_id);

CREATE INDEX idx_market_study_business ON market_study(business_id);

CREATE INDEX idx_market_study_valid_until ON market_study(valid_until);

CREATE UNIQUE INDEX repository_organization_one ON repository(owner_type) WHERE owner_type='organization';

CREATE INDEX work_ready_idx ON work_item(status,priority DESC,created_at);

CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_event BEGIN SELECT RAISE(ABORT,'audit_event is append-only'); END;

CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_event BEGIN SELECT RAISE(ABORT,'audit_event is append-only'); END;
