// Regression tests for the widget settings studio.
//
// Run from the frontend directory with:  node --test tests/*.test.cjs
//
// The web app has no test runner of its own, so this file uses the Node test
// runner and the TypeScript compiler Next already depends on. Nothing new is
// installed. The studio's state is pure, so it is driven directly; the pieces
// that render are rendered with the React server renderer, which is enough to
// prove what a customer is shown.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const frontendRoot = path.resolve(__dirname, "..");

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

// The app resolves "@/..." against the frontend root.
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith("@/")) return resolveFilename.call(this, path.join(frontendRoot, request.slice(2)), parent, ...rest);
  return resolveFilename.call(this, request, parent, ...rest);
};

function requireFrontend(relativePath) {
  return require(path.join(frontendRoot, relativePath));
}

const studio = requireFrontend("components/widget/widget-studio-state.ts");
const controls = requireFrontend("components/widget/widget-studio-controls.tsx");
const sections = requireFrontend("components/widget/widget-studio-sections.tsx");
const leadFormBuilder = requireFrontend("components/widget/widget-lead-form-builder.tsx");
const { ApiError } = requireFrontend("lib/api.ts");

const themePresets = [
  { id: "ocean_blue", label: "Ocean blue", description: "Calm and professional", colors: { primary: "#0F4C81", accent: "#2E8BC0", background: "#FFFFFF", surface: "#EEF4FA", text: "#0F1D2B", on_primary: "#FFFFFF", on_accent: "#FFFFFF" } },
  { id: "forest_green", label: "Forest green", description: "Natural and balanced", colors: { primary: "#1B5E3F", accent: "#2E9E63", background: "#FFFFFF", surface: "#EDF6F0", text: "#10231A", on_primary: "#FFFFFF", on_accent: "#FFFFFF" } },
  { id: "sunset_orange", label: "Sunset orange", description: "Warm and energetic", colors: { primary: "#B23A0B", accent: "#F97316", background: "#FFFFFF", surface: "#FFF3EA", text: "#2A1508", on_primary: "#FFFFFF", on_accent: "#111827" } },
  { id: "summer_yellow", label: "Summer yellow", description: "Bright and cheerful", colors: { primary: "#A16207", accent: "#FACC15", background: "#FFFFFF", surface: "#FEF9E7", text: "#2B2205", on_primary: "#FFFFFF", on_accent: "#111827" } },
  { id: "royal_purple", label: "Royal purple", description: "Creative and luxurious", colors: { primary: "#4C1D95", accent: "#7C3AED", background: "#FFFFFF", surface: "#F4EFFE", text: "#1E1235", on_primary: "#FFFFFF", on_accent: "#FFFFFF" } },
  { id: "custom", label: "Custom", description: "Customizable for you", colors: null },
];

const positions = ["bottom_right", "bottom_left", "middle_right", "middle_left", "top_right", "top_left"];
const leadFormFieldTypes = ["text", "email", "telephone", "number", "textarea", "select", "checkbox", "date"];
const reservedLeadFieldIDs = ["name", "email", "phone", "company"];
const contrastMinimums = { body_text: 4.5, interface: 3 };

// An agent stored before any of this existed: none of the new keys are present
// and every resolved value is the widget it already shows.
function legacyAgentRecord() {
  return {
    id: "agent-1",
    name: "Aria",
    status: "published",
    revision: 4,
    branding: { primary_color: "#111827", accent_color: "#F97316", position: "bottom_right" },
    lead_capture: { enabled: true, prompt: "", after_turns: 3, fields: ["name", "email"] },
    resolved_branding: {
      display_name: "Aria", tagline: "", logo_url: "", avatar_url: "", launcher_text: "", privacy_url: "",
      position: "bottom_right", theme: "custom",
      colors: { primary: "#111827", accent: "#F97316", background: "#FFFFFF", surface: "#F3F4F6", text: "#111827", on_primary: "#FFFFFF", on_accent: "#111827" },
      toggles: { transcription: false, chat: true, autostart: false, mute_on_minimize: false, mute_on_tab_change: false, show_lead_form: false, is_glowing: false, is_transparent: false, agent_mute: false },
    },
    resolved_lead_form: {
      enabled: true, prompt: "", after_turns: 3, heading: "Share your contact details", submit_label: "Submit", privacy_text: "",
      fields: [{ id: "name", label: "Name", type: "text" }, { id: "email", label: "Email", type: "email" }],
    },
    theme_presets: themePresets,
    positions,
    lead_form_field_types: leadFormFieldTypes,
    reserved_lead_field_ids: reservedLeadFieldIDs,
    contrast_minimums: contrastMinimums,
  };
}

