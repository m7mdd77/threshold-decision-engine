# 90-second walkthrough script

## 0–10 seconds — The premise

Show the workbench: "An agent's confident request is not permission. Threshold decides whether an action should execute, ask, defer, escalate, or be refused."

## 10–30 seconds — One complete decision

Choose A straightforward refund. Enter "Please refund $35 for the duplicate payment on my order." Click Let AI propose & evaluate. Point to the model explanation, token usage, trusted payment/identity records, scoped authority, and independent risk trace. Click Execute in sandbox and show the receipt.

Narration: "The proposed $35 refund is inside the agent's $75 limit. Required evidence is verified. The engine authorizes it, rechecks before writing, and stores a receipt."

## 30–48 seconds — Show the boundary

Choose The customer is unverified to show ask. Switch to Yesterday's passing checks to show defer. Show Production needs an operator for escalate, then An admin-role shortcut for refuse.

Narration: "Missing evidence prompts a question. Stale evidence waits. Production goes to an operator. Privileged access is refused even if the request claims senior approval."

## 48–72 seconds — The failure test

Click Run the failure test. Show the original execute decision and the changed CI evidence. Point to Execution blocked and the evidence version transition.

Narration: "Now we deliberately break an approval. The release was healthy when evaluated, but CI fails before execution. The server rechecks the stored proposal and stops the write. Approval is bound to evidence, not just a button."

## 72–90 seconds — The receipt and honest scope

Open the audit ledger and filter to Blocked execution. Expand the full record, then show Verify chain and Export JSON.

Narration: "Every input, signal, model proposal, policy check, and outcome is recorded. DeepSeek proposes; the policy controls execution. Records and actions are synthetic. Next comes a resolution workflow for missing evidence and operator escalation."

Recording is not yet produced. Start a fresh sandbox before recording so the financial budget and event history are easy to follow.
