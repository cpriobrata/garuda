const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const widget = require('../src/v1.js');

test('accepts publishable agent keys and rejects IDs or malformed values', () => {
  assert.equal(widget.validateAgentKey('pub_live_W0wYk_29TestKey'), true);
  assert.equal(widget.validateAgentKey('pub_demo_garuda'), true);
  assert.equal(widget.validateAgentKey('agent_550e8400-e29b-41d4-a716-446655440000'), false);
  assert.equal(widget.validateAgentKey('../../v1/me'), false);
  assert.equal(widget.validateAgentKey(''), false);
});

test('normalizes only public presentation settings', () => {
  const normalized = widget.normalizeAgentPayload({
    data: {
      display_name: '<img src=x onerror=alert(1)>',
      welcome_message: '<b>Hello</b>',
      suggested_prompts: ['First', 42, 'Second'],
      accent_color: 'red; position: fixed',
      position: 'somewhere',
      privacy_url: 'javascript:alert(1)',
      memory_enabled: true,
      lead_capture_enabled: true,
      lead_capture_fields: ['name', 'email', 'secret_internal_id']
    }
  });

  assert.equal(normalized.displayName, '<img src=x onerror=alert(1)>');
  assert.equal(normalized.welcomeMessage, '<b>Hello</b>');
  assert.deepEqual(normalized.suggestedPrompts, ['First', 'Second']);
  assert.equal(normalized.accentColor, '#4F46E5');
  assert.equal(normalized.position, 'bottom_right');
  assert.equal(normalized.privacyUrl, '');
  assert.deepEqual(normalized.leadFields, ['name', 'email']);
});

test('preserves whitespace in streamed deltas', () => {
  assert.equal(widget.streamText('Hello ', 100), 'Hello ');
  assert.equal(widget.streamText(' world', 100), ' world');
  assert.equal(widget.streamText('safe\u0000text', 100), 'safetext');
});

test('parses canonical and compact SSE event names across chunks', () => {
  const events = [];
  const parser = widget.createSSEParser((event) => events.push(event));
  parser.push('event: message.start\ndata: {"message_id":"m1"}\n\nevent: del');
  parser.push('ta\ndata: {"text":"Hello "}\r\n\r\nevent: message.delta\ndata: {"text":"there"}\n\n');
  parser.push('event: done\ndata: {"lead_capture_requested":true}\n\n');
  parser.finish();

  assert.equal(events.length, 4);
  assert.equal(events[0].event, 'message.start');
  assert.equal(events[1].event, 'delta');
  assert.equal(events[1].data.text, 'Hello ');
  assert.equal(events[2].event, 'message.delta');
  assert.equal(events[3].data.lead_capture_requested, true);
});

test('validates session material and caps restored history', () => {
  const messages = Array.from({ length: 60 }, (_, index) => ({
    id: 'm' + index,
    role: index % 2 ? 'user' : 'assistant',
    content: 'Message ' + index
  }));
  const session = widget.normalizeSessionPayload({
    data: {
      session_id: 'session-1',
      session_token: 'signed-session-token',
      visitor_token: '1234567890abcdef1234567890abcdef',
      conversation: { id: 'conversation-1', resumed: true, messages },
      agent: { display_name: 'Mira' }
    }
  });
  assert.equal(session.conversation.messages.length, 50);
  assert.equal(session.conversation.messages[0].content, 'Message 10');
  assert.equal(session.agent.displayName, 'Mira');
  assert.throws(() => widget.normalizeSessionPayload({ data: {} }), /invalid session/i);
});

test('visitor storage is scoped to the publishable agent key', () => {
  assert.equal(
    widget.storageKey('visitor', 'pub_live_agentA'),
    'garuda:v1:visitor:pub_live_agentA'
  );
  assert.notEqual(
    widget.storageKey('visitor', 'pub_live_agentA'),
    widget.storageKey('visitor', 'pub_live_agentB')
  );
});

