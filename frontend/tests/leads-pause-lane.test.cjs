// Regression tests for the lead export, manual add and agent pause lane.
//
// Run from the frontend directory with:  node --test tests/*.test.cjs
//
// The web app has no test runner of its own, so this file uses the Node test
// runner with the TypeScript compiler Next already depends on. Nothing new is
// installed. Components are compiled on require and rendered with the React
// server renderer, which is enough to prove what reaches the browser, and the
// exported helpers are driven directly.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const frontendRoot = path.resolve(__dirname, "..");

const navigationStub = {
  usePathname: () => "/app/leads",
  useRouter: () => ({ replace: () => undefined, push: () => undefined, prefetch: () => undefined, back: () => undefined, forward: () => undefined, refresh: () => undefined }),
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

const leadsPage = requireFrontend("app/app/leads/page.tsx");
const leadActions = requireFrontend("components/leads/lead-actions.tsx");
const agentDetail = requireFrontend("components/agents/agent-detail.tsx");

// The three placeholders these features replaced. None of them may come back.

test("the leads screen offers a real export and a real manual add", () => {
  const markup = renderToStaticMarkup(React.createElement(leadsPage.default));
  assert.ok(!markup.includes("coming soon"), "the leads screen still advertises a placeholder");
  assert.ok(markup.includes("Export CSV"), "the export control is missing");
  assert.ok(markup.includes("Manual add"), "the manual add control is missing");
});

test("the agent screen offers a real pause", () => {
  const markup = renderToStaticMarkup(React.createElement(agentDetail.AgentDetail, { agentId: "aria-sales" }));
  assert.ok(!markup.includes("coming soon"), "the agent screen still advertises a placeholder");
  assert.ok(markup.includes("Pause agent"), "the pause control is missing");
});

// Without a configured API there is nothing to call, so both controls have to be
// unusable rather than firing a request at a host that is not there.

test("the export and manual add controls are disabled while no API is configured", () => {
  assert.equal(process.env.NEXT_PUBLIC_API_URL, undefined, "this test describes the unconfigured build");
  const markup = renderToStaticMarkup(React.createElement(leadsPage.default));
  assert.ok(isDisabled(markup, "Export CSV"), "the export button would fire at a host that is not there");
  assert.ok(isDisabled(markup, "Manual add"), "the manual add button would fire at a host that is not there");
  assert.ok(markup.includes("Connect the Garuda API"), "nothing explains why the controls are inert");
});

test("the pause control is disabled while no API is configured", () => {
  const markup = renderToStaticMarkup(React.createElement(agentDetail.AgentDetail, { agentId: "aria-sales" }));
  assert.ok(isDisabled(markup, "Pause agent"), "the pause button would fire at a host that is not there");
});

// isDisabled reads the rendered attribute rather than the class list: the button
// component always carries Tailwind's disabled: variants, so a substring search
// for "disabled" would pass whether or not the control is actually inert.
function isDisabled(markup, label) {
  const button = (markup.match(/<button[^>]*>[\s\S]*?<\/button>/g) || []).find((candidate) => candidate.replace(/<[^>]*>/g, "").includes(label));
  assert.ok(button, `no button labelled ${label}`);
  return /\sdisabled=""/.test(button.slice(0, button.indexOf(">") + 1));
}

// filenameFromDisposition decides what the browser is told to save the download
// as. The header is a network response, so a value that is not a plain CSV name
// -- a path, a traversal, a script -- must be dropped rather than passed through.

test("the download name is taken from the server only when it is a plain CSV name", () => {
  assert.equal(leadActions.filenameFromDisposition('attachment; filename="garuda-leads-2026-08-30.csv"'), "garuda-leads-2026-08-30.csv");
  assert.equal(leadActions.filenameFromDisposition('attachment; filename="garuda-leads-qualified-2026-08-30.csv"'), "garuda-leads-qualified-2026-08-30.csv");
  for (const hostile of [
    'attachment; filename="../../etc/passwd.csv"',
    'attachment; filename="C:\\Windows\\evil.csv"',
    'attachment; filename="report.csv.exe"',
    'attachment; filename="a b.csv"',
    'attachment; filename=""',
    null,
  ]) {
    assert.equal(leadActions.filenameFromDisposition(hostile), "", `accepted a download name it should have dropped: ${hostile}`);
  }
});

// The status list the filter and the form offer has to be the vocabulary the API
// validates against, or the screen builds requests the server answers with 422.

test("the lead status vocabulary matches the one the API accepts", () => {
  assert.deepEqual([...leadActions.leadStatuses], ["new", "qualified", "contacted", "converted", "disqualified"]);
});

// pauseAction drives the button label, the route it posts to and whether it can
// be pressed at all. A draft was never on the air and an archived agent is gone,
// so neither offers anything to toggle.

test("the pause control follows the agent status", () => {
  for (const status of ["published", "live"]) {
    const action = pauseFor(status);
    assert.equal(action.path, "pause", `${status} should offer to pause`);
    assert.equal(action.label, "Pause agent");
    assert.equal(action.busyLabel, "Pausing…");
    assert.equal(action.available, true);
  }

  const resuming = pauseFor("paused");
  assert.equal(resuming.path, "unpause", "a paused agent should offer to resume");
  assert.equal(resuming.label, "Resume agent");
  assert.equal(resuming.busyLabel, "Resuming…");
  assert.equal(resuming.available, true);

  for (const status of ["draft", "archived", undefined]) {
    assert.equal(pauseFor(status).available, false, `${status} has nothing to pause`);
  }
});

function pauseFor(status) {
  return agentDetail.pauseAction(status);
}
