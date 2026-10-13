# Proposal prompt review

Applied the AI prompt engineering safety review skill to the proposal contract in `src/agent.js`, version `proposal-2026-10-12.1`.

## Original prompt and task

The initial product accepted a manually entered action with untrusted descriptive text. The added prompt asks a model to transform that request into a structured refund, deployment, or access proposal. The complete implemented prompt is maintained in `agentMessages()` rather than copied into a second independently editable source.

Task classification: moderately complex technical extraction and clarification. The model handles intent; the deterministic policy engine handles authorization. It receives synthetic operational records and has no execution tools or credentials in its prompt.

## Assessment

| Area | Assessment and implementation |
|---|---|
| Harmful output | An unsafe action can be proposed for inspection, but cannot execute without independent policy gates. Admin requests and revoked authority are refused by code. |
| Bias | The prompt uses operational evidence and explicit request fields, not demographic traits. Synthetic identity status means account verification, not a demographic judgment. |
| Privacy | The request and reduced synthetic context go to AgentRouter. The API key is sent only in the authentication header. Real personal/business data is outside the current demo's scope. |
| Injection and access control | Request text remains in a JSON data envelope. Prompt instructions disclaim authority; strict output validation and a separate server-held policy enforce it regardless of model compliance. |
| Clarity and specificity | One domain, explicit proposal schema, two permitted response kinds, and bounded explanation/question fields. |
| Context adequacy | The model gets factual record values and labels; permissions, risk thresholds, reliability values, and cumulative financial authority remain server-side. |
| Pattern and constraints | Role instruction plus structured data. No execution tools and no request for private reasoning. Constraints are enforced with allowlisted fields and values. |
| Robustness | Empty/oversized requests, fenced/malformed JSON, forged approvals, tool-use output, truncation, timeouts, and oversized provider bodies fail closed. |
| Consistency and reliability | The model must preserve requested amount, environment, and role rather than downgrade intent to fit policy. Real-model compliance and behavioral consistency are not measured yet. |
| Scalability and maintenance | Prompt version is recorded with decisions. Short contexts and bounded outputs limit each attempt; concurrency and request allowances limit local inference. The public Worker enforces persistent sandbox quotas and exposes no paid inference; persistent spending limits for a future hosted model remain future work. |

## Improved prompt measures

- Preserve unsafe intent for the independent evaluator; do not let the model turn a production request into staging merely to obtain execution.
- Ask one specific clarification when intent is ambiguous. Missing verification is handled by the policy engine, not invented by the model.
- Return only a proposal or clarification, with no approval, risk, confidence, trusted evidence, or arbitrary keys.
- Produce a short factual explanation instead of private reasoning.
- Disable automatic execution, provider redirects, retries, and fallback.
- Re-read resource version after inference. Changed context invalidates the model response before evaluation.

## Testing and limits

The suite validates approved field shapes in all three domains, rejected forged permissions, invalid money inputs, independent refusal of an AI admin proposal, clarification without a write, usage normalization, error sanitization, no paid retries, provider-body limits, concurrency/allowance boundaries, and evidence changes during inference. All provider responses are mocked.

Before claiming live prompt effectiveness, measure output validity, clarification accuracy, preservation of requested intent, latency, and billed token usage across ordinary, ambiguous, and injection-bearing requests using the configured account. Compare equivalent requests with demographic wording removed or varied; no real demographic outcome decisions belong in this prototype.

Live evidence on October 12, 2026: DeepSeek v4 Flash produced a valid $35 refund proposal through the genuine supported Claude Code client, with tools and MCP disabled. Usage was 546 input and 112 output tokens; independent evaluation allowed a separate sandbox execution. This single success does not establish broad consistency, clarification accuracy, or resistance to adversarial prompts.

The main principle is a mechanically enforced separation between model intent and authorized effect. A system instruction is useful guidance; the server's schema, trusted facts, and execution gate provide the enforceable boundary.