test('declining memory removes the visitor identity and demo history for that agent only', () => {
  const values = new Map([
    ['garuda:v1:visitor:pub_live_agentA', 'visitor-a'],
    ['garuda:v1:demo-history:pub_live_agentA', '[{"role":"user"}]'],
    ['garuda:v1:visitor:pub_live_agentB', 'visitor-b']
  ]);
  const storage = {
    removeItem(key) { values.delete(key); }
  };

  widget.clearVisitorMemory(storage, 'pub_live_agentA');

  assert.equal(values.has('garuda:v1:visitor:pub_live_agentA'), false);
  assert.equal(values.has('garuda:v1:demo-history:pub_live_agentA'), false);
  assert.equal(values.get('garuda:v1:visitor:pub_live_agentB'), 'visitor-b');
});

test('live API uses canonical public routes and keeps session credentials in headers', async () => {
  const originalFetch = global.fetch;
  const originalLocation = global.location;
  const originalDocument = global.document;
  const calls = [];
  global.location = { href: 'https://customer.example/products' };
  global.document = {
    title: 'Products',
    referrer: 'https://search.example/'
  };
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/widget/v1/sessions')) {
      return new Response(JSON.stringify({
        data: {
          session_id: 'session-1',
          session_token: 'short-lived-token',
          expires_at: '2026-08-29T11:00:00Z',
          visitor_token: '1234567890abcdef1234567890abcdef',
          conversation: { id: 'session-1', resumed: false, messages: [] },
          agent: { display_name: 'Mira' }
        }
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/leads')) {
      return new Response(JSON.stringify({
        data: { lead_id: 'lead-1', status: 'new' }
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error('Unexpected route: ' + url);
  };

  try {
    const api = new widget.LiveAPI({
      apiOrigin: 'https://api.garuda.example',
      agentKey: 'pub_live_testAgent'
    });
    const session = await api.createSession({
      memory: true,
      analytics: false,
      visitorToken: '1234567890abcdef1234567890abcdef'
    });
    await api.captureLead(session, {
      clientCaptureID: 'capture-1',
      fields: { email: 'visitor@example.com' }
    });

    const bootstrapBody = JSON.parse(calls[0].options.body);
    assert.equal(calls[0].url, 'https://api.garuda.example/widget/v1/sessions');
    assert.equal(bootstrapBody.agent_key, 'pub_live_testAgent');
    assert.equal(bootstrapBody.consent.memory, true);
    assert.equal('organization_id' in bootstrapBody, false);
    assert.equal('tenant_id' in bootstrapBody, false);

    const leadBody = JSON.parse(calls[1].options.body);
    assert.equal(calls[1].url, 'https://api.garuda.example/widget/v1/sessions/session-1/leads');
    assert.equal(calls[1].options.headers['X-Garuda-Session-Token'], 'short-lived-token');
    assert.deepEqual(leadBody.fields, { email: 'visitor@example.com' });
    assert.equal(leadBody.consent.granted, true);
  } finally {
    global.fetch = originalFetch;
    if (originalLocation === undefined) delete global.location;
    else global.location = originalLocation;
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
  }
});

test('message requests allow the backend provider budget without slowing setup calls', async () => {
  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const delays = [];
  global.setTimeout = (_callback, delay) => { delays.push(delay); return delays.length; };
  global.clearTimeout = () => {};
  global.fetch = async () => new Response(JSON.stringify({
    data: {
      assistant_message: { id: 'message-1', role: 'assistant', content: 'Hello' },
      lead_capture_requested: false
    }
  }), { status: 201, headers: { 'Content-Type': 'application/json' } });

  try {
    const api = new widget.LiveAPI({
      apiOrigin: 'https://api.garuda.example',
      agentKey: 'pub_live_testAgent'
    });
    await api.sendMessage(
      { sessionID: 'session-1', sessionToken: 'short-lived-token' },
      { clientMessageID: 'client-1', content: 'Hello' },
      { onStart() {}, onDelta() {}, onLead() {}, onDone() {} }
    );
    assert.deepEqual(delays, [60000]);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('source does not use HTML injection sinks or dynamic code execution', () => {
  const source = readFileSync(resolve(__dirname, '..', 'src', 'v1.js'), 'utf8');
  assert.doesNotMatch(source, /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML\b|document\.write\b/);
  assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\s*\(/);
});
