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

// ---------------------------------------------------------------------------
// Rendering tests.
//
// The widget draws into a shadow root, and neither this package nor the service
// it ships with carries a third-party dependency, so there is no jsdom to lend
// these tests a document. The stub below is the smallest DOM the widget itself
// touches: elements, classes, attributes, text, listeners and a shadow root.
// ---------------------------------------------------------------------------

function createNode(tagName, namespace) {
  const node = {
    tagName: String(tagName).toLowerCase(),
    namespace: namespace || 'html',
    childNodes: [],
    parentNode: null,
    attributes: new Map(),
    handlers: new Map(),
    hidden: false,
    disabled: false,
    required: false,
    checked: false,
    value: '',
    scrollHeight: 0,
    isConnected: true,
    focusCount: 0,
    style: {
      properties: new Map(),
      setProperty(name, value) { this.properties.set(name, String(value)); },
      getPropertyValue(name) { return this.properties.has(name) ? this.properties.get(name) : ''; }
    }
  };

  const classes = new Set();
  Object.defineProperty(node, 'className', {
    get() { return Array.from(classes).join(' '); },
    set(value) {
      classes.clear();
      String(value).split(/\s+/).filter(Boolean).forEach((name) => classes.add(name));
    }
  });
  node.classList = {
    add(name) { classes.add(name); },
    remove(name) { classes.delete(name); },
    contains(name) { return classes.has(name); },
    toggle(name, force) {
      const next = force === undefined ? !classes.has(name) : Boolean(force);
      if (next) classes.add(name);
      else classes.delete(name);
      return next;
    }
  };

  let ownText = '';
  Object.defineProperty(node, 'textContent', {
    get() {
      return ownText + node.childNodes.map((child) => child.textContent).join('');
    },
    set(value) {
      node.childNodes.forEach((child) => { child.parentNode = null; });
      node.childNodes = [];
      ownText = value === null || value === undefined ? '' : String(value);
    }
  });

  node.appendChild = (child) => {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = node;
    node.childNodes.push(child);
    return child;
  };
  node.removeChild = (child) => {
    node.childNodes = node.childNodes.filter((candidate) => candidate !== child);
    child.parentNode = null;
    return child;
  };
  node.remove = () => { if (node.parentNode) node.parentNode.removeChild(node); };
  node.replaceChildren = (...children) => {
    node.childNodes.forEach((child) => { child.parentNode = null; });
    node.childNodes = [];
    ownText = '';
    children.forEach(node.appendChild);
  };
  node.setAttribute = (name, value) => { node.attributes.set(name, String(value)); };
  node.getAttribute = (name) => (node.attributes.has(name) ? node.attributes.get(name) : null);
  node.hasAttribute = (name) => node.attributes.has(name);
  node.removeAttribute = (name) => { node.attributes.delete(name); };
  node.addEventListener = (type, handler) => {
    if (!node.handlers.has(type)) node.handlers.set(type, []);
    node.handlers.get(type).push(handler);
  };
  node.removeEventListener = (type, handler) => {
    node.handlers.set(type, (node.handlers.get(type) || []).filter((candidate) => candidate !== handler));
  };
  node.focus = () => { node.focusCount += 1; };
  node.scrollTo = () => {};
  node.attachShadow = () => {
    node.shadowRoot = createNode('#shadow');
    return node.shadowRoot;
  };
  node.querySelector = (selector) => queryAll(node, selector)[0] || null;
  node.querySelectorAll = (selector) => queryAll(node, selector);
  return node;
}

function matchesSelector(node, selector) {
  return selector.split(',').map((part) => part.trim()).filter(Boolean).some((part) => {
    if (part.startsWith('.')) return node.classList.contains(part.slice(1));
    if (part.startsWith('[')) return node.hasAttribute(part.slice(1, -1));
    return node.tagName === part.toLowerCase();
  });
}

function queryAll(node, selector) {
  const found = [];
  node.childNodes.forEach((child) => {
    if (matchesSelector(child, selector)) found.push(child);
    queryAll(child, selector).forEach((descendant) => found.push(descendant));
  });
  return found;
}

function dispatch(node, type, extra) {
  const handlers = (node.handlers.get(type) || []).slice();
  const event = Object.assign({
    type,
    target: node,
    preventDefault() {},
    stopPropagation() {}
  }, extra || {});
  return Promise.all(handlers.map((handler) => handler.call(node, event)));
}

