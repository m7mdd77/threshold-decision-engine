# AgentRouter custom application access request

Optional draft for enabling direct API clients. The local app already works through the genuine supported Claude Code client with DeepSeek v4 Flash; this draft is no longer a blocker. It contains no key, token identifier, account information, or private application data. No support message has been sent by Codex.

> My AgentRouter token is enabled, has no IP restriction, and does not expire. I am integrating a Node.js web application through the documented Anthropic-compatible Messages endpoint and the official Anthropic JavaScript SDK. Generic requests and the SDK request return HTTP 401 with `unauthorized client detected`. Please enable custom web/API client access for my token, or provide your supported application SDK and integration contract. I also need to confirm whether my account can access `claude-opus-4-8`. I can provide my token name privately through your support channel, but will not post the API key.

Observed on October 12, 2026: the key is loaded from the saved local configuration, both bearer and API-key requests receive the client-rejection message, and the official Anthropic SDK with its standard client identity is also rejected. This establishes the client-access blocker; it does not prove the token or model entitlement is otherwise valid.

Related reports: [AgentRouter support issue 21](https://github.com/agentrouter-org/docs/issues/21), [AgentRouter support issue 25](https://github.com/agentrouter-org/docs/issues/25).

