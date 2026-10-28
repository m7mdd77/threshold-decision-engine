# Cerebras runtime — 28 October 2026

The active server adapter calls Cerebras directly at https://api.cerebras.ai/v1/chat/completions using qwen-3.8-27b. AgentRouter credentials and legacy model overrides are ignored by this adapter. There is no provider fallback or application model retry. Dated Sol, Astra and DeepSeek evidence and walkthroughs are historical, not evidence for this migration.

Copy .env.example to an ignored .env and set CEREBRAS_API_KEY or CEREBRAS_KEY_FILE to your own private file. Never commit a real key or personal key path. No Codex/Claude executable or client identity is required. The API key remains server-side, separate from the private public-worker credential.

Requests use bounded direct HTTPS, a completion-token limit, an application deadline, JSON object mode where structured output is required, and no model tools. Returned model identity, completion status and actual numeric usage are checked. Incomplete output, tool calls, malformed results and unexpected models fail closed. Existing application validators, allowances, revision checks and approval/execution boundaries still apply. Usage reports are not a guaranteed USD price or budget cap. Failed attempts count toward existing persistent allowances.

Genuine proposals are available in the runnable local app. The public companion retains its local-only paid-inference boundary and deterministic sandbox.

Verification: 79 automated tests passed. The fresh real call and its reported usage are recorded in [cerebras-verification.json](cerebras-verification.json); mocked tests are not provider evidence. Earlier media and records are unchanged.

Publication: existing public Site deployment succeeded at https://threshold-decision-engine.choggyacc.chatgpt.site. The public companion remains deterministic; local genuine inference was verified separately.