function installFakeBrowser(fetchStub) {
  const saved = {
    document: global.document,
    hadDocument: 'document' in global,
    fetch: global.fetch,
    addEventListener: global.addEventListener,
    requestAnimationFrame: global.requestAnimationFrame,
    location: global.location,
    hadLocation: 'location' in global
  };
  const documentStub = {
    title: 'Customer page',
    referrer: '',
    createElement: (tagName) => createNode(tagName),
    createElementNS: (namespace, tagName) => createNode(tagName, namespace),
    addEventListener() {},
    querySelectorAll() { return []; },
    currentScript: null
  };
  documentStub.body = createNode('body');
  global.document = documentStub;
  global.addEventListener = () => {};
  global.requestAnimationFrame = () => 0;
  global.location = { href: 'https://customer.example/pricing' };
  if (fetchStub) global.fetch = fetchStub;
  return {
    document: documentStub,
    restore() {
      if (saved.hadDocument) global.document = saved.document;
      else delete global.document;
      if (saved.hadLocation) global.location = saved.location;
      else delete global.location;
      global.fetch = saved.fetch;
      global.addEventListener = saved.addEventListener;
      global.requestAnimationFrame = saved.requestAnimationFrame;
    }
  };
}

// Mounts one widget against the stub DOM and hands it the bootstrap payload the
// server sends, normalized exactly as a live bootstrap would be.
function renderWidget(payload, options) {
  options = options || {};
  const browser = installFakeBrowser(options.fetch);
  const instance = new widget.GarudaWidget({
    agentKey: 'pub_live_renderAgent',
    mode: 'live',
    apiOrigin: 'https://api.garuda.example',
    memorySetting: 'false',
    analytics: false,
    launcherLabel: '',
    startOpen: false,
    zIndex: 2147482000
  });
  instance.createUI();
  // A session already in hand keeps these tests on the rendering path rather
  // than the bootstrap path, which has its own tests above.
  instance.agentLoaded = true;
  instance.session = options.session === null
    ? null
    : { sessionID: 'session-1', sessionToken: 'short-lived-token' };
  instance.applyAgent(widget.normalizeAgentPayload(payload));
  // An open panel holds a polling interval, and a live interval keeps the test
  // runner from ever exiting. Teardown stops it whether the test opened the
  // panel or not.
  const restore = () => { instance.stopPolling(); browser.restore(); };
  return { instance, nodes: instance.nodes, browser, restore };
}

function leadFieldGroups(instance) {
  return instance.nodes.leadRegion.querySelectorAll('.gw-field').map((group) => ({
    group,
    label: group.querySelector('label'),
    control: group.querySelector('input,select,textarea'),
    error: group.querySelector('.gw-field-error')
  }));
}

test('a bootstrap with none of the new keys still resolves to the widget deployed today', () => {
  const agent = widget.normalizeAgentPayload({
    display_name: 'Northstar',
    accent_color: '#F97316',
    primary_color: '#111827',
    position: 'bottom_right',
    lead_capture_enabled: true,
    lead_capture_fields: ['name', 'email', 'phone']
  });

  assert.equal(agent.tagline, '');
  assert.equal(agent.logoUrl, '');
  assert.equal(agent.theme, '');
  assert.equal(agent.accentColor, '#F97316', 'the colour the widget paints with today is untouched');
  assert.deepEqual(agent.colors, {
    primary: '#111827',
    accent: '#F97316',
    background: '#FFFFFF',
    surface: '#F3F4F6',
    text: '#111827',
    onPrimary: '#FFFFFF',
    onAccent: '#FFFFFF'
  });
  assert.equal(agent.toggles.chat, true, 'chat has to stay on for every agent that predates the switches');
  Object.keys(agent.toggles).filter((name) => name !== 'chat').forEach((name) => {
    assert.equal(agent.toggles[name], false, name + ' defaults off');
  });
  assert.equal(agent.leadForm.fromServer, false);
  assert.deepEqual(
    agent.leadForm.fields.map((field) => field.id + ':' + field.type + ':' + field.label),
    ['name:text:Name', 'email:email:Email', 'phone:telephone:Phone']
  );
});

test('an absent toggle object is not a set of false toggles', () => {
  assert.equal(widget.normalizeToggles(undefined).chat, true);
  assert.equal(widget.normalizeToggles(null).chat, true);
  assert.equal(widget.normalizeToggles({ chat: null }).chat, true, 'null means the customer never chose');
  assert.equal(widget.normalizeToggles({ chat: false }).chat, false);
  assert.equal(widget.normalizeToggles({ chat: 'false' }).chat, true, 'only a real boolean is a choice');
  const both = widget.normalizeToggles({ autostart: true, show_lead_form: true });
  assert.equal(both.showLeadForm, true);
  assert.equal(both.autostart, false, 'autostart and show_lead_form are mutually exclusive');
});