// An agent the customer has already configured through this screen.
function configuredAgentRecord() {
  const record = legacyAgentRecord();
  record.branding = {
    primary_color: "#111827",
    accent_color: "#F97316",
    position: "middle_left",
    display_name: "Nova",
    tagline: "Answers in seconds",
    logo_url: "https://cdn.example.test/logo.png",
    theme: "ocean_blue",
    custom_colors: { background: "#FFFFFF", surface: "#F3F4F6", text: "#1F2937", on_primary: "", on_accent: "" },
    toggles: { transcription: true, chat: true, autostart: false, mute_on_minimize: true, mute_on_tab_change: false, show_lead_form: true, is_glowing: true, is_transparent: false, agent_mute: false },
  };
  record.lead_capture = {
    enabled: true,
    prompt: "Can the team follow up?",
    after_turns: 2,
    fields: ["name", "email"],
    privacy_text: "Used only for this follow-up.",
    form_heading: "Tell us where to reach you",
    submit_label: "Send it",
    form_fields: [
      { id: "full_name", label: "Full name", type: "text", required: true, placeholder: "Ada Lovelace" },
      { id: "work_email", label: "Work email", type: "email", required: true },
      { id: "budget", label: "Budget", type: "select", options: ["Under 5k", "5k to 20k"] },
    ],
  };
  record.resolved_branding = {
    ...record.resolved_branding,
    display_name: "Nova", tagline: "Answers in seconds", logo_url: "https://cdn.example.test/logo.png",
    position: "middle_left", theme: "ocean_blue",
    colors: { ...themePresets[0].colors },
    toggles: { transcription: true, chat: true, autostart: false, mute_on_minimize: true, mute_on_tab_change: false, show_lead_form: true, is_glowing: true, is_transparent: false, agent_mute: false },
  };
  record.resolved_lead_form = {
    enabled: true, prompt: "Can the team follow up?", after_turns: 2,
    heading: "Tell us where to reach you", submit_label: "Send it", privacy_text: "Used only for this follow-up.",
    fields: record.lead_capture.form_fields.map((field) => ({ ...field })),
  };
  return record;
}

// ---------------------------------------------------------------------------
// Autostart and the lead form are mutually exclusive. The server refuses a
// request carrying both, so the screen has to clear the other switch rather than
// send a pair it knows will be rejected.

test("turning on autostart turns off the lead form, and the other way round", () => {
  const draft = studio.studioDraftFromAgent(configuredAgentRecord());
  assert.equal(draft.toggles.show_lead_form, true);

  const autostarted = studio.setStudioToggle(draft, "autostart", true);
  assert.equal(autostarted.toggles.autostart, true);
  assert.equal(autostarted.toggles.show_lead_form, false, "enabling autostart must clear show_lead_form");

  const formShown = studio.setStudioToggle(autostarted, "show_lead_form", true);
  assert.equal(formShown.toggles.show_lead_form, true);
  assert.equal(formShown.toggles.autostart, false, "enabling show_lead_form must clear autostart");

  const payload = studio.studioPayloadFromDraft(formShown);
  assert.equal(payload.branding.toggles.autostart && payload.branding.toggles.show_lead_form, false, "a save can never carry both");
});

