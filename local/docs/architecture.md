# Threshold architecture snapshot

## Inputs → signals → decision → audit

**Input:** a structured proposal bound to a server-created resource. The refund schema permits amount and note; deployments permit target and note; access requests permit role and note. The server rejects arbitrary policy fields. Request text is descriptive and cannot grant authority.

**Signals:** server-held source records, required verified facts, evidence age, dependency status, delegated scope, cumulative refund spending, reversibility, exposure, and policy version. The demo's records are synthetic and make no claim to independent verification.

**Decision:** explicit precedence prevents lower-level uncertainty from overriding a hard prohibition. Refunds require a verified customer and eligible captured payment, with $75/action and $150/day authority. Deployments require passing checks and rollback readiness; autonomous scope is staging. Access grants require an active employee and owner approval; autonomous scope is viewer and admin requests are prohibited.

**Audit:** each evaluation persists the input, complete resource snapshot, rule trace, confidence/risk components, decision, policy version, and timestamp. Each ledger event carries a SHA-256 digest over its serialized payload and the previous event digest. Execution outcomes and evidence changes use the same ledger. JSON export contains the complete chain for the sandbox.

## Execution boundary

1. Look up the stored decision within the session's sandbox.
2. If an effect already exists, return its original receipt; do not execute again.
3. Inside a SQLite `BEGIN IMMEDIATE` transaction, re-read the current resource and today's cumulative exposure.
4. Re-evaluate the original stored proposal. The browser cannot substitute a different amount/role/target.
5. Require an original execute decision, a fresh execute decision, and an unchanged resource version.
6. On failure, persist a blocked-execution event and return HTTP 409.
7. On success, persist the sandbox effect, mark the resource consumed, advance its version, and save a receipt and audit event in the same transaction.

The effects table constrains each resource to one completed action and each decision to one receipt. There is no production connector in this version. External service writes will need a separate idempotency and reconciliation protocol.

## Failure demonstration

The initial record is v1 with passing CI checks. Its proposal produces execute. The demo changes CI to failed and advances the resource to v2. Executing the stored v1 decision produces refuse during re-evaluation. No effect is created. The ledger preserves the full original evaluation and the failed execution attempt.

This is a time-of-check/time-of-use test, not a UI confirmation dialog. The HTTP tests attempt the old decision directly, and the server blocks it regardless of what the browser displays.

## Storage and scope

Node.js 24 provides the HTTP server, crypto hash implementation, test runner, and SQLite database. Plain HTML, CSS, and JavaScript provide the interface without remotely loaded fonts/scripts. The direct Anthropic adapter uses its official SDK; the verified AgentRouter integration invokes the genuine installed Claude Code client with tools and MCP disabled.

Before evaluation, an optional model converts the request and reduced synthetic context into a proposal or clarification. Strict validation rejects policy/authority fields. The server rechecks evidence version after inference and never automatically executes. Model, prompt version, explanation, and reported token counts join the audit record. The local DeepSeek refund path is verified; future hosting must provision the supported client and control persistent spending.

The local server has host/origin checks, a per-sandbox CSRF token, a bounded JSON body, HttpOnly/SameSite cookies, static-asset allowlisting, and a content security policy. These controls are useful prototype boundaries, not a claim that the app is ready for public or production service. Public rate limits, quotas, operational monitoring, backup retention, and independent audit anchors remain necessary.

## Resolution and review

Synthetic resolvers fill only missing ownership/owner-approval facts or refresh/restore deferred context; they do not erase known failures. Each advances the resource version and records a new evaluation. Operator grants are limited by a server-owned reviewer catalogue. A grant carries original/approved decision IDs, exact proposal JSON, resource/evidence version, policy version, reviewer identity, reason and expiry. Execution checks this grant again, including revocation and current refund budget. These identities are explicitly synthetic selectable personas, not real authenticated operators.

The public Worker stores one bounded sandbox payload per D1 row and uses an atomic revision comparison to serialize changes. This is safe for synthetic effects; real integrations require a transactional outbox, external idempotency and reconciliation. Anonymous sessions expire after seven days, with creation and mutation quotas. No AgentRouter key or local client data is hosted.
