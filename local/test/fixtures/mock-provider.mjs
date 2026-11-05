// Test-only preload. No production switch or real credential is required.
globalThis.fetch = async (url, options) => {
  if (url !== 'https://api.cerebras.ai/v1/chat/completions' || new Headers(options.headers).get('Authorization') !== 'Bearer csk-synthetic-unit-key-123456789') throw new Error('Unexpected provider request; real network access blocked by the test.');
  const body = JSON.parse(options.body);
  const envelope = JSON.parse(body.messages[1].content);
  const request = envelope.requestText;
  if (request.includes('[slow]')) await new Promise(resolve => setTimeout(resolve, 150));
  if (request.includes('[provider-fail]')) return new Response('unit-test-secret upstream error', { status: 401 });
  if (request.includes('[client-blocked]')) return new Response(JSON.stringify({ error: { message: 'unauthorized client detected; unit-test-secret' }, type: 'unauthorized_client_error' }), { status: 401 });
  const domain = envelope.recordContext.domain;
  const proposal = domain === 'refund' ? { amount: 35, note: 'Refund $35.' } : domain === 'deploy' ? { target: 'staging', note: 'Deploy to staging.' } : { role: 'admin', note: 'Grant admin access.' };
  const output = request.includes('[clarify]') ? { kind: 'clarification', question: 'How much should be refunded?', explanation: 'No amount was specified.' } : { kind: 'proposal', proposal, explanation: 'A mocked model proposed the requested action.' };
  if (request.includes('[forged]')) output.proposal.approved = true;
  return new Response(JSON.stringify({model:'qwen-3.8-27b',choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:800,completion_tokens:120}}));
};
