# Threshold — public Decision Engine demo

Public demo: https://threshold-decision-engine.choggyacc.chatgpt.site

Source repository: https://github.com/m7mdd77/threshold-decision-engine

Threshold evaluates structured agent proposals against server-held evidence and policy. It returns execute, ask, defer, escalate or refuse. Actions are persistent synthetic sandbox writes, never real refunds, deployments or access changes.

## What works

- Thirteen scenarios across refunds, deployments and access.
- Synthetic missing-evidence resolution and dependency/source refresh.
- Operator inbox with domain-specific sandbox actors, review reasons, bounded capabilities, ten-minute maximum approval expiry and revocation.
- Exact proposal/evidence/policy binding, execution-time rechecks and idempotent receipts.
- Hash-linked audit and JSON export.
- D1 persistence, isolated HttpOnly sessions, CSRF/origin checks, optimistic concurrency and bounded public quotas.

Public visitors select synthetic operator personas. This demonstrates scope checks; it is not production user authentication. Paid model inference is intentionally absent from the public site. The separate local build now uses Qwen 3.8 27B through the bounded direct Cerebras API; see [current setup and verification](local/docs/cerebras-migration.md). The following token counts describe the original historical release. A local refund inference succeeded with 658 reported tokens. After two timeout checks without effects, a fresh production proposal succeeded with 696 tokens, escalated for scoped operator review, then produced a separate sandbox receipt with valid audit integrity. No API key, local database or client config is uploaded here.

## Run a clean clone

Node.js 24 recommended. Install the locked dependencies with `npm ci`.

Generate/build and migrate local D1 once:

```powershell
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_free_havok.sql
npm start -- --port 3242
```

On Windows, if Wrangler cannot write its global config, use a checkout-local `XDG_CONFIG_HOME` (for example `.sites-runtime/xdg-config`) for that command. This directory is ignored. Stop the preview before rebuilding on Windows to release Worker file handles.

Checks:

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --test test/hosted-store.test.mjs
node test/live-smoke.mjs http://127.0.0.1:3242
```

The live smoke script creates anonymous synthetic test sessions; it uses no API credits. Production sessions expire after seven days. Limits: 60 runs, 100 decisions, 450 audit events and 120 POST attempts per hour per session; creation limits are 20/hour per IP and 500/day globally.

## Architecture

The shared pure policy (`lib/engine.js`) derives authority, evidence quality, risk and missing context. `lib/workflow.js` limits resolution and reviewer capabilities. `lib/hosted-store.js` stores bounded sandbox state; the API atomically commits it through D1 revision comparison. A conflicting action reloads and rechecks current state. This serializes budget/evidence/action changes without pretending a database transaction can make an external service atomic.

The `.openai/hosting.json` manifest declares the ChatGPT Site and DB binding. Source publication and deployment follow the Sites plugin workflow. It contains no credentials.

## Limits

Synthetic data and effects; heuristic confidence; selectable demonstration operators; no payment/directory/deployment connectors; no external audit anchor; no calibrated model accuracy. The public release is a working policy demo, while DeepSeek inference runs locally. No competition submission has been sent.

The sanitized local Node/SQLite build is included under local/. Run npm ci and npm start there for optional private DeepSeek inference; add the key only to its ignored .env. Public walkthrough: /walkthrough.mp4.

