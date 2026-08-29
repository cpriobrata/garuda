const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
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

test('the build writes every copy of the widget that customers are served', async () => {
  const build = await import(pathToFileURL(resolve(__dirname, '..', 'scripts', 'build.mjs')).href);
  const source = readFileSync(build.sourcePath, 'utf8');
  const packageJSON = JSON.parse(readFileSync(build.packagePath, 'utf8'));
  const expected = build.renderWidget(source, packageJSON.version);
  const asPosix = (value) => value.replaceAll('\\', '/');

  const servedByTheAPI = build.outputPaths.filter(
    (outputPath) => asPosix(outputPath).endsWith('/backend/internal/api/assets/widget.js')
  );
  assert.equal(
    servedByTheAPI.length,
    1,
    'the Go binary embeds assets/widget.js and serves it at /widget.js, so the build has to write it'
  );
  const packaged = build.outputPaths.filter(
    (outputPath) => asPosix(outputPath).endsWith('/widget/dist/v1.js')
  );
  assert.equal(packaged.length, 1, 'the demo page and the npm package still read dist/v1.js');

  for (const outputPath of build.outputPaths) {
    assert.equal(
      readFileSync(outputPath, 'utf8'),
      expected,
      asPosix(outputPath) + ' has drifted from src/v1.js. Run npm run build.'
    );
  }
});

test('re-running the embed snippet does not mount a second widget', () => {
  const loaderScript = (agentKey) => {
    const attributes = { 'data-agent-key': agentKey, 'data-mode': 'demo' };
    const owns = (name) => Object.prototype.hasOwnProperty.call(attributes, name);
    return {
      getAttribute(name) { return owns(name) ? attributes[name] : null; },
      hasAttribute(name) { return owns(name); },
      setAttribute(name, value) { attributes[name] = String(value); }
    };
  };

  const hadDocument = 'document' in global;
  const originalDocument = global.document;
  const originalMounts = global.garudaWidgetMounts;
  const originalMount = widget.GarudaWidget.prototype.mount;
  const mounted = [];
  widget.GarudaWidget.prototype.mount = function stubbedMount() { mounted.push(this); };
  const documentStub = {
    currentScript: loaderScript('pub_live_bootAgent'),
    querySelectorAll() { return []; }
  };
  global.document = documentStub;
  delete global.garudaWidgetMounts;

  try {
    widget.boot();
    widget.boot();
    assert.equal(mounted.length, 1, 'the same script tag must only boot once');

    documentStub.currentScript = loaderScript('pub_live_bootAgent');
    widget.boot();
    assert.equal(
      mounted.length,
      1,
      'a single page application that re-injects the snippet must not stack a second widget'
    );

    documentStub.currentScript = loaderScript('pub_live_secondAgent');
    widget.boot();
    assert.equal(mounted.length, 2, 'a different agent on the same page still gets its own widget');

    mounted[0].nodes = { host: { isConnected: false } };
    documentStub.currentScript = loaderScript('pub_live_bootAgent');
    widget.boot();
    assert.equal(mounted.length, 3, 'a widget removed with the page can mount again');
  } finally {
    widget.GarudaWidget.prototype.mount = originalMount;
    if (originalMounts === undefined) delete global.garudaWidgetMounts;
    else global.garudaWidgetMounts = originalMounts;
    if (hadDocument) global.document = originalDocument;
    else delete global.document;
  }
});

test('a stream that stalls after the headers times out instead of wedging the widget', async () => {
  const realSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const originalFetch = global.fetch;
  const timers = new Map();
  const delays = [];
  let nextTimerID = 1;
  global.setTimeout = (callback, delay) => {
    const timerID = nextTimerID;
    nextTimerID += 1;
    timers.set(timerID, callback);
    delays.push(delay);
    return timerID;
  };
  global.clearTimeout = (timerID) => { timers.delete(timerID); };

  const encoder = new TextEncoder();
  global.fetch = async (_url, options) => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: message.start\ndata: {"message_id":"m1"}\n\n'));
        controller.enqueue(encoder.encode('event: delta\ndata: {"text":"Half a sen"}\n\n'));
        // The stream then goes quiet forever, the way a dropped upstream does.
        options.signal.addEventListener('abort', () => {
          controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }
    });
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    });
  };

  try {
    const api = new widget.LiveAPI({
      apiOrigin: 'https://api.garuda.example',
      agentKey: 'pub_live_testAgent'
    });
    let received = '';
    const pending = api.sendMessage(
      { sessionID: 'session-1', sessionToken: 'short-lived-token' },
      { clientMessageID: 'client-1', content: 'Hello' },
      { onStart() {}, onDelta(piece) { received += piece; }, onLead() {}, onDone() {} }
    );
    await new Promise((done) => realSetTimeout(done, 20));

    assert.equal(received, 'Half a sen', 'the deltas that did arrive are still delivered');
    assert.equal(timers.size, 1, 'the stalled stream has to stay under an inactivity timer');
    assert.equal(delays[delays.length - 1], 30000, 'each chunk restarts the inactivity timer');

    for (const fire of Array.from(timers.values())) fire();

    const bounded = Promise.race([
      pending,
      new Promise((_done, fail) => {
        realSetTimeout(() => fail(new Error('the widget never gave up on the stalled stream')), 2000);
      })
    ]);
    await assert.rejects(bounded, (error) => {
      assert.equal(error.code, 'stream_timeout');
      assert.equal(error.message, 'The assistant stopped responding. Please try again.');
      return true;
    });
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.fetch = originalFetch;
  }
});

test('the non-modal panel lets Tab leave and still closes on Escape', () => {
  const focused = [];
  const focusable = [
    { hidden: false, offsetParent: {}, focus() { focused.push('first'); } },
    { hidden: false, offsetParent: {}, focus() { focused.push('last'); } }
  ];
  const panel = {
    querySelectorAll() { return focusable; },
    getRootNode() { return { activeElement: focusable[focusable.length - 1] }; }
  };
  const openStates = [];
  const instance = Object.create(widget.GarudaWidget.prototype);
  instance.nodes = { panel };
  instance.setOpen = function setOpen(next) { openStates.push(next); };

  let tabPrevented = false;
  instance.handlePanelKeys({ key: 'Tab', shiftKey: false, preventDefault() { tabPrevented = true; } });
  assert.equal(tabPrevented, false, 'a dialog that reports aria-modal="false" must let Tab out');
  assert.deepEqual(focused, [], 'focus is not pulled back to the top of the panel');

  let shiftTabPrevented = false;
  instance.handlePanelKeys({ key: 'Tab', shiftKey: true, preventDefault() { shiftTabPrevented = true; } });
  assert.equal(shiftTabPrevented, false);
  assert.deepEqual(focused, []);

  let escapePrevented = false;
  instance.handlePanelKeys({ key: 'Escape', preventDefault() { escapePrevented = true; } });
  assert.equal(escapePrevented, true);
  assert.deepEqual(openStates, [false], 'Escape still closes the panel');

  const source = readFileSync(resolve(__dirname, '..', 'src', 'v1.js'), 'utf8');
  assert.match(
    source,
    /setAttribute\('aria-modal', 'false'\)/,
    'the panel claims to be non-modal; making it modal means revisiting focus handling'
  );
});
