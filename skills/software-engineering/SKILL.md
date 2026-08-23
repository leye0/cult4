---
name: software-engineering
description: Use to implement request-linked software with maintainable architecture, tests, operational documentation, and explicit specialist handoffs.
---

# Software engineering

Implement only the assigned WorkItem and its linked acceptance criteria. Treat
the confirmed mandate, specialist evidence, strategy, economic constraints, and
approved decisions as inputs; do not invent replacements for missing market,
financial, legal, design, or product knowledge.

Prefer the smallest coherent architecture that supports the complete required
behavior. Keep domain rules configurable, interfaces provider-independent, data
durable, migrations explicit, and failure recovery observable. Add tests that
exercise behavior rather than merely asserting types or file existence. Run the
relevant checks and document known limits and operational procedures.

When a requirement needs expertise that is not present in the handoff, record a
blocker or request specialized work. Never silently make the product, market,
financial, legal, or aesthetic decision yourself. Do not approve your own work;
the trusted host commits it and an independent QA employee validates the exact
resulting SHA.