test("turning a switch off leaves its partner alone", () => {
  const draft = studio.studioDraftFromAgent(configuredAgentRecord());
  const cleared = studio.setStudioToggle(draft, "show_lead_form", false);

  assert.equal(cleared.toggles.show_lead_form, false);
  assert.equal(cleared.toggles.autostart, false, "switching one off must not switch the other on");
  assert.equal(cleared.toggles.chat, true, "the other seven switches are untouched");
});

// ---------------------------------------------------------------------------
// custom_colors, toggles and lead_capture each replace their stored value whole.
// A save that sends one switch resets the other eight, and a save that omits the
// prompt deletes it.

test("a save sends all nine switches and all five custom colours together", () => {
  const draft = studio.studioDraftFromAgent(configuredAgentRecord());
  const payload = studio.studioPayloadFromDraft(studio.setStudioToggle(draft, "agent_mute", true));

  assert.deepEqual(Object.keys(payload.branding.toggles).sort(), [...studio.widgetToggleKeys].sort(), "all nine switches ride together");
  assert.deepEqual(Object.keys(payload.branding.custom_colors).sort(), [...studio.customColorKeys].sort(), "all five custom colours ride together");
  assert.equal(payload.branding.toggles.transcription, true, "a switch the customer set earlier survives the save");
  assert.equal(payload.branding.toggles.agent_mute, true);
});

test("a save carries the lead capture keys the studio has no input for", () => {
  const draft = studio.studioDraftFromAgent(configuredAgentRecord());
  const payload = studio.studioPayloadFromDraft({ ...draft, formHeading: "New heading" });

  assert.equal(payload.lead_capture.prompt, "Can the team follow up?", "lead_capture is replaced whole, so the prompt has to ride along");
  assert.equal(payload.lead_capture.after_turns, 2);
  assert.equal(payload.lead_capture.privacy_text, "Used only for this follow-up.");
  assert.deepEqual(payload.lead_capture.fields, ["name", "email"]);
  assert.equal(payload.lead_capture.form_heading, "New heading");
});

// ---------------------------------------------------------------------------
// The server refuses options on anything but a select, so a field that used to
// be a dropdown must shed them before the save rather than after it.

test("a field that is no longer a dropdown sends no options", () => {
  const draft = studio.studioDraftFromAgent(configuredAgentRecord());
  const retyped = studio.updateLeadFormField(draft.formFields, 2, { type: "text" });
  assert.deepEqual(retyped[2].options, [], "the row drops its options the moment it stops being a dropdown");

  // Whatever a row happens to be holding, the body that reaches the server
  // carries options only on a select, because the server refuses them anywhere
  // else and the customer would see the rejection rather than the cause.
  const stubborn = { ...draft, formFields: draft.formFields.map((field, index) => (index === 2 ? { ...field, type: "text" } : field)) };
  const payload = studio.studioPayloadFromDraft(stubborn);
  assert.equal(payload.lead_capture.form_fields[2].type, "text");
  assert.deepEqual(payload.lead_capture.form_fields[2].options, [], "only a select may carry options");
});

test("a dropdown keeps its options", () => {
  const draft = studio.studioDraftFromAgent(configuredAgentRecord());
  const payload = studio.studioPayloadFromDraft(draft);

  assert.deepEqual(payload.lead_capture.form_fields[2].options, ["Under 5k", "5k to 20k"]);
});

// ---------------------------------------------------------------------------
// A field's identifier is the key its answers are stored under.

test("relabelling a field keeps the identifier its answers are stored under", () => {
  const draft = studio.studioDraftFromAgent(configuredAgentRecord());
  const relabelled = studio.updateLeadFormField(draft.formFields, 1, { label: "Company email" });

  assert.equal(relabelled[1].id, "work_email", "the identifier must survive a relabel");
  assert.equal(relabelled[1].label, "Company email");
});

test("an added field gets a slug of its own that collides with nothing", () => {
  const fields = [{ id: "custom_field", label: "Custom field", type: "text" }];
  const withOne = studio.addLeadFormField(fields);
  const withTwo = studio.addLeadFormField(withOne);

  assert.equal(withOne[1].id, "custom_field_2");
  assert.equal(withTwo[2].id, "custom_field_3");
  assert.equal(new Set(withTwo.map((field) => field.id)).size, 3, "identifiers are unique within the form");
  assert.equal(studio.slugifyLeadFieldID("Full name!"), "full_name");
});

