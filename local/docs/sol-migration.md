# GPT 6.1 Sol migration

Current inference uses `gpt-6.1-sol` through AgentRouter’s supported Codex client and Responses endpoint. Configure `AGENTROUTER_MODEL=gpt-6.1-sol`, `AGENTROUTER_TRANSPORT=codex`, `AGENTROUTER_API_FORMAT=openai`, `AGENTROUTER_BASE_URL=https://agentrouter.org/v1`, `CODEX_PATH` and the existing server-only key. The child has an isolated configuration, read-only sandbox, disabled shell/browser/app/plugin/agent features, no saved session, and no application/provider retries. Model output remains a proposal subject to existing domain validation and separate execution authority. Application deadlines and request allowances remain in force. The former Claude-specific estimated USD/output caps do not apply to this client; unknown costs remain unknown. Historical DeepSeek evidence and video are dated records, not new Sol invocations.

Fresh verification uses fictional data; no external effects were executed. See `sol-verification.json` for scoped results.