test('the widget consumes resolved colours and carries no theme table of its own', () => {
  const rendered = renderWidget({
    display_name: 'Nova',
    theme: 'ocean_blue',
    accent_color: '#F97316',
    theme_colors: {
      primary: '#0F4C81',
      accent: '#2E8BC0',
      background: '#FFFFFF',
      surface: '#EEF4FA',
      text: '#0F1D2B',
      on_primary: '#FFFFFF',
      on_accent: '#FFFFFF'
    }
  });
  try {
    const style = rendered.nodes.host.style;
    assert.equal(style.getPropertyValue('--garuda-primary'), '#0F4C81');
    assert.equal(style.getPropertyValue('--garuda-accent'), '#2E8BC0');
    assert.equal(style.getPropertyValue('--garuda-background'), '#FFFFFF');
    assert.equal(style.getPropertyValue('--garuda-surface'), '#EEF4FA');
    assert.equal(style.getPropertyValue('--garuda-text'), '#0F1D2B');
    assert.equal(style.getPropertyValue('--garuda-primary-text'), '#FFFFFF');
    assert.equal(style.getPropertyValue('--garuda-accent-text'), '#FFFFFF');
    assert.equal(rendered.nodes.host.getAttribute('data-theme'), 'ocean_blue');
  } finally {
    rendered.restore();
  }

  // A preset retuned on the server has to reach every embedded widget without a
  // release, which it cannot do if the palette is compiled into this file.
  const source = readFileSync(resolve(__dirname, '..', 'src', 'v1.js'), 'utf8');
  ['#0F4C81', '#1B5E3F', '#B23A0B', '#A16207', '#4C1D95'].forEach((preset) => {
    assert.doesNotMatch(source, new RegExp(preset, 'i'), preset + ' is a preset colour and must live on the server');
  });
  assert.doesNotMatch(source, /forest_green|sunset_orange|summer_yellow|royal_purple/);
});

test('the header shows the name, the tagline and the logo, and keeps the monogram as the fallback', async () => {
  const rendered = renderWidget({
    display_name: 'Nova',
    tagline: 'Answers in seconds',
    logo_url: 'https://cdn.example.com/logo.png'
  });
  try {
    assert.equal(rendered.nodes.title.textContent, 'Nova');
    assert.equal(rendered.nodes.tagline.textContent, 'Answers in seconds');
    assert.equal(rendered.nodes.tagline.hidden, false);
    assert.equal(rendered.nodes.monogram.textContent, 'N');

    const image = rendered.nodes.logo;
    assert.ok(image, 'a configured logo is rendered');
    assert.equal(image.tagName, 'img');
    assert.equal(image.src, 'https://cdn.example.com/logo.png');
    assert.equal(image.alt, '', 'the logo is decorative beside the name that is already there');
    assert.equal(image.hidden, true, 'the monogram holds the space until the logo decodes');
    assert.equal(rendered.nodes.monogram.hidden, false);

    await dispatch(image, 'load');
    assert.equal(image.hidden, false);
    assert.equal(rendered.nodes.monogram.hidden, true);

    // A logo that 404s on the customer's CDN must not leave a broken image icon
    // in the header of every visitor's chat.
    await dispatch(image, 'error');
    assert.equal(rendered.nodes.logo, null, 'the failed image is removed');
    assert.equal(rendered.nodes.avatar.querySelectorAll('img').length, 0);
    assert.equal(rendered.nodes.monogram.hidden, false, 'the monogram comes back');
    assert.equal(rendered.nodes.avatar.textContent, 'N');
  } finally {
    rendered.restore();
  }
});

test('a tagline-less agent hides the line instead of leaving a gap, and an insecure logo is refused', () => {
  assert.equal(widget.safeImageURL('http://cdn.example.com/logo.png'), '', 'mixed content would not load');
  assert.equal(widget.safeImageURL('javascript:alert(1)'), '');
  assert.equal(widget.safeImageURL('https://cdn.example.com/logo.png'), 'https://cdn.example.com/logo.png');

  const rendered = renderWidget({ display_name: 'Nova' });
  try {
    assert.equal(rendered.nodes.tagline.hidden, true);
    assert.equal(rendered.nodes.logo, null);
    assert.equal(rendered.nodes.avatar.textContent, 'N');
  } finally {
    rendered.restore();
  }
});

test('all six placements reach the shell and an unknown one lands bottom right', () => {
  const placements = [
    'bottom_right', 'bottom_left', 'middle_right', 'middle_left', 'top_right', 'top_left'
  ];
  placements.forEach((placement) => {
    assert.equal(widget.normalizePosition(placement), placement);
  });
  assert.equal(widget.normalizePosition('middle_centre'), 'bottom_right');
  assert.equal(widget.normalizePosition(undefined), 'bottom_right');

  const rendered = renderWidget({ display_name: 'Nova', position: 'top_left' });
  try {
    assert.equal(rendered.nodes.shell.getAttribute('data-position'), 'top_left');
    placements.forEach((placement) => {
      rendered.instance.applyAgent(widget.normalizeAgentPayload({ position: placement }));
      assert.equal(rendered.nodes.shell.getAttribute('data-position'), placement);
    });
    rendered.instance.applyAgent(widget.normalizeAgentPayload({ position: 'nowhere' }));
    assert.equal(rendered.nodes.shell.getAttribute('data-position'), 'bottom_right');

    const source = readFileSync(resolve(__dirname, '..', 'src', 'v1.js'), 'utf8');
    placements.forEach((placement) => {
      assert.match(source, new RegExp('data-position\\^?\\$?="?' + placement.split('_')[0]), 'the stylesheet places ' + placement);
    });
  } finally {
    rendered.restore();
  }
});

