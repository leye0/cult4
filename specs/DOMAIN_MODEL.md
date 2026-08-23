# Domain model

- Actor: human, employee, or system identity. Employee extends Actor with a durable charter and generated OpenCode definition.
- Capability says who can perform work; Assignment says who currently has work; Responsibility establishes ownership; Authority permits a decision.
- WorkItem is generic work in a dependency DAG. Its validated state machine distinguishes gate, human, external, and true blocking.
- ActionIntent is a structured proposed sensitive effect. Policies return ALLOW, BLOCK, or DENY and exact gate requirements.
- Gate is an obligation attached to a subject and version. Approval is an authorized actor decision for that exact tuple and policy version.
- HumanRequest is persistent asynchronous business state, never an OpenCode permission question.
- Memory has strict organization, employee, business, or employee-business scope, epistemic kind/status, and visible expiry for volatile cultural facts.
- Source, Claim, Evidence, Decision, Hypothesis, Metric, and Experiment preserve research and learning discipline.
- BusinessControl is a Business-owned executable domain invariant. ControlValidation binds its exact code version and evidence input to TESTED or independent QA_VERIFIED results. DecisionClaim identifies which Claims are material; ActionAssurance records that the complete current chain passed before a sensitive action was gated.
- IntakeMessage is an immutable exact human-authored source. OfficialRequest structures a substantive demand without replacing that source. MandateRequest records its explicit contractual disposition; WorkRequest carries it into execution; RequestVerification binds independent acceptance evidence to the exact work, QA mission, subject, and version. Silent omission is invalid.
- MarketStudy anchors current target/market/language/geography research while linking existing Evidence. MarketSignal compactly represents cultural, commercial, opportunity, saturation, and risk conclusions. CreativeBrief is the Strategist-owned evidence-backed handoff to the Designer.
- Budget, Commitment, Transaction, and SpendRequest separately model allocation, reservation, observation, and intent.
- ArtifactVersion, ProductVersion, SampleOrder, PhysicalSample, SupplierQualification, and provenance support creative/IP/physical controls.

SQLite is authoritative for operational state; Git is authoritative for versioned source/assets/methods; the object store holds large binary evidence referenced by hash.
