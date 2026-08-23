# Security model

Business sessions may write only their resolved business repository, read the organization repository, query state only through scoped Cult4 tools, and never read secrets or other business repositories. Organization maintenance is a distinct mode; Foundation changes additionally require exact-version human approval and passing tests.

Sensitive effects are expressed as structured ActionIntents and evaluated by deterministic policies. Credentials remain under the mode-0700 Cult4 secrets directory and are read only by narrow authorized adapters. No secret is placed in prompts or normal logs. Paths are canonicalized, repositories are resolved from database records, OpenCode receives explicit deny rules, and broker failures deny the operation.

Critical mutations and their audit event occur in one SQLite transaction. Audit rows are append-only by triggers. Financial reservations are transactional commitments with idempotency keys; external adapters must use those keys so recovery after authorization is safe.

Threats addressed include prompt injection, forged textual approvals, hash/commit substitution, self-review, expired authority, budget races, cross-business memory leaks, directory traversal, organization-policy weakening, and direct credential access. OpenCode permissions limit blast radius but never replace domain policy.
