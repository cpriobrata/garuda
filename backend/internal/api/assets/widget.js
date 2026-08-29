/*! Garuda Widget v1.0.0
 * Dependency-free website assistant loader.
 * Public agent keys identify published agents; session credentials stay in memory.
 */
(function garudaWidgetRuntime(global) {
  'use strict';

  var VERSION = '1.0.0';
  var MAX_MESSAGE_LENGTH = 4000;
  var MAX_HISTORY = 50;
  var REQUEST_TIMEOUT_MS = 20000;
  var MESSAGE_REQUEST_TIMEOUT_MS = 60000;
  var STREAM_IDLE_TIMEOUT_MS = 30000;
  var DEFAULT_ACCENT = '#4F46E5';
  // The palette the widget painted with before themes existed. It is the only
  // colour table in this file: every other colour arrives already resolved from
  // the server, so a new preset never needs a widget release on somebody else's
  // website.
  var DEFAULT_COLORS = {
    primary: '#111827',
    accent: DEFAULT_ACCENT,
    background: '#FFFFFF',
    surface: '#F3F4F6',
    text: '#111827',
    onPrimary: '#FFFFFF',
    onAccent: '#FFFFFF'
  };
  // The lead endpoint stores these four as columns on the lead. Every other
  // field the customer builds travels in custom_fields and lands as metadata.
  var RESERVED_LEAD_FIELDS = ['name', 'email', 'phone', 'company'];
  var WIDGET_POSITIONS = [
    'bottom_right', 'bottom_left', 'middle_right', 'middle_left', 'top_right', 'top_left'
  ];
  var LEAD_FIELD_TYPES = [
    'text', 'email', 'telephone', 'number', 'textarea', 'select', 'checkbox', 'date'
  ];
  var LEAD_INPUT_TYPES = { text: 'text', email: 'email', telephone: 'tel', number: 'number', date: 'date' };
  var LEAD_AUTOCOMPLETE = { name: 'name', email: 'email', phone: 'tel', company: 'organization' };
  var LEGACY_LEAD_TYPES = { name: 'text', email: 'email', phone: 'telephone', company: 'text' };
  var LEGACY_LEAD_LABELS = { name: 'Name', email: 'Email', phone: 'Phone', company: 'Company' };
  // Both limits mirror what the lead endpoint accepts, so the widget never
  // builds a submission the server has to refuse.
  var MAX_LEAD_FORM_FIELDS = 20;
  var MAX_LEAD_FIELD_OPTIONS = 20;
  var MAX_LEAD_VALUE_LENGTH = 500;

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function asText(value, fallback, maxLength) {
    if (typeof value !== 'string') return fallback;
    var normalized = value.replace(/\u0000/g, '').trim();
    if (!normalized) return fallback;
    return normalized.slice(0, maxLength || 500);
  }

  function safeTextList(value, maxItems, maxLength) {
    if (!Array.isArray(value)) return [];
    var result = [];
    value.forEach(function (item) {
      var normalized = asText(item, '', maxLength || 160);
      if (normalized && result.indexOf(normalized) === -1 && result.length < maxItems) {
        result.push(normalized);
      }
    });
    return result;
  }

  function streamText(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.replace(/\u0000/g, '').slice(0, maxLength || MAX_MESSAGE_LENGTH * 2);
  }

  function safeColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    var candidate = value.trim();
    return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toUpperCase() : fallback;
  }

  function safeHttpUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return '';
    try {
      var parsed = new URL(value);
      if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
        return parsed.href.slice(0, 2048);
      }
    } catch (_error) {
      return '';
    }
    return '';
  }

  function normalizePosition(value) {
    return WIDGET_POSITIONS.indexOf(value) === -1 ? 'bottom_right' : value;
  }

  // A logo is fetched by the visitor's browser on a page the customer does not
  // always control, so only https is rendered: an http image on an https page is
  // blocked as mixed content and would show as a broken icon.
  function safeImageURL(value) {
    var resolved = safeHttpUrl(value);
    return resolved.indexOf('https://') === 0 ? resolved : '';
  }

  function safeSlug(value, maxLength) {
    if (typeof value !== 'string') return '';
    var slug = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
    return slug.slice(0, maxLength || 64);
  }

  // A toggle the customer never chose arrives absent or null, and only a real
  // boolean is allowed to override the default. That is what keeps chat switched
  // on for every agent published before the switches existed.
  function normalizeToggles(raw) {
    var payload = isRecord(raw) ? raw : {};
    function chosen(key, fallback) {
      return typeof payload[key] === 'boolean' ? payload[key] : fallback;
    }
    var toggles = {
      transcription: chosen('transcription', false),
      chat: chosen('chat', true),
      autostart: chosen('autostart', false),
      muteOnMinimize: chosen('mute_on_minimize', false),
      muteOnTabChange: chosen('mute_on_tab_change', false),
      showLeadForm: chosen('show_lead_form', false),
      isGlowing: chosen('is_glowing', false),
      isTransparent: chosen('is_transparent', false),
      agentMute: chosen('agent_mute', false)
    };
    // The server refuses to store both and forces autostart off when stored
    // state somehow holds both. The widget resolves it the same way rather than
    // opening itself and immediately covering the conversation with a form.
    if (toggles.autostart && toggles.showLeadForm) toggles.autostart = false;
    return toggles;
  }

  // Colours are resolved by the server; the widget only checks that each one is
  // something it can paint with. A foreground the payload omits is derived from
  // its own fill, so text stays legible on whatever the fill turned out to be.
  function normalizeThemeColors(raw, accentFallback, primaryFallback) {
    var payload = isRecord(raw) ? raw : {};
    var primary = safeColor(payload.primary, primaryFallback);
    var accent = safeColor(payload.accent, accentFallback);
    return {
      primary: primary,
      accent: accent,
      background: safeColor(payload.background, DEFAULT_COLORS.background),
      surface: safeColor(payload.surface, DEFAULT_COLORS.surface),
      text: safeColor(payload.text, DEFAULT_COLORS.text),
      onPrimary: safeColor(payload.on_primary, contrastText(primary)),
      onAccent: safeColor(payload.on_accent, contrastText(accent))
    };
  }

  // The form the widget has always drawn, expressed in the shape the builder
  // uses. It is what an agent that predates the builder resolves to, and what a
  // bootstrap that does not carry a form yet falls back to.
  function legacyLeadFormFields(names) {
    var fields = [];
    (Array.isArray(names) ? names : []).forEach(function (name) {
      var identifier = safeSlug(name, 64);
      if (!identifier) return;
      fields.push({
        id: identifier,
        label: LEGACY_LEAD_LABELS[identifier] || asText(name, identifier, 80),
        type: LEGACY_LEAD_TYPES[identifier] || 'text',
        required: false,
        options: [],
        placeholder: ''
      });
    });
    return fields;
  }

  function normalizeLeadFormField(raw) {
    if (!isRecord(raw)) return null;
    var identifier = safeSlug(raw.id, 64);
    var label = asText(raw.label, '', 80);
    if (!identifier || !label) return null;
    var type = asText(raw.type, 'text', 24).toLowerCase();
    if (LEAD_FIELD_TYPES.indexOf(type) === -1) type = 'text';
    var options = type === 'select' ? safeTextList(raw.options, MAX_LEAD_FIELD_OPTIONS, 80) : [];
    // A select with nothing to select is a dead control. Rendering it as a text
    // box keeps the customer's field, and its answers, rather than dropping it.
    if (type === 'select' && !options.length) type = 'text';
    return {
      id: identifier,
      label: label,
      type: type,
      required: raw.required === true,
      options: options,
      placeholder: asText(raw.placeholder, '', 120)
    };
  }

  function normalizeLeadForm(raw, legacyFields) {
    var payload = isRecord(raw) ? raw : {};
    var fields = [];
    if (Array.isArray(payload.fields)) {
      payload.fields.slice(0, MAX_LEAD_FORM_FIELDS).forEach(function (field) {
        var normalized = normalizeLeadFormField(field);
        if (normalized) fields.push(normalized);
      });
    }
    var fromServer = fields.length > 0;
    if (!fromServer) {
      fields = legacyLeadFormFields(
        legacyFields && legacyFields.length ? legacyFields : ['name', 'email', 'phone']
      );
    }
    return {
      // Copy the customer authored is used only when the bootstrap really
      // carried a form. Until then the widget keeps the wording it ships with.
      fromServer: fromServer,
      heading: asText(payload.heading, '', 120),
      submitLabel: asText(payload.submit_label, '', 40),
      prompt: asText(payload.prompt, '', 300),
      privacyText: asText(payload.privacy_text, '', 300),
      fields: fields
    };
  }

  function validateAgentKey(value) {
    return typeof value === 'string' && /^pub_[A-Za-z0-9_-]{4,160}$/.test(value);
  }

  function storageKey(kind, agentKey) {
    return 'garuda:v1:' + kind + ':' + agentKey;
  }

  function clearVisitorMemory(storage, agentKey) {
    if (!storage) return;
    storage.removeItem(storageKey('visitor', agentKey));
    storage.removeItem(storageKey('demo-history', agentKey));
  }

  function validOpaqueToken(value) {
    return typeof value === 'string' &&
      value.length >= 16 &&
      value.length <= 2048 &&
      /^[A-Za-z0-9._~-]+$/.test(value);
  }

  function normalizeMessage(raw) {
    if (!isRecord(raw)) return null;
    var role = raw.role === 'user' ? 'user' : raw.role === 'assistant' ? 'assistant' : '';
    var content = asText(raw.content, '', MAX_MESSAGE_LENGTH * 2);
    if (!role || !content) return null;
    return {
      id: asText(raw.id, randomID(), 180),
      role: role,
      content: content,
      createdAt: asText(raw.created_at, '', 80)
    };
  }

  function normalizeAgentPayload(payload) {
    var envelope = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    var raw = isRecord(envelope) && isRecord(envelope.agent) ? envelope.agent : envelope;
    raw = isRecord(raw) ? raw : {};
    var lead = isRecord(raw.lead_capture) ? raw.lead_capture : {};
    var rawLeadFields = raw.lead_capture_fields || raw.lead_fields || lead.fields;
    var fields = safeTextList(rawLeadFields, 4, 24).filter(function (field) {
      return RESERVED_LEAD_FIELDS.indexOf(field) !== -1;
    });
    var leadFormPayload = isRecord(raw.lead_form) ? raw.lead_form : null;
    // accent_color and primary_color are what the bootstrap has always carried.
    // theme_colors is what it carries once branding is resolved server side, and
    // it wins where present, so a widget already embedded on a customer site
    // repaints itself from the theme without being rebuilt.
    var accentColor = safeColor(raw.accent_color || raw.primary_color, DEFAULT_ACCENT);
    var colors = normalizeThemeColors(
      raw.theme_colors,
      accentColor,
      safeColor(raw.primary_color, DEFAULT_COLORS.primary)
    );
    return {
      displayName: asText(raw.display_name || raw.name, 'Garuda Assistant', 80),
      welcomeMessage: asText(
        raw.welcome_message,
        'Hi! How can I help you today?',
        1000
      ),
      suggestedPrompts: safeTextList(
        raw.suggested_prompts || raw.suggested_replies,
        4,
        180
      ),
      tagline: asText(raw.tagline, '', 140),
      logoUrl: safeImageURL(raw.logo_url),
      theme: safeSlug(raw.theme, 40),
      colors: colors,
      accentColor: colors.accent,
      toggles: normalizeToggles(raw.toggles),
      leadForm: normalizeLeadForm(leadFormPayload, fields),
      position: normalizePosition(raw.position),
      privacyUrl: safeHttpUrl(raw.privacy_url),
      memoryEnabled: raw.memory_enabled !== false,
      leadCaptureEnabled: Boolean(
        raw.lead_capture_enabled === true ||
        lead.enabled === true ||
        (leadFormPayload && leadFormPayload.enabled === true)
      ),
      leadFields: fields.length ? fields : ['name', 'email', 'phone'],
      requiredLeadFields: safeTextList(
        raw.required_lead_fields || lead.required_fields,
        4,
        24
      ).filter(function (field) {
        return RESERVED_LEAD_FIELDS.indexOf(field) !== -1;
      }),
      launcherLabel: asText(raw.launcher_label || raw.launcher_text, '', 50)
    };
  }

  function normalizeLeadSpec(raw, agent) {
    raw = isRecord(raw) ? raw : {};
    var requested = safeTextList(raw.fields, 4, 24).filter(function (field) {
      return RESERVED_LEAD_FIELDS.indexOf(field) !== -1;
    });
    var required = safeTextList(raw.required_fields, 4, 24).filter(function (field) {
      return RESERVED_LEAD_FIELDS.indexOf(field) !== -1;
    });
    var fields = requested.length ? requested : agent.leadFields;
    if (fields.indexOf('email') === -1 && fields.indexOf('phone') === -1) {
      fields = fields.concat('email');
    }
    var fallbackRequired = [];
    if (fields.indexOf('email') !== -1) fallbackRequired = ['email'];
    else if (fields.indexOf('phone') !== -1) fallbackRequired = ['phone'];
    var selectedRequired = required.length ? required : agent.requiredLeadFields;
    selectedRequired = selectedRequired.filter(function (field) {
      return fields.indexOf(field) !== -1;
    });
    return {
      fields: fields.length ? fields : ['name', 'email', 'phone'],
      requiredFields: selectedRequired.length ? selectedRequired : fallbackRequired,
      reason: asText(raw.reason, '', 80),
      prompt: asText(raw.prompt, 'Share only what you are comfortable with.', 300),
      privacyText: asText(raw.privacy_text, '', 300)
    };
  }

  function normalizeSessionPayload(payload) {
    var data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    if (!isRecord(data)) throw new WidgetError('invalid_response', 'The assistant returned an invalid session.', 502);
    var conversation = isRecord(data.conversation) ? data.conversation : {};
    var messages = Array.isArray(conversation.messages)
      ? conversation.messages.map(normalizeMessage).filter(Boolean).slice(-MAX_HISTORY)
      : [];
    var sessionID = asText(data.session_id, '', 180);
    var sessionToken = asText(data.session_token, '', 4096);
    if (!sessionID || !sessionToken) {
      throw new WidgetError('invalid_response', 'The assistant returned an invalid session.', 502);
    }
    return {
      sessionID: sessionID,
      sessionToken: sessionToken,
      expiresAt: asText(data.expires_at, '', 80),
      visitorToken: validOpaqueToken(data.visitor_token) ? data.visitor_token : '',
      conversation: {
        id: asText(conversation.id, '', 180),
        resumed: conversation.resumed === true,
        messages: messages
      },
      agent: normalizeAgentPayload(data.agent || {})
    };
  }

  function parseSSEBlock(block) {
    var eventName = 'message';
    var data = [];
    block.split(/\r?\n/).forEach(function (line) {
      if (!line || line.charAt(0) === ':') return;
      var separator = line.indexOf(':');
      var field = separator === -1 ? line : line.slice(0, separator);
      var value = separator === -1 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') eventName = value || 'message';
      if (field === 'data') data.push(value);
    });
    if (!data.length) return null;
    var rawData = data.join('\n');
    var decoded = rawData;
    try {
      decoded = JSON.parse(rawData);
    } catch (_error) {
      decoded = { text: rawData };
    }
    return { event: eventName, data: decoded };
  }

  function createSSEParser(onEvent) {
    var buffer = '';
    function drain(final) {
      buffer = buffer.replace(/\r\n/g, '\n');
      var boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        var block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        var parsed = parseSSEBlock(block);
        if (parsed) onEvent(parsed);
        boundary = buffer.indexOf('\n\n');
      }
      if (final && buffer.trim()) {
        var last = parseSSEBlock(buffer);
        if (last) onEvent(last);
        buffer = '';
      }
    }
    return {
      push: function (chunk) {
        buffer += chunk;
        drain(false);
      },
      finish: function () {
        drain(true);
      }
    };
  }

  function randomID() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(16);
      global.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, '0');
      }).join('');
    }
    return 'client_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  function opaqueDemoToken() {
    if (global.crypto && typeof global.crypto.getRandomValues === 'function') {
      var bytes = new Uint8Array(32);
      global.crypto.getRandomValues(bytes);
      var binary = '';
      bytes.forEach(function (byte) {
        binary += String.fromCharCode(byte);
      });
      return global.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return 'demo_' + randomID() + randomID();
  }

  function contrastText(hex) {
    var red = parseInt(hex.slice(1, 3), 16);
    var green = parseInt(hex.slice(3, 5), 16);
    var blue = parseInt(hex.slice(5, 7), 16);
    var luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
    return luminance > 0.61 ? '#111827' : '#FFFFFF';
  }

  function truncate(value, maximum) {
    return typeof value === 'string' ? value.slice(0, maximum) : '';
  }

  function getStorage() {
    try {
      var storage = global.localStorage;
      var probe = 'garuda:storage-probe';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return storage;
    } catch (_error) {
      return null;
    }
  }

  function readJSON(storage, key, fallback) {
    if (!storage) return fallback;
    try {
      var value = JSON.parse(storage.getItem(key));
      return value === null ? fallback : value;
    } catch (_error) {
      return fallback;
    }
  }

  function element(tag, className, textValue) {
    var node = global.document.createElement(tag);
    if (className) node.className = className;
    if (typeof textValue === 'string') node.textContent = textValue;
    return node;
  }

  function svgIcon(pathData, viewBox) {
    var svg = global.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', viewBox || '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var path = global.document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.9');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  // Every control that starts network work owns its own busy state. The owner
  // reported clicking twice and three times because nothing said the first click
  // had landed, and a doubled submit is what produced a duplicate write, so a
  // control in flight refuses further clicks and says that it is working.
  function setButtonBusy(button, busy, busyLabel, idleLabel) {
    if (!button) return;
    button.disabled = Boolean(busy);
    button.setAttribute('aria-busy', String(Boolean(busy)));
    button.classList.toggle('gw-busy', Boolean(busy));
    var label = busy ? busyLabel : idleLabel;
    if (typeof label === 'string' && label) button.textContent = label;
  }

  function wait(milliseconds) {
    return new Promise(function (resolve) {
      global.setTimeout(resolve, milliseconds);
    });
  }

  function WidgetError(code, message, status, details) {
    this.name = 'WidgetError';
    this.code = code || 'request_failed';
    this.message = message || 'Something went wrong.';
    this.status = status || 0;
    this.details = isRecord(details) ? details : {};
  }
  WidgetError.prototype = Object.create(Error.prototype);
  WidgetError.prototype.constructor = WidgetError;

  // The error envelope's details object names the fields a request failed on.
  // Only string values are kept, and only for keys that look like field paths,
  // because these strings are rendered next to the visitor's own inputs.
  function safeErrorDetails(raw) {
    if (!isRecord(raw)) return {};
    var details = {};
    Object.keys(raw).slice(0, MAX_LEAD_FORM_FIELDS + 4).forEach(function (key) {
      var name = asText(key, '', 96);
      var value = asText(raw[key], '', 240);
      if (name && value && /^[A-Za-z0-9_.-]+$/.test(name)) details[name] = value;
    });
    return details;
  }

  async function safeErrorFromResponse(response) {
    var message = 'The assistant could not complete that request.';
    var code = 'request_failed';
    var details = {};
    try {
      var body = await response.json();
      if (isRecord(body) && isRecord(body.error)) {
        code = asText(body.error.code, code, 80);
        message = asText(body.error.message, message, 240);
        details = safeErrorDetails(body.error.details);
      }
    } catch (_error) {
      // The public UI deliberately ignores raw server bodies.
    }
    return new WidgetError(code, message, response.status, details);
  }

  // A deadline owns the abort controller for one request and the single timer
  // that fires it. Streaming responses keep the deadline alive past the response
  // headers and push it out on every chunk, because a header timeout on its own
  // is cleared the moment the headers arrive: a stream that stalls after that
  // left the widget waiting on a read that never resolved, with the composer
  // disabled and no retry notice, until the visitor reloaded the page.
  function createRequestDeadline(timeoutMs) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    var deadline = {
      signal: controller ? controller.signal : null,
      expired: false,
      clear: function () {
        if (timer === null) return;
        global.clearTimeout(timer);
        timer = null;
      },
      extend: function (milliseconds) {
        deadline.clear();
        timer = global.setTimeout(function () {
          timer = null;
          deadline.expired = true;
          if (controller) controller.abort();
        }, milliseconds);
      }
    };
    deadline.extend(timeoutMs || REQUEST_TIMEOUT_MS);
    return deadline;
  }

  function streamFailure(error, deadline) {
    var stalled = Boolean(deadline && deadline.expired) ||
      Boolean(error && error.name === 'AbortError');
    if (stalled) {
      return new WidgetError('stream_timeout', 'The assistant stopped responding. Please try again.', 0);
    }
    return new WidgetError('stream_error', 'The response was interrupted. Please try again.', 0);
  }

  function LiveAPI(config) {
    this.origin = config.apiOrigin;
    this.agentKey = config.agentKey;
  }

  LiveAPI.prototype.request = async function request(path, options, timeoutMs, deadline) {
    var activeDeadline = deadline || createRequestDeadline(timeoutMs);
    var settings = Object.assign({
      method: 'GET',
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      referrerPolicy: 'strict-origin-when-cross-origin'
    }, options || {});
    if (activeDeadline.signal) settings.signal = activeDeadline.signal;
    try {
      return await global.fetch(this.origin + path, settings);
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new WidgetError('request_timeout', 'The assistant took too long to respond.', 0);
      }
      throw new WidgetError('network_error', 'We could not reach the assistant. Check your connection and try again.', 0);
    } finally {
      // A caller that supplied the deadline keeps it running for the response body.
      if (!deadline) activeDeadline.clear();
    }
  };

  LiveAPI.prototype.getAgent = async function getAgent() {
    var response = await this.request('/widget/v1/agents/' + encodeURIComponent(this.agentKey));
    if (!response.ok) throw await safeErrorFromResponse(response);
    return normalizeAgentPayload(await response.json());
  };

  LiveAPI.prototype.createSession = async function createSession(options) {
    var page = {
      url: truncate(global.location && global.location.href, 2000),
      title: truncate(global.document.title, 300),
      referrer: truncate(global.document.referrer, 2000)
    };
    var body = {
      agent_key: this.agentKey,
      page: page,
      locale: truncate(global.navigator && global.navigator.language, 32) || 'en',
      consent: {
        memory: options.memory === true,
        analytics: options.analytics === true
      }
    };
    if (options.memory && validOpaqueToken(options.visitorToken)) {
      body.visitor_token = options.visitorToken;
    }
    var response = await this.request('/widget/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw await safeErrorFromResponse(response);
    return normalizeSessionPayload(await response.json());
  };

  LiveAPI.prototype.sendMessage = async function sendMessage(session, request, handlers) {
    var deadline = createRequestDeadline(MESSAGE_REQUEST_TIMEOUT_MS);
    try {
      var response = await this.request(
        '/widget/v1/sessions/' + encodeURIComponent(session.sessionID) + '/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream, application/json',
            'X-Garuda-Session-Token': session.sessionToken
          },
          body: JSON.stringify({
            client_message_id: request.clientMessageID,
            content: request.content
          })
        },
        MESSAGE_REQUEST_TIMEOUT_MS,
        deadline
      );
      if (!response.ok) throw await safeErrorFromResponse(response);
      var contentType = (response.headers.get('Content-Type') || '').toLowerCase();
      if (contentType.indexOf('text/event-stream') === -1) {
        var json = await response.json();
        var data = isRecord(json) && isRecord(json.data) ? json.data : json;
        data = isRecord(data) ? data : {};
        var assistant = normalizeMessage(data.assistant_message);
        if (!assistant) {
          throw new WidgetError('invalid_response', 'The assistant returned an invalid message.', 502);
        }
        handlers.onStart(assistant.id);
        handlers.onDelta(assistant.content);
        if (data.lead_capture_requested === true) {
          handlers.onLead(isRecord(data.lead_capture) ? data.lead_capture : {});
        }
        handlers.onDone(data);
        return { message: assistant, leadRequested: data.lead_capture_requested === true };
      }
      return await consumeEventStream(response, handlers, deadline);
    } finally {
      deadline.clear();
    }
  };

  LiveAPI.prototype.captureLead = async function captureLead(session, request) {
    var response = await this.request(
      '/widget/v1/sessions/' + encodeURIComponent(session.sessionID) + '/leads',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Garuda-Session-Token': session.sessionToken
        },
        body: JSON.stringify(leadRequestBody(request))
      }
    );
    if (!response.ok) throw await safeErrorFromResponse(response);
    var json = await response.json();
    return isRecord(json) && isRecord(json.data) ? json.data : json;
  };

  // Reserved answers travel in the fields object the deployed widget has always
  // sent; everything the customer added travels in custom_fields, which is where
  // the endpoint expects a field it does not have a column for.
  function leadRequestBody(request) {
    var body = {
      client_capture_id: request.clientCaptureID,
      fields: request.fields,
      consent: {
        granted: true,
        notice_version: 'garuda-widget-v1'
      }
    };
    if (isRecord(request.customFields) && Object.keys(request.customFields).length) {
      body.custom_fields = request.customFields;
    }
    return body;
  }

  async function consumeEventStream(response, handlers, deadline) {
    var assembled = '';
    var messageID = '';
    var finalData = {};
    var leadRequested = false;
    var streamError = null;
    function accept(event) {
      var type = event.event;
      var data = isRecord(event.data) ? event.data : {};
      if (type === 'message.start' || type === 'meta') {
        messageID = asText(data.message_id || data.id, messageID || randomID(), 180);
        handlers.onStart(messageID);
        return;
      }
      if (type === 'message.delta' || type === 'delta') {
        var piece = streamText(data.text || data.delta || data.content, MAX_MESSAGE_LENGTH * 2);
        if (piece) {
          assembled += piece;
          handlers.onDelta(piece);
        }
        return;
      }
      if (type === 'lead.form' || type === 'lead') {
        leadRequested = true;
        handlers.onLead(data);
        return;
      }
      if (type === 'message.done' || type === 'done') {
        finalData = data;
        if (data.lead_capture_requested === true) {
          leadRequested = true;
          handlers.onLead(
            isRecord(data.lead_form)
              ? data.lead_form
              : isRecord(data.lead_capture)
                ? data.lead_capture
                : {}
          );
        }
        handlers.onDone(data);
        return;
      }
      if (type === 'error') {
        streamError = new WidgetError(
          asText(data.code, 'stream_error', 80),
          asText(data.message, 'The response was interrupted. Please try again.', 240),
          0
        );
      }
    }
    var parser = createSSEParser(accept);
    if (response.body && typeof response.body.getReader === 'function') {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      // Every chunk buys the stream another quiet period. When one does not
      // arrive in time the deadline aborts the request, the pending read rejects,
      // and the visible retry notice takes over instead of the widget hanging.
      if (deadline) deadline.extend(STREAM_IDLE_TIMEOUT_MS);
      try {
        while (true) {
          var chunk = await reader.read();
          if (chunk.done) break;
          if (deadline) deadline.extend(STREAM_IDLE_TIMEOUT_MS);
          parser.push(decoder.decode(chunk.value, { stream: true }));
          if (streamError) {
            try { await reader.cancel(); } catch (_error) { /* no-op */ }
            break;
          }
        }
        parser.push(decoder.decode());
      } catch (error) {
        try { await reader.cancel(); } catch (_cancelError) { /* no-op */ }
        throw streamFailure(error, deadline);
      }
      parser.finish();
    } else {
      try {
        parser.push(await response.text());
      } catch (error) {
        throw streamFailure(error, deadline);
      }
      parser.finish();
    }
    if (streamError) throw streamError;
    if (!assembled) {
      var finalAssistant = normalizeMessage(finalData.assistant_message);
      if (finalAssistant) {
        messageID = finalAssistant.id;
        assembled = finalAssistant.content;
        handlers.onStart(messageID);
        handlers.onDelta(assembled);
      }
    }
    if (!assembled) {
      throw new WidgetError('empty_response', 'The assistant did not return a message.', 502);
    }
    return {
      message: {
        id: messageID || asText(finalData.message_id, randomID(), 180),
        role: 'assistant',
        content: assembled,
        createdAt: ''
      },
      leadRequested: leadRequested
    };
  }

  function DemoAPI(config, storage) {
    this.agentKey = config.agentKey;
    this.storage = storage;
    this.historyKey = storageKey('demo-history', config.agentKey);
    this.agent = normalizeAgentPayload({
      display_name: 'Mira',
      tagline: 'Garuda product guide',
      welcome_message: 'Hi — I am Mira. Ask me how Garuda can help turn website conversations into qualified leads.',
      suggested_prompts: [
        'What can Garuda do?',
        'How much does it cost?',
        'How quickly can I launch?'
      ],
      accent_color: '#5B5CE2',
      position: 'bottom_right',
      memory_enabled: true,
      lead_capture_enabled: true,
      lead_capture_fields: ['name', 'email', 'phone'],
      required_lead_fields: ['email'],
      lead_form: {
        enabled: true,
        heading: 'Tell us where to reach you',
        submit_label: 'Send it',
        fields: [
          { id: 'name', label: 'Full name', type: 'text', placeholder: 'Ada Lovelace' },
          { id: 'email', label: 'Work email', type: 'email', required: true },
          { id: 'timeline', label: 'Timeline', type: 'select', options: ['This month', 'This quarter', 'Just looking'] }
        ]
      }
    });
  }

  DemoAPI.prototype.getAgent = async function getAgent() {
    await wait(180);
    return this.agent;
  };

  DemoAPI.prototype.createSession = async function createSession(options) {
    await wait(240);
    var visitorToken = options.memory && validOpaqueToken(options.visitorToken)
      ? options.visitorToken
      : options.memory ? opaqueDemoToken() : '';
    var history = options.memory
      ? readJSON(this.storage, this.historyKey, [])
      : [];
    var messages = Array.isArray(history)
      ? history.map(normalizeMessage).filter(Boolean).slice(-MAX_HISTORY)
      : [];
    return {
      sessionID: 'demo_session_' + randomID(),
      sessionToken: 'demo_session_token_' + randomID(),
      demoPersistent: options.memory === true,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      visitorToken: visitorToken,
      conversation: {
        id: 'demo_conversation_' + randomID(),
        resumed: messages.length > 0,
        messages: messages
      },
      agent: this.agent
    };
  };

  DemoAPI.prototype.persistMessage = function persistMessage(message) {
    if (!this.storage) return;
    var history = readJSON(this.storage, this.historyKey, []);
    if (!Array.isArray(history)) history = [];
    history.push({
      id: message.id,
      role: message.role,
      content: message.content,
      created_at: new Date().toISOString()
    });
    try {
      this.storage.setItem(this.historyKey, JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch (_error) {
      // The demo continues when storage quotas or privacy settings block persistence.
    }
  };

  DemoAPI.prototype.sendMessage = async function sendMessage(session, request, handlers) {
    if (session.demoPersistent) {
      this.persistMessage({
        id: request.clientMessageID,
        role: 'user',
        content: request.content
      });
    }
    await wait(320);
    var selected = demoReply(request.content);
    var id = 'demo_message_' + randomID();
    handlers.onStart(id);
    var pieces = selected.text.match(/.{1,24}(?:\s|$)|.+$/g) || [selected.text];
    for (var index = 0; index < pieces.length; index += 1) {
      handlers.onDelta(pieces[index]);
      await wait(28);
    }
    if (selected.lead) handlers.onLead({
      fields: ['name', 'email', 'phone'],
      required_fields: ['email'],
      reason: 'follow_up_requested'
    });
    handlers.onDone({ message_id: id, lead_capture_requested: selected.lead });
    var message = { id: id, role: 'assistant', content: selected.text, createdAt: '' };
    if (session.demoPersistent) this.persistMessage(message);
    return { message: message, leadRequested: selected.lead };
  };

  DemoAPI.prototype.captureLead = async function captureLead() {
    await wait(480);
    return { lead_id: 'demo_lead_' + randomID(), status: 'new' };
  };

  function demoReply(content) {
    var query = content.toLowerCase();
    if (/price|pricing|cost|\$17|plan/.test(query)) {
      return {
        text: 'Garuda is built around a $17 monthly starter plan. It includes a published website agent, conversation history, and lead capture in one focused workspace.',
        lead: false
      };
    }
    if (/launch|install|setup|embed|how fast|quick/.test(query)) {
      return {
        text: 'You can answer the onboarding questions, review your generated agent, publish it, and add one script tag to your site. Most teams can get the first version live in a single session.',
        lead: false
      };
    }
    if (/call|contact|human|demo|talk|sales|follow/.test(query)) {
      return {
        text: 'Absolutely. Share the best contact details below and the team can follow up with you. Your details are only submitted after you confirm consent.',
        lead: true
      };
    }
    if (/lead|qualif|customer|what can|feature|do\?/.test(query)) {
      return {
        text: 'Garuda answers questions from your business knowledge, keeps useful context for returning visitors with consent, and can ask for contact details when someone is ready for a human follow-up.',
        lead: false
      };
    }
    return {
      text: 'Garuda gives every visitor a helpful, on-brand conversation while keeping the handoff clear for your team. Would you like to hear about setup, pricing, or lead capture?',
      lead: false
    };
  }

  var TEST_EXPORTS = {
    validateAgentKey: validateAgentKey,
    normalizePosition: normalizePosition,
    normalizeToggles: normalizeToggles,
    normalizeLeadForm: normalizeLeadForm,
    safeImageURL: safeImageURL,
    validOpaqueToken: validOpaqueToken,
    safeHttpUrl: safeHttpUrl,
    normalizeAgentPayload: normalizeAgentPayload,
    normalizeLeadSpec: normalizeLeadSpec,
    normalizeSessionPayload: normalizeSessionPayload,
    createSSEParser: createSSEParser,
    storageKey: storageKey,
    clearVisitorMemory: clearVisitorMemory,
    contrastText: contrastText,
    streamText: streamText,
    LiveAPI: LiveAPI,
    boot: boot,
    GarudaWidget: GarudaWidget
  };

  function readRuntimeConfig(script) {
    var agentKey = asText(script.getAttribute('data-agent-key'), '', 180);
    if (!validateAgentKey(agentKey)) {
      throw new WidgetError('invalid_configuration', 'A valid data-agent-key is required.', 0);
    }
    var mode = script.getAttribute('data-mode') === 'demo' ? 'demo' : 'live';
    var scriptURL = safeHttpUrl(script.src);
    var explicitOrigin = safeHttpUrl(script.getAttribute('data-api-origin'));
    var apiOrigin = '';
    if (explicitOrigin) apiOrigin = new URL(explicitOrigin).origin;
    if (!apiOrigin && scriptURL) apiOrigin = new URL(scriptURL).origin;
    if (mode === 'live' && !apiOrigin) {
      throw new WidgetError('invalid_configuration', 'A valid API origin could not be resolved.', 0);
    }
    var memorySetting = asText(script.getAttribute('data-memory-consent'), 'prompt', 12).toLowerCase();
    if (['true', 'false', 'prompt'].indexOf(memorySetting) === -1) memorySetting = 'prompt';
    var rawZIndex = script.getAttribute('data-z-index');
    var zIndex = rawZIndex === null ? 2147482000 : Number(rawZIndex);
    if (!Number.isFinite(zIndex)) zIndex = 2147482000;
    zIndex = Math.max(1000, Math.min(2147483000, Math.floor(zIndex)));
    return {
      agentKey: agentKey,
      mode: mode,
      apiOrigin: apiOrigin,
      memorySetting: memorySetting,
      analytics: script.getAttribute('data-analytics-consent') === 'true',
      launcherLabel: asText(script.getAttribute('data-launcher-label'), '', 50),
      startOpen: script.getAttribute('data-open') === 'true',
      zIndex: zIndex
    };
  }

  function findLoaderScript() {
    if (global.document.currentScript) return global.document.currentScript;
    var scripts = Array.prototype.slice.call(global.document.querySelectorAll('script[data-agent-key]'));
    for (var index = scripts.length - 1; index >= 0; index -= 1) {
      if (!scripts[index].hasAttribute('data-garuda-loaded')) return scripts[index];
    }
    return null;
  }

  // Which agents are already on the page has to be recorded on the page itself
  // rather than in this closure. A single page application re-runs the embed
  // snippet on every navigation, and each run loads a fresh copy of this runtime
  // whose closure starts out empty, so widgets used to stack: several launchers,
  // several sessions, and one visitor counted as several conversations.
  function mountedWidgets() {
    var registry = global.garudaWidgetMounts;
    if (!isRecord(registry)) {
      registry = Object.create(null);
      global.garudaWidgetMounts = registry;
    }
    return registry;
  }

  function alreadyMounted(registry, agentKey) {
    var widget = registry[agentKey];
    if (!widget) return false;
    var host = widget.nodes ? widget.nodes.host : null;
    // A host page that replaced its document body took the widget away with it,
    // so that agent is free to mount again. A widget still waiting for the body
    // has no host yet and counts as mounted.
    if (host && host.isConnected === false) return false;
    return true;
  }

  function boot() {
    var script = findLoaderScript();
    if (!script || script.hasAttribute('data-garuda-loaded')) return;
    script.setAttribute('data-garuda-loaded', VERSION);
    try {
      var config = readRuntimeConfig(script);
      var registry = mountedWidgets();
      if (alreadyMounted(registry, config.agentKey)) return;
      var widget = new GarudaWidget(config);
      registry[config.agentKey] = widget;
      widget.mount();
    } catch (_error) {
      // Invalid embed configuration fails closed without exposing identifiers.
    }
  }

  function GarudaWidget(config) {
    this.config = config;
    this.storage = getStorage();
    this.api = config.mode === 'demo'
      ? new DemoAPI(config, this.storage)
      : new LiveAPI(config);
    this.agent = normalizeAgentPayload({});
    this.session = null;
    this.sessionPromise = null;
    this.agentPromise = null;
    this.agentLoaded = false;
    this.messages = [];
    this.open = false;
    this.sending = false;
    this.unread = 0;
    this.leadVisible = false;
    this.autoOpened = false;
    this.lastRetry = null;
    this.nodes = {};
    this.memoryConsent = this.resolveInitialConsent();
    this.requiresConsent = this.memoryConsent === null;
  }

  GarudaWidget.prototype.resolveInitialConsent = function resolveInitialConsent() {
    if (this.config.memorySetting === 'true') return true;
    if (this.config.memorySetting === 'false') {
      if (this.storage) {
        try {
          clearVisitorMemory(this.storage, this.config.agentKey);
        } catch (_error) {
          // Storage access is optional.
        }
      }
      return false;
    }
    if (!this.storage) return null;
    var stored = this.storage.getItem(storageKey('memory-consent', this.config.agentKey));
    if (stored === 'granted') return true;
    if (stored === 'declined') return false;
    return null;
  };

  GarudaWidget.prototype.mount = function mount() {
    var self = this;
    var append = function () {
      if (!global.document.body) return;
      self.createUI();
      self.agentPromise = self.loadAgent();
      if (!self.requiresConsent) {
        self.agentPromise.then(function () {
          return self.ensureSession();
        }).catch(function () {
          // The visible retry notice owns recovery.
        });
      }
      if (self.config.startOpen) self.setOpen(true);
    };
    if (global.document.body) append();
    else global.document.addEventListener('DOMContentLoaded', append, { once: true });
  };

  GarudaWidget.prototype.createUI = function createUI() {
    var self = this;
    var host = element('div');
    host.setAttribute('data-garuda-widget', VERSION);
    host.style.setProperty('--garuda-z-index', String(this.config.zIndex));
    var root = host.attachShadow({ mode: 'open' });
    var style = element('style');
    style.textContent = widgetCSS();
    root.appendChild(style);

    var shell = element('div', 'gw-shell');
    shell.setAttribute('data-position', 'bottom_right');
    var launcher = element('button', 'gw-launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-label', 'Open chat');
    var launcherIcon = element('span', 'gw-launcher-icon');
    launcherIcon.appendChild(svgIcon('M7.5 17.5 4 20v-4.2A7.5 7.5 0 0 1 3 12c0-4.42 4.03-8 9-8s9 3.58 9 8-4.03 8-9 8a9.8 9.8 0 0 1-4.5-1.05'));
    var launcherLabel = element('span', 'gw-launcher-label', 'Chat with us');
    var unread = element('span', 'gw-unread', '0');
    unread.hidden = true;
    launcher.appendChild(launcherIcon);
    launcher.appendChild(launcherLabel);
    launcher.appendChild(unread);

    var panel = element('section', 'gw-panel');
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', 'Chat with Garuda Assistant');

    var header = element('header', 'gw-header');
    var identity = element('div', 'gw-identity');
    var avatar = element('div', 'gw-avatar');
    avatar.setAttribute('aria-hidden', 'true');
    var monogram = element('span', 'gw-monogram', 'G');
    avatar.appendChild(monogram);
    var identityCopy = element('div', 'gw-identity-copy');
    var title = element('div', 'gw-title', 'Garuda Assistant');
    var tagline = element('div', 'gw-tagline');
    tagline.hidden = true;
    var status = element('div', 'gw-status');
    var statusDot = element('span', 'gw-status-dot');
    var statusText = element('span', '', 'Connecting…');
    status.appendChild(statusDot);
    status.appendChild(statusText);
    identityCopy.appendChild(title);
    identityCopy.appendChild(tagline);
    identityCopy.appendChild(status);
    identity.appendChild(avatar);
    identity.appendChild(identityCopy);
    // The muted indicator is the part of agent_mute this widget can honestly
    // show: it has no audio of its own to silence, so it says the assistant will
    // not speak rather than pretending to mute something.
    var mutedBadge = element('span', 'gw-muted-badge');
    mutedBadge.hidden = true;
    mutedBadge.setAttribute('role', 'img');
    mutedBadge.setAttribute('aria-label', 'Assistant audio is muted');
    mutedBadge.appendChild(svgIcon('M11 5 6.5 9H3v6h3.5L11 19V5Zm4 4 5 6m0-6-5 6'));
    var close = element('button', 'gw-icon-button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Minimize chat');
    close.appendChild(svgIcon('M6 9l6 6 6-6'));
    var headerActions = element('div', 'gw-header-actions');
    headerActions.appendChild(mutedBadge);
    headerActions.appendChild(close);
    header.appendChild(identity);
    header.appendChild(headerActions);

    var connectionNotice = element('div', 'gw-notice');
    connectionNotice.hidden = true;
    connectionNotice.setAttribute('role', 'status');
    var noticeText = element('span');
    var retryButton = element('button', 'gw-notice-action', 'Try again');
    retryButton.type = 'button';
    connectionNotice.appendChild(noticeText);
    connectionNotice.appendChild(retryButton);

    var body = element('div', 'gw-body');
    var messages = element('div', 'gw-messages');
    messages.setAttribute('role', 'log');
    messages.setAttribute('aria-live', 'polite');
    messages.setAttribute('aria-relevant', 'additions text');
    messages.setAttribute('aria-label', 'Conversation');
    var consentRegion = element('div', 'gw-consent-region');
    var historyStatus = element('p', 'gw-history-status');
    historyStatus.setAttribute('role', 'status');
    historyStatus.hidden = true;
    messages.appendChild(consentRegion);
    messages.appendChild(historyStatus);
    var suggestions = element('div', 'gw-suggestions');
    suggestions.setAttribute('aria-label', 'Suggested questions');
    var leadRegion = element('div', 'gw-lead-region');
    body.appendChild(messages);
    body.appendChild(suggestions);
    body.appendChild(leadRegion);

    var typing = element('div', 'gw-typing');
    typing.hidden = true;
    typing.setAttribute('role', 'status');
    typing.setAttribute('aria-label', 'Assistant is typing');
    typing.appendChild(element('span'));
    typing.appendChild(element('span'));
    typing.appendChild(element('span'));

    var contactRow = element('div', 'gw-contact-row');
    var contactButton = element('button', 'gw-contact-button', 'Contact the team');
    contactButton.type = 'button';
    contactButton.hidden = true;
    contactButton.appendChild(svgIcon('M4 5.5h16v11H8l-4 3v-14Zm4 4h8M8 13h5'));
    contactRow.appendChild(contactButton);

    var composer = element('form', 'gw-composer');
    var inputWrap = element('div', 'gw-input-wrap');
    var textarea = element('textarea', 'gw-input');
    textarea.rows = 1;
    textarea.maxLength = MAX_MESSAGE_LENGTH;
    textarea.placeholder = 'Type your message…';
    textarea.setAttribute('aria-label', 'Message');
    textarea.disabled = true;
    var counter = element('span', 'gw-counter', '0 / ' + MAX_MESSAGE_LENGTH);
    counter.hidden = true;
    inputWrap.appendChild(textarea);
    inputWrap.appendChild(counter);
    var send = element('button', 'gw-send');
    send.type = 'submit';
    send.disabled = true;
    send.setAttribute('aria-label', 'Send message');
    send.appendChild(svgIcon('M4 12 20 4l-5.5 16-3.2-6.8L4 12Zm7.3 1.2L20 4'));
    composer.appendChild(inputWrap);
    composer.appendChild(send);

    var footer = element('div', 'gw-footer');
    var lock = svgIcon('M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Z');
    footer.appendChild(lock);
    footer.appendChild(element('span', '', 'Secure chat by '));
    var brand = element('span', 'gw-brand', 'Garuda');
    footer.appendChild(brand);

    panel.appendChild(header);
    panel.appendChild(connectionNotice);
    panel.appendChild(body);
    panel.appendChild(typing);
    panel.appendChild(contactRow);
    panel.appendChild(composer);
    panel.appendChild(footer);
    shell.appendChild(panel);
    shell.appendChild(launcher);
    root.appendChild(shell);
    global.document.body.appendChild(host);

    this.nodes = {
      host: host,
      shell: shell,
      launcher: launcher,
      launcherLabel: launcherLabel,
      launcherIcon: launcherIcon,
      unread: unread,
      panel: panel,
      header: header,
      avatar: avatar,
      monogram: monogram,
      logo: null,
      mutedBadge: mutedBadge,
      title: title,
      tagline: tagline,
      status: status,
      statusText: statusText,
      close: close,
      connectionNotice: connectionNotice,
      noticeText: noticeText,
      retryButton: retryButton,
      body: body,
      messages: messages,
      consentRegion: consentRegion,
      historyStatus: historyStatus,
      suggestions: suggestions,
      leadRegion: leadRegion,
      typing: typing,
      contactButton: contactButton,
      composer: composer,
      textarea: textarea,
      counter: counter,
      send: send
    };

    launcher.addEventListener('click', function () { self.setOpen(!self.open); });
    close.addEventListener('click', function () { self.setOpen(false); });
    composer.addEventListener('submit', function (event) {
      event.preventDefault();
      self.submitMessage();
    });
    textarea.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        self.submitMessage();
      }
    });
    textarea.addEventListener('input', function () { self.resizeInput(); });
    retryButton.addEventListener('click', function () {
      var retry = self.lastRetry;
      if (!retry || retryButton.disabled) return;
      setButtonBusy(retryButton, true, 'Retrying…');
      Promise.resolve().then(retry).catch(function () {
        // The notice itself reports whatever went wrong on this attempt.
      }).then(function () {
        setButtonBusy(retryButton, false, '', 'Try again');
      });
    });
    contactButton.addEventListener('click', function () {
      self.showLeadForm(normalizeLeadSpec({}, self.agent));
    });
    panel.addEventListener('keydown', function (event) { self.handlePanelKeys(event); });
    global.addEventListener('online', function () { self.updateConnectionState(); });
    global.addEventListener('offline', function () { self.updateConnectionState(); });
    this.applyAgent(this.agent);
    if (this.requiresConsent) this.renderConsentPrompt();
  };

  GarudaWidget.prototype.loadAgent = async function loadAgent() {
    var self = this;
    this.setStatus('Connecting…', 'loading');
    try {
      var agent = await this.api.getAgent();
      this.applyAgent(agent);
      this.agentLoaded = true;
      this.setStatus(this.config.mode === 'demo' ? 'Demo · Online' : 'Online', 'online');
      this.clearNotice();
      if (this.requiresConsent) this.renderConsentPrompt();
    } catch (error) {
      this.setStatus('Unavailable', 'error');
      this.showNotice(
        error instanceof WidgetError ? error.message : 'This assistant is unavailable right now.',
        function () {
          self.agentPromise = self.loadAgent();
          self.agentPromise.then(function () {
            if (self.agentLoaded && !self.requiresConsent) return self.ensureSession();
            return null;
          }).catch(function () {
            // The visible notice remains available for another attempt.
          });
        }
      );
    }
  };

  GarudaWidget.prototype.applyAgent = function applyAgent(agent) {
    this.agent = Object.assign({}, this.agent, agent || {});
    if (!this.nodes.host) return;
    this.applyTheme();
    this.applyIdentity();
    this.applyToggles();
    this.updateContactVisibility();
    this.renderSuggestions();
  };

  // Seven colours and one placement, all of them resolved by the server. The
  // widget deliberately owns no palette table: a theme retuned on the server
  // reaches every embedded widget on its next bootstrap, with no release.
  GarudaWidget.prototype.applyTheme = function applyTheme() {
    var colors = isRecord(this.agent.colors) ? this.agent.colors : DEFAULT_COLORS;
    var host = this.nodes.host;
    host.style.setProperty('--garuda-accent', colors.accent);
    host.style.setProperty('--garuda-accent-text', colors.onAccent);
    host.style.setProperty('--garuda-primary', colors.primary);
    host.style.setProperty('--garuda-primary-text', colors.onPrimary);
    host.style.setProperty('--garuda-background', colors.background);
    host.style.setProperty('--garuda-surface', colors.surface);
    host.style.setProperty('--garuda-text', colors.text);
    // The identifier is published for support and for the host page's own
    // styling hooks. Nothing in this file reads a colour back out of it.
    host.setAttribute('data-theme', this.agent.theme || 'custom');
    this.nodes.shell.setAttribute('data-position', normalizePosition(this.agent.position));
  };

  GarudaWidget.prototype.applyIdentity = function applyIdentity() {
    var nodes = this.nodes;
    var displayName = this.agent.displayName;
    nodes.title.textContent = displayName;
    nodes.tagline.textContent = this.agent.tagline;
    nodes.tagline.hidden = !this.agent.tagline;
    nodes.monogram.textContent = displayName.charAt(0).toUpperCase() || 'G';
    this.applyLogo(this.agent.logoUrl);
    nodes.panel.setAttribute('aria-label', 'Chat with ' + displayName);
    var launcherCopy = this.config.launcherLabel || this.agent.launcherLabel || 'Chat with ' + displayName;
    nodes.launcherLabel.textContent = launcherCopy;
    nodes.launcher.setAttribute('aria-label', 'Open chat with ' + displayName);
  };

  // The monogram stays visible until a logo has actually decoded, and comes back
  // if the image never does. A customer whose CDN 404s gets the initial they had
  // before, not the broken image icon their visitors would otherwise see.
  GarudaWidget.prototype.applyLogo = function applyLogo(logoUrl) {
    var nodes = this.nodes;
    if (nodes.logo) {
      nodes.logo.remove();
      nodes.logo = null;
    }
    nodes.monogram.hidden = false;
    if (!logoUrl) return;
    var image = element('img', 'gw-avatar-image');
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.setAttribute('decoding', 'async');
    image.hidden = true;
    image.addEventListener('load', function () {
      image.hidden = false;
      nodes.monogram.hidden = true;
    });
    image.addEventListener('error', function () {
      image.remove();
      nodes.logo = null;
      nodes.monogram.hidden = false;
    });
    image.src = logoUrl;
    nodes.avatar.appendChild(image);
    nodes.logo = image;
  };

  GarudaWidget.prototype.applyToggles = function applyToggles() {
    var toggles = this.agent.toggles;
    var nodes = this.nodes;
    nodes.shell.classList.toggle('gw-glowing', toggles.isGlowing);
    nodes.shell.classList.toggle('gw-transparent', toggles.isTransparent);
    nodes.mutedBadge.hidden = !toggles.agentMute;
    // This widget is text only. The three switches that describe when audio
    // should stop are published on the host element for the page and for a
    // future voice surface to read, rather than being acted out here.
    nodes.host.setAttribute('data-transcription', String(toggles.transcription));
    nodes.host.setAttribute('data-agent-mute', String(toggles.agentMute));
    nodes.host.setAttribute('data-mute-on-minimize', String(toggles.muteOnMinimize));
    nodes.host.setAttribute('data-mute-on-tab-change', String(toggles.muteOnTabChange));
    // Chat is the only conversation this widget offers, so a customer who
    // switches it off wants no bubble on their site at all.
    var chatDisabled = toggles.chat === false;
    nodes.host.hidden = chatDisabled;
    if (chatDisabled) {
      this.open = false;
      nodes.panel.hidden = true;
      nodes.launcher.setAttribute('aria-expanded', 'false');
      nodes.shell.classList.remove('gw-open');
      return;
    }
    if (toggles.autostart && !this.autoOpened && !this.open) {
      this.autoOpened = true;
      this.setOpen(true);
    }
  };

  // The lead form is available when lead capture is on, and also when the
  // customer switched the form on explicitly, because that switch is the whole
  // point of the setting.
  GarudaWidget.prototype.leadCaptureAvailable = function leadCaptureAvailable() {
    return this.agent.leadCaptureEnabled === true || this.agent.toggles.showLeadForm === true;
  };

  GarudaWidget.prototype.setStatus = function setStatus(label, state) {
    if (!this.nodes.status) return;
    this.nodes.statusText.textContent = label;
    this.nodes.status.setAttribute('data-state', state || '');
  };

  GarudaWidget.prototype.updateConnectionState = function updateConnectionState() {
    if (global.navigator && global.navigator.onLine === false) {
      this.setStatus('Offline', 'error');
    } else if (this.session) {
      this.setStatus(this.config.mode === 'demo' ? 'Demo · Online' : 'Online', 'online');
    }
  };

  GarudaWidget.prototype.setOpen = function setOpen(nextOpen) {
    if (!this.nodes.panel) return;
    this.open = Boolean(nextOpen);
    this.nodes.panel.hidden = !this.open;
    this.nodes.launcher.setAttribute('aria-expanded', String(this.open));
    this.nodes.shell.classList.toggle('gw-open', this.open);
    if (this.open) {
      this.unread = 0;
      this.updateUnread();
      if (!this.requiresConsent) {
        this.ensureSession().catch(function () {
          // The notice inside the panel owns recovery for a failed session.
        });
      }
      if (this.agent.toggles.showLeadForm) this.showLeadForm(null);
      this.scrollToBottom(false);
      var focusTarget = this.requiresConsent
        ? this.nodes.consentRegion.querySelector('button')
        : this.nodes.textarea;
      global.setTimeout(function () {
        if (focusTarget) focusTarget.focus({ preventScroll: true });
      }, 80);
    } else {
      this.nodes.launcher.focus({ preventScroll: true });
    }
  };

  // The panel stays non-modal and therefore does not trap Tab. It is a launcher
  // anchored bubble sitting on somebody else's page: the page behind it keeps
  // working, and a widget cannot honestly make a customer's document inert from
  // inside its own shadow root, so aria-modal="false" is the truthful value.
  // Cycling Tab inside a dialog that reports itself as non-modal stranded
  // keyboard and screen reader users, who had been told they could leave it.
  // Escape still closes the panel and setOpen returns focus to the launcher.
  GarudaWidget.prototype.handlePanelKeys = function handlePanelKeys(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.setOpen(false);
  };

  GarudaWidget.prototype.renderConsentPrompt = function renderConsentPrompt() {
    var self = this;
    var region = this.nodes.consentRegion;
    if (!region || !this.requiresConsent) return;
    region.replaceChildren();
    var card = element('section', 'gw-consent-card');
    card.setAttribute('aria-labelledby', 'gw-consent-title');
    var icon = element('div', 'gw-consent-icon');
    icon.appendChild(svgIcon('M12 3 5 6v5c0 4.6 2.8 8.5 7 10 4.2-1.5 7-5.4 7-10V6l-7-3Zm0 5v5m0 3h.01'));
    var title = element('h2', '', 'Your chat, your choice');
    title.id = 'gw-consent-title';
    var copy = element(
      'p',
      '',
      'Allow this assistant to remember this conversation on this browser, or continue with a one-time chat.'
    );
    var actions = element('div', 'gw-consent-actions');
    var remember = element('button', 'gw-primary-button', 'Remember this chat');
    remember.type = 'button';
    var once = element('button', 'gw-secondary-button', 'Use once');
    once.type = 'button';
    actions.appendChild(remember);
    actions.appendChild(once);
    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(copy);
    card.appendChild(actions);
    if (this.agent.privacyUrl) {
      var privacy = element('a', 'gw-privacy-link', 'Read the privacy policy');
      privacy.href = this.agent.privacyUrl;
      privacy.target = '_blank';
      privacy.rel = 'noopener noreferrer';
      card.appendChild(privacy);
    }
    region.appendChild(card);
    remember.addEventListener('click', function () { self.chooseConsent(true); });
    once.addEventListener('click', function () { self.chooseConsent(false); });
  };

  GarudaWidget.prototype.chooseConsent = function chooseConsent(memory) {
    if (!this.requiresConsent) return;
    this.memoryConsent = memory;
    this.requiresConsent = false;
    if (this.storage) {
      try {
        this.storage.setItem(
          storageKey('memory-consent', this.config.agentKey),
          memory ? 'granted' : 'declined'
        );
        if (!memory) clearVisitorMemory(this.storage, this.config.agentKey);
      } catch (_error) {
        // The selected privacy choice still applies to the current session.
      }
    }
    this.nodes.consentRegion.replaceChildren();
    this.ensureSession();
  };

  GarudaWidget.prototype.ensureSession = function ensureSession(force) {
    var self = this;
    if (this.requiresConsent) return Promise.resolve(null);
    if (!this.agentLoaded && this.agentPromise) {
      return this.agentPromise.then(function () {
        if (!self.agentLoaded) {
          throw new WidgetError('agent_unavailable', 'This assistant is unavailable right now.', 0);
        }
        return self.ensureSession(force);
      });
    }
    if (this.session && !force) return Promise.resolve(this.session);
    if (this.sessionPromise && !force) return this.sessionPromise;
    this.nodes.textarea.disabled = true;
    this.nodes.send.disabled = true;
    this.setStatus('Connecting…', 'loading');
    var memory = this.memoryConsent === true && this.agent.memoryEnabled !== false;
    var visitorToken = '';
    if (memory && this.storage) {
      try {
        var stored = this.storage.getItem(storageKey('visitor', this.config.agentKey));
        if (validOpaqueToken(stored)) visitorToken = stored;
      } catch (_error) {
        visitorToken = '';
      }
    }
    this.sessionPromise = this.api.createSession({
      memory: memory,
      analytics: this.config.analytics,
      visitorToken: visitorToken
    }).then(function (session) {
      self.session = session;
      self.sessionPromise = null;
      self.applyAgent(session.agent);
      if (memory && session.visitorToken && self.storage) {
        try {
          self.storage.setItem(storageKey('visitor', self.config.agentKey), session.visitorToken);
        } catch (_error) {
          // Session remains usable when host storage is unavailable.
        }
      }
      self.hydrateConversation(session.conversation);
      self.nodes.textarea.disabled = false;
      self.resizeInput();
      self.setStatus(self.config.mode === 'demo' ? 'Demo · Online' : 'Online', 'online');
      self.clearNotice();
      if (self.open) self.nodes.textarea.focus({ preventScroll: true });
      return session;
    }).catch(function (error) {
      self.sessionPromise = null;
      self.setStatus('Unavailable', 'error');
      self.showNotice(
        error instanceof WidgetError ? error.message : 'The chat could not start.',
        function () { self.ensureSession(true); }
      );
      throw error;
    });
    return this.sessionPromise;
  };

  GarudaWidget.prototype.hydrateConversation = function hydrateConversation(conversation) {
    if (this.messages.length) return;
    var restored = conversation && Array.isArray(conversation.messages)
      ? conversation.messages.slice(-MAX_HISTORY)
      : [];
    if (restored.length) {
      this.nodes.historyStatus.textContent = 'Welcome back — continuing your recent conversation.';
      this.nodes.historyStatus.hidden = false;
      restored.forEach(this.appendMessage.bind(this));
    } else {
      this.appendMessage({
        id: 'welcome_' + randomID(),
        role: 'assistant',
        content: this.agent.welcomeMessage,
        createdAt: ''
      });
    }
    this.renderSuggestions();
  };

  GarudaWidget.prototype.appendMessage = function appendMessage(message, options) {
    options = options || {};
    var normalized = normalizeMessage(message);
    if (!normalized) return null;
    this.messages.push(normalized);
    if (this.messages.length > MAX_HISTORY) this.messages.shift();
    var row = element('div', 'gw-message-row gw-' + normalized.role);
    row.setAttribute('data-message-id', normalized.id);
    var bubble = element('div', 'gw-bubble');
    var copy = element('p', '', normalized.content);
    bubble.appendChild(copy);
    if (normalized.role === 'assistant') {
      var miniAvatar = element('span', 'gw-mini-avatar', this.agent.displayName.charAt(0).toUpperCase() || 'G');
      miniAvatar.setAttribute('aria-hidden', 'true');
      row.appendChild(miniAvatar);
    }
    row.appendChild(bubble);
    this.nodes.messages.appendChild(row);
    if (!options.silent && !this.open && normalized.role === 'assistant') {
      this.unread += 1;
      this.updateUnread();
    }
    this.updateContactVisibility();
    this.scrollToBottom(true);
    return { row: row, copy: copy, message: normalized };
  };

  GarudaWidget.prototype.createStreamingMessage = function createStreamingMessage() {
    var id = 'stream_' + randomID();
    var rendered = this.appendMessage({
      id: id,
      role: 'assistant',
      content: 'Thinking…',
      createdAt: ''
    }, { silent: true });
    rendered.copy.textContent = '';
    rendered.row.classList.add('gw-streaming');
    return rendered;
  };

  GarudaWidget.prototype.updateUnread = function updateUnread() {
    if (!this.nodes.unread) return;
    this.nodes.unread.textContent = String(Math.min(this.unread, 9));
    this.nodes.unread.hidden = this.unread < 1;
  };

  GarudaWidget.prototype.renderSuggestions = function renderSuggestions() {
    var self = this;
    if (!this.nodes.suggestions) return;
    this.nodes.suggestions.replaceChildren();
    var hasUserMessage = this.messages.some(function (message) { return message.role === 'user'; });
    if (!this.session || hasUserMessage || !this.agent.suggestedPrompts.length) return;
    this.agent.suggestedPrompts.forEach(function (prompt) {
      var button = element('button', 'gw-suggestion', prompt);
      button.type = 'button';
      button.addEventListener('click', function () {
        if (button.disabled || self.sending) return;
        setButtonBusy(button, true);
        self.nodes.textarea.value = prompt;
        self.resizeInput();
        self.submitMessage();
      });
      self.nodes.suggestions.appendChild(button);
    });
  };

  GarudaWidget.prototype.submitMessage = async function submitMessage() {
    var content = this.nodes.textarea.value.trim();
    if (!content || this.sending || content.length > MAX_MESSAGE_LENGTH) return;
    try {
      await this.ensureSession();
    } catch (_error) {
      return;
    }
    var request = {
      clientMessageID: randomID(),
      content: content
    };
    this.nodes.textarea.value = '';
    this.resizeInput();
    this.appendMessage({
      id: request.clientMessageID,
      role: 'user',
      content: content,
      createdAt: ''
    });
    this.renderSuggestions();
    await this.generateReply(request, false);
  };

  GarudaWidget.prototype.generateReply = async function generateReply(request, retrying) {
    var self = this;
    this.setSending(true);
    this.clearNotice();
    var rendered = this.createStreamingMessage();
    var received = '';
    var leadSpec = null;
    try {
      var result = await this.api.sendMessage(this.session, request, {
        onStart: function (id) {
          if (id) rendered.row.setAttribute('data-message-id', id);
        },
        onDelta: function (piece) {
          received += piece;
          rendered.copy.textContent = received;
          self.scrollToBottom(true);
        },
        onLead: function (spec) {
          leadSpec = normalizeLeadSpec(spec, self.agent);
        },
        onDone: function () {}
      });
      rendered.row.classList.remove('gw-streaming');
      if (!received && result.message) {
        received = result.message.content;
        rendered.copy.textContent = received;
      }
      var stored = this.messages[this.messages.length - 1];
      if (stored && stored.role === 'assistant') {
        stored.content = received;
        stored.id = result.message.id;
      }
      if (leadSpec || result.leadRequested) {
        this.showLeadForm(leadSpec || normalizeLeadSpec({}, this.agent));
      }
      if (!this.open) {
        this.unread += 1;
        this.updateUnread();
      }
    } catch (error) {
      rendered.row.remove();
      this.messages.pop();
      var canRefresh = !retrying &&
        error instanceof WidgetError &&
        (error.status === 401 || error.code === 'session_expired' || error.code === 'invalid_session');
      if (canRefresh) {
        try {
          await this.ensureSession(true);
          this.setSending(false);
          return await this.generateReply(request, true);
        } catch (_refreshError) {
          // The actionable error below is safer than exposing refresh internals.
        }
      }
      var message = error instanceof WidgetError
        ? error.message
        : 'The response was interrupted. Please try again.';
      this.showNotice(message, function () { self.generateReply(request, false); });
    } finally {
      this.setSending(false);
      this.nodes.textarea.focus({ preventScroll: true });
    }
  };

  GarudaWidget.prototype.setSending = function setSending(active) {
    this.sending = active;
    this.nodes.typing.hidden = !active;
    this.nodes.textarea.disabled = active || !this.session;
    this.nodes.send.setAttribute('aria-busy', String(Boolean(active)));
    this.nodes.send.classList.toggle('gw-busy', Boolean(active));
    this.nodes.send.disabled = active || !this.session || !this.nodes.textarea.value.trim();
    this.nodes.messages.setAttribute('aria-busy', String(active));
    this.updateContactVisibility();
    if (active) this.scrollToBottom(true);
  };

  GarudaWidget.prototype.resizeInput = function resizeInput() {
    var textarea = this.nodes.textarea;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 112) + 'px';
    var count = textarea.value.length;
    this.nodes.counter.textContent = count + ' / ' + MAX_MESSAGE_LENGTH;
    this.nodes.counter.hidden = count < 3600;
    this.nodes.send.disabled = this.sending || !this.session || !textarea.value.trim();
  };

  GarudaWidget.prototype.updateContactVisibility = function updateContactVisibility() {
    if (!this.nodes.contactButton) return;
    var hasUserMessage = this.messages.some(function (message) {
      return message.role === 'user';
    });
    var lastMessage = this.messages[this.messages.length - 1];
    this.nodes.contactButton.hidden =
      !this.leadCaptureAvailable() ||
      !hasUserMessage ||
      !lastMessage ||
      lastMessage.role !== 'assistant' ||
      this.sending ||
      this.leadVisible;
  };

  // ---- the lead form the customer built ----
  //
  // The field list, the heading and the button label all arrive resolved from
  // the server. An agent whose customer never opened the builder resolves to the
  // name/email/phone form this widget has always drawn, so nothing about a live
  // site changes until somebody actually builds a form.

  function createLeadControl(field, controlID, errorID) {
    var control;
    if (field.type === 'textarea') {
      control = element('textarea', 'gw-lead-input');
      control.rows = 3;
      control.maxLength = MAX_LEAD_VALUE_LENGTH;
      if (field.placeholder) control.placeholder = field.placeholder;
    } else if (field.type === 'select') {
      control = element('select', 'gw-lead-input');
      var unchosen = element('option', '', field.placeholder || 'Select an option');
      unchosen.value = '';
      control.appendChild(unchosen);
      field.options.forEach(function (option) {
        var choice = element('option', '', option);
        choice.value = option;
        control.appendChild(choice);
      });
    } else if (field.type === 'checkbox') {
      control = element('input', 'gw-lead-checkbox');
      control.type = 'checkbox';
    } else {
      control = element('input', 'gw-lead-input');
      control.type = LEAD_INPUT_TYPES[field.type] || 'text';
      control.maxLength = field.type === 'email' ? 254 : 160;
      if (field.placeholder) control.placeholder = field.placeholder;
    }
    control.id = controlID;
    control.name = field.id;
    if (LEAD_AUTOCOMPLETE[field.id]) control.autocomplete = LEAD_AUTOCOMPLETE[field.id];
    if (field.required) control.required = true;
    control.setAttribute('aria-describedby', errorID);
    return control;
  }

  // Every control gets its own label element and its own error line, wired by
  // id, so a screen reader announces the customer's wording for the field and
  // then whatever went wrong with that field rather than one notice for all.
  function createLeadField(field) {
    var controlID = 'gw-field-' + field.id + '-' + randomID();
    var errorID = controlID + '-error';
    var group = element('div', 'gw-field gw-field-' + field.type);
    var label = element('label', '', field.label);
    label.htmlFor = controlID;
    if (field.required) {
      var marker = element('span', 'gw-required', ' *');
      marker.setAttribute('aria-hidden', 'true');
      label.appendChild(marker);
    } else {
      label.appendChild(element('span', '', ' · optional'));
    }
    var control = createLeadControl(field, controlID, errorID);
    var error = element('p', 'gw-field-error');
    error.id = errorID;
    error.hidden = true;
    error.setAttribute('role', 'alert');
    if (field.type === 'checkbox') {
      group.appendChild(control);
      group.appendChild(label);
    } else {
      group.appendChild(label);
      group.appendChild(control);
    }
    group.appendChild(error);
    return { field: field, group: group, control: control, error: error };
  }

  function leadFieldValue(entry) {
    if (entry.field.type === 'checkbox') return entry.control.checked ? 'yes' : '';
    var value = entry.control.value;
    return typeof value === 'string' ? value.trim() : '';
  }

  // Client side checks exist so a visitor is told what is wrong without a round
  // trip. The server still decides: anything it rejects is shown on these same
  // lines by showLeadFieldErrors.
  function leadFieldProblem(entry) {
    var field = entry.field;
    var value = leadFieldValue(entry);
    if (!value) {
      if (!field.required) return '';
      return field.type === 'checkbox'
        ? 'Please confirm this to continue.'
        : 'This field is required.';
    }
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      return 'Enter an email address like you@example.com.';
    }
    if (field.type === 'telephone' && value.replace(/[^0-9]/g, '').length < 7) {
      return 'Enter a phone number the team can call.';
    }
    if (field.type === 'number' && !/^-?\d+(?:\.\d+)?$/.test(value)) {
      return 'Enter a number.';
    }
    if (value.length > MAX_LEAD_VALUE_LENGTH) return 'Please shorten this answer.';
    return '';
  }

  function setLeadFieldProblem(entry, message) {
    entry.error.textContent = message;
    entry.error.hidden = !message;
    if (message) entry.control.setAttribute('aria-invalid', 'true');
    else entry.control.removeAttribute('aria-invalid');
  }

  // A details value can be a whole sentence or a single word like "invalid".
  // The single word is read back with the field's own label so the line under
  // the input is a sentence either way.
  function leadFieldMessage(label, detail) {
    var message = asText(detail, '', 240);
    if (!message) return 'This answer was not accepted.';
    return message.indexOf(' ') === -1 ? label + ' is ' + message + '.' : message;
  }

  function showLeadFieldErrors(entries, details) {
    var matched = false;
    Object.keys(isRecord(details) ? details : {}).forEach(function (key) {
      var identifier = key.replace(/^(?:fields|custom|custom_fields|lead_capture)\./, '');
      entries.forEach(function (entry) {
        if (entry.field.id !== identifier) return;
        matched = true;
        setLeadFieldProblem(entry, leadFieldMessage(entry.field.label, details[key]));
      });
    });
    return matched;
  }

  // The four reserved identifiers are stored as columns on the lead; every other
  // field the customer built travels in custom_fields and lands as metadata.
  function leadSubmission(entries) {
    var reserved = {};
    var custom = {};
    entries.forEach(function (entry) {
      var value = leadFieldValue(entry);
      if (!value) return;
      if (RESERVED_LEAD_FIELDS.indexOf(entry.field.id) !== -1) {
        reserved[entry.field.id] = value.slice(0, 254);
        return;
      }
      if (Object.keys(custom).length >= MAX_LEAD_FORM_FIELDS) return;
      custom[entry.field.id] = value.slice(0, MAX_LEAD_VALUE_LENGTH);
    });
    return { fields: reserved, customFields: custom };
  }

  GarudaWidget.prototype.leadFormFields = function leadFormFields(spec) {
    var builder = this.agent.leadForm;
    var fields = builder.fromServer ? builder.fields : legacyLeadFormFields(spec.fields);
    return fields.slice(0, MAX_LEAD_FORM_FIELDS).map(function (field) {
      return Object.assign({}, field, {
        required: field.required === true || spec.requiredFields.indexOf(field.id) !== -1
      });
    });
  };

  GarudaWidget.prototype.showLeadForm = function showLeadForm(spec) {
    var self = this;
    if (this.leadVisible || !this.leadCaptureAvailable()) return;
    this.leadVisible = true;
    this.updateContactVisibility();
    var normalized = normalizeLeadSpec(spec, this.agent);
    var builder = this.agent.leadForm;
    var entries = this.leadFormFields(normalized).map(createLeadField);
    var headingCopy = builder.fromServer && builder.heading
      ? builder.heading
      : 'How can the team reach you?';
    var submitCopy = builder.fromServer && builder.submitLabel
      ? builder.submitLabel
      : 'Send securely';
    var introCopy = builder.fromServer && builder.prompt ? builder.prompt : normalized.prompt;
    var privacyCopy = normalized.privacyText || builder.privacyText;
    var card = element('section', 'gw-lead-card');
    card.setAttribute('aria-labelledby', 'gw-lead-title');
    var top = element('div', 'gw-lead-top');
    var headingWrap = element('div');
    var eyebrow = element('span', 'gw-lead-eyebrow', 'Human follow-up');
    var heading = element('h2', '', headingCopy);
    heading.id = 'gw-lead-title';
    var intro = element('p', '', introCopy);
    intro.hidden = !introCopy;
    headingWrap.appendChild(eyebrow);
    headingWrap.appendChild(heading);
    headingWrap.appendChild(intro);
    var dismiss = element('button', 'gw-lead-dismiss');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Dismiss contact form');
    dismiss.appendChild(svgIcon('M6 6l12 12M18 6 6 18'));
    top.appendChild(headingWrap);
    top.appendChild(dismiss);
    var form = element('form', 'gw-lead-form');
    // The browser's own validation bubbles cannot be styled inside a shadow root
    // and leave nothing behind for a screen reader to read a second time, so the
    // per-field lines below take that job.
    form.noValidate = true;
    entries.forEach(function (entry) { form.appendChild(entry.group); });
    var consentLabel = element('label', 'gw-check');
    var checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.required = true;
    var consentError = element('p', 'gw-field-error gw-consent-error');
    consentError.id = 'gw-consent-error-' + randomID();
    consentError.hidden = true;
    consentError.setAttribute('role', 'alert');
    checkbox.setAttribute('aria-describedby', consentError.id);
    consentLabel.appendChild(checkbox);
    consentLabel.appendChild(element('span', '', 'I agree to be contacted about my request.'));
    form.appendChild(consentLabel);
    form.appendChild(consentError);
    if (privacyCopy) {
      form.appendChild(element('p', 'gw-lead-privacy-copy', privacyCopy));
    }
    if (this.agent.privacyUrl) {
      var privacy = element('a', 'gw-privacy-link', 'View privacy policy');
      privacy.href = this.agent.privacyUrl;
      privacy.target = '_blank';
      privacy.rel = 'noopener noreferrer';
      form.appendChild(privacy);
    }
    var submit = element('button', 'gw-primary-button gw-lead-submit', submitCopy);
    submit.type = 'submit';
    var formStatus = element('p', 'gw-form-status');
    formStatus.setAttribute('role', 'status');
    form.appendChild(submit);
    form.appendChild(formStatus);
    card.appendChild(top);
    card.appendChild(form);
    var clientCaptureID = randomID();
    this.nodes.leadRegion.replaceChildren(card);
    this.nodes.contactButton.hidden = true;
    this.scrollToBottom(true);
    dismiss.addEventListener('click', function () {
      self.leadVisible = false;
      self.nodes.leadRegion.replaceChildren();
      self.updateContactVisibility();
      self.nodes.textarea.focus({ preventScroll: true });
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      // One submission at a time. The button is already disabled while a capture
      // is in flight; this guards the keyboard path that can fire submit again.
      if (submit.disabled) return;
      var firstProblem = null;
      entries.forEach(function (entry) {
        var problem = leadFieldProblem(entry);
        setLeadFieldProblem(entry, problem);
        if (problem && !firstProblem) firstProblem = entry;
      });
      var consented = checkbox.checked === true;
      consentError.textContent = consented ? '' : 'Please confirm you agree to be contacted.';
      consentError.hidden = consented;
      if (firstProblem || !consented) {
        formStatus.textContent = 'Check the highlighted fields and try again.';
        var focusTarget = firstProblem ? firstProblem.control : checkbox;
        focusTarget.focus({ preventScroll: true });
        return;
      }
      var submission = leadSubmission(entries);
      setButtonBusy(submit, true, 'Sending…');
      formStatus.textContent = '';
      try {
        await self.ensureSession();
        await self.captureLeadWithRefresh({
          clientCaptureID: clientCaptureID,
          fields: submission.fields,
          customFields: submission.customFields
        }, false);
        var success = element('div', 'gw-lead-success');
        var successIcon = element('div', 'gw-success-icon');
        successIcon.appendChild(svgIcon('M5 12.5 9.5 17 19 7'));
        success.appendChild(successIcon);
        success.appendChild(element('h2', '', 'You are all set'));
        success.appendChild(element('p', '', 'Thanks — the team has your details and can follow up.'));
        card.replaceChildren(success);
      } catch (error) {
        setButtonBusy(submit, false, '', submitCopy);
        var named = error instanceof WidgetError && showLeadFieldErrors(entries, error.details);
        formStatus.textContent = named
          ? 'Check the highlighted fields and try again.'
          : error instanceof WidgetError
            ? error.message
            : 'Your details could not be sent. Please try again.';
      }
    });
  };

  GarudaWidget.prototype.captureLeadWithRefresh = async function captureLeadWithRefresh(request, retrying) {
    try {
      return await this.api.captureLead(this.session, request);
    } catch (error) {
      var canRefresh = !retrying &&
        error instanceof WidgetError &&
        (error.status === 401 || error.code === 'session_expired' || error.code === 'invalid_session');
      if (!canRefresh) throw error;
      await this.ensureSession(true);
      return this.captureLeadWithRefresh(request, true);
    }
  };

  GarudaWidget.prototype.showNotice = function showNotice(message, retry) {
    this.lastRetry = typeof retry === 'function' ? retry : null;
    this.nodes.noticeText.textContent = asText(message, 'Something went wrong.', 240);
    this.nodes.retryButton.hidden = !this.lastRetry;
    this.nodes.connectionNotice.hidden = false;
  };

  GarudaWidget.prototype.clearNotice = function clearNotice() {
    this.lastRetry = null;
    if (this.nodes.connectionNotice) this.nodes.connectionNotice.hidden = true;
  };

  GarudaWidget.prototype.scrollToBottom = function scrollToBottom(smooth) {
    var body = this.nodes.body;
    if (!body) return;
    global.requestAnimationFrame(function () {
      var reduced = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
      body.scrollTo({
        top: body.scrollHeight,
        behavior: smooth && !reduced ? 'smooth' : 'auto'
      });
    });
  };

  function widgetCSS() {
    return [
      ':host{--garuda-accent:#4F46E5;--garuda-accent-text:#fff;--garuda-primary:#111827;--garuda-primary-text:#fff;--garuda-background:#fff;--garuda-surface:#F3F4F6;--garuda-text:#111827;--garuda-muted:color-mix(in srgb,var(--garuda-text) 62%,transparent);--garuda-line:color-mix(in srgb,var(--garuda-text) 12%,transparent);--garuda-z-index:2147482000;all:initial;color-scheme:light;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}',
      // all:initial on the host outranks the browser's own [hidden] rule,
      // because an author declaration beats a user agent one. Without this the
      // host element stays visible when chat is switched off.
      ':host([hidden]){display:none!important;}',
      '*,*::before,*::after{box-sizing:border-box;}',
      'button,input,textarea{font:inherit;}',
      'button{touch-action:manipulation;}',
      '[hidden]{display:none!important;}',
      '.gw-shell{position:fixed;z-index:var(--garuda-z-index);right:max(20px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:flex-end;gap:14px;color:var(--garuda-text);line-height:1.45;text-rendering:optimizeLegibility;}',
      '.gw-shell[data-position$="_left"]{right:auto;left:max(20px,env(safe-area-inset-left));align-items:flex-start;}',
      '.gw-shell[data-position^="middle_"]{top:50%;bottom:auto;transform:translateY(-50%);}',
      '.gw-shell[data-position^="top_"]{top:max(20px,env(safe-area-inset-top));bottom:auto;flex-direction:column-reverse;}',
      '.gw-launcher{position:relative;min-width:60px;height:60px;border:0;border-radius:20px;padding:0 7px;background:var(--garuda-accent);color:var(--garuda-accent-text);display:flex;align-items:center;gap:0;box-shadow:0 14px 35px rgba(30,41,59,.22),0 4px 12px rgba(30,41,59,.12);cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,min-width .25s ease;border:1px solid rgba(255,255,255,.18);}',
      '.gw-launcher:hover{transform:translateY(-2px);box-shadow:0 18px 42px rgba(30,41,59,.27),0 5px 14px rgba(30,41,59,.13);}',
      '.gw-launcher:active{transform:translateY(0) scale(.98);}',
      '.gw-launcher:focus-visible,.gw-icon-button:focus-visible,.gw-send:focus-visible,.gw-suggestion:focus-visible,.gw-primary-button:focus-visible,.gw-secondary-button:focus-visible,.gw-contact-button:focus-visible,.gw-lead-dismiss:focus-visible,.gw-notice-action:focus-visible,a:focus-visible{outline:3px solid color-mix(in srgb,var(--garuda-accent) 36%,white);outline-offset:3px;}',
      '.gw-launcher-icon{width:46px;height:46px;border-radius:15px;display:grid;place-items:center;flex:none;background:rgba(255,255,255,.13);}',
      '.gw-launcher-icon svg{width:25px;height:25px;}',
      '.gw-launcher-label{max-width:0;overflow:hidden;white-space:nowrap;font-size:14px;font-weight:720;letter-spacing:-.01em;opacity:0;transition:max-width .25s ease,opacity .18s ease,padding .25s ease;}',
      '.gw-launcher:hover .gw-launcher-label,.gw-launcher:focus-visible .gw-launcher-label{max-width:190px;opacity:1;padding:0 13px 0 7px;}',
      '.gw-open .gw-launcher{min-width:60px;}',
      '.gw-open .gw-launcher-label{max-width:0!important;opacity:0!important;padding:0!important;}',
      '.gw-unread{position:absolute;right:-4px;top:-6px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;display:grid;place-items:center;background:#EF4444;color:#fff;border:3px solid #fff;font-size:10px;font-weight:800;box-shadow:0 4px 10px rgba(239,68,68,.28);}',
      '.gw-panel{width:min(390px,calc(100vw - 32px));height:min(650px,calc(100dvh - 112px));min-height:440px;border-radius:24px;background:var(--garuda-background);border:1px solid rgba(148,163,184,.26);box-shadow:0 28px 70px rgba(15,23,42,.2),0 8px 25px rgba(15,23,42,.1);overflow:hidden;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto auto auto auto;transform-origin:bottom right;animation:gw-enter .22s cubic-bezier(.2,.8,.2,1);}',
      '.gw-shell[data-position$="_left"] .gw-panel{transform-origin:bottom left;}',
      '.gw-shell[data-position^="top_"] .gw-panel{transform-origin:top right;}',
      '.gw-shell[data-position^="top_"][data-position$="_left"] .gw-panel{transform-origin:top left;}',
      '.gw-shell[data-position^="middle_"] .gw-panel{height:min(650px,calc(100dvh - 64px));}',
      '.gw-header{min-height:76px;padding:14px 13px 13px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--garuda-line);background:linear-gradient(135deg,var(--garuda-background) 0%,color-mix(in srgb,var(--garuda-primary) 8%,var(--garuda-background)) 100%);}',
      '.gw-header-actions{display:flex;align-items:center;gap:2px;flex:none;}',
      '.gw-muted-badge{width:32px;height:32px;flex:none;border-radius:11px;display:grid;place-items:center;color:var(--garuda-muted);background:color-mix(in srgb,var(--garuda-text) 7%,transparent);}',
      '.gw-muted-badge svg{width:17px;height:17px;}',
      '.gw-identity{display:flex;align-items:center;gap:11px;min-width:0;}',
      '.gw-avatar{position:relative;overflow:hidden;width:44px;height:44px;border-radius:15px;display:grid;place-items:center;flex:none;background:linear-gradient(145deg,color-mix(in srgb,var(--garuda-accent) 82%,white),var(--garuda-accent));color:var(--garuda-accent-text);font-size:17px;font-weight:800;box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),0 6px 14px color-mix(in srgb,var(--garuda-accent) 22%,transparent);}',
      '.gw-identity-copy{min-width:0;}',
      '.gw-avatar-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
      '.gw-title{font-size:15px;font-weight:760;letter-spacing:-.018em;color:var(--garuda-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:235px;}',
      '.gw-tagline{margin-top:1px;color:var(--garuda-muted);font-size:11px;font-weight:520;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:235px;}',
      '.gw-status{display:flex;align-items:center;gap:6px;margin-top:3px;color:#64748B;font-size:11px;font-weight:530;}',
      '.gw-status-dot{width:7px;height:7px;border-radius:50%;background:#94A3B8;box-shadow:0 0 0 3px rgba(148,163,184,.12);}',
      '.gw-status[data-state="online"] .gw-status-dot{background:#22C55E;box-shadow:0 0 0 3px rgba(34,197,94,.13);}',
      '.gw-status[data-state="loading"] .gw-status-dot{background:#F59E0B;animation:gw-pulse 1.2s ease-in-out infinite;}',
      '.gw-status[data-state="error"] .gw-status-dot{background:#EF4444;}',
      '.gw-icon-button,.gw-lead-dismiss{width:42px;height:42px;border:0;border-radius:13px;display:grid;place-items:center;background:transparent;color:#64748B;cursor:pointer;transition:background .15s ease,color .15s ease;}',
      '.gw-icon-button:hover,.gw-lead-dismiss:hover{background:#EEF2F7;color:#111827;}',
      '.gw-icon-button svg{width:21px;height:21px;}',
      '.gw-notice{padding:9px 12px;background:#FFF7ED;border-bottom:1px solid #FED7AA;color:#9A3412;display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;line-height:1.4;}',
      '.gw-notice-action{border:0;background:transparent;color:#9A3412;text-decoration:underline;font-weight:750;cursor:pointer;white-space:nowrap;}',
      '.gw-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#CBD5E1 transparent;background:linear-gradient(180deg,var(--garuda-surface) 0%,var(--garuda-background) 42%);}',
      '.gw-body::-webkit-scrollbar{width:6px}.gw-body::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:8px;}',
      '.gw-messages{padding:18px 15px 7px;display:flex;flex-direction:column;gap:12px;}',
      '.gw-history-status{align-self:center;margin:0 0 2px;padding:5px 9px;border-radius:999px;background:#EEF2FF;color:#4F46E5;font-size:10px;font-weight:650;text-align:center;}',
      '.gw-message-row{display:flex;align-items:flex-end;gap:7px;max-width:91%;animation:gw-message .2s ease both;}',
      '.gw-message-row.gw-user{align-self:flex-end;flex-direction:row-reverse;}',
      '.gw-message-row.gw-assistant{align-self:flex-start;}',
      '.gw-bubble{padding:10px 12px;border-radius:16px;font-size:13px;line-height:1.55;letter-spacing:-.004em;box-shadow:0 1px 2px rgba(15,23,42,.05);}',
      '.gw-bubble p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;}',
      '.gw-assistant .gw-bubble{background:var(--garuda-surface);color:var(--garuda-text);border:1px solid var(--garuda-line);border-bottom-left-radius:5px;}',
      '.gw-user .gw-bubble{background:var(--garuda-accent);color:var(--garuda-accent-text);border:1px solid color-mix(in srgb,var(--garuda-accent) 88%,black);border-bottom-right-radius:5px;}',
      '.gw-mini-avatar{width:24px;height:24px;border-radius:9px;flex:none;display:grid;place-items:center;background:color-mix(in srgb,var(--garuda-accent) 12%,white);color:var(--garuda-accent);border:1px solid color-mix(in srgb,var(--garuda-accent) 18%,white);font-size:10px;font-weight:800;}',
      '.gw-streaming .gw-bubble::after{content:"";display:inline-block;width:5px;height:13px;margin-left:3px;vertical-align:-2px;border-radius:2px;background:var(--garuda-accent);animation:gw-cursor .8s steps(1) infinite;}',
      '.gw-suggestions{padding:6px 15px 13px;display:flex;flex-wrap:wrap;gap:7px;}',
      '.gw-suggestion{border:1px solid color-mix(in srgb,var(--garuda-accent) 22%,#DCE2EA);border-radius:999px;padding:8px 11px;background:#fff;color:color-mix(in srgb,var(--garuda-accent) 80%,#172033);font-size:11px;font-weight:650;line-height:1.25;cursor:pointer;text-align:left;transition:background .15s,border-color .15s,transform .15s;}',
      '.gw-suggestion:hover{background:color-mix(in srgb,var(--garuda-accent) 6%,white);border-color:color-mix(in srgb,var(--garuda-accent) 42%,#DCE2EA);transform:translateY(-1px);}',
      '.gw-suggestion:disabled{opacity:.45;cursor:default;transform:none;}',
      '.gw-typing{height:23px;padding:2px 18px 5px;display:flex;align-items:center;gap:4px;background:var(--garuda-background);}',
      '.gw-typing span{width:5px;height:5px;border-radius:50%;background:#94A3B8;animation:gw-typing 1.1s ease-in-out infinite;}',
      '.gw-typing span:nth-child(2){animation-delay:.14s}.gw-typing span:nth-child(3){animation-delay:.28s;}',
      '.gw-contact-row{padding:4px 15px 3px;background:var(--garuda-background);}',
      '.gw-contact-button{min-height:35px;border:0;background:transparent;color:#5B6475;display:flex;align-items:center;gap:6px;padding:5px 3px;font-size:11px;font-weight:680;cursor:pointer;}',
      '.gw-contact-button:hover{color:var(--garuda-accent);}',
      '.gw-contact-button svg{width:15px;height:15px;}',
      '.gw-composer{display:flex;align-items:flex-end;gap:8px;padding:9px 12px 11px;background:var(--garuda-background);border-top:1px solid var(--garuda-line);}',
      '.gw-input-wrap{position:relative;flex:1;min-width:0;}',
      '.gw-input{display:block;width:100%;min-height:44px;max-height:112px;resize:none;border:1px solid var(--garuda-line);border-radius:15px;background:var(--garuda-surface);padding:11px 12px;color:var(--garuda-text);font-size:13px;line-height:1.45;outline:0;overflow-y:auto;transition:border-color .15s,box-shadow .15s,background .15s;}',
      '.gw-input::placeholder{color:#94A3B8;}',
      '.gw-input:focus{border-color:color-mix(in srgb,var(--garuda-accent) 55%,#DCE2EA);box-shadow:0 0 0 3px color-mix(in srgb,var(--garuda-accent) 10%,transparent);background:var(--garuda-background);}',
      '.gw-input:disabled{cursor:not-allowed;opacity:.65;}',
      '.gw-counter{position:absolute;right:8px;bottom:-17px;font-size:9px;color:#64748B;}',
      '.gw-send{position:relative;width:44px;height:44px;flex:none;border:0;border-radius:14px;display:grid;place-items:center;background:var(--garuda-accent);color:var(--garuda-accent-text);box-shadow:0 6px 14px color-mix(in srgb,var(--garuda-accent) 23%,transparent);cursor:pointer;transition:transform .15s,opacity .15s;}',
      '.gw-send:hover:not(:disabled){transform:translateY(-1px)}.gw-send:active:not(:disabled){transform:scale(.97)}',
      '.gw-send:disabled{opacity:.35;cursor:not-allowed;box-shadow:none;}',
      '.gw-send svg{width:20px;height:20px;}',
      '.gw-footer{min-height:28px;padding:0 12px 8px;display:flex;align-items:center;justify-content:center;color:#94A3B8;background:var(--garuda-background);font-size:9px;letter-spacing:.01em;}',
      '.gw-footer svg{width:10px;height:10px;margin-right:4px}.gw-brand{margin-left:3px;color:#64748B;font-weight:780;}',
      '.gw-consent-card{margin:5px 0 7px;padding:17px;border-radius:19px;background:var(--garuda-background);border:1px solid var(--garuda-line);box-shadow:0 9px 25px rgba(15,23,42,.07);text-align:left;}',
      '.gw-consent-icon{width:35px;height:35px;border-radius:12px;display:grid;place-items:center;margin-bottom:11px;background:color-mix(in srgb,var(--garuda-accent) 10%,white);color:var(--garuda-accent);}',
      '.gw-consent-icon svg{width:19px;height:19px;}',
      '.gw-consent-card h2,.gw-lead-card h2,.gw-lead-success h2{margin:0;color:var(--garuda-text);font-size:15px;letter-spacing:-.015em;}',
      '.gw-consent-card p,.gw-lead-card p,.gw-lead-success p{margin:6px 0 0;color:var(--garuda-muted);font-size:11px;line-height:1.55;}',
      '.gw-consent-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:14px;}',
      '.gw-primary-button,.gw-secondary-button{min-height:40px;border-radius:12px;padding:8px 11px;font-size:11px;font-weight:740;cursor:pointer;}',
      '.gw-primary-button{border:1px solid var(--garuda-primary);background:var(--garuda-primary);color:var(--garuda-primary-text);}',
      '.gw-primary-button:disabled{opacity:.55;cursor:not-allowed;}',
      '.gw-busy{cursor:progress;}',
      '.gw-primary-button.gw-busy::before,.gw-notice-action.gw-busy::before,.gw-suggestion.gw-busy::before{content:"";display:inline-block;width:11px;height:11px;margin-right:7px;vertical-align:-1px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:gw-spin .7s linear infinite;}',
      '.gw-send.gw-busy svg{opacity:0;}',
      '.gw-send.gw-busy::after{content:"";position:absolute;width:17px;height:17px;border-radius:50%;border:2px solid currentColor;border-top-color:transparent;animation:gw-spin .7s linear infinite;}',
      '.gw-secondary-button{border:1px solid #DCE2EA;background:#fff;color:#475569;}',
      '.gw-secondary-button:hover{background:#F8FAFC;}',
      '.gw-privacy-link{display:inline-block;margin-top:10px;color:var(--garuda-accent);font-size:10px;font-weight:650;text-underline-offset:2px;}',
      '.gw-lead-region{padding:0 15px 13px;}',
      '.gw-lead-card{border-radius:19px;padding:15px;background:var(--garuda-background);border:1px solid color-mix(in srgb,var(--garuda-accent) 19%,#E4E9F0);box-shadow:0 11px 30px rgba(15,23,42,.08);}',
      '.gw-lead-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;}',
      '.gw-lead-eyebrow{display:block;margin-bottom:3px;color:var(--garuda-accent);font-size:9px;font-weight:820;text-transform:uppercase;letter-spacing:.12em;}',
      '.gw-lead-dismiss{width:34px;height:34px;flex:none}.gw-lead-dismiss svg{width:16px;height:16px;}',
      '.gw-lead-form{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:13px;}',
      '.gw-field{display:flex;flex-direction:column;gap:4px;min-width:0;}',
      '.gw-field-textarea,.gw-field-select,.gw-field-checkbox{grid-column:1/-1;}',
      '.gw-field label{color:var(--garuda-muted);font-size:10px;font-weight:700}.gw-field label span{color:#94A3B8;font-weight:500;}',
      '.gw-field label .gw-required{color:#B91C1C;font-weight:800;}',
      '.gw-field input,.gw-field select,.gw-field textarea{width:100%;min-height:39px;border:1px solid var(--garuda-line);border-radius:11px;padding:9px 10px;background:var(--garuda-surface);color:var(--garuda-text);font-size:11px;outline:0;}',
      '.gw-field textarea{resize:vertical;min-height:66px;line-height:1.45;}',
      '.gw-field input:focus,.gw-field select:focus,.gw-field textarea:focus{border-color:var(--garuda-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--garuda-accent) 9%,transparent);background:var(--garuda-background);}',
      '.gw-field [aria-invalid="true"]{border-color:#B91C1C;}',
      '.gw-field-checkbox{flex-direction:row;align-items:center;gap:8px;flex-wrap:wrap;}',
      '.gw-field-checkbox input{width:16px;height:16px;min-height:0;flex:none;padding:0;accent-color:var(--garuda-accent);}',
      '.gw-field-checkbox label{order:1;}',
      '.gw-field-error{width:100%;margin:0!important;color:#B91C1C!important;font-size:10px!important;}',
      '.gw-check{grid-column:1/-1;display:flex;align-items:flex-start;gap:8px;margin-top:2px;color:#526075;font-size:10px;line-height:1.45;cursor:pointer;}',
      '.gw-check input{width:16px;height:16px;margin:0;flex:none;accent-color:var(--garuda-accent);}',
      '.gw-consent-error{grid-column:1/-1;}',
      '.gw-lead-privacy-copy{grid-column:1/-1;margin:-3px 0 0!important;color:#7B8798!important;font-size:9px!important;}',
      '.gw-lead-form>.gw-privacy-link{grid-column:1/-1;margin:0;}',
      '.gw-lead-submit{grid-column:1/-1;width:100%;}',
      '.gw-form-status{grid-column:1/-1;margin:0!important;color:#B91C1C!important;}',
      '.gw-lead-success{text-align:center;padding:11px 5px 8px;}',
      '.gw-success-icon{width:40px;height:40px;margin:0 auto 9px;border-radius:14px;display:grid;place-items:center;background:#DCFCE7;color:#15803D;}',
      '.gw-success-icon svg{width:21px;height:21px;}',
      '.gw-glowing .gw-launcher{animation:gw-glow 2.6s ease-in-out infinite;}',
      '.gw-transparent .gw-panel{background:color-mix(in srgb,var(--garuda-background) 78%,transparent);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);}',
      '.gw-transparent .gw-header,.gw-transparent .gw-body,.gw-transparent .gw-typing,.gw-transparent .gw-contact-row,.gw-transparent .gw-composer,.gw-transparent .gw-footer{background:transparent;}',
      '.gw-transparent .gw-assistant .gw-bubble,.gw-transparent .gw-lead-card,.gw-transparent .gw-consent-card{background:color-mix(in srgb,var(--garuda-background) 70%,transparent);}',
      '@keyframes gw-glow{0%,100%{box-shadow:0 14px 35px rgba(30,41,59,.22),0 0 0 0 color-mix(in srgb,var(--garuda-accent) 55%,transparent)}55%{box-shadow:0 14px 35px rgba(30,41,59,.22),0 0 0 13px color-mix(in srgb,var(--garuda-accent) 0%,transparent)}}',
      '@keyframes gw-spin{to{transform:rotate(360deg)}}',
      '@keyframes gw-enter{from{opacity:0;transform:translateY(13px) scale(.96)}to{opacity:1;transform:none}}',
      '@keyframes gw-message{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}',
      '@keyframes gw-pulse{50%{opacity:.42;transform:scale(.82)}}',
      '@keyframes gw-typing{0%,65%,100%{transform:translateY(0);opacity:.45}35%{transform:translateY(-3px);opacity:1}}',
      '@keyframes gw-cursor{50%{opacity:0}}',
      '@media(max-width:520px){.gw-shell,.gw-shell[data-position$="_left"]{right:max(10px,env(safe-area-inset-right));left:max(10px,env(safe-area-inset-left));align-items:flex-end}.gw-shell[data-position^="bottom_"]{bottom:max(10px,env(safe-area-inset-bottom))}.gw-shell[data-position^="top_"]{top:max(10px,env(safe-area-inset-top))}.gw-panel{width:100%;height:min(690px,calc(100dvh - 88px));min-height:380px;border-radius:22px}.gw-launcher{height:56px;min-width:56px;border-radius:18px}.gw-launcher-icon{width:42px;height:42px;border-radius:13px}.gw-title{max-width:220px}.gw-launcher-label{display:none}}',
      '@media(max-width:360px){.gw-panel{border-radius:18px}.gw-messages{padding-left:12px;padding-right:12px}.gw-lead-form{grid-template-columns:1fr}.gw-field,.gw-check,.gw-lead-submit,.gw-form-status{grid-column:1}.gw-consent-actions{grid-template-columns:1fr}}',
      '@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}',
      '@media(prefers-contrast:more){.gw-panel,.gw-bubble,.gw-input,.gw-field input,.gw-suggestion{border-color:#64748B}.gw-status,.gw-footer{color:#475569}}'
    ].join('');
  }

  // Tests load this file in Node, where there is no document to mount into. The
  // check sits at the very end so that every prototype method above is defined
  // before the module is handed over, including the ones a test drives directly.
  if (
    typeof module === 'object' &&
    module &&
    module.exports &&
    typeof global.document === 'undefined'
  ) {
    module.exports = TEST_EXPORTS;
    return;
  }
  if (!global.document || !global.fetch) return;

  boot();
})(typeof window !== 'undefined' ? window : globalThis);