test('the toggles the widget can act on change what a visitor sees', () => {
  const glowing = renderWidget({
    display_name: 'Nova',
    toggles: { is_glowing: true, is_transparent: true, agent_mute: true, transcription: true, mute_on_minimize: true }
  });
  try {
    assert.equal(glowing.nodes.shell.classList.contains('gw-glowing'), true);
    assert.equal(glowing.nodes.shell.classList.contains('gw-transparent'), true);
    assert.equal(glowing.nodes.mutedBadge.hidden, false, 'agent_mute says the assistant will not speak');
    assert.equal(glowing.nodes.mutedBadge.getAttribute('aria-label'), 'Assistant audio is muted');
    // The widget has no audio of its own. The switches that describe when audio
    // stops are published rather than acted out, so a voice surface can read
    // them and support can see them.
    assert.equal(glowing.nodes.host.getAttribute('data-transcription'), 'true');
    assert.equal(glowing.nodes.host.getAttribute('data-mute-on-minimize'), 'true');
    assert.equal(glowing.nodes.host.getAttribute('data-mute-on-tab-change'), 'false');
    assert.equal(glowing.nodes.host.hidden, false);
  } finally {
    glowing.restore();
  }

  const chatOff = renderWidget({ display_name: 'Nova', toggles: { chat: false } });
  try {
    assert.equal(chatOff.nodes.host.hidden, true, 'chat off means no bubble on the customer site');
    assert.equal(chatOff.nodes.panel.hidden, true);
    assert.equal(chatOff.instance.open, false);
    // all:initial on the host outranks the browser's own [hidden] rule, so
    // hiding the host only works while the stylesheet says so itself.
    const stylesheet = readFileSync(resolve(__dirname, '..', 'src', 'v1.js'), 'utf8');
    assert.ok(
      stylesheet.includes(':host([hidden]){display:none!important;}'),
      'the host element has to hide itself explicitly'
    );
  } finally {
    chatOff.restore();
  }

  const autostart = renderWidget({ display_name: 'Nova', toggles: { autostart: true } });
  try {
    assert.equal(autostart.instance.open, true, 'autostart opens the panel without a click');
    assert.equal(autostart.nodes.panel.hidden, false);
    assert.equal(autostart.nodes.launcher.getAttribute('aria-expanded'), 'true');
  } finally {
    autostart.restore();
  }

  const both = renderWidget({
    display_name: 'Nova',
    lead_capture_enabled: true,
    toggles: { autostart: true, show_lead_form: true }
  });
  try {
    assert.equal(both.instance.agent.toggles.autostart, false, 'the server refuses both, and so does the widget');
    assert.equal(both.instance.open, false);
    both.instance.setOpen(true);
    assert.equal(both.nodes.leadRegion.querySelectorAll('form').length, 1, 'show_lead_form greets with the form');
  } finally {
    both.restore();
  }
});

test('the lead form is rendered from the fields the server resolved, labelled and typed', () => {
  const rendered = renderWidget({
    display_name: 'Nova',
    lead_capture_enabled: true,
    lead_form: {
      enabled: true,
      heading: 'Tell us where to reach you',
      submit_label: 'Send it',
      privacy_text: 'Used only for this follow-up.',
      fields: [
        { id: 'full_name', label: 'Full name', type: 'text', required: true, placeholder: 'Ada Lovelace' },
        { id: 'work_email', label: 'Work email', type: 'email', required: true },
        { id: 'mobile', label: 'Mobile', type: 'telephone' },
        { id: 'seats', label: 'Seats', type: 'number' },
        { id: 'brief', label: 'Brief', type: 'textarea' },
        { id: 'budget', label: 'Budget', type: 'select', options: ['Under 5k', '5k to 20k'] },
        { id: 'newsletter', label: 'Send me the newsletter', type: 'checkbox' },
        { id: 'start_date', label: 'Start date', type: 'date' }
      ]
    }
  });
  try {
    rendered.instance.showLeadForm(null);
    const card = rendered.nodes.leadRegion.querySelector('.gw-lead-card');
    assert.equal(card.querySelector('h2').textContent, 'Tell us where to reach you');
    assert.equal(card.querySelector('.gw-lead-submit').textContent, 'Send it');

    const groups = leadFieldGroups(rendered.instance);
    assert.deepEqual(
      groups.map((entry) => entry.control.name),
      ['full_name', 'work_email', 'mobile', 'seats', 'brief', 'budget', 'newsletter', 'start_date']
    );
    assert.deepEqual(
      groups.map((entry) => (entry.control.tagName === 'input' ? entry.control.type : entry.control.tagName)),
      ['text', 'email', 'tel', 'number', 'textarea', 'select', 'checkbox', 'date']
    );

    groups.forEach((entry) => {
      assert.ok(entry.label, entry.control.name + ' has a label element');
      assert.equal(entry.label.htmlFor, entry.control.id, entry.control.name + ' is labelled by id, not by placement');
      assert.ok(entry.control.id, 'every control has an id to be labelled by');
      assert.equal(entry.control.getAttribute('aria-describedby'), entry.error.id);
    });

    assert.equal(groups[0].control.required, true);
    assert.equal(groups[1].control.required, true);
    assert.equal(groups[2].control.required, false);
    assert.match(groups[0].label.textContent, /Full name \*/);
    assert.match(groups[2].label.textContent, /optional/);
    assert.equal(groups[0].control.placeholder, 'Ada Lovelace');

    const options = groups[5].control.querySelectorAll('option');
    assert.deepEqual(options.map((option) => option.value), ['', 'Under 5k', '5k to 20k']);
    assert.equal(options[0].textContent, 'Select an option');
    assert.equal(card.querySelectorAll('.gw-lead-privacy-copy')[0].textContent, 'Used only for this follow-up.');
  } finally {
    rendered.restore();
  }
});

