# Release verification

- Local build: 78 automated tests passed.
- Hosted store: 4 automated tests passed.
- Worker preview: 68 API assertions passed, covering all thirteen scenarios, Ask/Defer resolution, concurrent receipt replay, scoped review, revocation, stale CI, isolation, CSRF and audit integrity.
- TypeScript check and Worker production build passed.
- Local DeepSeek refund inference previously succeeded: 546 input + 112 output tokens. The latest production-proposal attempt reached the 25-second application deadline. A separate short connectivity probe also timed out. Neither created an execution effect. A final fresh probe succeeded in 4.5 seconds: 558 input + 138 output = 696 tokens, production target preserved, Escalate → scoped Noor approval → Execute, sandbox release applied, audit chain valid.
- No paid model access is exposed in the public release. Public checks consume no AgentRouter credits.
- Public source repository: https://github.com/m7mdd77/threshold-decision-engine. Runnable hosted and sanitized local source are included; no competition submission has been sent.

The final version 2 public release passed 68 API assertions and browser checks for refund execution, Ask resolution, operator review, stale-CI containment, audit integrity and mobile layout. Browser verification confirmed policy 2026-10-13.2, execution-time Refuse after changed CI, and a playable 90-second video. The captioned walkthrough is exactly 90 seconds and decoded successfully.

Before GitHub publication, the clean source checkout installed its locked local dependencies and passed all 78 local tests plus all 4 hosted-store tests. Source checks excluded the actual AgentRouter key and private runtime paths.
