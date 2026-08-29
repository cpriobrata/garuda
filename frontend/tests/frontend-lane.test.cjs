// Regression tests for the frontend defect lane.
//
// Run from the frontend directory with:  node --test tests/*.test.cjs
//
// The web app has no test runner of its own, so this file uses the Node test
// runner and the TypeScript compiler that Next already depends on. Nothing new
// is installed. Components are compiled on require and rendered with the React
// server renderer, which is enough to prove what the server sends to the
// browser and to drive the exported loading and gate helpers directly.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const frontendRoot = path.resolve(__dirname, "..");

let currentPathname = "/app";
const replacedDestinations = [];
const navigationStub = {
  usePathname: () => currentPathname,
  useRouter: () => ({
    replace: (destination) => replacedDestinations.push(destination),
    push: (destination) => replacedDestinations.push(destination),
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
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  module._compile(compiled.outputText, filename);
}

require.extensions[".ts"] = compileTypeScript;
require.extensions[".tsx"] = compileTypeScript;

// The app resolves "@/..." against the frontend root, and the navigation hooks
// need a stand-in because these tests render outside the Next router.
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

function requireFrontend(relativePath) {
  return require(path.join(frontendRoot, relativePath));
}

const agentBuilder = requireFrontend("components/agents/agent-builder.tsx");
const portalShell = requireFrontend("components/portal/portal-shell.tsx");
const DashboardPage = requireFrontend("app/app/page.tsx").default;
const { ApiError, garudaApi } = requireFrontend("lib/api.ts");

function serverAgentRecord() {
  return {
    id: "agent-1",
    name: "Server name",
    description: "Server description",
    status: "draft",
    revision: 7,
    system_prompt: "Server instructions",
    welcome_message: "Server greeting",
    branding: { primary_color: "#001122", accent_color: "#334455", position: "bottom_left", launcher_text: "Server launcher", allowed_domains: ["server.example"] },
    knowledge: [],
  };
}

function untouchedFormValues() {
  return {
    name: "",
    description: "A focused AI agent for website conversations.",
    greeting: "",
    systemPrompt: "Local instructions",
    primaryColor: "#111827",
    accent: "#635BFF",
    launcherText: "Ask Garuda",
    widgetPosition: "bottom_right",
    allowedDomain: "",
  };
}

function bootstrapPayload(overrides = {}) {
  return {
    user: { id: "user-1", email: "owner@example.test", name: "Workspace Owner" },
    organization: { id: "org-1", name: "Example Org", role: "owner" },
    subscription: { status: "active", entitled: true, limits: { published_agents: 10, monthly_conversations: 100 } },
    onboarding: { status: "completed", answered: 4, required: 4 },
    ...overrides,
  };
}

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

// Defect 1: the initial agent read used to overwrite local state unconditionally,
// so anything typed before the response landed was silently discarded.

test("typing while the agent record is still loading survives the response", async () => {
  await withStubbedApi({ getAgent: () => new Promise((resolve) => setTimeout(() => resolve(serverAgentRecord()), 25)) }, async () => {
    const editedFields = new Set();
    const pending = agentBuilder.loadAgentForm("agent-1", () => editedFields);

    // The writer starts on the form while the request is still in flight.
    const typed = { ...untouchedFormValues(), name: "Half typed name", greeting: "Half typed greeting" };
    editedFields.add("name");
    editedFields.add("greeting");

    const loaded = await pending;
    const applied = loaded.apply(typed);

    assert.equal(applied.name, "Half typed name", "an edited name must not be replaced by the loaded record");
    assert.equal(applied.greeting, "Half typed greeting", "an edited greeting must not be replaced by the loaded record");
    assert.equal(applied.description, "Server description", "untouched fields still take the loaded record");
    assert.equal(applied.allowedDomain, "server.example");
    assert.equal(loaded.agent.revision, 7, "the record itself is still handed back for the non-editable state");
  });
});

test("a record loaded before any editing fills every field", async () => {
  await withStubbedApi({ getAgent: async () => serverAgentRecord() }, async () => {
    const loaded = await agentBuilder.loadAgentForm("agent-1", () => new Set());
    const applied = loaded.apply(untouchedFormValues());

    assert.equal(applied.name, "Server name");
    assert.equal(applied.greeting, "Server greeting");
    assert.equal(applied.systemPrompt, "Server instructions");
    assert.equal(applied.accent, "#334455");
    assert.equal(applied.widgetPosition, "bottom_left");
  });
});

test("merging keeps edited fields and takes everything else from the record", () => {
  const current = { ...untouchedFormValues(), accent: "#ABCDEF", name: "Typed name" };
  const loaded = agentBuilder.agentFormValuesFromRecord(serverAgentRecord(), current);
  const merged = agentBuilder.mergeLoadedAgentValues(loaded, current, new Set(["accent"]));

  assert.equal(merged.accent, "#ABCDEF");
  assert.equal(merged.name, "Server name", "a field the writer never touched is refreshed from the record");
});

// Defect 2: a rejected save threw the server's validation details away, so the
// writer saw nothing they could act on.

test("validation details from a rejected save become per-field messages", () => {
  const rejection = new ApiError({
    code: "validation_failed",
    message: "One or more agent fields are invalid",
    request_id: "request-1",
    details: { name: "must contain 2 to 120 characters", "branding.allowed_domains": "use hostnames only, without a scheme" },
  });

  const messages = agentBuilder.fieldMessagesFromError(rejection);

  assert.equal(messages.name, "must contain 2 to 120 characters");
  assert.equal(messages["branding.allowed_domains"], "use hostnames only, without a scheme");
  assert.equal(agentBuilder.sectionForFieldMessages(messages), "identity", "the builder moves to the first rejected section");
});

test("a rejection with no usable details produces no field messages", () => {
  assert.deepEqual(agentBuilder.fieldMessagesFromError(new ApiError({ code: "validation_failed", message: "Message must contain 1 to 4,000 characters" })), {});
  assert.deepEqual(agentBuilder.fieldMessagesFromError(new ApiError({ code: "agent_conflict", message: "Reload the agent", details: { name: "stale" } })), {});
  assert.deepEqual(agentBuilder.fieldMessagesFromError(new Error("network down")), {});
  assert.deepEqual(agentBuilder.fieldMessagesFromError(new ApiError({ code: "validation_failed", message: "Invalid", details: ["name"] })), {});
});

test("a rejected field with no input of its own is still shown to the writer", () => {
  const messages = agentBuilder.fieldMessagesFromError(new ApiError({
    code: "validation_failed",
    message: "One or more agent fields are invalid",
    details: { "lead_capture.after_turns": "must be between 0 and 50", name: "must contain 2 to 120 characters" },
  }));

  assert.deepEqual(agentBuilder.unlistedFieldMessages(messages), ["lead_capture.after_turns: must be between 0 and 50"]);
  assert.equal(agentBuilder.sectionForFieldMessages(messages), "identity", "the builder never jumps to a section that shows nothing");
});

// Defect 3: the dashboard date was formatted while rendering, so it was baked
// into the prerendered page at build time and disagreed with the browser.

test("the prerendered dashboard carries no formatted date", () => {
  const markup = renderToStaticMarkup(React.createElement(DashboardPage));
  const dateThisRenderWouldProduce = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  assert.ok(markup.length > 1000, "the dashboard still renders");
  assert.ok(!markup.includes(dateThisRenderWouldProduce), `the prerendered markup must not contain a render-time date, found "${dateThisRenderWouldProduce}"`);
  assert.ok(markup.includes("text-xs font-medium text-indigo-600"), "the date line is still part of the header");
  assert.ok(markup.includes("Welcome back,"), "the rest of the header is unchanged");
});

// Defect 4: the entitlement and onboarding gate was skipped whenever either
// bootstrap call failed, which let an unentitled visitor into the workspace.

test("a failed bootstrap blocks the workspace instead of opening it", async () => {
  await withStubbedApi({
    me: async () => { throw new ApiError({ code: "HTTP_ERROR", message: "Request failed (503)" }); },
    listAgents: async () => [],
  }, async () => {
    const resolved = await portalShell.resolvePortalAccess("/app");

    assert.equal(resolved.access.state, "blocked", "a bootstrap that never arrived is not permission to continue");
    assert.equal(resolved.account, null);
    assert.equal(resolved.agents, null);
  });
});

test("a failed agent list still leaves the entitlement gate in force", async () => {
  await withStubbedApi({
    me: async () => bootstrapPayload({ subscription: { status: "canceled", entitled: false, limits: { published_agents: 0, monthly_conversations: 0 } } }),
    listAgents: async () => { throw new ApiError({ code: "HTTP_ERROR", message: "Request failed (500)" }); },
  }, async () => {
    const resolved = await portalShell.resolvePortalAccess("/app");

    assert.equal(resolved.access.state, "redirect", "losing the sidebar list must not skip the entitlement check");
    assert.equal(resolved.access.destination, "/checkout");
    assert.equal(resolved.agents, null);
  });
});

test("a failed agent list does not block an entitled account", async () => {
  await withStubbedApi({
    me: async () => bootstrapPayload(),
    listAgents: async () => { throw new ApiError({ code: "HTTP_ERROR", message: "Request failed (500)" }); },
  }, async () => {
    const resolved = await portalShell.resolvePortalAccess("/app");

    assert.equal(resolved.access.state, "granted");
    assert.equal(resolved.agents, null, "the sidebar keeps whatever it already had");
    assert.equal(resolved.account.organization, "Example Org");
  });
});

test("an unfinished onboarding is sent to onboarding, but not from onboarding itself", async () => {
  await withStubbedApi({
    me: async () => bootstrapPayload({ onboarding: { status: "in_progress", answered: 1, required: 4 } }),
    listAgents: async () => [],
  }, async () => {
    const fromDashboard = await portalShell.resolvePortalAccess("/app");
    assert.equal(fromDashboard.access.state, "redirect");
    assert.equal(fromDashboard.access.destination, "/app/onboarding");

    const fromOnboarding = await portalShell.resolvePortalAccess("/app/onboarding");
    assert.equal(fromOnboarding.access.state, "granted");

    const fromGenerating = await portalShell.resolvePortalAccess("/app/generating");
    assert.equal(fromGenerating.access.state, "granted");
  });
});

test("a complete bootstrap grants access and fills the sidebar", async () => {
  await withStubbedApi({
    me: async () => bootstrapPayload(),
    listAgents: async () => [{ id: "agent-1", name: "Aria", status: "live" }],
  }, async () => {
    const resolved = await portalShell.resolvePortalAccess("/app");

    assert.equal(resolved.access.state, "granted");
    assert.equal(resolved.account.name, "Workspace Owner");
    assert.equal(resolved.account.planStatus, "active");
    assert.equal(resolved.agents.length, 1);
  });
});

test("the workspace renders nothing of its own until the gate has answered", () => {
  const previousApiUrl = process.env.NEXT_PUBLIC_API_URL;
  process.env.NEXT_PUBLIC_API_URL = "https://api.example.test";
  try {
    const markup = renderToStaticMarkup(React.createElement(portalShell.PortalShell, null, React.createElement("p", null, "PRIVATE WORKSPACE CONTENT")));

    assert.ok(!markup.includes("PRIVATE WORKSPACE CONTENT"), "children must not render before the bootstrap has confirmed access");
    assert.ok(markup.includes("Checking your workspace access"), "the closed workspace explains itself");
  } finally {
    if (previousApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
    else process.env.NEXT_PUBLIC_API_URL = previousApiUrl;
  }
});

test("the demo workspace still renders without any API configured", () => {
  const previousApiUrl = process.env.NEXT_PUBLIC_API_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
  try {
    const markup = renderToStaticMarkup(React.createElement(portalShell.PortalShell, null, React.createElement("p", null, "DEMO WORKSPACE CONTENT")));
    assert.ok(markup.includes("DEMO WORKSPACE CONTENT"), "the credential-free demo workspace keeps working");
  } finally {
    if (previousApiUrl !== undefined) process.env.NEXT_PUBLIC_API_URL = previousApiUrl;
  }
});
