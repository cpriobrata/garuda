// Regression tests for the loading-state lane.
//
// Run from the frontend directory with:  node --test tests/loading-lane.test.cjs
//
// The web app has no test runner and no DOM of its own, so this file uses the
// Node test runner plus the TypeScript compiler Next already depends on. Two
// harnesses are used: the React server renderer for the markup a button
// produces, and a small hook runtime below that calls a client component as a
// plain function, so a handler can be invoked twice in one tick - which is
// exactly the double click these changes exist to survive.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const frontendRoot = path.resolve(__dirname, "..");

const pushedDestinations = [];
const navigationStub = {
  usePathname: () => "/",
  useRouter: () => ({
    replace: (destination) => pushedDestinations.push(destination),
    push: (destination) => pushedDestinations.push(destination),
    prefetch: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    refresh: () => undefined,
  }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
};

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

const loadModule = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "next/navigation") return navigationStub;
  return loadModule.call(this, request, parent, isMain);
};

// ---------------------------------------------------------------------------
// A browser small enough for these components: storage, a location, timers.

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

const assignedLocations = [];
global.window = {
  sessionStorage: memoryStorage(),
  localStorage: memoryStorage(),
  location: { search: "", hash: "", pathname: "/", assign: (url) => assignedLocations.push(url) },
  history: { replaceState: () => undefined },
  setInterval: () => 0,
  clearInterval: () => undefined,
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (handle) => clearTimeout(handle),
};
global.document = { title: "Garuda" };

// The forms read their fields with new FormData(event.currentTarget) and
// nothing else, so a stand-in over a plain object is enough and leaves the
// handler code under test unchanged.
global.FormData = class {
  constructor(form) { this.values = (form && form.fields) || {}; }
  get(key) { return key in this.values ? this.values[key] : null; }
};

function submitEvent(fields) {
  return { preventDefault: () => undefined, currentTarget: { fields } };
}

// ---------------------------------------------------------------------------
// The hook runtime. React function components are ordinary functions, and the
// hooks they call are resolved through the react module object at call time, so
// replacing them here lets a component be rendered, re-rendered and driven
// without react-dom. Outside a harness render every hook falls back to React's
// own, so renderToStaticMarkup keeps working normally.

const reactHooks = { useState: React.useState, useRef: React.useRef, useEffect: React.useEffect, useMemo: React.useMemo, useCallback: React.useCallback };
let activeHarness = null;

React.useState = (initial) => (activeHarness ? activeHarness.useState(initial) : reactHooks.useState(initial));
React.useRef = (initial) => (activeHarness ? activeHarness.useRef(initial) : reactHooks.useRef(initial));
React.useEffect = (effect, deps) => (activeHarness ? activeHarness.useEffect(effect, deps) : reactHooks.useEffect(effect, deps));
React.useMemo = (factory, deps) => (activeHarness ? factory() : reactHooks.useMemo(factory, deps));
React.useCallback = (callback, deps) => (activeHarness ? callback : reactHooks.useCallback(callback, deps));

function findAll(node, predicate) {
  const found = [];
  (function walk(current) {
    if (Array.isArray(current)) { current.forEach(walk); return; }
    if (!React.isValidElement(current)) return;
    if (predicate(current)) found.push(current);
    walk(current.props.children);
  })(node);
  return found;
}

function textOf(node) {
  let text = "";
  (function walk(current) {
    if (current === null || current === undefined || typeof current === "boolean") return;
    if (Array.isArray(current)) { current.forEach(walk); return; }
    if (typeof current === "string" || typeof current === "number") { text += String(current); return; }
    if (React.isValidElement(current)) walk(current.props.children);
  })(node);
  return text;
}

function renderComponent(Component, props = {}) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let tree = null;
  let rendering = false;
  let dirty = false;

  const harness = {
    useState(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = { value: typeof initial === "function" ? initial() : initial };
      const box = slots[slot];
      return [box.value, (next) => { box.value = typeof next === "function" ? next(box.value) : next; render(); }];
    },
    useRef(initial) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      const previous = slots[slot];
      // A missing dependency list runs on mount only. React would run it after
      // every render; here that could loop forever, and no component under test
      // leaves the list out.
      const changed = !previous || (deps && (!previous.deps || deps.length !== previous.deps.length || deps.some((value, index) => !Object.is(value, previous.deps[index]))));
      slots[slot] = { deps };
      if (changed) effects.push(effect);
    },
  };

  function render() {
    if (rendering) { dirty = true; return; }
    rendering = true;
    const previousHarness = activeHarness;
    activeHarness = harness;
    try {
      do {
        dirty = false;
        cursor = 0;
        tree = Component(props);
        for (const effect of effects.splice(0)) effect();
      } while (dirty);
    } finally {
      activeHarness = previousHarness;
      rendering = false;
    }
  }

  render();

  return {
    get tree() { return tree; },
    findAll: (predicate) => findAll(tree, predicate),
    find(predicate) {
      const found = findAll(tree, predicate);
      assert.ok(found.length, "no element matched");
      return found[0];
    },
  };
}

