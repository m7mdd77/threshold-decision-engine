# Current Qwen runtime — 5 November 2026

The operator selected Qwen 3.8 27B (qwen-3.8-27b) through the existing Cerebras account. The current private key-file reference is retained. For your own deployment, copy .env.example to an ignored .env and set CEREBRAS_API_KEY or CEREBRAS_KEY_FILE. Never commit a key or a personal key path. The endpoint remains https://api.cerebras.ai/v1/chat/completions.

The bounded direct adapter requests reasoning_effort=none, omits the GPT-OSS-specific hidden reasoning format, and validates actual returned model identity and completed text. Application retries and provider/model fallback remain disabled. Existing response-size, completion-token, deadline, quota, document, approval and execution checks remain. Usage is reported when returned by Cerebras; no USD charge guarantee is claimed.

The genuine paid model path remains in the runnable local app. The public companion retains deterministic checks.

Fresh local/public evidence is recorded in qwen-nov5-verification.json after the checks complete. Older GPT-OSS and Qwen evidence and recordings remain dated history and are not relabeled as new requests.

The fresh genuine checks passed. See [qwen-nov5-verification.json](qwen-nov5-verification.json) for actual local/public outcomes and numeric usage. The existing public Site was deployed at https://threshold-decision-engine.choggyacc.chatgpt.site.