test("fields stay in the order the customer put them in", () => {
  const draft = studio.studioDraftFromAgent(configuredAgentRecord());
  const moved = studio.moveLeadFormField(draft.formFields, 2, -1);

  assert.deepEqual(moved.map((field) => field.id), ["full_name", "budget", "work_email"]);
  assert.deepEqual(studio.moveLeadFormField(moved, 0, -1).map((field) => field.id), ["full_name", "budget", "work_email"], "moving past the top is a no-op");
  assert.deepEqual(studio.removeLeadFormField(moved, 1).map((field) => field.id), ["full_name", "work_email"]);
});

// ---------------------------------------------------------------------------
// An agent stored before any of this shipped has to open on today's widget.

test("an agent with none of the new keys opens on the widget it already shows", () => {
  const draft = studio.studioDraftFromAgent(legacyAgentRecord());

  assert.equal(draft.theme, "custom", "an absent theme means custom");
  assert.equal(draft.position, "bottom_right");
  assert.equal(draft.displayName, "", "the name is left empty so the agent's own name keeps showing");
  assert.equal(draft.toggles.chat, true, "chat stays on");
  assert.deepEqual(
    studio.widgetToggleKeys.filter((key) => draft.toggles[key]),
    ["chat"],
    "every other switch is off, exactly as the widget behaves today",
  );
  assert.deepEqual(draft.formFields.map((field) => field.id), ["name", "email"], "the builder opens on the form the widget already draws");
  assert.deepEqual(draft.formFields.map((field) => field.type), ["text", "email"]);
});

test("a named theme paints from the preset and leaves the customer's own colours stored", () => {
  const draft = studio.studioDraftFromAgent(configuredAgentRecord());

  assert.equal(draft.primaryColor, "#111827", "the stored colour is kept so switching back to custom restores it");
  assert.deepEqual(studio.resolveDraftColors(draft, themePresets), themePresets[0].colors, "a named preset wins outright");

  const backToCustom = { ...draft, theme: "custom" };
  assert.equal(studio.resolveDraftColors(backToCustom, themePresets).primary, "#111827");
  assert.equal(studio.resolveDraftColors(backToCustom, themePresets).on_primary, "#FFFFFF", "a foreground nobody set is derived from its fill");
});

// ---------------------------------------------------------------------------
// Unsaved work is not lost quietly.

test("a freshly loaded agent has nothing unsaved, and an edit says so", () => {
  const loaded = studio.studioDraftFromAgent(configuredAgentRecord());

  assert.equal(studio.hasUnsavedStudioChanges(loaded, loaded), false, "loading is not an edit");
  assert.equal(studio.hasUnsavedStudioChanges({ ...loaded, tagline: "Something else" }, loaded), true);
  assert.equal(studio.hasUnsavedStudioChanges(studio.setStudioToggle(loaded, "agent_mute", true), loaded), true);
  assert.equal(studio.hasUnsavedStudioChanges({ ...loaded, formFields: studio.addLeadFormField(loaded.formFields) }, loaded), true);
});

test("the draft rebuilt from a save response is clean again", () => {
  const record = configuredAgentRecord();
  const edited = { ...studio.studioDraftFromAgent(record), tagline: "Answers in seconds, day or night" };

  const saved = configuredAgentRecord();
  saved.branding.tagline = "Answers in seconds, day or night";
  saved.resolved_branding.tagline = "Answers in seconds, day or night";
  const afterSave = studio.studioDraftFromAgent(saved);

  assert.equal(studio.hasUnsavedStudioChanges(edited, studio.studioDraftFromAgent(record)), true, "the edit was unsaved before the response");
  assert.equal(studio.hasUnsavedStudioChanges(afterSave, afterSave), false, "the response becomes the new baseline");
});

