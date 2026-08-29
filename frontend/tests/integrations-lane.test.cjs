// Regression tests for the CRM integrations lane (outbound webhooks).
//
// Run from the frontend directory with:
//   node --test tests/integrations-lane.test.cjs
//
// The web app has no test runner of its own, so this file uses the Node test
// runner plus the TypeScript compiler Next already depends on. There is no DOM:
// the component is called as the plain function it is, through a small hook
// runtime, and the element tree it returns is walked directly. That is enough to
// assert on what the buttons say while a request is in flight, which is the
// behaviour these tests exist to hold still.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");

const frontendRoot = path.resolve(__dirname, "..");

function compileTypeScript(module, filename) {
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  module._compile(compiled.outputText, filename);
}

require.extensions[".ts"] = compileTypeScript;
require.extensions[".tsx"] = compileTypeScript;

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) return resolveFilename.call(this, path.join(frontendRoot, request.slice(2)), parent, ...rest);
  return resolveFilename.call(this, request, parent, ...rest);
};

// The transport is stubbed rather than the integrations module, so the real
// request shapes -- method, path, encoded id, JSON body -- are under test.
const requests = [];
let respond = () => ({});

class StubApiError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ApiError";
    this.code = code || "error";
  }
}

const apiStub = {
  ApiError: StubApiError,
  apiRequest: (requestPath, options = {}) => {
    const call = { path: requestPath, method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(call);
    return Promise.resolve(respond(call)).then((value) => value);
  },
};

const loadModule = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "@/lib/api") return apiStub;
  return loadModule.call(this, request, parent, isMain);
};

const integrationsApi = require("@/components/integrations/integrations-api");
const { WebhookEndpoints } = require("@/components/integrations/webhook-endpoints");

// ---------------------------------------------------------------------------
// A hook runtime small enough for one component. React resolves hooks through
// the module object at call time, so replacing them here lets the component be
// rendered and re-rendered as an ordinary function. Every hook falls through to
// React's own whenever no harness is active, so nothing else is affected.

const originalHooks = {
  useState: React.useState,
  useEffect: React.useEffect,
  useCallback: React.useCallback,
};
let activeHarness = null;
React.useState = (initial) => (activeHarness ? activeHarness.useState(initial) : originalHooks.useState(initial));
React.useEffect = (effect, deps) => (activeHarness ? activeHarness.useEffect(effect, deps) : originalHooks.useEffect(effect, deps));
React.useCallback = (callback, deps) => (activeHarness ? callback : originalHooks.useCallback(callback, deps));

function renderComponent(Component, props = {}) {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let tree = null;
  const harness = {
    useState(initial) {
      const index = cursor++;
      if (slots.length <= index) slots.push(typeof initial === "function" ? initial() : initial);
      return [slots[index], (value) => {
        slots[index] = typeof value === "function" ? value(slots[index]) : value;
      }];
    },
    useEffect(effect) {
      effects.push(effect);
    },
  };
  function render() {
    cursor = 0;
    effects = [];
    activeHarness = harness;
    try {
      tree = Component(props);
    } finally {
      activeHarness = null;
    }
    return tree;
  }
  render();
  return {
    render,
    get tree() {
      return tree;
    },
    async runEffects() {
      const pending = effects.slice();
      for (const effect of pending) {
        const result = effect();
        if (result && typeof result.then === "function") await result;
      }
      // Effects here start work that settles on the microtask queue.
      await new Promise((resolve) => setImmediate(resolve));
      render();
    },
  };
}

function walk(node, visit) {
  if (node === null || node === undefined || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit));
    return;
  }
  if (typeof node === "string" || typeof node === "number") {
    visit(node);
    return;
  }
  if (!React.isValidElement(node)) return;
  visit(node);
  // Plain function components are expanded so their output is visible too --
  // the delivery table is one of these. The shared ui primitives are forwardRef
  // objects rather than functions, so they are left alone and reached through
  // their children, which is where their text actually lives.
  if (typeof node.type === "function" && !node.type.prototype?.isReactComponent) {
    try {
      walk(node.type(node.props), visit);
      return;
    } catch {
      // A component that needs a real render is not worth expanding here.
    }
  }
  walk(node.props.children, visit);
}

function textOf(node) {
  let text = "";
  walk(node, (current) => {
    if (typeof current === "string" || typeof current === "number") text += String(current);
  });
  return text;
}

function elementsWhere(node, predicate) {
  const found = [];
  walk(node, (current) => {
    if (React.isValidElement(current) && predicate(current)) found.push(current);
  });
  return found;
}

