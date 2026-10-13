const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const title = value => value.charAt(0).toUpperCase() + value.slice(1);
let state, run, record, domain = 'refund', currentPage = 'lab', pending = false, toastTimer;
let effect, blocked;
let agentOutput;

// Keep optional inference next to the action request; credentials stay server-side.
$('#request-note').insertAdjacentHTML('afterend', '<section class="agent-box"><div class="agent-box-heading"><span class="field-label">AI PROPOSAL</span><span id="agent-status" class="mono"></span></div><button id="generate-agent" class="outline-button">Let AI propose & evaluate ↗</button><p class="micro-copy">Sends this request and synthetic evidence to AgentRouter. Uses API credits. Execution requires a separate click.</p><div id="agent-output" aria-live="polite" hidden></div></section>');
document.querySelector('nav').insertAdjacentHTML('beforeend', '<button class="nav-item" data-page="review"><span class="nav-icon">↳</span> Operator inbox <span id="review-count" class="nav-count">0</span></button>');
document.querySelector('main > footer').insertAdjacentHTML('beforebegin', '<section id="page-review" class="page" hidden><div class="page-heading"><div class="eyebrow">REVIEW A SPECIFIC ACTION</div><h1>The operator inbox.</h1><p>Scoped review with a reason, an expiry, and execution-time checks.</p></div><div class="integrity-note">Synthetic sandbox actors demonstrate role separation. They are selectable demo identities, not authenticated production operators. Approval never overrides a hard refusal or invents missing evidence.</div><div id="review-items"></div></section>');

function renderAgent() {
  if (!state) return;
  $('#agent-status').textContent = state.agent?.configured ? state.agent.model : state.publicDemo ? 'LOCAL AI VERIFIED' : 'KEY REQUIRED';
  $('#generate-agent').disabled = pending || !state.agent?.configured;
  $('#generate-agent').textContent = state.publicDemo ? 'DeepSeek is connected in the local build' : 'Let AI propose & evaluate ↗';
  if (state.publicDemo) document.querySelector('.agent-box > .micro-copy').textContent = 'Public sandbox: structured proposals and server policy are live. Paid inference is local only. The verified DeepSeek run used 658 tokens; no key or account credits are exposed here.';
  $('#agent-output').hidden = !agentOutput;
  if (agentOutput) {
    const usage = agentOutput.usage ?? agentOutput.record?.agent?.usage;
    $('#agent-output').innerHTML = `${agentOutput.kind === 'clarification' ? `<strong>${esc(agentOutput.question)}</strong><p>${esc(agentOutput.explanation)}</p><p>Answer in the request box, then try again.</p>` : `<strong>Proposed by ${esc(agentOutput.model)}</strong><p>${esc(agentOutput.explanation)}</p><p>${effect ? 'The sandbox action was applied. Receipt saved below.' : 'The policy engine evaluated the proposal below. No action was executed.'}</p>`}${usage ? `<p class="micro-copy">Reported usage: ${esc(usage.prompt_tokens)} input + ${esc(usage.completion_tokens)} output tokens${usage.cache_read_input_tokens || usage.cache_creation_input_tokens ? '. Cache counts are in the ledger.' : '.'}</p>` : ''}`;
  }
}