// ---------------------------------------------------------------------------
// A rejected save has to name the colour pair that failed, not just "invalid".

test("a rejected save becomes per-field messages, contrast pairs included", () => {
  const rejection = new ApiError({
    code: "validation_failed",
    message: "One or more agent fields are invalid",
    request_id: "request-1",
    details: {
      "branding.contrast.text_on_background": "#FFFFFF on #FFFFFF has a contrast ratio of 1.00:1, below the 4.5:1 minimum",
      "branding.toggles": "autostart and show_lead_form are mutually exclusive; enabling one must disable the other",
      "lead_capture.form_fields.0.label": "must contain 1 to 80 characters",
    },
  });

  const messages = studio.studioFieldMessages(rejection);
  assert.equal(messages["branding.contrast.text_on_background"], "#FFFFFF on #FFFFFF has a contrast ratio of 1.00:1, below the 4.5:1 minimum");
  assert.equal(messages["lead_capture.form_fields.0.label"], "must contain 1 to 80 characters");

  const summary = studio.studioMessageSummary(messages);
  const contrastLine = summary.find((entry) => entry.key === "branding.contrast.text_on_background");
  assert.equal(contrastLine.label, "Text on the widget background", "the customer is told which pairing failed");
  assert.ok(contrastLine.message.includes("4.5:1 minimum"), "and why");
  assert.equal(summary.length, 3, "every rejected field reaches the customer, including ones with no input of their own");
});

test("a rejection with nothing usable in it produces no field messages", () => {
  assert.deepEqual(studio.studioFieldMessages(new ApiError({ code: "validation_failed", message: "Invalid" })), {});
  assert.deepEqual(studio.studioFieldMessages(new ApiError({ code: "stale_revision", message: "Reload", details: { current_revision: 9 } })), {});
  assert.deepEqual(studio.studioFieldMessages(new Error("network down")), {});
});

// A save carries the revision it was based on. When someone else has saved in
// between, no amount of correcting a field will help: the screen has to offer
// the newer record instead of asking the customer to click save again.
test("a save refused for being out of date is not treated as a bad field", () => {
  const conflict = new ApiError({ code: "stale_revision", message: "The agent has changed; reload before saving", details: { current_revision: 9 } });

  assert.equal(studio.isStaleRevision(conflict), true);
  assert.deepEqual(studio.studioFieldMessages(conflict), {}, "nothing on the form is wrong, so nothing on the form is marked");
  assert.equal(studio.isStaleRevision(new ApiError({ code: "validation_failed", message: "Invalid", details: { "branding.theme": "bad" } })), false);
  assert.equal(studio.isStaleRevision(new Error("network down")), false);
});

// ---------------------------------------------------------------------------
// The same readability rule the server enforces, applied before the save so the
// customer is warned while they are still looking at the colour.

test("unreadable colours are caught locally against the server's own floors", () => {
  const draft = studio.studioDraftFromAgent(legacyAgentRecord());
  const unreadable = { ...draft, customColors: { ...draft.customColors, text: "#FFFFFF", background: "#FFFFFF" } };
  const report = studio.contrastReport(studio.resolveDraftColors(unreadable, themePresets), contrastMinimums);
  const pair = report.find((entry) => entry.key === "branding.contrast.text_on_background");

  assert.equal(pair.passes, false);
  assert.equal(pair.ratio.toFixed(2), "1.00", "the same ratio the server would quote");
  assert.equal(pair.minimum, 4.5, "the floor comes from contrast_minimums, not from a number typed in the browser");

  const readable = studio.contrastReport(themePresets[0].colors, contrastMinimums);
  assert.deepEqual(readable.filter((entry) => !entry.passes), [], "a served preset never trips the warning");
});