function requireFrontend(relativePath) {
  return require(path.join(frontendRoot, relativePath));
}

async function settle() {
  for (let pass = 0; pass < 5; pass += 1) await new Promise((resolve) => setImmediate(resolve));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((settleWith, failWith) => { resolve = settleWith; reject = failWith; });
  return { promise, resolve, reject };
}

process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";

const { Button } = requireFrontend("components/ui/button.tsx");
const { createBusyAction, keepBusyUntilNavigation } = requireFrontend("lib/busy-action.ts");
const { garudaApi } = requireFrontend("lib/api.ts");
const { CheckoutForm } = requireFrontend("components/checkout/checkout-form.tsx");
const { OnboardingFlow } = requireFrontend("components/onboarding/onboarding-flow.tsx");
const { SignInForm } = requireFrontend("components/auth/sign-in-form.tsx");
const { SignUpForm } = requireFrontend("components/auth/sign-up-form.tsx");
const { ForgotPasswordForm, ResetPasswordForm } = requireFrontend("components/auth/password-forms.tsx");
const { AgentBuilder } = requireFrontend("components/agents/agent-builder.tsx");
const { LeadsTable } = requireFrontend("components/leads/leads-table.tsx");
const { SettingsPanel } = requireFrontend("components/settings/settings-panel.tsx");

async function withStubbedApi(stubs, body) {
  const originals = {};
  for (const [name, implementation] of Object.entries(stubs)) {
    originals[name] = garudaApi[name];
    garudaApi[name] = implementation;
  }
  try {
    return await body();
  } finally {
    for (const [name, implementation] of Object.entries(originals)) garudaApi[name] = implementation;
  }
}

// ---------------------------------------------------------------------------
// The guard itself.

test("two calls in the same tick start the action once", async () => {
  const started = [];
  const busyStates = [];
  const gate = deferred();
  const action = createBusyAction((busy) => busyStates.push(busy));

  const first = action.run(async () => { started.push("first"); await gate.promise; });
  const second = action.run(async () => { started.push("second"); await gate.promise; });

  assert.deepEqual(started, ["first"], "the second call must not start a second request");
  assert.equal(action.isRunning(), true);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(busyStates, [true, false], "the control goes busy once and comes back once");
  assert.equal(action.isRunning(), false);
});

test("a failed action releases the control so it can be tried again", async () => {
  const started = [];
  const action = createBusyAction(() => undefined);

  await action.run(async () => { started.push("first"); throw new Error("network down"); }).catch(() => undefined);
  await action.run(async () => { started.push("second"); });

  assert.deepEqual(started, ["first", "second"], "a rejection must re-arm the control");
});

test("an action that navigates stays busy instead of flicking back to idle", async () => {
  const busyStates = [];
  const started = [];
  const action = createBusyAction((busy) => busyStates.push(busy));

  await action.run(async () => { started.push("first"); return keepBusyUntilNavigation; });
  await action.run(async () => { started.push("second"); });

  assert.deepEqual(busyStates, [true], "the control never returned to idle before the page changed");
  assert.deepEqual(started, ["first"], "and nothing else can start while the page is leaving");
  assert.equal(action.isRunning(), true);
});

// ---------------------------------------------------------------------------
// What a busy button renders.

