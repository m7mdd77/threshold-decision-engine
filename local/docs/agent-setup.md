# Cerebras proposals

The current adapter is src/cerebras-client.js. Older CLI/client evidence remains historical; it is not the active transport.

Requires Node.js 24+ and locked dependencies. Copy .env.example to ignored .env, then set CEREBRAS_API_KEY or CEREBRAS_KEY_FILE to your own private key file. Keep CEREBRAS_BASE_URL=https://api.cerebras.ai/v1 and CEREBRAS_MODEL=qwen-3.8-27b. Run npm ci and npm start. No Claude/Codex executable is needed.

The key stays server-side. One direct HTTPS call per application request returns a structured proposal or clarification. Threshold validates the output and evaluates it independently; only a separate execution request can write a synthetic effect. No tools, application retries or provider fallback.

The completion bound is 768 tokens, the application deadline is 25 seconds, and the output bound is 64 KiB. The existing in-memory attempt/concurrency controls remain; they are not a persistent spending cap. Failed attempts may incur usage. Numeric provider usage is recorded when available; no USD-price guarantee is claimed.

Use fictional information. The public companion has no paid model endpoint. See [current verification](cerebras-verification.json) for fresh local evidence and [migration notes](cerebras-migration.md).