test("a lead form that could not be submitted is refused before the save", () => {
  const noWayToReply = [{ id: "full_name", label: "Full name", type: "text", options: [] }];
  assert.ok(studio.leadFormWarnings(noWayToReply, true).some((warning) => warning.includes("email or phone")));

  const emptyDropdown = [
    { id: "work_email", label: "Work email", type: "email", options: [] },
    { id: "budget", label: "Budget", type: "select", options: ["Only one"] },
  ];
  assert.ok(studio.leadFormWarnings(emptyDropdown, true).some((warning) => warning.includes("at least two options")));

  const workable = [{ id: "work_email", label: "Work email", type: "email", options: [] }];
  assert.deepEqual(studio.leadFormWarnings(workable, true), []);
  assert.deepEqual(studio.leadFormWarnings(noWayToReply, false), [], "a hidden form is not nagged about");
});

// ---------------------------------------------------------------------------
// Loading states. Clicking twice because nothing said the first click landed is
// what produced a production 500, so the guard is a property of the control.

test("a second click while the first is still running is ignored", async () => {
  let started = 0;
  let release = () => {};
  const runner = controls.createAsyncActionRunner();
  const action = () => { started += 1; return new Promise((resolve) => { release = resolve; }); };

  const first = runner.run(action);
  const second = await runner.run(action);

  assert.equal(started, 1, "the second click must not start the work again");
  assert.equal(second.started, false, "and it reports that it did nothing");
  assert.equal(runner.isPending(), true);

  release();
  await first;
  assert.equal(runner.isPending(), false, "the button is usable again once the work lands");

  const third = await runner.run(async () => "done");
  assert.equal(third.started, true);
  assert.equal(third.value, "done");
});

test("a failed action still releases the button", async () => {
  const pendingStates = [];
  const runner = controls.createAsyncActionRunner((pending) => pendingStates.push(pending));

  await assert.rejects(runner.run(async () => { throw new Error("save rejected"); }));
  assert.equal(runner.isPending(), false, "a rejection must not leave the button stuck");
  assert.deepEqual(pendingStates, [true, false]);
});

test("a button that is working says so and refuses clicks", () => {
  const busy = renderToStaticMarkup(React.createElement(controls.AsyncButton, { pending: true, pendingLabel: "Saving…" }, "Save changes"));
  assert.ok(busy.includes('disabled=""'), "an in-flight button is disabled");
  assert.ok(busy.includes('aria-busy="true"'), "and says so to assistive technology");
  assert.ok(busy.includes("animate-spin"), "and shows a spinner");
  assert.ok(busy.includes("Saving…"), "and says what it is doing");
  assert.ok(!busy.includes("Save changes"), "the idle label is replaced while it works");

  const idle = renderToStaticMarkup(React.createElement(controls.AsyncButton, { pendingLabel: "Saving…" }, "Save changes"));
  assert.ok(!idle.includes('disabled=""'), "an idle button is clickable");
  assert.ok(idle.includes('aria-busy="false"'));
  assert.ok(!idle.includes("animate-spin"));
  assert.ok(idle.includes("Save changes"));
});

// ---------------------------------------------------------------------------
// The product has to run with no credentials configured at all, this screen
// included: a settings studio that cannot draw its own pickers without a server
// is not a settings studio.

test("the studio loads, edits and saves with no API configured", async () => {
  const previousApiUrl = process.env.NEXT_PUBLIC_API_URL;
  delete process.env.NEXT_PUBLIC_API_URL;
  try {
    const { widgetStudioApi } = requireFrontend("components/widget/widget-studio-api.ts");
    const agent = await widgetStudioApi.loadAgentStudio("demo-agent");

    assert.equal(agent.theme_presets.length, 6, "six themes to choose from");
    assert.equal(agent.positions.length, 6, "six placements");
    assert.equal(agent.lead_form_field_types.length, 8, "eight field types");

    const loaded = studio.studioDraftFromAgent(agent);
    const edited = studio.setStudioToggle({ ...loaded, displayName: "Nova", theme: "royal_purple" }, "show_lead_form", true);
    assert.equal(studio.hasUnsavedStudioChanges(edited, loaded), true);

    const saved = await widgetStudioApi.saveAgentStudio("demo-agent", studio.studioPayloadFromDraft(edited), agent.revision);
    assert.equal(saved.resolved_branding.display_name, "Nova");
    assert.equal(saved.resolved_branding.toggles.show_lead_form, true);
    assert.equal(saved.revision, agent.revision + 1);
    assert.equal(studio.hasUnsavedStudioChanges(studio.studioDraftFromAgent(saved), studio.studioDraftFromAgent(saved)), false, "the saved record is the new baseline");
  } finally {
    if (previousApiUrl !== undefined) process.env.NEXT_PUBLIC_API_URL = previousApiUrl;
  }
});