test("a loading button disables itself, says it is busy, and keeps its width", () => {
  const idle = renderToStaticMarkup(React.createElement(Button, null, "Continue with Stripe"));
  const busy = renderToStaticMarkup(React.createElement(Button, { loading: true, loadingLabel: "Opening secure checkout" }, "Continue with Stripe"));

  assert.ok(!idle.includes('disabled=""'), "an idle button is clickable");
  assert.ok(!idle.includes("aria-busy"), "and reports nothing to assistive tech");
  assert.ok(!idle.includes("animate-spin"), "and shows no spinner");

  assert.ok(busy.includes('disabled=""'), "a busy button cannot be clicked again");
  assert.ok(busy.includes('aria-busy="true"'), "a busy button reports itself to assistive tech");
  assert.ok(busy.includes("animate-spin"), "a busy button shows a spinner");
  assert.ok(busy.includes("Opening secure checkout"), "and names the work for screen readers");
  assert.ok(busy.includes("Continue with Stripe"), "the label is still rendered, only hidden, so the button keeps its width");
  assert.ok(busy.includes("invisible"), "the label holds its space rather than being removed");
});

test("the spinner stops moving when the reader asked for reduced motion", () => {
  const busy = renderToStaticMarkup(React.createElement(Button, { loading: true }, "Save"));
  assert.ok(busy.includes("motion-reduce:animate-none"), "the spin is suppressed under prefers-reduced-motion");
  assert.ok(busy.includes("animate-spin"), "while the mark itself stays, so the state is still visible");
});

test("a button that renders a link still takes the busy flag without breaking", () => {
  const markup = renderToStaticMarkup(
    React.createElement(Button, { asChild: true, loading: true }, React.createElement("a", { href: "/app" }, "Open the workspace")),
  );
  assert.ok(markup.includes('aria-busy="true"'));
  assert.ok(markup.includes("Open the workspace"));
  assert.ok(markup.startsWith("<a"), "the slot still renders the element it was given");
});

// ---------------------------------------------------------------------------
// Onboarding: the double submit that produced a production 500.

// answerEveryQuestionButTheLast walks the flow to the point where the next
// interaction is the one that pays for a generation. It is a helper rather than
// six inline calls because the flow has now grown twice, and each time it grew
// the tests broke in a way that looked like a product regression and was not.
async function answerEveryQuestionButTheLast(rendered) {
  await answerQuestion(rendered, "Northstar Labs helps growth teams");
  await answerQuestion(rendered, "Growth leaders evaluating conversion tooling");
  await choiceButton(rendered, "Capture qualified leads").props.onClick();
  await choiceButton(rendered, "Lead qualifier").props.onClick();
  await answerQuestion(rendered, "Aria");
}

// The last step now saves the agent name and the appointments answer before it
// asks for a generation, and that save is a real request. These tests are about
// the double-click guard on the generation, not about the save, so the save is
// stubbed at the network rather than mocked away -- a stub that returned an
// error would make these pass for the wrong reason.
function withDetailsSaved(body) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/onboarding/voice/details")) {
      return {
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ data: { details: {} } }),
      };
    }
    throw new Error("unexpected request to " + url);
  };
  return (async () => { try { return await body(); } finally { globalThis.fetch = original; } })();
}

function answerQuestion(rendered, text) {
  // Input and Textarea are forwardRef objects rather than functions, so the
  // controlled field is found by the props it was given.
  const textarea = rendered.find((node) => typeof node.props.onChange === "function" && typeof node.props.value === "string");
  textarea.props.onChange({ target: { value: text } });
  const form = rendered.find((node) => node.type === "form");
  return form.props.onSubmit(submitEvent({}));
}

function choiceButton(rendered, label) {
  return rendered.find((node) => node.type === "button" && textOf(node).startsWith(label));
}

test("clicking the last onboarding answer twice generates one agent", async () => {
  const completions = [];
  const gate = deferred();
  pushedDestinations.length = 0;

  await withStubbedApi({
    completeOnboarding: async (answers) => { completions.push(answers); await gate.promise; return { agent_id: "agent-1", job_id: "job-1", agent_name: "Nova" }; },
  }, async () => withDetailsSaved(async () => {
    const rendered = renderComponent(OnboardingFlow);
    await answerEveryQuestionButTheLast(rendered);

    const finalChoice = choiceButton(rendered, "Yes, we take appointments");
    const first = finalChoice.props.onClick();
    const second = finalChoice.props.onClick();

    // The last step saves the name and the appointments answer before it asks
    // for a generation, so the generation is now one await further away than it
    // was. Yielding once gets there; the gate below is what holds it open.
    await settle();
    assert.equal(completions.length, 1, "the second click must not pay for a second generation");

    const busyChoice = choiceButton(rendered, "Yes, we take appointments");
    assert.equal(busyChoice.props.disabled, true, "the choices are held while the agent is being built");
    assert.equal(busyChoice.props["aria-busy"], true, "and the chosen one says it is working");

    gate.resolve();
    await Promise.all([first, second]);
    await settle();

    assert.deepEqual(pushedDestinations, ["/app/generating"]);
    assert.equal(choiceButton(rendered, "Yes, we take appointments").props.disabled, true, "the control stays busy until the new route paints");
  }));
});