function clickable(tree, label) {
  const matches = elementsWhere(tree, (element) => typeof element.props.onClick === "function" && textOf(element).includes(label));
  return matches[matches.length - 1];
}

const catalogue = {
  events: [
    { id: "lead.created", label: "Lead captured", description: "A visitor completed the lead form." },
    { id: "conversation.started", label: "Conversation started", description: "A visitor sent a first message." },
    { id: "conversation.ended", label: "Conversation ended", description: "A conversation went quiet." },
  ],
  signature: { header: "Garuda-Signature", format: "t=<unix seconds>,v1=<hex HMAC-SHA256>", signed_value: "<t>.<raw request body>", algorithm: "HMAC-SHA256", tolerance_seconds: 300, notes: "" },
  delivery: { method: "POST", content_type: "application/json", retries: "5 retries", guarantee: "at least once", requirements: "https only", expected_reply: "any 2xx" },
};

const existingEndpoint = {
  id: "whep_live",
  url: "https://hooks.zapier.com/hooks/catch/1/abcdef/",
  description: "Zapier",
  events: ["lead.created"],
  enabled: true,
  status: "active",
  consecutive_failures: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

function resetTransport(handler) {
  requests.length = 0;
  respond = handler;
}

test("the request shapes are the ones the API defines", async () => {
  resetTransport(() => ({}));
  await integrationsApi.createEndpoint({ url: "https://hooks.example.com/x", description: "CRM", events: ["lead.created"] });
  assert.deepEqual(requests[0], {
    path: "/integrations/webhooks",
    method: "POST",
    body: { url: "https://hooks.example.com/x", description: "CRM", events: ["lead.created"] },
  });

  // Ids arrive from the server but still travel through a URL, so they are
  // encoded rather than concatenated.
  resetTransport(() => ({}));
  await integrationsApi.sendTestEvent("whep_a/b?c");
  assert.equal(requests[0].path, "/integrations/webhooks/whep_a%2Fb%3Fc/test");
  assert.equal(requests[0].method, "POST");

  resetTransport(() => ({}));
  await integrationsApi.fetchDeliveries("whep_a/b");
  assert.equal(requests[0].path, "/integrations/webhooks/whep_a%2Fb/deliveries");

  resetTransport(() => ({}));
  await integrationsApi.updateEndpoint("whep_1", { enabled: false });
  assert.equal(requests[0].method, "PATCH");
  assert.deepEqual(requests[0].body, { enabled: false });

  resetTransport(() => ({}));
  await integrationsApi.deleteEndpoint("whep_1");
  assert.equal(requests[0].method, "DELETE");
});

test("the endpoint list shows a loading state and then the endpoints", async () => {
  resetTransport((call) => (call.path === "/integrations/events" ? catalogue : [existingEndpoint]));
  const view = renderComponent(WebhookEndpoints);
  assert.match(textOf(view.tree), /Loading endpoints/, "the first paint must say it is still loading");

  await view.runEffects();
  const loaded = textOf(view.tree);
  assert.match(loaded, /hooks\.zapier\.com/);
  assert.match(loaded, /Zapier/);
  assert.doesNotMatch(loaded, /Loading endpoints/);
});

test("adding an endpoint shows a busy button and then the secret, once", async () => {
  resetTransport((call) => (call.path === "/integrations/events" ? catalogue : []));
  const view = renderComponent(WebhookEndpoints);
  await view.runEffects();

  // Type a URL.
  const urlField = elementsWhere(view.tree, (element) => element.props.id === "webhook-url")[0];
  assert.ok(urlField, "expected the endpoint URL field to be rendered");
  urlField.props.onChange({ target: { value: "https://hooks.zapier.com/hooks/catch/9/zzz/" } });
  view.render();

  // Hold the create request open so the in-flight render can be inspected.
  let releaseCreate;
  const created = new Promise((resolve) => {
    releaseCreate = resolve;
  });
  resetTransport(() => created);

  const form = elementsWhere(view.tree, (element) => typeof element.props.onSubmit === "function")[0];
  const submitted = form.props.onSubmit({ preventDefault: () => undefined });
  view.render();

  const busy = textOf(view.tree);
  assert.match(busy, /Adding…/, "the submit button must say what it is doing while the request is open");
  const busyButton = elementsWhere(view.tree, (element) => element.props.type === "submit")[0];
  assert.equal(busyButton.props.disabled, true, "the submit button must be disabled while the request is open");

  releaseCreate({ endpoint: { ...existingEndpoint, id: "whep_new" }, secret: "whsec_shown_once_value" });
  if (submitted && typeof submitted.then === "function") await submitted;
  await new Promise((resolve) => setImmediate(resolve));
  view.render();

  const settled = textOf(view.tree);
  assert.match(settled, /whsec_shown_once_value/, "the new secret is shown once, right after it is issued");
  assert.match(settled, /shown once and never again/);
  assert.doesNotMatch(settled, /Adding…/);

  // Dismissing the banner takes the secret off the screen for good.
  const done = clickable(view.tree, "Done");
  assert.ok(done, "expected a control to dismiss the secret banner");
  done.props.onClick();
  view.render();
  assert.doesNotMatch(textOf(view.tree), /whsec_shown_once_value/);
});

test("a refused endpoint URL is reported in the words the server used", async () => {
  resetTransport((call) => (call.path === "/integrations/events" ? catalogue : []));
  const view = renderComponent(WebhookEndpoints);
  await view.runEffects();

  const urlField = elementsWhere(view.tree, (element) => element.props.id === "webhook-url")[0];
  urlField.props.onChange({ target: { value: "https://169.254.169.254/latest/meta-data" } });
  view.render();

  resetTransport(() => Promise.reject(new StubApiError("the endpoint URL resolves to an address that is not on the public internet", "validation_failed")));
  const form = elementsWhere(view.tree, (element) => typeof element.props.onSubmit === "function")[0];
  await form.props.onSubmit({ preventDefault: () => undefined });
  await new Promise((resolve) => setImmediate(resolve));
  view.render();

  const shown = textOf(view.tree);
  assert.match(shown, /not on the public internet/, "the SSRF refusal must reach the person who typed the URL");
  assert.doesNotMatch(shown, /Adding…/, "the button must not stay busy after a failure");
});

test("sending a test event marks that one button busy and no other", async () => {
  const secondEndpoint = { ...existingEndpoint, id: "whep_second", url: "https://hooks.make.com/second", description: "Make" };
  resetTransport((call) => (call.path === "/integrations/events" ? catalogue : [existingEndpoint, secondEndpoint]));
  const view = renderComponent(WebhookEndpoints);
  await view.runEffects();

  let releaseTest;
  const testCall = new Promise((resolve) => {
    releaseTest = resolve;
  });
  resetTransport(() => testCall);

  const buttons = elementsWhere(view.tree, (element) => typeof element.props.onClick === "function" && textOf(element).includes("Send test"));
  assert.equal(buttons.length, 2, "expected one test button per endpoint");
  buttons[0].props.onClick();
  view.render();

  const busyButtons = elementsWhere(view.tree, (element) => typeof element.props.onClick === "function" && textOf(element).includes("Sending…"));
  assert.equal(busyButtons.length, 1, "only the endpoint that was clicked may show a busy state");
  const stillIdle = elementsWhere(view.tree, (element) => typeof element.props.onClick === "function" && textOf(element).includes("Send test"));
  assert.equal(stillIdle.length, 1, "the other endpoint's button must stay usable");

  releaseTest({ id: "whdl_1", endpoint_id: "whep_live", event: "webhook.test", event_id: "evt_1", status: "pending", attempts: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await new Promise((resolve) => setImmediate(resolve));
  view.render();
  assert.match(textOf(view.tree), /Test event queued/);
});

test("the delivery log renders each attempt with its status and error", async () => {
  const deliveries = [
    { id: "whdl_1", endpoint_id: "whep_live", event: "lead.created", event_id: "evt_1", status: "delivered", attempts: 1, response_status: 200, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    { id: "whdl_2", endpoint_id: "whep_live", event: "conversation.started", event_id: "evt_2", status: "failed", attempts: 6, response_status: 502, last_error: "endpoint responded with status 502", created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  ];
  resetTransport((call) => (call.path === "/integrations/events" ? catalogue : [existingEndpoint]));
  const view = renderComponent(WebhookEndpoints);
  await view.runEffects();

  resetTransport(() => deliveries);
  const expander = clickable(view.tree, "Recent deliveries");
  assert.ok(expander, "expected a control that opens the delivery log");
  expander.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  view.render();

  const shown = textOf(view.tree);
  assert.match(shown, /lead\.created/);
  assert.match(shown, /delivered/);
  assert.match(shown, /failed/);
  assert.match(shown, /502/);
  assert.match(shown, /endpoint responded with status 502/, "the customer must be able to read why a delivery failed");
  assert.equal(requests[requests.length - 1].path, "/integrations/webhooks/whep_live/deliveries");
});