// ---------------------------------------------------------------------------
// What the customer is actually shown.

function draftFor(record) {
  return studio.studioDraftFromAgent(record);
}

test("the theme picker offers six named schemes, described by the server", () => {
  const draft = draftFor(configuredAgentRecord());
  const markup = renderToStaticMarkup(React.createElement(sections.ThemeSection, {
    draft,
    presets: themePresets,
    minimums: contrastMinimums,
    messages: {},
    onChange: () => undefined,
  }));

  for (const preset of themePresets) {
    assert.ok(markup.includes(preset.label), `${preset.label} is offered`);
    assert.ok(markup.includes(preset.description), `${preset.label} carries its description`);
  }
  assert.equal(markup.match(/aria-pressed="true"/g).length, 1, "exactly one card reads as selected");
  assert.ok(markup.includes('aria-label="Ocean blue theme" class'), "and it is the stored one");
  assert.ok(!markup.includes("Custom colors"), "the colour inputs stay hidden until custom is chosen");

  const custom = renderToStaticMarkup(React.createElement(sections.ThemeSection, {
    draft: { ...draft, theme: "custom" },
    presets: themePresets,
    minimums: contrastMinimums,
    messages: {},
    onChange: () => undefined,
  }));
  assert.ok(custom.includes("Custom colors"), "choosing custom reveals the colour inputs");
  assert.ok(custom.includes("Text on primary"), "including the derived foregrounds");
});

test("the theme picker never invents a palette of its own", () => {
  const retuned = themePresets.map((preset) => (preset.id === "ocean_blue" ? { ...preset, label: "Harbour blue", description: "Retuned on the server" } : preset));
  const markup = renderToStaticMarkup(React.createElement(sections.ThemeSection, {
    draft: draftFor(configuredAgentRecord()),
    presets: retuned,
    minimums: contrastMinimums,
    messages: {},
    onChange: () => undefined,
  }));

  assert.ok(markup.includes("Harbour blue"), "the label comes from the response");
  assert.ok(markup.includes("Retuned on the server"));
  assert.ok(!markup.includes("Calm and professional"), "nothing is hardcoded in the screen");
});

test("the position picker draws six placements rather than a dropdown", () => {
  const markup = renderToStaticMarkup(React.createElement(sections.PositionSection, {
    draft: draftFor(configuredAgentRecord()),
    positions,
    messages: {},
    onChange: () => undefined,
  }));

  for (const label of ["Bottom right", "Bottom left", "Middle right", "Middle left", "Top right", "Top left"]) {
    assert.ok(markup.includes(label), `${label} is offered`);
  }
  assert.ok(!markup.includes("<select"), "the owner asked for placements, not a dropdown");
  assert.equal(markup.match(/aria-pressed="true"/g).length, 1);
  assert.ok(markup.includes('aria-label="Middle left"'), "the stored placement is one of the six");
});

test("all nine switches are shown, and the exclusive pair explains itself", () => {
  const markup = renderToStaticMarkup(React.createElement(sections.TogglesSection, {
    draft: draftFor(configuredAgentRecord()),
    messages: {},
    onToggle: () => undefined,
  }));

  for (const key of studio.widgetToggleKeys) {
    assert.ok(markup.includes(studio.toggleDescriptions[key].title), `${key} has a switch`);
  }
  assert.equal(markup.match(/role="switch"/g).length, 9, "nine switches, no more and no fewer");
  assert.ok(markup.includes("mutually exclusive"), "the rule is stated where the customer can see it");
});