test('a bootstrap without a built form still draws the form the widget has always drawn', () => {
  const rendered = renderWidget({
    display_name: 'Nova',
    lead_capture_enabled: true,
    lead_capture_fields: ['name', 'email', 'phone']
  });
  try {
    rendered.instance.showLeadForm({ fields: ['name', 'email'], required_fields: ['email'] });
    const groups = leadFieldGroups(rendered.instance);
    assert.deepEqual(groups.map((entry) => entry.control.name), ['name', 'email']);
    assert.equal(groups[1].control.required, true, 'the stream can still mark a field required');
    const card = rendered.nodes.leadRegion.querySelector('.gw-lead-card');
    assert.equal(card.querySelector('h2').textContent, 'How can the team reach you?');
    assert.equal(card.querySelector('.gw-lead-submit').textContent, 'Send securely');
  } finally {
    rendered.restore();
  }
});

test('a submitted form sends reserved ids at the top level and every other answer as a custom field', async () => {
  const calls = [];
  const rendered = renderWidget({
    display_name: 'Nova',
    lead_capture_enabled: true,
    lead_form: {
      enabled: true,
      fields: [
        { id: 'name', label: 'Name', type: 'text' },
        { id: 'email', label: 'Work email', type: 'email', required: true },
        { id: 'budget', label: 'Budget', type: 'select', options: ['Under 5k', '5k to 20k'] },
        { id: 'newsletter', label: 'Newsletter', type: 'checkbox' }
      ]
    }
  }, {
    fetch: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ data: { lead_id: 'lead-1', status: 'new' } }), {
        status: 201, headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  try {
    rendered.instance.showLeadForm(null);
    const groups = leadFieldGroups(rendered.instance);
    groups[0].control.value = 'Ada Lovelace';
    groups[1].control.value = 'ada@example.com';
    groups[2].control.value = '5k to 20k';
    groups[3].control.checked = true;
    const form = rendered.nodes.leadRegion.querySelector('form');
    form.querySelector('.gw-check').querySelector('input').checked = true;

    await dispatch(form, 'submit');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.garuda.example/widget/v1/sessions/session-1/leads');
    assert.deepEqual(calls[0].body.fields, { name: 'Ada Lovelace', email: 'ada@example.com' });
    assert.deepEqual(calls[0].body.custom_fields, { budget: '5k to 20k', newsletter: 'yes' });
    assert.equal(calls[0].body.consent.granted, true);
    assert.equal(
      rendered.nodes.leadRegion.querySelectorAll('.gw-lead-success').length,
      1,
      'the visitor is told the details arrived'
    );
  } finally {
    rendered.restore();
  }
});

test('the submit button says it is working and refuses the second and third click', async () => {
  let releaseCapture = null;
  const attempts = [];
  const rendered = renderWidget({
    display_name: 'Nova',
    lead_capture_enabled: true,
    lead_form: {
      enabled: true,
      submit_label: 'Send it',
      fields: [{ id: 'email', label: 'Work email', type: 'email', required: true }]
    }
  }, {
    fetch: (url, options) => {
      attempts.push(JSON.parse(options.body));
      return new Promise((settle) => {
        releaseCapture = () => settle(new Response(JSON.stringify({ data: { lead_id: 'lead-1' } }), {
          status: 201, headers: { 'Content-Type': 'application/json' }
        }));
      });
    }
  });
  try {
    rendered.instance.showLeadForm(null);
    const form = rendered.nodes.leadRegion.querySelector('form');
    const submit = form.querySelector('.gw-lead-submit');
    leadFieldGroups(rendered.instance)[0].control.value = 'ada@example.com';
    form.querySelector('.gw-check').querySelector('input').checked = true;

    const pending = dispatch(form, 'submit');
    await Promise.resolve();

    assert.equal(submit.disabled, true, 'the control that started the work disables itself');
    assert.equal(submit.getAttribute('aria-busy'), 'true');
    assert.equal(submit.classList.contains('gw-busy'), true);
    assert.equal(submit.textContent, 'Sending…');

    await dispatch(form, 'submit');
    await dispatch(form, 'submit');
    assert.equal(attempts.length, 1, 'an impatient double click must not post the lead twice');

    releaseCapture();
    await pending;
    assert.equal(rendered.nodes.leadRegion.querySelectorAll('.gw-lead-success').length, 1);
  } finally {
    rendered.restore();
  }
});

test('a field the server rejects is named on that field, and the button comes back', async () => {
  const rendered = renderWidget({
    display_name: 'Nova',
    lead_capture_enabled: true,
    lead_form: {
      enabled: true,
      submit_label: 'Send it',
      fields: [
        { id: 'email', label: 'Work email', type: 'email', required: true },
        { id: 'budget', label: 'Budget', type: 'text' }
      ]
    }
  }, {
    fetch: async () => new Response(JSON.stringify({
      error: {
        code: 'validation_failed',
        message: 'Email address is invalid',
        request_id: 'req_1',
        details: { email: 'invalid', 'custom.budget': 'must not exceed 500 characters' }
      }
    }), { status: 422, headers: { 'Content-Type': 'application/json' } })
  });
  try {
    rendered.instance.showLeadForm(null);
    const form = rendered.nodes.leadRegion.querySelector('form');
    const submit = form.querySelector('.gw-lead-submit');
    const groups = leadFieldGroups(rendered.instance);
    groups[0].control.value = 'ada@example.com';
    groups[1].control.value = 'plenty';
    form.querySelector('.gw-check').querySelector('input').checked = true;

    await dispatch(form, 'submit');

    assert.equal(groups[0].error.hidden, false, 'the rejected field says so under itself');
    assert.equal(groups[0].error.textContent, 'Work email is invalid.');
    assert.equal(groups[0].control.getAttribute('aria-invalid'), 'true');
    assert.equal(groups[1].error.textContent, 'must not exceed 500 characters', 'a custom.<id> detail finds its field');
    assert.equal(submit.disabled, false, 'the visitor can correct the field and send again');
    assert.equal(submit.textContent, 'Send it', 'the customer wording comes back, not "Sending…"');
    assert.equal(submit.getAttribute('aria-busy'), 'false');
  } finally {
    rendered.restore();
  }
});

test('the form checks itself before it spends a round trip, and says which field', async () => {
  const calls = [];
  const rendered = renderWidget({
    display_name: 'Nova',
    lead_capture_enabled: true,
    lead_form: {
      enabled: true,
      fields: [
        { id: 'email', label: 'Work email', type: 'email', required: true },
        { id: 'mobile', label: 'Mobile', type: 'telephone' }
      ]
    }
  }, { fetch: async () => { calls.push('sent'); throw new Error('the form must not reach the network'); } });
  try {
    rendered.instance.showLeadForm(null);
    const form = rendered.nodes.leadRegion.querySelector('form');
    const groups = leadFieldGroups(rendered.instance);

    await dispatch(form, 'submit');
    assert.equal(calls.length, 0, 'a required field left empty never reaches the server');
    assert.equal(groups[0].error.textContent, 'This field is required.');
    assert.equal(groups[0].control.getAttribute('aria-invalid'), 'true');
    assert.equal(groups[0].control.focusCount > 0, true, 'focus moves to the field to fix');

    groups[0].control.value = 'ada@example';
    groups[1].control.value = '123';
    await dispatch(form, 'submit');
    assert.equal(calls.length, 0);
    assert.equal(groups[0].error.textContent, 'Enter an email address like you@example.com.');
    assert.equal(groups[1].error.textContent, 'Enter a phone number the team can call.');

    groups[0].control.value = 'ada@example.com';
    groups[1].control.value = '+91 98765 43210';
    await dispatch(form, 'submit');
    assert.equal(calls.length, 0, 'consent is still required before anything is sent');
    assert.equal(form.querySelector('.gw-consent-error').hidden, false);
    assert.equal(groups[0].error.hidden, true, 'a corrected field clears its own line');
    assert.equal(groups[0].control.hasAttribute('aria-invalid'), false);
  } finally {
    rendered.restore();
  }
});

test('every control that starts network work says so and refuses the second click', async () => {
  const rendered = renderWidget({ display_name: 'Nova' });
  try {
    let releaseRetry = null;
    let attempts = 0;
    rendered.instance.showNotice('The chat could not start.', () => {
      attempts += 1;
      return new Promise((settle) => { releaseRetry = settle; });
    });

    const retry = rendered.nodes.retryButton;
    await dispatch(retry, 'click');
    assert.equal(retry.disabled, true, 'the retry that is running cannot be started again');
    assert.equal(retry.getAttribute('aria-busy'), 'true');
    assert.equal(retry.classList.contains('gw-busy'), true);
    assert.equal(retry.textContent, 'Retrying…');

    await dispatch(retry, 'click');
    assert.equal(attempts, 1, 'clicking again while it works must not start a second attempt');

    releaseRetry();
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(retry.disabled, false, 'the control comes back when the work finishes');
    assert.equal(retry.textContent, 'Try again');
    assert.equal(retry.getAttribute('aria-busy'), 'false');

    // Sending a message is the other control the owner was clicking twice.
    rendered.instance.setSending(true);
    assert.equal(rendered.nodes.send.disabled, true);
    assert.equal(rendered.nodes.send.getAttribute('aria-busy'), 'true');
    assert.equal(rendered.nodes.send.classList.contains('gw-busy'), true);
    rendered.instance.setSending(false);
    assert.equal(rendered.nodes.send.getAttribute('aria-busy'), 'false');
    assert.equal(rendered.nodes.send.classList.contains('gw-busy'), false);
  } finally {
    rendered.restore();
  }
});

// ---- human handoff over WhatsApp ----

test('the bootstrap tells the widget a handoff exists without ever carrying the number', () => {
  const agent = widget.normalizeAgentPayload({
    display_name: 'Northstar',
    handoff: {
      enabled: true,
      channel: 'whatsapp',
      label: 'Chat with Priya',
      availability: 'Mon-Fri, 9am-6pm IST',
      trigger_phrases: ['Human', 'real person'],
      auto_offer_after: 3
    }
  });

  assert.equal(agent.handoff.enabled, true);
  assert.equal(agent.handoff.label, 'Chat with Priya');
  assert.equal(agent.handoff.availability, 'Mon-Fri, 9am-6pm IST');
  assert.deepEqual(agent.handoff.triggerPhrases, ['human', 'real person'], 'phrases are lowercased once, here, not per keystroke');
  assert.equal(agent.handoff.autoOfferAfter, 3);
  assert.equal('whatsAppNumber' in agent.handoff, false, 'the widget must have no field the number could arrive in');
});

test('an agent with no handoff configured behaves exactly as it did before the feature', () => {
  const agent = widget.normalizeAgentPayload({ display_name: 'Northstar' });
  assert.equal(agent.handoff.enabled, false);
  assert.deepEqual(agent.handoff.triggerPhrases, []);
  assert.equal(agent.handoff.autoOfferAfter, 0);
});

test('the handoff button appears only when the agent offers one, and carries the availability note', () => {
  const withHandoff = renderWidget({
    display_name: 'Northstar',
    handoff: { enabled: true, label: 'Talk to Priya', availability: 'Weekdays, 9-6 IST' }
  });
  try {
    withHandoff.instance.appendMessage({ id: 'm1', role: 'user', content: 'hello' });
    assert.equal(withHandoff.nodes.handoffButton.hidden, false);
    assert.equal(withHandoff.nodes.handoffLabel.textContent, 'Talk to Priya');
    assert.equal(withHandoff.nodes.handoffHint.hidden, false);
    assert.equal(withHandoff.nodes.handoffHint.textContent, 'Weekdays, 9-6 IST');
  } finally {
    withHandoff.restore();
  }

  const without = renderWidget({ display_name: 'Northstar' });
  try {
    without.instance.appendMessage({ id: 'm1', role: 'user', content: 'hello' });
    assert.equal(without.nodes.handoffButton.hidden, true, 'a site that never configured a handoff shows no button');
    assert.equal(without.nodes.handoffHint.hidden, true);
  } finally {
    without.restore();
  }
});

test('asking for a human pulls the offer forward instead of waiting to be found', () => {
  const rendered = renderWidget({
    display_name: 'Northstar',
    handoff: { enabled: true, label: 'Talk to a person', trigger_phrases: ['real person'] }
  });
  try {
    rendered.instance.maybeOfferHandoff('can I speak to a REAL PERSON please');
    assert.equal(rendered.nodes.handoffButton.classList.contains('gw-handoff-offered'), true);
  } finally {
    rendered.restore();
  }

  const quiet = renderWidget({
    display_name: 'Northstar',
    handoff: { enabled: true, trigger_phrases: ['real person'] }
  });
  try {
    quiet.instance.maybeOfferHandoff('what are your opening hours');
    assert.equal(quiet.nodes.handoffButton.classList.contains('gw-handoff-offered'), false);
  } finally {
    quiet.restore();
  }
});

test('the handoff fetches its link with the session token and opens it in a new tab', async () => {
  const calls = [];
  const rendered = renderWidget(
    { display_name: 'Northstar', handoff: { enabled: true, label: 'Talk to a person' } },
    {
      fetch: async (url, settings) => {
        calls.push({ url, settings });
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ data: { channel: 'whatsapp', url: 'https://wa.me/919876543210?text=hi', label: 'Talk to a person' } })
        };
      }
    }
  );
  const savedOpen = global.open;
  const opened = [];
  global.open = (url, target, features) => { opened.push({ url, target, features }); return {}; };
  try {
    await rendered.instance.requestHandoff();

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.garuda.example/widget/v1/sessions/session-1/handoff');
    assert.equal(calls[0].settings.method, 'POST');
    assert.equal(calls[0].settings.headers['X-Garuda-Session-Token'], 'short-lived-token', 'the link is only obtainable with a live session');
    assert.equal(opened.length, 1);
    assert.equal(opened[0].url, 'https://wa.me/919876543210?text=hi');
    assert.equal(opened[0].features, 'noopener,noreferrer');
    assert.equal(rendered.nodes.handoffButton.disabled, false, 'the button comes back after the link opens');
    assert.equal(rendered.nodes.handoffLabel.textContent, 'Talk to a person', 'the busy label does not stick');
  } finally {
    global.open = savedOpen;
    rendered.restore();
  }
});