test("answering an onboarding question twice does not skip the next one", async () => {
  const rendered = renderComponent(OnboardingFlow);
  const field = rendered.find((node) => typeof node.props.onChange === "function" && typeof node.props.value === "string");
  field.props.onChange({ target: { value: "Northstar Labs helps growth teams" } });

  // Both submits come from the same render, the way a fast double press does.
  const form = rendered.find((node) => node.type === "form");
  await form.props.onSubmit(submitEvent({}));
  await form.props.onSubmit(submitEvent({}));

  // The guide answers each question exactly once, so its reply is the reliable
  // count of how many answers were accepted.
  const transcript = textOf(rendered.tree);
  const replyCount = transcript.split("got it.").length - 1;
  assert.equal(replyCount, 1, "the answer must be recorded once");
  assert.ok(transcript.includes("Who is your ideal customer"), "the flow moved on by exactly one question");
  assert.ok(!transcript.includes("What is the #1 outcome"), "a second submit must not answer the next question for them");
});

test("a failed onboarding completion can be answered again", async () => {
  const completions = [];
  pushedDestinations.length = 0;

  await withStubbedApi({
    completeOnboarding: async (answers) => {
      completions.push(answers);
      if (completions.length === 1) throw new Error("Request failed (500)");
      return { agent_id: "agent-1", job_id: "job-1", agent_name: "Nova" };
    },
  }, async () => withDetailsSaved(async () => {
    const rendered = renderComponent(OnboardingFlow);
    await answerEveryQuestionButTheLast(rendered);
    await choiceButton(rendered, "Yes, we take appointments").props.onClick();
    await settle();

    assert.equal(completions.length, 1);
    assert.equal(choiceButton(rendered, "Yes, we take appointments").props.disabled, false, "a failure hands the question back");

    // The same question again, answered the other way, because a retry has to
    // work from whatever the person chooses the second time.
    await choiceButton(rendered, "No, not for now").props.onClick();
    await settle();

    assert.equal(completions.length, 2, "the retry reaches the server");
    assert.deepEqual(pushedDestinations, ["/app/generating"]);
  }));
});

// ---------------------------------------------------------------------------
// Checkout.

test("clicking checkout twice opens one Stripe session and stays busy", async () => {
  const sessions = [];
  const gate = deferred();
  assignedLocations.length = 0;

  await withStubbedApi({
    createCheckout: async () => { sessions.push("created"); await gate.promise; return { session_id: "cs_1", url: "https://checkout.stripe.test/cs_1" }; },
  }, async () => {
    const rendered = renderComponent(CheckoutForm);
    const button = rendered.find((node) => node.type === Button && textOf(node).includes("Continue with Stripe"));

    const first = button.props.onClick();
    const second = button.props.onClick();

    assert.equal(sessions.length, 1, "a second click must not start a second checkout");
    assert.equal(rendered.find((node) => node.type === Button).props.loading, true, "the button shows it is working");

    gate.resolve();
    await Promise.all([first, second]);
    await settle();

    assert.deepEqual(assignedLocations, ["https://checkout.stripe.test/cs_1"]);
    assert.equal(rendered.find((node) => node.type === Button).props.loading, true, "and stays busy while the page leaves for Stripe");
  });
});

// ---------------------------------------------------------------------------
// Sign in.

test("submitting the sign-in form twice sends one request", async () => {
  const attempts = [];
  const gate = deferred();
  pushedDestinations.length = 0;

  await withStubbedApi({
    signIn: async (email) => { attempts.push(email); await gate.promise; return { access_token: "token", user: { id: "user-1", email } }; },
  }, async () => {
    const rendered = renderComponent(SignInForm);
    const form = rendered.find((node) => node.type === "form");
    const credentials = submitEvent({ email: "owner@example.test", password: "correct horse" });

    const first = form.props.onSubmit(credentials);
    const second = form.props.onSubmit(credentials);

    assert.deepEqual(attempts, ["owner@example.test"], "the second submit must not send a second sign-in");
    const submitButton = rendered.find((node) => node.type === Button && textOf(node).includes("Sign in to Garuda"));
    assert.equal(submitButton.props.loading, true, "the button says it is working");

    gate.resolve();
    await Promise.all([first, second]);
    await settle();

    assert.deepEqual(pushedDestinations, ["/app"]);
    assert.equal(rendered.find((node) => node.type === Button && textOf(node).includes("Sign in to Garuda")).props.loading, true, "and stays busy until the workspace opens");
  });
});