test("the lead form builder edits the form, and hides behind its own switch", () => {
  const draft = draftFor(configuredAgentRecord());
  const markup = renderToStaticMarkup(React.createElement(leadFormBuilder.LeadFormBuilder, {
    draft,
    fieldTypes: leadFormFieldTypes,
    reservedIDs: reservedLeadFieldIDs,
    messages: { "lead_capture.form_fields.0.label": "must contain 1 to 80 characters" },
    onChange: () => undefined,
  }));

  assert.ok(markup.includes("Tell us where to reach you"), "the heading the customer wrote");
  assert.ok(markup.includes("Send it"), "and their submit button text");
  assert.ok(markup.includes("Full name") && markup.includes("Work email") && markup.includes("Budget"), "every field is listed");
  assert.ok(markup.includes("Under 5k"), "a dropdown shows its options");
  assert.ok(markup.includes("Add custom field"), "and a custom field can be added");
  assert.ok(markup.includes("must contain 1 to 80 characters"), "a rejected field says what is wrong with it");
  for (const type of leadFormFieldTypes) {
    assert.ok(markup.includes(`value="${type}"`), `${type} can be chosen`);
  }

  const hidden = renderToStaticMarkup(React.createElement(leadFormBuilder.LeadFormBuilder, {
    draft: studio.setStudioToggle(draft, "show_lead_form", false),
    fieldTypes: leadFormFieldTypes,
    reservedIDs: reservedLeadFieldIDs,
    messages: {},
    onChange: () => undefined,
  }));
  assert.ok(!hidden.includes("Add custom field"), "the builder is shown only when the form is");
  assert.ok(hidden.includes("Show lead form"), "and says how to bring it back");
});

test("the studio explains itself before its agent has arrived", () => {
  const { WidgetStudio } = requireFrontend("components/widget/widget-studio.tsx");

  const waiting = renderToStaticMarkup(React.createElement(WidgetStudio, { agentId: "agent-1" }));
  assert.ok(waiting.includes("Loading this agent"), "a request in flight says so rather than showing an empty form");
  assert.ok(waiting.includes("animate-spin"));

  const nothingToEdit = renderToStaticMarkup(React.createElement(WidgetStudio, { agentId: "" }));
  assert.ok(nothingToEdit.includes("No agent to customize yet"), "an account with no agent is told what to do");
  assert.ok(!nothingToEdit.includes("Save changes"), "and is not offered a save that would go nowhere");
});

test("the identity section names the fields the widget header shows", () => {
  const markup = renderToStaticMarkup(React.createElement(sections.IdentitySection, {
    draft: draftFor(configuredAgentRecord()),
    agentName: "Aria",
    messages: { "branding.tagline": "must not exceed 140 characters" },
    onChange: () => undefined,
  }));

  assert.ok(markup.includes("Bot display name"));
  assert.ok(markup.includes('value="Nova"'));
  assert.ok(markup.includes('value="Answers in seconds"'));
  assert.ok(markup.includes("must not exceed 140 characters"), "the server's rejection is shown against the field");
});

test("the logo section previews the logo and can clear it", () => {
  const markup = renderToStaticMarkup(React.createElement(sections.LogoSection, {
    draft: draftFor(configuredAgentRecord()),
    messages: { "branding.logo_url": "must be an absolute HTTPS URL" },
    onChange: () => undefined,
  }));

  assert.ok(markup.includes("https://cdn.example.test/logo.png"), "the logo is previewed");
  assert.ok(markup.includes('aria-label="Remove the chat logo"'), "and can be removed");
  assert.ok(markup.includes("must be an absolute HTTPS URL"));

  const withoutLogo = renderToStaticMarkup(React.createElement(sections.LogoSection, {
    draft: { ...draftFor(configuredAgentRecord()), logoUrl: "" },
    messages: {},
    onChange: () => undefined,
  }));
  assert.ok(withoutLogo.includes("Monogram"), "the monogram is the fallback");
  assert.ok(!withoutLogo.includes("<img"), "and no broken image is drawn");
});