test('a blocked popup still gets the visitor to WhatsApp', async () => {
  const rendered = renderWidget(
    { display_name: 'Northstar', handoff: { enabled: true } },
    {
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ data: { url: 'https://wa.me/919876543210?text=hi' } })
      })
    }
  );
  const savedOpen = global.open;
  global.open = () => null;
  try {
    await rendered.instance.requestHandoff();
    assert.equal(global.location.href, 'https://wa.me/919876543210?text=hi', 'the tab the visitor already trusted is navigated instead');
  } finally {
    global.open = savedOpen;
    rendered.restore();
  }
});

test('a handoff that cannot be reached says so in the transcript rather than looking broken', async () => {
  const rendered = renderWidget(
    { display_name: 'Northstar', handoff: { enabled: true } },
    { fetch: async () => { throw new Error('offline'); } }
  );
  const savedOpen = global.open;
  global.open = () => ({});
  try {
    await rendered.instance.requestHandoff();
    const last = rendered.instance.messages[rendered.instance.messages.length - 1];
    assert.match(last.content, /could not open WhatsApp/i);
    assert.equal(rendered.nodes.handoffButton.disabled, false);
  } finally {
    global.open = savedOpen;
    rendered.restore();
  }
});

// ---- starting the conversation over ----

test('restarting swaps in a new session and clears the transcript', async () => {
  const rendered = renderWidget(
    { display_name: 'Northstar', welcome_message: 'Hi there!' },
    {
      fetch: async () => ({
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => ({
          data: {
            session_id: 'session-2',
            session_token: 'a-brand-new-token',
            conversation: { id: 'session-2', resumed: false, messages: [] }
          }
        })
      })
    }
  );
  try {
    rendered.instance.appendMessage({ id: 'm1', role: 'user', content: 'the earlier conversation' });
    assert.equal(rendered.nodes.restart.hidden, false, 'the control appears once there is something to restart');

    await rendered.instance.restartConversation();

    assert.equal(rendered.instance.session.sessionID, 'session-2');
    assert.equal(rendered.instance.session.sessionToken, 'a-brand-new-token', 'the old token must not survive a reset');
    assert.equal(rendered.instance.messages.length, 1, 'only the fresh welcome remains');
    assert.equal(rendered.instance.messages[0].content, 'Hi there!');
    assert.equal(
      rendered.nodes.messages.querySelectorAll('.gw-message-row').length,
      1,
      'the old rows are removed from the DOM, not just from the array'
    );
    assert.equal(rendered.nodes.restart.disabled, false);
  } finally {
    rendered.restore();
  }
});

test('a failed restart keeps the visitor where they were', async () => {
  const rendered = renderWidget(
    { display_name: 'Northstar' },
    { fetch: async () => { throw new Error('offline'); } }
  );
  try {
    rendered.instance.appendMessage({ id: 'm1', role: 'user', content: 'still here' });
    await rendered.instance.restartConversation();

    assert.equal(rendered.instance.session.sessionID, 'session-1', 'the working session is not thrown away');
    assert.equal(rendered.instance.messages[0].content, 'still here');
    assert.match(rendered.instance.messages[rendered.instance.messages.length - 1].content, /could not start a new conversation/i);
    assert.equal(rendered.nodes.restart.disabled, false);
  } finally {
    rendered.restore();
  }
});