test("submitting the sign-up form twice creates one account", async () => {
  const attempts = [];
  const gate = deferred();
  pushedDestinations.length = 0;

  await withStubbedApi({
    signUp: async (name, email) => { attempts.push(email); await gate.promise; return { access_token: "token", user: { id: "user-1", email } }; },
  }, async () => {
    const rendered = renderComponent(SignUpForm);
    const form = rendered.find((node) => node.type === "form");
    const details = submitEvent({ firstName: "Maya", lastName: "Chen", email: "maya@example.test", password: "a long password" });

    const first = form.props.onSubmit(details);
    const second = form.props.onSubmit(details);

    assert.deepEqual(attempts, ["maya@example.test"], "the second submit must not create a second account");
    assert.equal(rendered.find((node) => node.type === Button && textOf(node).includes("Continue to plan")).props.loading, true);

    gate.resolve();
    await Promise.all([first, second]);
    await settle();

    assert.deepEqual(pushedDestinations, ["/checkout"]);
    assert.equal(rendered.find((node) => node.type === Button && textOf(node).includes("Continue to plan")).props.loading, true, "and stays busy until the plan page opens");
  });
});

test("asking for a reset link twice sends one email", async () => {
  const requests = [];
  const gate = deferred();

  await withStubbedApi({
    forgotPassword: async (email) => { requests.push(email); await gate.promise; return { message: "sent" }; },
  }, async () => {
    const rendered = renderComponent(ForgotPasswordForm);
    const form = rendered.find((node) => node.type === "form");
    const request = submitEvent({ email: "maya@example.test" });

    const first = form.props.onSubmit(request);
    const second = form.props.onSubmit(request);

    assert.deepEqual(requests, ["maya@example.test"], "the second submit must not send a second email");
    assert.equal(rendered.find((node) => node.type === Button && textOf(node).includes("Send reset link")).props.loading, true);

    gate.resolve();
    await Promise.all([first, second]);
    await settle();
  });
});

test("saving a new password twice writes it once and holds through the redirect", async () => {
  const saves = [];
  const gate = deferred();

  await withStubbedApi({
    resetPassword: async (password) => { saves.push(password); await gate.promise; return { message: "Password updated" }; },
  }, async () => {
    const rendered = renderComponent(ResetPasswordForm);
    const form = rendered.find((node) => node.type === "form");
    const chosen = submitEvent({ password: "a long password", confirm: "a long password" });

    const first = form.props.onSubmit(chosen);
    const second = form.props.onSubmit(chosen);

    assert.deepEqual(saves, ["a long password"], "the second submit must not write the password again");

    gate.resolve();
    await Promise.all([first, second]);
    await settle();

    const saveButton = rendered.find((node) => node.type === Button);
    assert.equal(saveButton.props.loading, true, "the button stays busy across the pause before sign-in opens");
    assert.ok(textOf(rendered.tree).includes("Password updated. Taking you to sign in"), "and the page confirms what happened");
  });
});

test("a mismatched confirmation never puts the button to work", async () => {
  const saves = [];

  await withStubbedApi({ resetPassword: async (password) => { saves.push(password); return { message: "Password updated" }; } }, async () => {
    const rendered = renderComponent(ResetPasswordForm);
    const form = rendered.find((node) => node.type === "form");

    // Read while the handler is still open: a check made inside the busy run
    // would have flashed the spinner on its way to an error message.
    const pending = form.props.onSubmit(submitEvent({ password: "a long password", confirm: "a different one" }));
    assert.equal(rendered.find((node) => node.type === Button).props.loading, false, "a correction must not read as work in progress");
    await pending;

    assert.deepEqual(saves, [], "nothing was sent");
    assert.ok(textOf(rendered.tree).includes("Passwords do not match"), "the mismatch is reported instead");
  });
});

// ---------------------------------------------------------------------------
// The agent builder, where four buttons write the same record.

function toolbarButton(rendered, label) {
  return rendered.find((node) => node.type === Button && textOf(node).includes(label));
}

