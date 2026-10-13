# Mission mapping and next milestone

Mission: [The Decision Engine](https://build.doo.ooo/challenges/decision-engine). Deadline shown by the official site: November 15, 2026. Prize advertised: $500 plus Decision Architect badge; award is competitive, not a guaranteed payment.

## Evidence against the brief

| Requirement | Implemented evidence | Status |
|---|---|---|
| Five possible outcomes | Explicit policy engine, thirteen scenarios across three domains | Working locally |
| Confidence, risk, evidence, missing context, reversibility | Decision trace, source records, risk components, missing-evidence list, cost of error | Working locally; confidence is heuristic |
| Full audit trail | SQLite inputs/snapshots/rules/outcomes, hash chain, JSON export | Working locally |
| At least three domains | Refunds, deployments, access grants | Synthetic fixtures and persistent sandbox adapters |
| Runnable public repo | Source, locked dependencies, README, automated tests | Public GitHub repository: https://github.com/m7mdd77/threshold-decision-engine |
| Required live demo URL | Public ChatGPT Site with persistent D1 sandbox | Published; live verification complete |
| Architecture snapshot | README diagram and architecture.md | Prepared |
| Deliberate failure test | CI changes after evaluate; execute rechecks and blocks | Tested through HTTP and browser |
| Two-year thesis ≤300 words | thesis.md and field guide | Prepared |
| 90-second walkthrough | Captioned MP4 and demo-script.md | Verified 90-second video assembled from public demo screenshots |
| AI usage and scope notes | This file and README | Prepared |

## Next implementation milestone

The genuine proposal agent is now connected through AgentRouter's supported Claude Code client using DeepSeek v4 Flash. A browser request generated a $35 proposal, received independent authorization, and produced a separate sandbox receipt. It used 658 reported tokens. Records remain synthetic; broad model behavior is not yet measured. The model cannot supply permissions, source verification, policy thresholds, or confidence.

Synthetic evidence resolution and a scoped operator inbox are implemented and tested. Selectable demo actors have domain capabilities; each approval binds an exact proposal, evidence version, policy and expiry. Real operator authentication is outside the sandbox release. Hard refusals and narrower workspace-owner approvals remain binding.

The public ChatGPT Site includes quotas, retention and persistent storage and passed hosted smoke tests. The sanitized source repository and captioned 90-second walkthrough are ready. Recheck the official requirements before submission. The brief lists a video as a deliverable while the submission form calls it optional but recommended; include it.

## Draft submission notes

Threshold separates a proposed intention from an allowed effect. It derives decisions from scoped authority, required evidence, freshness, cumulative exposure, risk, and reversibility. Three domain adapters produce five distinct outcomes with inspectable rule traces. Execution rechecks current state, prevents stale approvals, and returns the same receipt on duplicate requests.

The deliberate failure test approves a staging release, changes CI evidence to failed, and attempts execution. The engine refuses the write and records the decision, evidence change, and blocked attempt.

AI usage: developed with OpenAI Codex for implementation, documentation, and testing. The app makes optional DeepSeek v4 Flash calls through AgentRouter's supported client, with tools disabled. Evidence is synthetic; model proposals receive independent policy evaluation and effects are persistent local sandbox records. Confidence is an evidence-quality heuristic. Synthetic operator review and evidence resolution work. Real authentication, external connectors and calibrated uncertainty remain outside this prototype.

Final live checks: the public release passed 68 API assertions and browser containment/video checks. A new local DeepSeek production proposal succeeded with 696 tokens; scoped review and a separate execution step applied the synthetic release and verified the audit chain. Public inference remains disabled.