async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': state.csrf }, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok && !result.blocked) throw new Error(result.error ?? 'Request failed.');
  return result;
}
function toast(message, isError = false) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.toggle('error', isError); $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6500);
}
async function perform(fn) {
  if (pending) return;
  pending = true;
  document.querySelectorAll('button,select,input,textarea').forEach(el => { el.disabled = true; });
  try { await fn(); } catch (error) { toast(error.message, true); }
  finally { pending = false; document.querySelectorAll('button,select,input,textarea').forEach(el => { el.disabled = false; }); renderAgent(); }
}
async function refresh() { state = await api('/api/state'); renderStats(); renderRecent(); renderAgent(); renderReviews(); }
function renderReviews() {
  const reviews = state.reviews ?? [];
  $('#review-count').textContent = reviews.filter(r => r.status === 'pending').length;
  $('#review-items').innerHTML = reviews.length ? reviews.map(review => {
    const original = state.decisions.find(r => r.id === review.originalDecisionId);
    if (!original) return '';
    return `<article class="audit-card review-card"><div class="audit-head"><strong>${esc(state.domains[review.domain].action)}</strong><span class="badge ${review.status === 'approved' ? 'execute' : review.status === 'pending' ? 'escalate' : 'refuse'}">${esc(title(review.status))}</span><time>Evidence v${review.resourceVersion}</time></div><p>${esc(original.result.reasons.join(' '))}</p><p class="mono">Proposal: ${esc(JSON.stringify(original.proposal))}</p>${review.status === 'pending' ? `<label class="field-label" for="actor-${review.id}">SANDBOX REVIEWER</label><select id="actor-${review.id}">${(state.reviewers ?? []).filter(actor => actor.domain === review.domain || !actor.domain).map(actor => `<option value="${esc(actor.id)}">${esc(actor.name)}</option>`).join('')}</select><label class="field-label" for="reason-${review.id}">REVIEW REASON</label><textarea id="reason-${review.id}" maxlength="600" rows="2" placeholder="Explain why this exact action should be approved or denied."></textarea><div class="review-actions"><button class="outline-button" data-review="${review.id}" data-verdict="approve">Approve within operator scope ↗</button><button class="text-button" data-review="${review.id}" data-verdict="deny">Deny this action</button></div>` : `<p>${esc(review.reviewerName)} · ${esc(review.note)}</p>${review.expiresAt ? `<p>Approval expires: ${esc(new Date(review.expiresAt).toLocaleString())}. Revocation and current evidence are checked before execution.</p>` : ''}${review.approvedDecisionId ? `<div class="review-actions"><button class="outline-button" data-record="${review.approvedDecisionId}">View reviewed decision ↗</button>${review.status === 'approved' ? `<button class="text-button" data-revoke="${review.id}" data-reviewer="${review.reviewerId}">Revoke this approval</button>` : ''}</div>` : ''}`}</article>`;
  }).join('') : '<div class="empty-table">No escalations yet. Evaluate a production deployment or a refund above $75 to create a review.</div>';
}
function renderStats() {
  $('#policy-version').textContent = state.policyVersion;
  $('#stat-evaluations').innerHTML = `${state.decisions.length} <small>recorded decisions</small>`;
  $('#stat-actions').innerHTML = `${state.effects.length} <small>within this sandbox</small>`;
  $('#stat-integrity').innerHTML = `${state.integrity.valid ? 'Verified' : 'Broken'} <small>SHA-256 chain</small>`;
  $('#ledger-count').textContent = state.integrity.count;
}
function renderRecent() {
  const rows = state.decisions.slice(0, 5);
  $('#recent-decisions').innerHTML = rows.length ? `<table class="recent-table"><thead><tr><th>PROPOSED ACTION</th><th>DECISION</th><th>RISK</th><th>RECORDED</th><th></th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(state.domains[row.domain].action)}</td><td><span class="badge ${row.result.decision}">${title(row.result.decision)}</span></td><td>${row.result.risk}/100</td><td>${new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td><button class="view-record" data-record="${esc(row.id)}">View ↗</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty-table">Your first decision will appear here. Every evaluation is saved to the ledger.</div>';
}
async function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== `page-${page}`; });
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  if (page === 'ledger') await renderAudit();
  if (page === 'review') renderReviews();
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function setDomain(next) {
  domain = next;
  document.querySelectorAll('[data-domain]').forEach(el => el.classList.toggle('selected', el.dataset.domain === domain));
  $('#agent-name').textContent = state.domains[domain].agent;
  $('#scenario').innerHTML = state.scenarios.filter(s => s.domain === domain).map(s => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
  $('#domain-field').innerHTML = domain === 'refund' ? '<label class="field-label" for="amount">REFUND AMOUNT / USD</label><input id="amount" type="number" min="0.01" max="100000" step="0.01" value="35">' : domain === 'deploy' ? '<label class="field-label" for="target">DEPLOYMENT TARGET</label><select id="target"><option value="staging">Staging</option><option value="production">Production</option></select>' : '<label class="field-label" for="role">REQUESTED ROLE</label><select id="role"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Administrator</option></select>';
}
async function loadScenario(id) {
  const scenario = state.scenarios.find(s => s.id === id);
  if (domain !== scenario.domain) setDomain(scenario.domain);
  $('#scenario').value = id;
  $('#scenario-description').textContent = scenario.description;
  run = await api('/api/runs', { scenarioId: id });
  record = effect = blocked = agentOutput = undefined;
  $('#request-note').value = run.proposal.note;
  if (domain === 'refund') $('#amount').value = run.proposal.amount;
  if (domain === 'deploy') $('#target').value = run.proposal.target;
  if (domain === 'access') $('#role').value = run.proposal.role;
  renderEvidence(); renderResult(); renderAgent(); await refresh();
}
function renderEvidence() {
  if (!run) return;
  $('#resource-version').textContent = `v${run.resource.version}`;
  $('#evidence-list').innerHTML = run.resource.evidence.map(e => `<div class="evidence-item"><span class="evidence-icon">${e.verified ? '✓' : '?'}</span><div><strong>${esc(e.label)}</strong><p>${esc(e.value)}</p></div></div>`).join('');
  const policy = state.domains[domain];
  $('#authority-scope').textContent = run.resource.scopeGranted ? policy.scope : 'Authority revoked';
  $('#authority-detail').textContent = domain === 'refund' ? `$75 per action · $${state.spent.toFixed(2)} / $150 used today (UTC)` : domain === 'deploy' ? 'Staging only · verified CI and rollback required' : 'Viewer only · active employee and owner approval required';
}
function proposal() {
  const note = $('#request-note').value;
  return domain === 'refund' ? { amount: Number($('#amount').value), note } : domain === 'deploy' ? { target: $('#target').value, note } : { role: $('#role').value, note };
}
function renderResult() {
  if (!record) {
    $('#decision-result').innerHTML = '<div class="empty-result"><div class="orb"><span>◇</span></div><h3>Permission is earned.</h3><p>Evaluate a proposal to reveal the decision,<br>the evidence behind it, and the next step.</p><div class="outcome-key"><span class="execute">Execute</span><span class="ask">Ask</span><span class="defer">Defer</span><span class="escalate">Escalate</span><span class="refuse">Refuse</span></div></div>';
    return;
  }
  const r = blocked?.result ?? record.result;
  $('#decision-result').innerHTML = `<div class="result-heading"><h2 class="decision-word ${r.decision}">${title(r.decision)}</h2><span class="result-id">${esc(record.id.slice(0, 8))}<br>POLICY ${esc(r.policyVersion)}</span></div><p class="result-reason">${r.reasons.map(esc).join('<br>')}</p><div class="metrics"><div class="metric"><small>EVIDENCE CONFIDENCE</small><strong>${Math.round(r.confidence * 100)}<span class="muted">%</span></strong></div><div class="metric"><small>RISK SCORE</small><strong>${r.risk}<span class="muted"> / 100</span></strong></div><div class="metric"><small>REVERSIBILITY</small><strong class="text-metric">${r.reversible ? 'Reversible' : 'Irreversible'}</strong></div></div><div class="reasoning-title">THE DECISION TRACE</div>${r.trace.map(item => `<div class="trace-item"><span class="trace-symbol ${item.status}">${item.status === 'pass' ? '✓' : item.status === 'fail' ? '×' : '↳'}</span><div><strong>${esc(item.rule)}</strong><p>${esc(item.detail)}</p></div></div>`).join('')}<details class="detail-toggle"><summary>Risk components & cost of error</summary><p>${r.riskFactors.map(f => `${esc(f.label)}: +${f.points}`).join('<br>')}<br><br>${esc(r.costOfError)}<br>Confidence is an evidence-quality heuristic, not a calibrated probability.</p></details><div class="next-step"><strong>NEXT STEP</strong>${esc(r.nextStep)}</div>${blocked ? `<div class="effect-box blocked-box"><strong>Execution blocked.</strong><br>${esc(blocked.reason)}<br>Current decision: ${esc(blocked.currentDecision)} · evidence v${blocked.originalVersion} → v${blocked.currentVersion}<br>No sandbox action was applied.</div>` : ''}${effect ? `<div class="effect-box"><strong>Action applied.</strong><br>${esc(effect.description)}<br>Receipt: ${esc(effect.id.slice(0, 8))}</div>` : ''}${r.decision === 'execute' && !effect && !blocked ? '<button id="execute-action" class="primary-button">Execute in sandbox <span>↗</span></button><p class="micro-copy">Current evidence, budget, and authority are rechecked before the write.</p><button id="change-evidence" class="text-button detail-toggle">Revoke authority before execution ↗</button>' : ''}`;
  if (!effect && !blocked && record.resolutionOptions?.length) $('#decision-result').insertAdjacentHTML('beforeend', `<div class="resolution-box"><strong>RESOLVE THE NEXT STEP</strong><p>These controls update synthetic source records and create a new evaluation. They preserve known failures.</p>${record.resolutionOptions.map(option => `<button class="outline-button" data-resolution="${esc(option.id)}">${esc(option.label)} ↗</button>`).join('')}</div>`);
  if (r.decision === 'escalate') $('#decision-result').insertAdjacentHTML('beforeend', '<button class="outline-button" data-page="review">Open operator inbox ↗</button>');
  if (record.reviewId) $('#decision-result').insertAdjacentHTML('beforeend', '<p class="micro-copy">This decision uses a scoped operator approval. Revocation and expiry are checked again before execution.</p>');
  if (blocked) $('#decision-result').insertAdjacentHTML('afterbegin', `<p class="micro-copy">Original evaluation: ${esc(title(record.result.decision))}. The decision below reflects the execution-time recheck.</p>`);
}
async function execute() {
  const result = await api('/api/execute', { decisionId: record.id });
  effect = result.effect; blocked = result.blocked;
  await refresh(); renderEvidence(); renderResult();
  toast(blocked ? 'Execution blocked. The evidence no longer supports the original decision.' : result.replay ? 'Existing receipt returned. The action was not repeated.' : 'Action applied to the sandbox. Receipt saved.', Boolean(blocked));
}
async function generateAgent() {
  record = effect = blocked = agentOutput = undefined;
  renderResult(); renderAgent();
  $('#generate-agent').textContent = 'AI is proposing…';
  const output = await api('/api/agent/propose', { resourceId: run.resource.id, request: $('#request-note').value });
  agentOutput = output;
  if (output.kind === 'proposal') {
    record = output.record;
    if (domain === 'refund') $('#amount').value = output.proposal.amount;
    if (domain === 'deploy') $('#target').value = output.proposal.target;
    if (domain === 'access') $('#role').value = output.proposal.role;
  }
  await refresh(); renderEvidence(); renderAgent(); renderResult();
  toast(output.kind === 'clarification' ? 'The AI needs a specific clarification before proposing an action.' : `AI proposal evaluated: ${output.record.result.decision}. No action has been executed.`);
}
async function failureTest() {
  await showPage('lab'); setDomain('deploy'); await loadScenario('deploy-safe');
  record = await api('/api/evaluate', { resourceId: run.resource.id, proposal: proposal() });
  if (record.result.decision !== 'execute') throw new Error('Failure setup did not authorize execution.');
  run.resource = await api('/api/fault', { resourceId: run.resource.id, type: 'ci-failed' });
  await execute();
  if (!blocked || effect) throw new Error('Failure test did not contain the action.');
  toast('Failure test passed: CI changed after approval. The deployment was blocked and audited.');
  $('#decision-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function renderAudit() {
  const result = await api('/api/audit');
  $('#integrity-note').textContent = `${result.integrity.valid ? '✓ Chain verified' : '× Chain broken'} · ${result.integrity.count} events · head ${result.integrity.head ?? 'invalid'}. This verifies chain consistency, not independent authenticity.`;
  const filter = $('#audit-filter').value;
  const events = result.events.filter(e => filter === 'all' || e.payload.type === filter).reverse();
  $('#audit-events').innerHTML = events.length ? events.map(event => {
    const data = event.payload.data;
    const label = { 'run.created': 'Run created', 'decision.evaluated': 'Decision evaluated', 'action.executed': 'Action applied', 'execution.blocked': 'Execution blocked', 'evidence.changed': 'Evidence changed', 'evidence.resolved': 'Evidence resolved', 'review.requested': 'Review requested', 'review.approved': 'Review approved', 'review.denied': 'Review denied', 'review.revoked': 'Review revoked', 'agent.requested': 'AI request started', 'agent.clarification': 'AI clarification', 'agent.failed': 'AI request failed' }[event.payload.type] ?? event.payload.type;
    const decision = data.result?.decision ?? data.currentDecision;
    return `<article class="audit-card"><div class="audit-head"><span class="mono">#${event.id}</span><strong>${esc(label)}</strong>${decision ? `<span class="badge ${esc(decision)}">${esc(title(decision))}</span>` : ''}<time>${new Date(event.payload.at).toLocaleString()}</time></div><p>${esc(data.description ?? data.reason ?? data.note ?? data.result?.reasons.join(' ') ?? data.question ?? data.message ?? data.request ?? (data.scenarioId ? `Scenario: ${data.scenarioId}` : data.type ? `Evidence update: ${data.type}` : data.resourceVersion ? `Review bound to evidence v${data.resourceVersion}.` : 'Inspect full record for details.'))}</p><details><summary class="detail-toggle">Inspect full record</summary><pre>${esc(JSON.stringify(event.payload, null, 2))}</pre></details><div class="audit-hash">SHA-256 ${esc(event.hash)}</div></article>`;
  }).join('') : '<div class="empty-table">No events match this filter.</div>';
  return result;
}