test("clicking save twice creates one agent", async () => {
  const creates = [];
  const gate = deferred();

  await withStubbedApi({
    createAgent: async (input) => { creates.push(input.name); await gate.promise; return { id: "agent-1", revision: 1, name: input.name, description: "", status: "draft", system_prompt: "", welcome_message: "", branding: {}, knowledge: [] }; },
  }, async () => {
    const rendered = renderComponent(AgentBuilder, { existing: false });
    const save = toolbarButton(rendered, "Save");

    const first = save.props.onClick();
    const second = save.props.onClick();

    assert.equal(creates.length, 1, "the second click must not create a second agent");
    assert.equal(toolbarButton(rendered, "Save").props.loading, true, "the clicked button shows the spinner");
    assert.equal(toolbarButton(rendered, "Publish agent").props.disabled, true, "and the other writers hold still");
    assert.equal(toolbarButton(rendered, "Publish agent").props.loading, false, "without borrowing the spinner");

    gate.resolve();
    await Promise.all([first, second]);
    await settle();

    assert.equal(toolbarButton(rendered, "Save").props.loading, false, "the toolbar comes back when the write lands");
    assert.equal(toolbarButton(rendered, "Publish agent").props.disabled, false);
  });
});

test("clicking publish twice saves and publishes once", async () => {
  const creates = [];
  const publishes = [];
  const gate = deferred();

  await withStubbedApi({
    createAgent: async (input) => { creates.push(input.name); return { id: "agent-1", revision: 1, name: input.name, description: "", status: "draft", system_prompt: "", welcome_message: "", branding: {}, knowledge: [] }; },
    publishAgent: async (agentId) => { publishes.push(agentId); await gate.promise; return { status: "published", published_version: 2, agent_key: "pub_1", embed_code: "<script></script>" }; },
  }, async () => {
    const rendered = renderComponent(AgentBuilder, { existing: false });
    // Publishing needs an approved domain, which lives in the appearance section.
    rendered.find((node) => node.type === "button" && textOf(node) === "Appearance").props.onClick();
    rendered.find((node) => typeof node.type === "function" && typeof node.props.setAllowedDomain === "function").props.setAllowedDomain("northstarlabs.com");

    const publish = toolbarButton(rendered, "Publish agent");
    const first = publish.props.onClick();
    const second = publish.props.onClick();
    await settle();

    assert.equal(creates.length, 1, "the second click must not create a second agent");
    assert.equal(publishes.length, 1, "nor publish twice");
    assert.equal(toolbarButton(rendered, "Publish agent").props.loading, true, "publish shows it is working");
    assert.equal(toolbarButton(rendered, "Save").props.disabled, true, "and save cannot race it");

    gate.resolve();
    await Promise.all([first, second]);
    await settle();

    assert.equal(toolbarButton(rendered, "Publish updates").props.loading, false, "the toolbar comes back once the agent is live");
  });
});

// ---------------------------------------------------------------------------
// Reads the workspace waits on, which used to look like an answer.

test("the lead table says it is loading instead of claiming there are none", async () => {
  const gate = deferred();

  await withStubbedApi({ listLeads: async () => { await gate.promise; return []; } }, async () => {
    const rendered = renderComponent(LeadsTable);
    const waiting = textOf(rendered.tree);

    assert.ok(waiting.includes("Loading leads"), "the table says the rows are on their way");
    assert.ok(!waiting.includes("No leads found"), "an unanswered request is not an empty workspace");

    gate.resolve();
    await settle();

    const settled = textOf(rendered.tree);
    assert.ok(settled.includes("No leads found"), "and the empty state is told once the answer is in");
    assert.ok(!settled.includes("Loading leads"));
  });
});

test("the settings profile shows that it is still reading the account", async () => {
  const gate = deferred();

  await withStubbedApi({
    me: async () => { await gate.promise; return { user: { id: "user-1", email: "owner@example.test", name: "Workspace Owner" }, organization: { id: "org-1", name: "Example Org", role: "owner" }, subscription: { status: "active", entitled: true, limits: { published_agents: 10, monthly_conversations: 100 } }, onboarding: { status: "completed", answered: 4, required: 4 } }; },
  }, async () => {
    const rendered = renderComponent(SettingsPanel);
    const profileCard = () => rendered.find((node) => node.props.title === "Personal profile");

    assert.equal(profileCard().props.loading, true, "the card reports the read it is waiting on");

    gate.resolve();
    await settle();

    assert.equal(profileCard().props.loading, false, "and stops once the account details are in");
  });
});
