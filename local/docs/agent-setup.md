# DeepSeek through AgentRouter's supported client

Threshold converts requests into strictly validated proposals or clarification questions. The independent policy engine evaluates each proposal; execution requires a separate click.

## Local setup

Requires Node.js 24+, locked npm dependencies, and the genuine installed Claude Code client. Generic HTTP and standard Anthropic SDK requests from this account received HTTP 401 `unauthorized client detected`. The documented supported Claude Code client works with the same key and `deepseek-v4-flash`.

Enter the key only in the project's local `.env`:

```dotenv
AGENTROUTER_API_KEY=your-key-entered-locally
AGENTROUTER_BASE_URL=https://agentrouter.org
AGENTROUTER_API_FORMAT=anthropic
AGENTROUTER_MODEL=deepseek-v4-flash
AGENTROUTER_TRANSPORT=claude-code
CLAUDE_CODE_PATH=C:/Users/User/.local/bin/claude.exe
```

Use the actual installed client path. Run `npm ci`, then `npm start`. Restart after configuration changes. The CLI transport uses the base URL's origin and the genuine client, even if the direct-adapter format is set to OpenAI. No fabricated identity, custom User-Agent, or restriction bypass is used.

The key stays server-side in the child process environment, absent from command arguments, prompts, browser responses, source archives, and audit exports. The client runs in a dedicated data directory with tools, MCP servers, slash commands, prompt suggestions, and session persistence disabled. Future hosting requires this executable on the server.

## Try it

1. Choose Customer refunds and A straightforward refund.
2. Enter `Please refund $35 for the duplicate payment on my order.`
3. Click **Let AI propose & evaluate**. This sends the request and synthetic record context to AgentRouter and uses API credits.
4. Inspect the explanation, token usage, and policy decision.
5. Click **Execute in sandbox** to apply the authorized synthetic action and save a receipt.

Use synthetic information. Real payment, deployment, and directory connectors are not implemented.

## Usage controls

- One application invocation per click; no application retries, fallback, or model switching. The supported client may have internal retry behavior.
- Output allowance: 768 tokens. The CLI's estimated $0.02 invocation budget uses its internal pricing estimate and is not a guaranteed AgentRouter charge limit.
- A 25-second timeout and 64 KiB output limit bound each invocation.
- One in-flight invocation per sandbox; four process-wide.
- In-memory allowances: 20 attempts per sandbox/hour and 60 process-wide/hour. Failures count. Restart resets them; they are not a persistent spending cap.
- Input/output usage appears beside the explanation and in audit metadata. Cache counts are retained separately when reported.
- Failed or timed-out calls can incur charges without returned usage. AgentRouter's dashboard is the billing authority.

## Verification on October 12, 2026

The client connectivity probe returned OK using 145 input and 35 output tokens. A live browser request generated the $35 refund proposal with **546 input + 112 output = 658 reported tokens**. The policy returned execute; a separate click applied the sandbox refund and saved a receipt. The audit chain verified. This establishes the selected model's working path; broad prompt accuracy and billing rates are not yet measured.

The original connection suite passed 66 tests; the expanded local suite now passes 78 tests. Mocked provider/client responses consume no API credits. Coverage includes schemas, independent refusal, clarification, stale evidence, cancellation, disabled tools, sanitized errors, usage, and execution controls.

## Direct API alternative

Set `AGENTROUTER_TRANSPORT=api` only if the account permits custom application clients. Anthropic format uses the official SDK with a base URL without `/v1`; OpenAI format uses `/v1/chat/completions` with a base URL ending in `/v1`. Hosts are restricted to AgentRouter HTTPS origins. Current direct requests are blocked. The draft in request-client-access.md is optional for enabling that alternative; no support message has been sent.

Reference: [AgentRouter's supported client guide](https://github.com/agentrouter-org/docs/blob/main/start.md).

Latest verification: the public demo deliberately excludes paid inference. A subsequent local production-proposal request reached the 25-second deadline, and a short supported-client probe also timed out. No new inference success or token usage is claimed for those attempts, and no action was executed. Keep the previously successful 658-token refund as historical evidence.

Final check on October 13: a fresh DeepSeek v4 Flash production proposal succeeded with 558 input and 138 output tokens (696 total). It preserved the production target, escalated, received a separate scoped Noor approval, executed a synthetic local release, and verified the audit chain. This succeeded after the earlier timeout checks.