document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button || pending) return;
  if (button.dataset.page) return perform(() => showPage(button.dataset.page));
  if (button.dataset.resolution) return perform(async () => {
    record = await api('/api/resolve', { decisionId: record.id, type: button.dataset.resolution });
    run.resource = record.resourceSnapshot; effect = blocked = undefined;
    await refresh(); renderEvidence(); renderResult(); toast(`Synthetic evidence resolved. New decision: ${record.result.decision}.`);
  });
  if (button.dataset.review) return perform(async () => {
    const id = button.dataset.review;
    const result = await api('/api/review', { reviewId: id, reviewerId: $(`#actor-${id}`).value, verdict: button.dataset.verdict, note: $(`#reason-${id}`).value });
    await refresh();
    if (result.record) toast('Scoped approval saved. Open the reviewed decision to execute separately.');
    else toast('Action denied. No execution authority was granted.');
  });
  if (button.dataset.revoke) return perform(async () => { await api('/api/review/revoke', { reviewId: button.dataset.revoke, reviewerId: button.dataset.reviewer }); await refresh(); toast('Approval revoked. Any pending execution using it will be blocked.'); });
  if (button.dataset.domain) return perform(async () => { setDomain(button.dataset.domain); await loadScenario(state.scenarios.find(s => s.domain === domain).id); });
  if (button.dataset.record) return perform(async () => {
    const saved = state.decisions.find(row => row.id === button.dataset.record);
    setDomain(saved.domain); $('#scenario').value = saved.resourceSnapshot.scenarioId;
    $('#scenario-description').textContent = 'Viewing a saved evaluation. Its input and evidence snapshot are shown below.';
    run = { resource: saved.resourceSnapshot, proposal: saved.proposal }; record = saved;
    $('#request-note').value = saved.proposal.note;
    if (saved.domain === 'refund') $('#amount').value = saved.proposal.amount;
    if (saved.domain === 'deploy') $('#target').value = saved.proposal.target;
    if (saved.domain === 'access') $('#role').value = saved.proposal.role;
    effect = state.effects.find(e => e.decisionId === saved.id); blocked = undefined;
    agentOutput = saved.agent ? { ...saved.agent, kind: 'proposal' } : undefined;
    renderEvidence(); renderResult(); renderAgent(); await showPage('lab'); $('#decision-result').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  if (button.id === 'generate-agent') return perform(generateAgent);
  if (button.id === 'evaluate') return perform(async () => { record = await api('/api/evaluate', { resourceId: run.resource.id, proposal: proposal() }); effect = blocked = undefined; await refresh(); renderEvidence(); renderResult(); });
  if (button.id === 'execute-action') return perform(execute);
  if (button.id === 'change-evidence') return perform(async () => { run.resource = await api('/api/fault', { resourceId: run.resource.id, type: 'revoke' }); await refresh(); renderEvidence(); toast('Authority revoked. Try executing the original decision to see the gate catch it.'); });
  if (button.id === 'failure-test') return perform(failureTest);
  if (button.id === 'new-sandbox') return perform(async () => { await api('/api/new-sandbox', {}); await refresh(); setDomain('refund'); await loadScenario('refund-safe'); await showPage('lab'); toast('Fresh sandbox ready. Previous records remain stored.'); });
  if (button.id === 'verify-audit') return perform(async () => { const result = await renderAudit(); toast(result.integrity.valid ? 'Audit chain verified.' : 'Audit chain is broken.', !result.integrity.valid); });
  if (button.id === 'export-audit') return perform(async () => {
    const audit = await api('/api/audit');
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), policyVersion: state.policyVersion, ...audit }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'threshold-audit.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
});
$('#scenario').addEventListener('change', () => perform(() => loadScenario($('#scenario').value)));
$('#audit-filter').addEventListener('change', () => perform(renderAudit));
// Editing a proposal invalidates its visible execution control. The server also binds
// execution to the stored proposal, so the browser cannot alter an approved payload.
document.addEventListener('input', event => {
    if (['request-note', 'amount', 'target', 'role'].includes(event.target.id)) { record = effect = blocked = agentOutput = undefined; renderResult(); renderAgent(); }
});
await perform(async () => { await refresh(); setDomain('refund'); await loadScenario('refund-safe'); });
