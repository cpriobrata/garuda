(function garudaWidgetRuntime(global) {
  'use strict';

  var VERSION = '__GARUDA_VERSION__';
  var MAX_MESSAGE_LENGTH = 4000;
  var MAX_HISTORY = 50;
  var REQUEST_TIMEOUT_MS = 20000;
  var MESSAGE_REQUEST_TIMEOUT_MS = 60000;
  var STREAM_IDLE_TIMEOUT_MS = 30000;
  var TEAM_REPLY_POLL_MS = 12000;
  // ---- visitor journey ----
  // The numbers below mirror backend/internal/api/journey.go. Every one of them
  // is enforced there as well; they are repeated here so the widget never builds
  // a batch the server has to refuse, and never grows without bound on a page it
  // does not own.
  var JOURNEY_FLUSH_MS = 15000;
  // maxJourneyBatch. A larger batch is answered with 422, not stored.
  var MAX_JOURNEY_BATCH = 20;
  // The server keeps fifty pages per session and drops the oldest. Holding a few
  // more than that here leaves room for pages still waiting on a batch, and
  // stops a very long visit from growing this array for the rest of the day.
  var MAX_JOURNEY_PAGES = 60;
  var MAX_JOURNEY_PATH = 512;
  var MAX_JOURNEY_TITLE = 200;
  var MAX_JOURNEY_CAMPAIGN = 120;
  // maxPageSeconds. Four hours on one page is already a broken clock.
  var MAX_PAGE_SECONDS = 4 * 60 * 60;
  // No single accrual may add more than two flush intervals. Time is counted in
  // steps between events while the tab is visible and focused, and a step far
  // larger than the timer that produced it is a laptop that slept with the tab
  // still open, not somebody reading.
  var MAX_ENGAGED_STEP_MS = 2 * JOURNEY_FLUSH_MS;
  // Analytics may never become a retry storm on somebody else's website. After
  // this many consecutive failures the tracker stops for good.
  var MAX_JOURNEY_FAILURES = 5;
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
  // ---- appointments ----
  // These three mirror what the booking endpoint stores, so the widget never
  // builds a request the server has to refuse. See backend/internal/api/booking.go.
  var MAX_BOOKING_NAME = 160;
  var MAX_BOOKING_EMAIL = 254;
  var MAX_BOOKING_NOTES = 500;
  // A fortnight of working hours is several hundred free slots, which is more
  // buttons than anyone reads and more DOM than a widget should put on somebody
  // else's page. The soonest sixty are drawn and the rest are named as unshown
  // rather than silently dropped.
  var MAX_BOOKING_SLOTS = 60;
  // Said in the visitor's own terms rather than as an error: between seeing a
  // time and choosing it, the owner took it.
  var SLOT_TAKEN_MESSAGE = 'That time was taken while you were choosing.';
  // ---- speaking instead of typing ----
  // Every number below mirrors backend/internal/api/widget_voice.go, so a
  // recording is stopped here rather than refused after the visitor has already
  // waited for the upload.
  //
  // maxWidgetVoiceBytes is one megabyte. The recording stops short of it so the
  // container's own trailer cannot push the finished blob past the cap.
  var MAX_VOICE_BYTES = 960 * 1024;
  // minVoiceNoteBytes. Below this there is no speech in any container the
  // server accepts, and it answers 422 -- which no round trip is needed to
  // learn.
  var MIN_VOICE_BYTES = 2 * 1024;
  // About a minute, which is what a megabyte of browser audio comes to. A chat
  // message is not a voicemail.
  var MAX_VOICE_SECONDS = 60;
  // The last stretch is counted down rather than sprung on the visitor.
  var VOICE_WARN_SECONDS = 10;
  // Measured against the clock four times a second, so a throttled tab reports
  // the length the server is going to measure rather than the ticks it managed.
  var VOICE_TICK_MS = 250;
  // Transcription is a round trip through a speech provider. The twenty second
  // default would abandon recordings that were going to succeed.
  var VOICE_REQUEST_TIMEOUT_MS = 90000;
  // Most preferred first. Chrome and Firefox record webm/opus and Safari
  // records mp4, so the list is walked rather than assumed, and every entry is
  // one acceptedVoiceMediaTypes already takes.
  var VOICE_MIME_TYPES = [
    'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/mp4'
  ];

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

  // The bootstrap says only that a handoff exists and what to call it. The
  // owner's phone number is deliberately absent: the bootstrap is public, and
  // the number becomes a link only inside an endpoint that first checks the
  // session token. See backend/internal/api/handoff.go.
  function normalizeHandoff(raw) {
    if (!isRecord(raw) || raw.enabled !== true) {
      return { enabled: false, label: '', availability: '', triggerPhrases: [], autoOfferAfter: 0 };
    }
    var autoOffer = Number(raw.auto_offer_after);
    return {
      enabled: true,
      channel: safeSlug(raw.channel, 20) || 'whatsapp',
      label: asText(raw.label, 'Talk to a person', 60),
      availability: asText(raw.availability, '', 120),
      triggerPhrases: safeTextList(raw.trigger_phrases, 12, 60).map(function (phrase) {
        return phrase.toLowerCase();
      }),
      autoOfferAfter: Number.isFinite(autoOffer) && autoOffer > 0 ? Math.min(Math.floor(autoOffer), 50) : 0
    };
  }

  // Like the handoff, the bootstrap says only that appointments exist, what to
  // call the button, how long one takes and which zone the owner works in. The
  // calendar, the working hours and the account are deliberately absent: the
  // bootstrap is public, and free times are only readable inside an endpoint
  // that first checks the session token. See backend/internal/api/booking.go.
  function normalizeBooking(raw) {
    if (!isRecord(raw) || raw.enabled !== true) {
      return { enabled: false, label: '', durationMinutes: 0, timezone: '', completesElsewhere: false, providerLabel: '', schedulingURL: '' };
    }
    var minutes = Number(raw.duration_minutes);
    // Some calendars -- Calendly and its like -- have no create-booking API at
    // all: the appointment is made on their own page. The bootstrap says so, and
    // dropping that here is what put a Confirm button in front of visitors that
    // could never finish. A link is only accepted if it is an https address, so
    // a malformed setting produces no button rather than a broken one.
    var schedulingURL = asText(raw.scheduling_url, '', 400);
    var elsewhere = raw.completes_elsewhere === true && schedulingURL.toLowerCase().indexOf('https://') === 0;
    return {
      enabled: true,
      label: asText(raw.label, 'Book an appointment', 60),
      durationMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0,
      timezone: asText(raw.timezone, '', 64),
      completesElsewhere: elsewhere,
      providerLabel: elsewhere ? asText(raw.provider_label, 'their booking page', 40) : '',
      schedulingURL: elsewhere ? schedulingURL : ''
    };
  }

  // A slot arrives twice over: the instant the booking call has to echo back,
  // and the owner's own wording for it. The wording is used exactly as sent. A
  // browser that re-rendered start in its own locale would show a visitor in
  // another country a time the owner never offered.
  function normalizeBookingSlot(raw) {
    if (!isRecord(raw)) return null;
    var start = asText(raw.start, '', 60);
    if (!start) return null;
    var label = asText(raw.label, '', 80);
    var day = asText(raw.day, '', 40);
    var time = asText(raw.time, '', 24);
    // A payload missing one of the three rendered forms borrows another rather
    // than deriving one from start, for the same reason.
    if (!time) time = label;
    if (!time) return null;
    if (!day) day = label || 'Available times';
    if (!label) label = day + ', ' + time;
    var minutes = Number(raw.minutes);
    return {
      start: start,
      label: label,
      day: day,
      time: time,
      minutes: Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0
    };
  }

  function normalizeBookingSlots(payload) {
    var data = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
    data = isRecord(data) ? data : {};
    var offered = Array.isArray(data.slots) ? data.slots : [];
    var slots = [];
    offered.slice(0, MAX_BOOKING_SLOTS).forEach(function (raw) {
      var slot = normalizeBookingSlot(raw);
      if (slot) slots.push(slot);
    });
    var minutes = Number(data.duration_minutes);
    return {
      slots: slots,
      truncated: offered.length > MAX_BOOKING_SLOTS,
      timezone: asText(data.timezone, '', 64),
      durationMinutes: Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0
    };
  }

  function groupBookingSlots(slots) {
    var groups = [];
    // The day is server text used as a key, so the map has no prototype for it
    // to collide with.
    var byDay = Object.create(null);
    slots.forEach(function (slot) {
      if (!byDay[slot.day]) {
        byDay[slot.day] = { day: slot.day, slots: [] };
        groups.push(byDay[slot.day]);
      }
      byDay[slot.day].slots.push(slot);
    });
    return groups;
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
      launcherLabel: asText(raw.launcher_label || raw.launcher_text, '', 50),
      handoff: normalizeHandoff(raw.handoff),
      booking: normalizeBooking(raw.booking)
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

  // openExternal leaves the host page alone. An anchor click is used rather
  // than window.open because window.open with noopener returns null whether it
  // worked or not, so its result cannot be tested -- and because a popup blocker
  // silently ignoring an anchor is a far better failure on somebody else's
  // website than navigating their visitor away.
  function openExternal(url) {
    try {
      var link = global.document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
      link.style.display = 'none';
      global.document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (_error) {
      // A blocked or failed open costs nothing: the visitor still has the link
      // in the transcript.
    }
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
      },
      // Not a timeout: the visitor asked for the wait to stop. expired stays
      // false, so the caller can tell a cancellation from a stall and say
      // nothing about a request nobody is waiting for any more.
      abort: function () {
        deadline.clear();
        if (controller) controller.abort();
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

  // ---- what the visitor's journey is made of ----
  //
  // These four are pure functions of the browser's own state so that the rules
  // they encode -- which are the part a customer reads on a lead -- can be
  // tested without mounting anything.

  function decodeQueryValue(value) {
    var text = String(value).replace(/\+/g, ' ');
    try {
      return decodeURIComponent(text);
    } catch (_error) {
      // A malformed percent escape is somebody else's URL, not a reason to stop.
      return text;
    }
  }

  // The campaign parameters, and whether an ad click carried the visitor here.
  // The click id itself is deliberately never copied into the result: that the
  // visit came from a Google or Meta ad is the useful part, and the id names one
  // click by one person, so it stays in the address bar it arrived in.
  function campaignParameters(search) {
    var found = {
      utm_source: '',
      utm_medium: '',
      utm_campaign: '',
      utm_term: '',
      utm_content: '',
      google_click: false,
      meta_click: false
    };
    var query = typeof search === 'string' ? search.replace(/^[?]/, '') : '';
    if (!query) return found;
    query.split('&').forEach(function (pair) {
      if (!pair) return;
      var separator = pair.indexOf('=');
      var name = decodeQueryValue(separator === -1 ? pair : pair.slice(0, separator))
        .trim().toLowerCase();
      var value = separator === -1 ? '' : decodeQueryValue(pair.slice(separator + 1));
      var present = value.trim() !== '';
      if (name === 'gclid') {
        found.google_click = found.google_click || present;
        return;
      }
      if (name === 'fbclid') {
        found.meta_click = found.meta_click || present;
        return;
      }
      // Only the five campaign names are read, and only the first occurrence of
      // each, so a duplicated parameter cannot rewrite one that already landed.
      if (name.indexOf('utm_') !== 0) return;
      if (!Object.prototype.hasOwnProperty.call(found, name)) return;
      if (!found[name]) found[name] = asText(value, '', MAX_JOURNEY_CAMPAIGN);
    });
    return found;
  }

  // The path, and nothing after it. A customer's own URLs can carry an order id,
  // a token in a reset link or an address in a tracking parameter, and none of
  // that belongs on a lead record. The server strips query strings as well; this
  // is here so the widget never sends one in the first place.
  function journeyPath(location) {
    var path = '';
    if (location && typeof location.href === 'string') {
      try {
        path = new URL(location.href).pathname || '';
      } catch (_error) {
        path = '';
      }
    }
    if (!path && location && typeof location.pathname === 'string') path = location.pathname;
    var cut = path.search(/[?#]/);
    if (cut !== -1) path = path.slice(0, cut);
    if (!path) path = '/';
    if (path.charAt(0) !== '/') path = '/' + path;
    return path.slice(0, MAX_JOURNEY_PATH);
  }

  function journeyQuery(location) {
    if (location && typeof location.href === 'string') {
      try {
        return new URL(location.href).search || '';
      } catch (_error) {
        // Fall through to whatever the location object itself exposes.
      }
    }
    return location && typeof location.search === 'string' ? location.search : '';
  }

  function journeySource() {
    var location = global.location || {};
    var campaign = campaignParameters(journeyQuery(location));
    var source = { landing_path: journeyPath(location) };
    var referrer = asText(global.document && global.document.referrer, '', 2000);
    if (referrer) source.referrer = referrer;
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (name) {
      if (campaign[name]) source[name] = campaign[name];
    });
    // Booleans, never ids. Absent means false to the server, so only a real
    // click is written into the batch at all.
    if (campaign.google_click) source.google_click = true;
    if (campaign.meta_click) source.meta_click = true;
    return source;
  }

  // Viewport width rather than the user agent string, because the question the
  // customer is really asking is whether the page they paid for works on a
  // phone. The time zone stands in for a region: it costs nothing, adds no third
  // party to the request path, and leaves no trail the way an IP lookup would.
  function journeyDevice() {
    var device = {};
    var width = 0;
    if (typeof global.innerWidth === 'number') width = global.innerWidth;
    var root = global.document ? global.document.documentElement : null;
    if (!width && root && typeof root.clientWidth === 'number') width = root.clientWidth;
    width = Math.floor(width);
    if (Number.isFinite(width) && width > 0) device.viewport_width = Math.min(width, 20000);
    var language = asText(global.navigator && global.navigator.language, '', 32);
    if (language) device.language = language;
    // Intl is missing on a few old and stripped-down browsers, and resolving a
    // time zone is the one call here that can throw.
    try {
      if (typeof Intl !== 'undefined' && Intl && typeof Intl.DateTimeFormat === 'function') {
        var zone = asText(Intl.DateTimeFormat().resolvedOptions().timeZone, '', 64);
        if (zone) device.timezone = zone;
      }
    } catch (_error) {
      // A journey without a time zone is still a journey.
    }
    return device;
  }

  // ---- what a browser will and will not let a visitor record ----
  //
  // Pure functions of the browser's own state, so the rules they encode -- which
  // browsers can record, what went wrong with the microphone, and what a person
  // can actually do about it -- are testable without a microphone.

  function recordingEnvironment() {
    var media = global.navigator ? global.navigator.mediaDevices : null;
    return {
      secureContext: global.isSecureContext === true,
      hasMediaRecorder: typeof global.MediaRecorder === 'function',
      hasGetUserMedia: Boolean(media) && typeof media.getUserMedia === 'function'
    };
  }

  // The insecure origin is checked FIRST and deliberately. Over plain http a
  // browser does not merely refuse the microphone, it removes
  // navigator.mediaDevices altogether, so asking about the API first would
  // conclude that a current browser is too old to record.
  function recordingSupport(environment) {
    if (!environment.secureContext) return 'insecure_context';
    if (!environment.hasMediaRecorder) return 'no_media_recorder';
    if (!environment.hasGetUserMedia) return 'no_media_devices';
    return 'supported';
  }

  // Walks the list rather than assuming, because a browser handed a type it
  // cannot record throws at construction. An empty answer means "let the
  // browser choose", which is a working recorder and not a failure: whatever it
  // produced is read back off the blob and sent as the content type.
  function chooseVoiceMimeType(isTypeSupported) {
    if (typeof isTypeSupported !== 'function') return '';
    for (var index = 0; index < VOICE_MIME_TYPES.length; index += 1) {
      try {
        if (isTypeSupported(VOICE_MIME_TYPES[index])) return VOICE_MIME_TYPES[index];
      } catch (_error) {
        // A browser that throws on a type it has never heard of has answered.
      }
    }
    return '';
  }

  // permissionState is what navigator.permissions reports for the microphone on
  // the browsers that answer that query at all, and it is the whole difference
  // between a prompt somebody dismissed and a block the browser has remembered.
  // The two need different advice: once it is remembered no prompt is ever
  // shown again, so "press Allow" is a loop with no way out of it.
  function describeMicrophoneFailure(reason, permissionState) {
    var name = reason && typeof reason.name === 'string' ? reason.name : '';
    if (name === 'SecurityError' || permissionState === 'denied') {
      return 'Your browser is blocking the microphone for this site, so it will not ask again. Allow it in the site settings beside the address bar, or type your message instead.';
    }
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'PermissionDismissedError') {
      return 'The microphone was not allowed. Press the microphone button and choose Allow — nothing is recorded until you do.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No microphone was found. Connect one and try again, or type your message instead.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'Your microphone is in use by another app. Close it and try again, or type your message instead.';
    }
    if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
      return 'That microphone could not be started. Try another input device, or type your message instead.';
    }
    return 'The microphone could not be started. Try again, or type your message instead.';
  }

  // What the voice endpoint answers with, and what a visitor can do about each
  // one. `off` means voice is unavailable on this WEBSITE rather than for this
  // recording: the button is taken away and the keyboard is the whole of the
  // answer, because pressing it again cannot end differently. None of these
  // blame the visitor, because none of it is their doing.
  function voiceFailure(error) {
    var code = error instanceof WidgetError ? error.code : '';
    if (code === 'subscription_required' || code === 'voice_unavailable') {
      return { off: true, message: 'Voice messages are not available on this site. Please type your message instead.' };
    }
    if (code === 'unsupported_media_type') {
      return { off: true, message: 'This browser records in a format we cannot transcribe. Please type your message, or try another browser.' };
    }
    if (code === 'transcription_unavailable') {
      return { off: false, message: 'That recording could not be understood just now. Try again, or type your message.' };
    }
    if (code === 'audio_too_large') {
      return { off: false, message: 'That recording was too long to send. Keep it under a minute.' };
    }
    if (code === 'audio_too_short') {
      return { off: false, message: 'That was too short to hear. Press the microphone and speak for a few seconds.' };
    }
    if (code === 'no_speech_detected') {
      return { off: false, message: 'Nothing could be heard. Try again somewhere quieter, or type your message.' };
    }
    if (code === 'voice_quota_exceeded') {
      return { off: false, message: 'Voice messages are busy right now. Please type your message instead.' };
    }
    // Written by the rate limiter in front of the route rather than by the
    // handler, which is why it is not one of the handler's own codes. It is the
    // one a visitor who keeps re-recording meets first, so it must not fall
    // through to "that could not be understood", which blames the recording.
    if (code === 'rate_limited') {
      return { off: false, message: 'That is a lot of voice messages. Wait a moment, or type your message instead.' };
    }
    if (code === 'network_error') {
      return { off: false, message: 'The recording could not be sent. Check your connection and try again.' };
    }
    return { off: false, message: 'That recording could not be sent just now. Try again, or type your message.' };
  }

  // Every track, and one track that refuses to stop never prevents the rest
  // being released. A microphone left live after the visitor has finished is the
  // worst thing this file could do on somebody else's website.
  function releaseMicrophoneStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    var tracks = [];
    try {
      tracks = stream.getTracks() || [];
    } catch (_error) {
      return;
    }
    tracks.forEach(function (track) {
      try {
        if (track && typeof track.stop === 'function') track.stop();
      } catch (_stopError) {
        // A track that has already ended throws on some browsers, and the ones
        // after it still have to be stopped.
      }
    });
  }

  function formatElapsed(totalSeconds) {
    var safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
    return Math.floor(safe / 60) + ':' + String(safe % 60).padStart(2, '0');
  }

  // Firefox has no microphone permission descriptor and throws on the query.
  // Not knowing costs only the more specific of two messages.
  async function readMicrophonePermission() {
    var permissions = global.navigator ? global.navigator.permissions : null;
    if (!permissions || typeof permissions.query !== 'function') return '';
    try {
      var status = await permissions.query({ name: 'microphone' });
      return status && typeof status.state === 'string' ? status.state : '';
    } catch (_error) {
      return '';
    }
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

  // What the visitor said, as text. This TRANSCRIBES, and that is all it does:
  // the endpoint has no way to post a message, and the widget puts the words in
  // the composer for the visitor to read and send themselves.
  //
  // The recording travels as the request body with its own content type. It
  // could not travel as JSON: decodeJSON refuses unknown fields and caps a body
  // at a megabyte, and audio is neither. Only Content-Type and the session token
  // are sent, because those are the two headers the widget CORS policy allows --
  // anything else fails the preflight rather than the request.
  LiveAPI.prototype.transcribeVoice = async function transcribeVoice(session, recording, deadline) {
    var response = await this.request(
      '/widget/v1/sessions/' + encodeURIComponent(session.sessionID) + '/voice',
      {
        method: 'POST',
        headers: {
          // Read off the blob rather than assumed: Safari records mp4 where
          // Chrome records webm, and the provider is given what was recorded.
          'Content-Type': recording.type || 'audio/webm',
          'X-Garuda-Session-Token': session.sessionToken
        },
        body: recording.blob
      },
      VOICE_REQUEST_TIMEOUT_MS,
      deadline
    );
    if (!response.ok) throw await safeErrorFromResponse(response);
    var json = await response.json();
    var data = isRecord(json) && isRecord(json.data) ? json.data : json;
    data = isRecord(data) ? data : {};
    var text = asText(data.text, '', MAX_MESSAGE_LENGTH);
    if (!text) {
      // The server sends 422 no_speech_detected for silence; an empty 200 is
      // the same thing said less clearly, and is answered the same way.
      throw new WidgetError('no_speech_detected', 'Nothing could be heard in that recording.', 422);
    }
    return { text: text, language: asText(data.language, '', 32) };
  };

  // The wa.me link is fetched rather than assembled here, because assembling
  // it would mean the number had to travel in the bootstrap.
  LiveAPI.prototype.startHandoff = async function startHandoff(session) {
    var response = await this.request(
      '/widget/v1/sessions/' + encodeURIComponent(session.sessionID) + '/handoff',
      { method: 'POST', headers: { 'X-Garuda-Session-Token': session.sessionToken } }
    );
    if (!response.ok) throw await safeErrorFromResponse(response);
    var json = await response.json();
    var data = isRecord(json) && isRecord(json.data) ? json.data : json;
    data = isRecord(data) ? data : {};
    var url = safeHttpUrl(data.url);
    if (!url) throw new WidgetError('invalid_response', 'The handoff link could not be opened.', 502);
    return { url: url, label: asText(data.label, 'Talk to a person', 60) };
  };

  // The owner's real free times, read behind the session token. The bootstrap
  // could not carry these even if it wanted to: it is public and cached, and
  // these change minute to minute.
  LiveAPI.prototype.listBookingSlots = async function listBookingSlots(session) {
    var response = await this.request(
      '/widget/v1/sessions/' + encodeURIComponent(session.sessionID) + '/slots',
      { headers: { 'X-Garuda-Session-Token': session.sessionToken } }
    );
    if (!response.ok) throw await safeErrorFromResponse(response);
    return normalizeBookingSlots(await response.json());
  };

  LiveAPI.prototype.createBooking = async function createBooking(session, request) {
    var response = await this.request(
      '/widget/v1/sessions/' + encodeURIComponent(session.sessionID) + '/booking',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Garuda-Session-Token': session.sessionToken
        },
        body: JSON.stringify(bookingRequestBody(request))
      }
    );
    if (!response.ok) throw await safeErrorFromResponse(response);
    var json = await response.json();
    var data = isRecord(json) && isRecord(json.data) ? json.data : json;
    data = isRecord(data) ? data : {};
    var minutes = Number(data.minutes);
    return {
      booked: data.booked !== false,
      minutes: Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0,
      timezone: asText(data.timezone, '', 64)
    };
  };

  // The chosen slot's own start travels back byte for byte. The endpoint checks
  // the calendar again and matches on that exact instant, so a value this widget
  // had reformatted would no longer be the time that was offered.
  function bookingRequestBody(request) {
    var body = { start: request.start };
    var name = asText(request.name, '', MAX_BOOKING_NAME);
    var email = asText(request.email, '', MAX_BOOKING_EMAIL);
    var notes = asText(request.notes, '', MAX_BOOKING_NOTES);
    if (name) body.name = name;
    if (email) body.email = email;
    if (notes) body.notes = notes;
    return body;
  }

  LiveAPI.prototype.resetSession = async function resetSession(session) {
    var response = await this.request(
      '/widget/v1/sessions/' + encodeURIComponent(session.sessionID) + '/reset',
      { method: 'POST', headers: { 'X-Garuda-Session-Token': session.sessionToken } }
    );
    if (!response.ok) throw await safeErrorFromResponse(response);
    return normalizeSessionPayload(await response.json());
  };

  // Anything the visitor's transcript does not already hold. The cursor is a
  // message id, not a timestamp, so two messages written in the same
  // millisecond can neither repeat nor go missing.
  LiveAPI.prototype.pollMessages = async function pollMessages(session, afterID) {
    var query = afterID ? '?after=' + encodeURIComponent(afterID) : '';
    var response = await this.request(
      '/widget/v1/sessions/' + encodeURIComponent(session.sessionID) + '/messages' + query,
      { headers: { 'X-Garuda-Session-Token': session.sessionToken } }
    );
    if (!response.ok) throw await safeErrorFromResponse(response);
    var json = await response.json();
    var data = isRecord(json) && isRecord(json.data) ? json.data : json;
    var messages = isRecord(data) && Array.isArray(data.messages) ? data.messages : [];
    return messages.map(normalizeMessage).filter(Boolean);
  };

  // One batch of the visitor's journey. The endpoint answers 204 and the widget
  // reads nothing back, so the whole exchange stays small on a path that fires
  // every fifteen seconds while somebody is on the customer's website.
  //
  // navigator.sendBeacon is not used, and cannot be. The session token is only
  // accepted in the X-Garuda-Session-Token header -- see authorizeWidgetSession
  // in backend/internal/api/widget.go, which reads that header and nothing else
  // -- and a beacon cannot set a header, so a beacon would be answered 401. The
  // keepalive flag below is what makes this request survive an unloading
  // document, which is the only property of a beacon this needed.
  LiveAPI.prototype.reportJourney = async function reportJourney(session, batch) {
    var response = await this.request(
      '/widget/v1/sessions/' + encodeURIComponent(session.sessionID) + '/activity',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Garuda-Session-Token': session.sessionToken
        },
        body: JSON.stringify(batch),
        keepalive: true
      }
    );
    if (!response.ok) throw await safeErrorFromResponse(response);
    return true;
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

  // The demo has no owner and therefore no number to hand out. Saying so is
  // better than opening WhatsApp on a number somebody made up.
  DemoAPI.prototype.pollMessages = async function pollMessages() {
    return [];
  };

  // The demo runs on Garuda's own marketing page and has no customer to report
  // a journey to. Nothing is collected there at all; this exists so the code
  // path is the same shape in both modes.
  DemoAPI.prototype.reportJourney = async function reportJourney() {
    return true;
  };

  DemoAPI.prototype.startHandoff = async function startHandoff() {
    throw new WidgetError('handoff_unavailable', 'Human handoff is not available in the demo.', 404);
  };

  // The demo has no account to bill a transcription to, and this half is left
  // undefined on purpose rather than defined to refuse: the microphone button
  // is drawn only where the API can actually transcribe, so the demo shows no
  // control that asks for a microphone and then apologises.

  // The demo has no owner and therefore no calendar. Both halves exist so the
  // widget finds the same methods in either mode, and both refuse the way the
  // live endpoints refuse an agent that does not offer appointments.
  DemoAPI.prototype.listBookingSlots = async function listBookingSlots() {
    throw new WidgetError('booking_unavailable', 'Appointments are not available in the demo.', 404);
  };

  DemoAPI.prototype.createBooking = async function createBooking() {
    throw new WidgetError('booking_unavailable', 'Appointments are not available in the demo.', 404);
  };

  DemoAPI.prototype.resetSession = async function resetSession(session) {
    if (this.storage) {
      try {
        this.storage.removeItem(this.historyKey);
      } catch (_error) {
        // Storage is optional; the transcript is cleared either way.
      }
    }
    return Object.assign({}, session, {
      conversation: { id: session.sessionID, resumed: false, messages: [] }
    });
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
    normalizeBooking: normalizeBooking,
    safeImageURL: safeImageURL,
    validOpaqueToken: validOpaqueToken,
    safeHttpUrl: safeHttpUrl,
    normalizeAgentPayload: normalizeAgentPayload,
    normalizeLeadSpec: normalizeLeadSpec,
    normalizeSessionPayload: normalizeSessionPayload,
    createSSEParser: createSSEParser,
    campaignParameters: campaignParameters,
    journeyPath: journeyPath,
    journeySource: journeySource,
    journeyDevice: journeyDevice,
    WidgetError: WidgetError,
    recordingSupport: recordingSupport,
    chooseVoiceMimeType: chooseVoiceMimeType,
    describeMicrophoneFailure: describeMicrophoneFailure,
    voiceFailure: voiceFailure,
    releaseMicrophoneStream: releaseMicrophoneStream,
    formatElapsed: formatElapsed,
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
      // An EXPLICIT no, kept separate from the affirmative above. Absence is not
      // a refusal -- most customers never set the attribute at all -- but a
      // customer who wires their cookie banner to it and gets a decline has said
      // something specific, and journey tracking has to hear it. It ignored this
      // attribute entirely, which made the attribute a lie about what it did.
      analyticsRefused: script.getAttribute('data-analytics-consent') === 'false',
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
    // The appointment picker owns one card in the panel at a time. bookingPicker
    // holds that card's parts while it is open and is null the moment it closes,
    // which is also how a reply that lands after a dismissal knows to stop.
    this.bookingVisible = false;
    this.bookingPicker = null;
    this.autoOpened = false;
    this.lastRetry = null;
    this.nodes = {};
    this.handoffOffered = false;
    this.pollTimer = null;
    this.polling = false;
    // Everything about the microphone. recorder and stream are non-null only
    // while it is actually live, which is what makes "is the microphone open"
    // one question with one answer rather than a guess from the UI.
    //
    // generation is how a wait is abandoned. The visitor can cancel, or close
    // the panel, while the browser's permission prompt is still open or an
    // upload is still in flight; bumping it means a stream granted afterwards is
    // handed straight back and a transcript that lands afterwards is dropped.
    this.voice = {
      available: true,
      state: 'idle',
      note: '',
      tone: '',
      generation: 0,
      recorder: null,
      stream: null,
      request: null,
      chunks: [],
      bytes: 0,
      startedAt: 0,
      seconds: 0,
      warned: false,
      leading: '',
      ticker: null
    };
    // Tracking is off until mount starts it, and null again the moment anything
    // about it fails. Nothing else in the widget depends on it existing.
    this.journey = null;
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
      // Tracking begins with the page, not with the panel: the pages somebody
      // read before they decided to talk are the ones that explain the lead.
      // Nothing is sent until there is a session to attach it to.
      self.startJourney();
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
    var restart = element('button', 'gw-icon-button');
    restart.type = 'button';
    restart.hidden = true;
    restart.setAttribute('aria-label', 'Start a new conversation');
    restart.setAttribute('title', 'Start a new conversation');
    restart.appendChild(svgIcon('M4 12a8 8 0 1 1 2.3 5.6M4 12V7m0 5h5'));
    var close = element('button', 'gw-icon-button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Minimize chat');
    close.appendChild(svgIcon('M6 9l6 6 6-6'));
    var headerActions = element('div', 'gw-header-actions');
    headerActions.appendChild(mutedBadge);
    headerActions.appendChild(restart);
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
    var bookingRegion = element('div', 'gw-booking-region');
    body.appendChild(messages);
    body.appendChild(suggestions);
    body.appendChild(leadRegion);
    body.appendChild(bookingRegion);

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
    // The handoff sits beside "contact the team" rather than in the header,
    // because it is an action about this conversation and belongs where the
    // visitor is already looking when the assistant runs out of answers.
    var handoffButton = element('button', 'gw-handoff-button');
    handoffButton.type = 'button';
    handoffButton.hidden = true;
    var handoffIcon = svgIcon("M17.5 14.4c-.3-.2-1.8-.9-2-1s-.5-.2-.7.1-.8 1-1 1.2-.4.2-.7 0a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.6-2c-.2-.4 0-.6.1-.7l.5-.6.3-.5c.1-.2 0-.4 0-.6l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.4-1.2 1.2-1.2 2.9s1.2 3.3 1.4 3.5a13 13 0 0 0 5 4.4c2.2.9 2.2.6 2.6.5.4 0 1.4-.5 1.6-1.1s.2-1.1.2-1.2l-.6-.3ZM12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3Z");
    var handoffLabel = element('span', '', 'Talk to a person');
    handoffButton.appendChild(handoffIcon);
    handoffButton.appendChild(handoffLabel);
    var handoffHint = element('p', 'gw-handoff-hint');
    handoffHint.hidden = true;
    // Booking sits with the other two for the same reason the handoff does: it
    // is an action about this conversation, and this is where the visitor is
    // already looking when they decide they want to speak to somebody.
    var bookingButton = element('button', 'gw-booking-button');
    bookingButton.type = 'button';
    bookingButton.hidden = true;
    bookingButton.appendChild(svgIcon('M8 3.5v3m8-3v3M4.5 10h15M6.5 6h11A2 2 0 0 1 19.5 8v9.5a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z'));
    var bookingLabel = element('span', '', 'Book an appointment');
    bookingButton.appendChild(bookingLabel);
    contactRow.appendChild(contactButton);
    contactRow.appendChild(handoffButton);
    contactRow.appendChild(bookingButton);
    contactRow.appendChild(handoffHint);

    // The microphone is live for as long as this row is on screen, and the row
    // is on screen for exactly as long as it is live. A control that looks idle
    // while a microphone is open is a privacy problem rather than a missing
    // polish, so the state, the elapsed clock and the way out all sit together
    // directly above the composer where the visitor is already looking.
    var voiceRow = element('div', 'gw-voice');
    voiceRow.hidden = true;
    var voiceDot = element('span', 'gw-voice-dot');
    voiceDot.setAttribute('aria-hidden', 'true');
    var voiceStatus = element('span', 'gw-voice-status');
    // A live region: a visitor who cannot see the red dot is still told that
    // the microphone opened, and when it closed again.
    voiceStatus.setAttribute('role', 'status');
    var voiceTime = element('span', 'gw-voice-time', '0:00');
    // The clock changes every second and is deliberately not announced. The
    // line beside it says the same thing in words, once per change of state.
    voiceTime.setAttribute('aria-hidden', 'true');
    voiceTime.hidden = true;
    var voiceAction = element('button', 'gw-voice-action', 'Cancel');
    voiceAction.type = 'button';
    voiceRow.appendChild(voiceDot);
    voiceRow.appendChild(voiceStatus);
    voiceRow.appendChild(voiceTime);
    voiceRow.appendChild(voiceAction);

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
    // Hidden until the browser has proved it can record. Feature detection runs
    // in updateVoiceVisibility rather than here, because an insecure origin and
    // an old browser are different answers and both change nothing until the
    // composer exists to hide the button in.
    var mic = element('button', 'gw-mic');
    mic.type = 'button';
    mic.hidden = true;
    mic.setAttribute('aria-label', 'Record a voice message');
    mic.setAttribute('aria-pressed', 'false');
    var micIcon = svgIcon('M12 4.4a2.7 2.7 0 0 1 2.7 2.7v4.7a2.7 2.7 0 0 1-5.4 0V7.1A2.7 2.7 0 0 1 12 4.4Zm6 6.9a6 6 0 0 1-12 0m6 6v2.3m-3.2 0h6.4');
    var micStopIcon = svgIcon('M8.6 8.6h6.8v6.8H8.6z');
    micStopIcon.hidden = true;
    mic.appendChild(micIcon);
    mic.appendChild(micStopIcon);
    var send = element('button', 'gw-send');
    send.type = 'submit';
    send.disabled = true;
    send.setAttribute('aria-label', 'Send message');
    send.appendChild(svgIcon('M4 12 20 4l-5.5 16-3.2-6.8L4 12Zm7.3 1.2L20 4'));
    composer.appendChild(inputWrap);
    composer.appendChild(mic);
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
    panel.appendChild(voiceRow);
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
      bookingRegion: bookingRegion,
      typing: typing,
      contactButton: contactButton,
      restart: restart,
      handoffButton: handoffButton,
      handoffLabel: handoffLabel,
      handoffHint: handoffHint,
      bookingButton: bookingButton,
      bookingLabel: bookingLabel,
      composer: composer,
      textarea: textarea,
      counter: counter,
      send: send,
      mic: mic,
      micIcon: micIcon,
      micStopIcon: micStopIcon,
      voiceRow: voiceRow,
      voiceDot: voiceDot,
      voiceStatus: voiceStatus,
      voiceTime: voiceTime,
      voiceAction: voiceAction
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
    mic.addEventListener('click', function () { self.toggleVoiceRecording(); });
    voiceAction.addEventListener('click', function () { self.cancelVoiceRecording(); });
    contactButton.addEventListener('click', function () {
      self.showLeadForm(normalizeLeadSpec({}, self.agent));
    });
    restart.addEventListener('click', function () { self.restartConversation(); });
    handoffButton.addEventListener('click', function () { self.requestHandoff(); });
    bookingButton.addEventListener('click', function () {
      var booking = isRecord(self.agent.booking) ? self.agent.booking : null;
      if (booking && booking.completesElsewhere && booking.schedulingURL) {
        self.openExternalBooking();
        return;
      }
      self.showBookingPicker();
    });
    panel.addEventListener('keydown', function (event) { self.handlePanelKeys(event); });
    global.addEventListener('online', function () { self.updateConnectionState(); });
    // A hidden tab must not poll. Browsers throttle background timers rather
    // than stopping them, so without this a visitor with twenty tabs open keeps
    // twenty conversations alive against the API for no benefit to anyone.
    if (global.document.addEventListener) {
      global.document.addEventListener('visibilitychange', function () {
        if (global.document.hidden) self.stopPolling();
        else if (self.open) self.startPolling();
      });
    }
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
    // The widget now takes voice IN -- the microphone in the composer -- but it
    // still has no audio of its own to play, so the three switches that describe
    // when audio should stop are published on the host element for the page to
    // read rather than acted out here.
    //
    // transcription is published the same way and is deliberately NOT the
    // microphone's switch. Nothing on the server reads it, the voice endpoint
    // does not consult it, and it resolves to false for every agent that
    // predates the settings screen -- so gating the button on it would mean no
    // visitor anywhere could speak. What the button waits for is a browser that
    // can record and a server that will transcribe.
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
      this.startPolling();
      var focusTarget = this.requiresConsent
        ? this.nodes.consentRegion.querySelector('button')
        : this.nodes.textarea;
      global.setTimeout(function () {
        if (focusTarget) focusTarget.focus({ preventScroll: true });
      }, 80);
    } else {
      // A panel the visitor has just closed must not leave a microphone open
      // behind it. The recording is discarded rather than transcribed: they
      // closed the chat, so nothing they said was meant to be sent anywhere.
      this.cancelVoiceRecording();
      this.stopPolling();
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
  // ---- replies typed by a person in the owner's inbox ----
  //
  // Polling runs only while the panel is open. A widget sitting closed on a page
  // nobody is looking at must cost nothing, and a reply that lands while the
  // panel is shut is picked up the moment the visitor opens it again.

  GarudaWidget.prototype.startPolling = function startPolling() {
    var self = this;
    if (this.pollTimer || !global.setInterval) return;
    this.pollTimer = global.setInterval(function () {
      self.pollForTeamReplies();
    }, TEAM_REPLY_POLL_MS);
  };

  GarudaWidget.prototype.stopPolling = function stopPolling() {
    if (!this.pollTimer) return;
    global.clearInterval(this.pollTimer);
    this.pollTimer = null;
  };

  GarudaWidget.prototype.pollForTeamReplies = async function pollForTeamReplies() {
    // A slow response must not stack a second request on top of the first, and
    // a reply arriving mid-generation must not interleave with the stream the
    // model is still writing.
    if (this.polling || this.sending || !this.session) return;
    this.polling = true;
    try {
      var last = this.messages[this.messages.length - 1];
      var self = this;
      // Through withFreshSession, so a poll that outlives the fifteen-minute
      // token renews it instead of failing quietly for the rest of the visit.
      // Without this an operator reply typed sixteen minutes in was never
      // delivered, and nothing anywhere said why.
      var fresh = await this.withFreshSession(function () {
        return self.api.pollMessages(self.session, last ? last.id : '');
      });
      var known = {};
      this.messages.forEach(function (message) { known[message.id] = true; });
      for (var index = 0; index < fresh.length; index += 1) {
        // Dedupe by id rather than trusting the cursor alone: a widget that
        // restarted, or one whose last message the server never stored, would
        // otherwise show the visitor their own conversation twice.
        if (known[fresh[index].id]) continue;
        this.appendMessage(fresh[index]);
      }
    } catch (_error) {
      // A failed poll is not worth telling the visitor about. The next one is
      // twelve seconds away, and the composer still works either way.
    } finally {
      this.polling = false;
    }
  };

  // ---- the visitor's journey ----
  //
  // Where they came from, which pages they read, and how long they actually
  // spent. All of it lives in one object hanging off the widget, so a failure
  // anywhere in here is answered by dropping that object: a widget with no
  // journey state reports nothing, and the customer's website never learns that
  // anything went wrong.
  //
  // CONSENT. There is exactly one consent rule in this file and the journey
  // follows it rather than inventing a second one. ensureSession refuses to open
  // a session while requiresConsent is true, so a visitor still looking at the
  // consent card -- or one who never answers it -- has no session, and
  // journeyAllowed below reports nothing without one. The journey is stored on
  // the session record, so it lives exactly as long as the conversation the
  // visitor already agreed to have.

  GarudaWidget.prototype.startJourney = function startJourney() {
    var self = this;
    // The demo has nobody to report to, and a second tracker on the same page
    // would double every number on it.
    if (this.journey || this.config.mode === 'demo') return;
    // A customer whose visitor declined analytics gets no journey. The
    // conversation still works: nothing here is needed to answer a question.
    if (this.config.analyticsRefused) return;
    try {
      var doc = global.document;
      var state = {
        pages: [],
        source: journeySource(),
        device: journeyDevice(),
        sourceSent: false,
        sessionID: '',
        visible: !(doc && doc.hidden === true),
        focused: true,
        engagedSince: 0,
        timer: null,
        sending: false,
        failures: 0,
        listeners: [],
        patches: []
      };
      if (doc && typeof doc.hasFocus === 'function') {
        state.focused = doc.hasFocus() === true;
      }
      this.journey = state;
      this.journeyOpenPage(
        journeyPath(global.location || {}),
        asText(doc && doc.title, '', MAX_JOURNEY_TITLE)
      );
      this.journeyAccrue();
      this.watchJourney();
      if (global.setInterval) {
        state.timer = global.setInterval(function () { self.journeyTick(); }, JOURNEY_FLUSH_MS);
      }
    } catch (_error) {
      // Analytics is never worth a broken page. Tracking simply does not run.
      this.journey = null;
    }
  };

  GarudaWidget.prototype.stopJourney = function stopJourney() {
    var state = this.journey;
    if (!state) return;
    this.journey = null;
    try {
      if (state.timer && global.clearInterval) global.clearInterval(state.timer);
      state.timer = null;
      state.listeners.forEach(function (entry) {
        if (entry.target && typeof entry.target.removeEventListener === 'function') {
          entry.target.removeEventListener(entry.type, entry.handler);
        }
      });
      state.patches.forEach(function (patch) {
        // Only what is still ours is unwrapped. A host page that wrapped history
        // on top of this keeps its wrapper instead of having it silently
        // removed, which would break its routing rather than ours.
        if (global.history && global.history[patch.name] === patch.patched) {
          global.history[patch.name] = patch.original;
        }
      });
    } catch (_error) {
      // Teardown is best effort; tracking is already off either way.
    }
  };

  // Engaged time, not wall clock time. A tab is counted only while the document
  // is visible AND the window has focus, which is why a tab left open overnight
  // behind another window adds nothing at all.
  GarudaWidget.prototype.journeyEngaged = function journeyEngaged() {
    var state = this.journey;
    return Boolean(state && state.visible && state.focused);
  };

  // Closes off the period that just ended and opens the next one. Callers change
  // visible or focused FIRST and then call this, because the period being closed
  // belongs to the state the tab was in until this moment.
  GarudaWidget.prototype.journeyAccrue = function journeyAccrue() {
    var state = this.journey;
    if (!state) return;
    var current = state.pages[state.pages.length - 1];
    var now = Date.now();
    if (state.engagedSince > 0 && current) {
      var elapsed = now - state.engagedSince;
      // A clock that moved backwards adds nothing, and a step far larger than
      // the timer that should have produced it is a machine that was asleep.
      if (elapsed > 0) current.millis += Math.min(elapsed, MAX_ENGAGED_STEP_MS);
    }
    state.engagedSince = this.journeyEngaged() ? now : 0;
  };

  GarudaWidget.prototype.journeyOpenPage = function journeyOpenPage(path, title) {
    var state = this.journey;
    if (!state) return;
    state.pages.push({
      // A stable id for THIS visit to this page. The server merges on it, so two
      // tabs reporting the same path do not merge into one another and a reload
      // -- which restarts the timer at zero -- is recognised as a new visit
      // rather than a report to be discarded for going backwards.
      id: randomID(),
      path: path,
      title: asText(title, '', MAX_JOURNEY_TITLE),
      millis: 0,
      reportedSeconds: -1,
      reportedTitle: null
    });
    // The oldest entries have already been reported, and the server keeps its
    // own fifty. Dropping the front is what stops this array from growing for
    // the rest of a very long visit.
    while (state.pages.length > MAX_JOURNEY_PAGES) state.pages.shift();
  };

  // A router changes the URL first and sets the document title afterwards, so
  // the title of the page being read is taken again on every tick rather than
  // once at navigation. The server only fills a title it does not already have,
  // so a page first reported without one still gets it on the next batch.
  GarudaWidget.prototype.journeyRefreshTitle = function journeyRefreshTitle() {
    var state = this.journey;
    var current = state && state.pages[state.pages.length - 1];
    if (!current) return;
    var title = asText(global.document && global.document.title, '', MAX_JOURNEY_TITLE);
    if (title) current.title = title;
  };

  GarudaWidget.prototype.journeyNavigated = function journeyNavigated() {
    var state = this.journey;
    if (!state) return;
    var path = journeyPath(global.location || {});
    var current = state.pages[state.pages.length - 1];
    // A router that rewrites the query string on every filter change is still on
    // the same page. The server strips query strings too, so an entry for it
    // would merge straight back into the one already there and say nothing.
    if (current && current.path === path) return;
    this.journeyAccrue();
    this.journeyRefreshTitle();
    // The new page starts without a title on purpose: at this moment the
    // document still carries the title of the page just left.
    this.journeyOpenPage(path, '');
  };

  GarudaWidget.prototype.watchJourney = function watchJourney() {
    var self = this;
    var state = this.journey;
    var doc = global.document;
    // Every listener is passive and every handler is wrapped. This code runs
    // inside somebody else's page, where an exception thrown from an event
    // handler is their bug report, and a listener that could block scrolling
    // would be their slow page.
    function listen(target, type, handler) {
      if (!target || typeof target.addEventListener !== 'function') return;
      var wrapped = function (event) {
        try {
          handler(event);
        } catch (_error) {
          // A tracking failure is never visible to the visitor.
        }
      };
      target.addEventListener(type, wrapped, { passive: true });
      state.listeners.push({ target: target, type: type, handler: wrapped });
    }

    listen(doc, 'visibilitychange', function () {
      var visible = doc.hidden !== true;
      if (visible === state.visible) return;
      state.visible = visible;
      self.journeyAccrue();
      // Hidden is the last reliable moment on mobile, where a tab is very often
      // never unloaded in a way the page gets to see.
      if (!visible) self.flushJourney();
    });
    listen(global, 'blur', function () {
      if (!state.focused) return;
      state.focused = false;
      self.journeyAccrue();
    });
    listen(global, 'focus', function () {
      if (state.focused) return;
      state.focused = true;
      self.journeyAccrue();
    });
    listen(global, 'pagehide', function (event) {
      self.journeyAccrue();
      self.flushJourney();
      // A persisted pagehide is the back/forward cache, and the page can come
      // back. Anything else is the document going away for good.
      if (!event || event.persisted !== true) self.stopJourney();
    });
    listen(global, 'popstate', function () { self.journeyNavigated(); });
    this.patchJourneyHistory();
  };

  // Most customer websites are single page applications, where a navigation is a
  // history call and no document ever loads. The two methods are wrapped rather
  // than replaced: the original is called first with the arguments it was given,
  // its return value is handed back untouched, and everything this widget does
  // afterwards sits in a try/catch, so the host page's own routing behaves
  // exactly as it did before the widget was on the page.
  GarudaWidget.prototype.patchJourneyHistory = function patchJourneyHistory() {
    var self = this;
    var state = this.journey;
    var history = global.history;
    if (!history) return;
    ['pushState', 'replaceState'].forEach(function (name) {
      var original = history[name];
      if (typeof original !== 'function') return;
      var patched = function () {
        var result = original.apply(this, arguments);
        try {
          self.journeyNavigated();
        } catch (_error) {
          // The host's navigation has already happened and is unaffected.
        }
        return result;
      };
      history[name] = patched;
      state.patches.push({ name: name, original: original, patched: patched });
    });
  };

  GarudaWidget.prototype.journeyTick = function journeyTick() {
    try {
      this.journeyAccrue();
      this.journeyRefreshTitle();
      this.flushJourney();
    } catch (_error) {
      // A tracking failure must never reach the customer's page.
    }
  };

  GarudaWidget.prototype.journeyAllowed = function journeyAllowed() {
    return Boolean(
      this.journey &&
      !this.requiresConsent &&
      this.session &&
      this.session.sessionID
    );
  };

  // One batch, or null when there is nothing to say. Returning null is the whole
  // of the cost discipline: a visitor sitting still on one page, and a tab left
  // open overnight, both produce no request at all.
  GarudaWidget.prototype.journeyBatch = function journeyBatch() {
    var state = this.journey;
    // A session the widget had to open again -- a restart, or a refresh after an
    // expiry -- starts with an empty journey on the server, so the whole visit is
    // offered to it rather than half of it going missing.
    if (state.sessionID !== this.session.sessionID) {
      state.sessionID = this.session.sessionID;
      state.sourceSent = false;
      state.pages.forEach(function (page) {
        page.reportedSeconds = -1;
        page.reportedTitle = null;
      });
    }
    var pages = [];
    var pending = [];
    for (var index = 0; index < state.pages.length && pages.length < MAX_JOURNEY_BATCH; index += 1) {
      var page = state.pages[index];
      var seconds = Math.min(Math.floor(page.millis / 1000), MAX_PAGE_SECONDS);
      if (page.reportedSeconds === seconds && page.reportedTitle === page.title) continue;
      var entry = { visit: page.id, path: page.path };
      if (page.title) entry.title = page.title;
      if (seconds > 0) entry.seconds = seconds;
      pages.push(entry);
      pending.push({ page: page, seconds: seconds, title: page.title });
    }
    var body = {};
    // Source and device travel once, on the first batch this session accepts.
    // Later batches leave them out so an internal navigation can never overwrite
    // the referrer that brought the visitor to the site.
    if (!state.sourceSent) {
      body.source = state.source;
      body.device = state.device;
    }
    if (pages.length) body.pages = pages;
    if (!body.source && !body.pages) return null;
    return { body: body, pending: pending };
  };

  GarudaWidget.prototype.flushJourney = function flushJourney() {
    var self = this;
    var state = this.journey;
    // One batch at a time. Two in flight could append the same page twice on the
    // server, because a page only merges in place when it is the last one stored.
    if (!state || state.sending || !this.journeyAllowed()) return;
    var session = this.session;
    var batch = null;
    var request = null;
    try {
      batch = this.journeyBatch();
      if (!batch) return;
      state.sending = true;
      // Called here rather than inside a promise so the keepalive fetch is
      // already issued by the time this returns: on pagehide there may be no
      // later turn of the event loop to issue it in.
      request = this.api.reportJourney(session, batch.body);
    } catch (_error) {
      // Building or issuing a batch is not allowed to reach the host page.
      state.sending = false;
      return;
    }
    Promise.resolve(request).then(function () {
      state.failures = 0;
      state.sourceSent = true;
      batch.pending.forEach(function (item) {
        item.page.reportedSeconds = item.seconds;
        item.page.reportedTitle = item.title;
      });
    }, function (error) {
      // A failed report is silent, and a visitor never sees an error because
      // analytics did not land. Nothing was marked as delivered, so the next
      // batch carries it again -- but only so many times.
      //
      // An EXPIRED SESSION is not that kind of failure. The token lives fifteen
      // minutes and a visit routinely outlasts it, so counting 401s towards the
      // give-up threshold meant journey tracking died a quarter of an hour into
      // every long visit -- exactly the visits worth measuring. Renew instead.
      var expired = error instanceof WidgetError &&
        (error.status === 401 || error.code === 'session_expired' || error.code === 'invalid_session');
      if (expired) {
        self.ensureSession(true).catch(function () {
          // If the session cannot be renewed the next batch fails again and the
          // ordinary failure count is what eventually stops it.
        });
        return;
      }
      state.failures += 1;
      if (state.failures >= MAX_JOURNEY_FAILURES) self.stopJourney();
    }).then(function () {
      state.sending = false;
    });
  };

  GarudaWidget.prototype.handlePanelKeys = function handlePanelKeys(event) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    // Escape dismisses the appointment times first. They are what the visitor
    // opened last, and closing the whole panel instead would take the
    // conversation behind them away as well.
    if (this.bookingVisible) {
      this.closeBookingPicker(true);
      return;
    }
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
      // The visit so far belongs to this session, so it is offered the moment
      // there is one to offer it to.
      self.flushJourney();
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
    // A real anchor, so a visitor whose browser refused the automatic open still
    // has one tap to WhatsApp. href is validated the same way every other URL
    // reaching this file is.
    if (options.action && safeHttpUrl(options.action.url)) {
      var action = element('a', 'gw-bubble-action', options.action.label);
      // setAttribute rather than the properties: they are equivalent in a
      // browser, and only the attribute is observable to anything inspecting
      // the shadow tree.
      action.setAttribute('href', safeHttpUrl(options.action.url));
      action.setAttribute('target', '_blank');
      action.setAttribute('rel', 'noopener noreferrer');
      bubble.appendChild(action);
    }
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
    // A message cannot be sent out from under a live microphone: the visitor is
    // still speaking, and the words they are speaking are meant for this box.
    if (!content || this.sending || this.voiceBusy() || content.length > MAX_MESSAGE_LENGTH) return;
    this.clearVoiceNote();
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
    this.maybeOfferHandoff(content);
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
    this.nodes.send.disabled = active || this.voiceBusy() || !this.session || !this.nodes.textarea.value.trim();
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
    this.nodes.send.disabled = this.sending || this.voiceBusy() || !this.session || !textarea.value.trim();
  };

  // ---- speaking instead of typing ----
  //
  // The visitor presses record, speaks, presses stop, reads what was heard, and
  // presses send themselves. The transcript is NEVER sent on their behalf.
  // Speech recognition is wrong sometimes, and a misheard sentence delivered to
  // somebody's business is worse than an extra tap -- "cancel my order" is one
  // vowel away from several other things. The endpoint is built the same way:
  // it returns text and has no means of posting a message.
  //
  // The microphone is asked for when the button is pressed and at no other
  // moment, and every path out of recording -- stop, cancel, an error, a closed
  // panel, a failed upload -- passes through releaseVoice, because a tab still
  // showing a live microphone after the visitor has stopped is a breach of
  // trust rather than a loose end.

  GarudaWidget.prototype.voiceBusy = function voiceBusy() {
    return Boolean(this.voice && this.voice.state !== 'idle');
  };

  GarudaWidget.prototype.voiceOffered = function voiceOffered() {
    return Boolean(
      this.voice &&
      this.voice.available &&
      this.api &&
      typeof this.api.transcribeVoice === 'function' &&
      recordingSupport(recordingEnvironment()) === 'supported'
    );
  };

  GarudaWidget.prototype.updateVoiceVisibility = function updateVoiceVisibility() {
    var nodes = this.nodes;
    if (!nodes.mic) return;
    var offered = this.voiceOffered();
    var state = this.voice.state;
    nodes.mic.hidden = !offered;
    // Published on the host element, the way the audio toggles are, so a
    // customer whose staging site is on plain http can read why their widget
    // shows no microphone instead of filing it as a missing feature.
    var reason = 'ready';
    if (!offered) {
      reason = this.voice.available && typeof this.api.transcribeVoice === 'function'
        ? recordingSupport(recordingEnvironment())
        : 'unavailable';
    }
    nodes.host.setAttribute('data-voice', reason);
    if (!offered) return;
    var recording = state === 'recording';
    // Live only in the two states the visitor can act on. While the browser is
    // asking for permission, or the words are being transcribed, a second press
    // would start a recording on top of one already being dealt with.
    nodes.mic.disabled = this.sending || !this.session || (state !== 'idle' && state !== 'recording');
    nodes.mic.setAttribute('aria-label', recording ? 'Stop recording' : 'Record a voice message');
    nodes.mic.setAttribute('aria-pressed', String(recording));
    nodes.mic.setAttribute('data-state', state);
    nodes.micIcon.hidden = recording;
    nodes.micStopIcon.hidden = !recording;
  };

  GarudaWidget.prototype.renderVoice = function renderVoice() {
    var nodes = this.nodes;
    var voice = this.voice;
    if (!nodes.voiceRow) return;
    var idle = voice.state === 'idle';
    nodes.voiceRow.hidden = idle && !voice.note;
    nodes.voiceRow.setAttribute('data-phase', voice.state);
    nodes.voiceRow.setAttribute('data-state', voice.tone);
    nodes.voiceStatus.textContent = voice.note;
    nodes.voiceDot.hidden = idle;
    nodes.voiceTime.hidden = voice.state !== 'recording' && voice.state !== 'transcribing';
    nodes.voiceTime.textContent = formatElapsed(voice.seconds);
    // The same button throughout: while anything is happening it abandons it,
    // and once nothing is it clears the sentence left behind.
    nodes.voiceAction.textContent = idle ? 'Dismiss' : 'Cancel';
    this.updateVoiceVisibility();
  };

  GarudaWidget.prototype.setVoice = function setVoice(state, note, tone) {
    this.voice.state = state;
    this.voice.note = note || '';
    this.voice.tone = tone || '';
    this.renderVoice();
    // The send button is disabled while the microphone is busy and comes back
    // afterwards, and only resizeInput knows whether there is anything to send.
    if (this.nodes.textarea) this.resizeInput();
  };

  GarudaWidget.prototype.clearVoiceNote = function clearVoiceNote() {
    if (!this.voice || this.voice.state !== 'idle' || !this.voice.note) return;
    this.setVoice('idle', '', '');
  };

  GarudaWidget.prototype.stopVoiceTicker = function stopVoiceTicker() {
    if (!this.voice.ticker) return;
    if (global.clearInterval) global.clearInterval(this.voice.ticker);
    this.voice.ticker = null;
  };

  // The hardware goes back here and nowhere else. It is deliberately separate
  // from anything about what the screen says, so that every failure path can
  // release the microphone without first deciding what to tell the visitor.
  GarudaWidget.prototype.releaseVoice = function releaseVoice() {
    var voice = this.voice;
    this.stopVoiceTicker();
    var recorder = voice.recorder;
    voice.recorder = null;
    if (recorder) {
      // The handlers go too. A recorder that delivers one last chunk after this
      // has nothing left to append to, and one that reports an error after the
      // words have already been transcribed would replace them with a warning
      // about a recording that is over.
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    releaseMicrophoneStream(voice.stream);
    voice.stream = null;
  };

  GarudaWidget.prototype.toggleVoiceRecording = function toggleVoiceRecording() {
    if (!this.voice) return undefined;
    if (this.voice.state === 'recording') return this.stopVoiceRecording('');
    if (this.voice.state === 'idle') return this.startVoiceRecording();
    return undefined;
  };

  GarudaWidget.prototype.startVoiceRecording = async function startVoiceRecording() {
    var self = this;
    var voice = this.voice;
    if (voice.state !== 'idle' || !this.voiceOffered()) return;
    voice.generation += 1;
    var generation = voice.generation;
    this.setVoice('starting', 'Waiting for your browser to allow the microphone…', '');

    var known = await readMicrophonePermission();
    if (known === 'denied') {
      // getUserMedia here would reject without ever showing a prompt, so the
      // visitor is told how to unblock it rather than waiting for a prompt that
      // is never coming.
      if (voice.generation !== generation) return;
      this.voiceFailed(describeMicrophoneFailure({ name: 'NotAllowedError' }, 'denied'));
      return;
    }
    if (voice.generation !== generation) return;

    var stream = null;
    try {
      stream = await global.navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (error) {
      var permission = await readMicrophonePermission();
      if (voice.generation !== generation) return;
      this.voiceFailed(describeMicrophoneFailure(error, permission));
      return;
    }
    // Cancelled, or the panel closed, while the permission prompt was open. The
    // stream that has just been granted is handed straight back.
    if (voice.generation !== generation) {
      releaseMicrophoneStream(stream);
      return;
    }

    var recorder = null;
    try {
      recorder = createVoiceRecorder(stream);
    } catch (error) {
      releaseMicrophoneStream(stream);
      this.voiceFailed(describeMicrophoneFailure(error));
      return;
    }
    voice.stream = stream;
    voice.recorder = recorder;
    voice.chunks = [];
    voice.bytes = 0;
    voice.seconds = 0;
    voice.warned = false;
    voice.leading = '';
    voice.startedAt = Date.now();
    recorder.ondataavailable = function (event) {
      var data = event ? event.data : null;
      if (!data || !data.size) return;
      voice.chunks.push(data);
      voice.bytes += data.size;
      // The server takes a megabyte. Stopping here is the difference between
      // the visitor hearing about the limit now and hearing about it after an
      // upload they waited through.
      if (voice.bytes >= MAX_VOICE_BYTES) {
        self.stopVoiceRecording('That is as much as one voice message can hold.');
      }
    };
    recorder.onstop = function () { self.voiceRecordingStopped(generation); };
    // A microphone unplugged mid-sentence fires this and may never fire onstop,
    // which would otherwise leave the row saying "recording" over a device that
    // is no longer there.
    recorder.onerror = function () {
      self.voiceFailed('The recording stopped unexpectedly. Try again, or type your message.');
    };
    try {
      // A timeslice, so how much has been recorded is known while it is still
      // being recorded rather than only once it is too late to stop short.
      recorder.start(1000);
    } catch (error) {
      this.releaseVoice();
      this.voiceFailed(describeMicrophoneFailure(error));
      return;
    }
    this.setVoice('recording', 'Recording — press the microphone again to stop.', '');
    if (global.setInterval) {
      voice.ticker = global.setInterval(function () { self.voiceTick(); }, VOICE_TICK_MS);
    }
  };

  GarudaWidget.prototype.voiceTick = function voiceTick() {
    var voice = this.voice;
    if (voice.state !== 'recording' && voice.state !== 'transcribing') return;
    // Read off the clock rather than counted, because a throttled background tab
    // fires this timer late and a counted second would under-report a length the
    // server is going to measure honestly.
    var elapsed = Math.floor((Date.now() - voice.startedAt) / 1000);
    if (elapsed === voice.seconds) return;
    voice.seconds = elapsed;
    if (voice.state === 'transcribing') {
      this.renderVoice();
      return;
    }
    var remaining = MAX_VOICE_SECONDS - elapsed;
    if (remaining <= 0) {
      this.stopVoiceRecording('That is as long as one voice message can be.');
      return;
    }
    // Announced once, on the way into the last stretch. Announcing every second
    // would read the countdown aloud over the visitor still speaking.
    if (remaining <= VOICE_WARN_SECONDS && !voice.warned) {
      voice.warned = true;
      voice.note = remaining + (remaining === 1 ? ' second left.' : ' seconds left.');
      voice.tone = 'warn';
    }
    this.renderVoice();
  };

  // Stopping is asked of the recorder rather than done to the stream: the tracks
  // stay live until onstop has handed over the last chunk, because stopping them
  // first truncates the tail of the recording on some browsers. releaseVoice
  // runs the moment onstop fires, which is a few milliseconds later.
  GarudaWidget.prototype.stopVoiceRecording = function stopVoiceRecording(leading) {
    var voice = this.voice;
    if (voice.state !== 'recording') return;
    voice.leading = leading || '';
    this.stopVoiceTicker();
    this.setVoice(
      'stopping',
      leading ? leading + ' Finishing the recording…' : 'Finishing the recording…',
      leading ? 'warn' : ''
    );
    try {
      if (voice.recorder && voice.recorder.state !== 'inactive') {
        voice.recorder.stop();
        return;
      }
    } catch (_error) {
      // A recorder that will not stop cleanly still has to give the microphone
      // back, which is what falling through to the line below does.
    }
    this.voiceRecordingStopped(voice.generation);
  };

  GarudaWidget.prototype.voiceRecordingStopped = function voiceRecordingStopped(generation) {
    var voice = this.voice;
    // Cancelled while the recorder was stopping. Nothing is uploaded and
    // nothing is said, because the visitor already said it.
    if (voice.generation !== generation) return;
    var chunks = voice.chunks;
    var recorder = voice.recorder;
    var recorded = voice.bytes;
    var seconds = Math.floor((Date.now() - voice.startedAt) / 1000);
    // Read back off the recorder rather than assumed: the browser may have
    // ignored the type it was asked for.
    var type = (recorder && recorder.mimeType) || (chunks[0] && chunks[0].type) || 'audio/webm';
    voice.chunks = [];
    voice.bytes = 0;
    // The hardware goes back before a byte is uploaded. The recording is already
    // in hand, so there is no reason to hold a microphone open for the seconds a
    // transcription takes.
    this.releaseVoice();
    if (recorded < MIN_VOICE_BYTES) {
      // minVoiceNoteBytes answers this with a 422, and no round trip is needed
      // to know that a tap on the button is not a sentence.
      this.voiceFailed('That was too short to hear. Press the microphone and speak for a few seconds.');
      return;
    }
    var recording = null;
    try {
      recording = { blob: new global.Blob(chunks, { type: type }), type: type, seconds: seconds };
    } catch (_error) {
      this.voiceFailed('That recording could not be prepared. Try again, or type your message.');
      return;
    }
    this.transcribeVoiceNote(recording, voice.leading);
  };

  GarudaWidget.prototype.transcribeVoiceNote = async function transcribeVoiceNote(recording, leading) {
    var self = this;
    var voice = this.voice;
    voice.generation += 1;
    var generation = voice.generation;
    var spoken = 'Turning ' + formatElapsed(recording.seconds) + ' of audio into text…';
    // The clock restarts and keeps running, because this is a call to a speech
    // provider that takes seconds: a number that grows is the difference between
    // waiting and wondering whether anything is happening at all.
    voice.startedAt = Date.now();
    voice.seconds = 0;
    this.setVoice('transcribing', leading ? leading + ' ' + spoken : spoken, leading ? 'warn' : '');
    if (global.setInterval) {
      voice.ticker = global.setInterval(function () { self.voiceTick(); }, VOICE_TICK_MS);
    }
    var deadline = createRequestDeadline(VOICE_REQUEST_TIMEOUT_MS);
    voice.request = deadline;
    try {
      await this.ensureSession();
      // Through withFreshSession: a panel open long enough for the fifteen
      // minute token to expire must not lose the words somebody just spoke.
      var result = await this.withFreshSession(function () {
        return self.api.transcribeVoice(self.session, recording, deadline);
      }, false);
      if (voice.generation !== generation) return;
      this.applyTranscript(result.text);
    } catch (error) {
      // A cancelled upload is not a failure to report: the visitor abandoned it
      // and has already been shown an idle composer.
      if (voice.generation !== generation) return;
      var failure = voiceFailure(error);
      // Voice is off for this website, not off for this recording. The button
      // goes, because pressing it again cannot end any differently, and the
      // keyboard is left doing the whole job without a word about whose fault
      // it is.
      if (failure.off) voice.available = false;
      this.stopVoiceTicker();
      this.setVoice('idle', failure.message, 'error');
    } finally {
      deadline.clear();
      if (voice.request === deadline) voice.request = null;
      if (voice.generation === generation) this.stopVoiceTicker();
    }
  };

  // The whole point of the feature, and the one thing about it that must not be
  // improved: the words land in the composer and stop there. The visitor reads
  // what was heard, fixes what was not, and presses send themselves.
  GarudaWidget.prototype.applyTranscript = function applyTranscript(text) {
    var textarea = this.nodes.textarea;
    var existing = typeof textarea.value === 'string' ? textarea.value : '';
    // Added to what is already there rather than replacing it: somebody who
    // typed half a sentence and then spoke the rest keeps both halves.
    var combined = existing.trim() ? existing.replace(/\s+$/, '') + ' ' + text : text;
    textarea.value = combined.slice(0, MAX_MESSAGE_LENGTH);
    this.stopVoiceTicker();
    this.setVoice('idle', 'Here is what we heard. Check it, then press send.', '');
    textarea.focus({ preventScroll: true });
    // The caret goes to the end, so the next keystroke edits the transcript
    // rather than landing in front of it.
    if (typeof textarea.setSelectionRange === 'function') {
      try {
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      } catch (_error) {
        // A control that refuses a selection is still perfectly typable.
      }
    }
  };

  GarudaWidget.prototype.voiceFailed = function voiceFailed(message) {
    this.releaseVoice();
    this.setVoice('idle', message, 'error');
  };

  // Cancel means the recording goes nowhere. The generation moves on, so a
  // stream still being granted is handed straight back, an upload already in
  // flight is dropped along with whatever it answers, and the chunks recorded so
  // far are thrown away rather than sent.
  GarudaWidget.prototype.cancelVoiceRecording = function cancelVoiceRecording() {
    var voice = this.voice;
    if (!voice) return;
    if (voice.state !== 'idle') {
      voice.generation += 1;
      voice.chunks = [];
      voice.bytes = 0;
      if (voice.request) {
        voice.request.abort();
        voice.request = null;
      }
      try {
        if (voice.recorder && voice.recorder.state !== 'inactive') voice.recorder.stop();
      } catch (_error) {
        // Nothing here depends on the recorder stopping cleanly. The tracks are
        // released either way, on the line below.
      }
      this.releaseVoice();
    }
    this.setVoice('idle', '', '');
  };

  // Some browsers report a type as supported and then refuse it at
  // construction. Losing the recording to that is unnecessary: the browser's
  // own default records everywhere its MediaRecorder does, and what it chose is
  // read back off the blob afterwards.
  function createVoiceRecorder(stream) {
    var Recorder = global.MediaRecorder;
    var mimeType = chooseVoiceMimeType(
      typeof Recorder.isTypeSupported === 'function'
        ? function (type) { return Recorder.isTypeSupported(type); }
        : null
    );
    if (mimeType) {
      try {
        return new Recorder(stream, { mimeType: mimeType });
      } catch (_error) {
        // Fall through to the browser's default rather than failing outright.
      }
    }
    return new Recorder(stream);
  }

  // ---- human handoff, and starting over ----

  GarudaWidget.prototype.handoffAvailable = function handoffAvailable() {
    var handoff = isRecord(this.agent.handoff) ? this.agent.handoff : null;
    return Boolean(handoff && handoff.enabled && this.session);
  };

  GarudaWidget.prototype.updateHandoffVisibility = function updateHandoffVisibility() {
    var nodes = this.nodes;
    if (!nodes.handoffButton) return;
    nodes.restart.hidden = !this.session || this.messages.length === 0;
    var available = this.handoffAvailable();
    nodes.handoffButton.hidden = !available || this.leadVisible || this.bookingVisible;
    if (!available) {
      nodes.handoffHint.hidden = true;
      return;
    }
    var handoff = this.agent.handoff;
    nodes.handoffLabel.textContent = handoff.label;
    nodes.handoffButton.setAttribute('aria-label', handoff.label);
    // The visitor is told when somebody is actually there before they commit to
    // a channel where silence reads as being ignored.
    nodes.handoffHint.textContent = handoff.availability;
    nodes.handoffHint.hidden = nodes.handoffButton.hidden || !handoff.availability;
  };

  // A visitor who types "let me talk to a human" should not have to hunt for a
  // button. Matching a phrase the owner listed, or simply taking several turns
  // without getting anywhere, pulls the offer forward instead.
  GarudaWidget.prototype.maybeOfferHandoff = function maybeOfferHandoff(content) {
    if (!this.handoffAvailable() || this.handoffOffered) return;
    var handoff = this.agent.handoff;
    var text = String(content || '').toLowerCase();
    var matched = handoff.triggerPhrases.some(function (phrase) {
      return phrase && text.indexOf(phrase) !== -1;
    });
    if (!matched && handoff.autoOfferAfter > 0) {
      var turns = this.messages.filter(function (message) {
        return message.role === 'user';
      }).length;
      matched = turns >= handoff.autoOfferAfter;
    }
    if (!matched) return;
    this.handoffOffered = true;
    this.nodes.handoffButton.classList.add('gw-handoff-offered');
  };

  GarudaWidget.prototype.requestHandoff = async function requestHandoff() {
    var nodes = this.nodes;
    if (!this.handoffAvailable() || nodes.handoffButton.disabled) return;
    nodes.handoffButton.disabled = true;
    nodes.handoffLabel.textContent = 'Opening WhatsApp…';
    try {
      var result = await this.api.startHandoff(this.session);
      openExternal(result.url);
      // The transcript carries a real link as well as the attempted open.
      // Nothing can detect a blocked popup -- window.open returns null on
      // SUCCESS when noopener is set, which is what made the old fallback
      // navigate the customer's own page away on every single handoff -- so the
      // visitor is given something to tap rather than the widget guessing.
      this.appendMessage({
        id: randomID(),
        role: 'assistant',
        content: 'Opening WhatsApp so you can speak with the team directly. This chat stays here if you would rather keep typing.'
      }, { action: { label: result.label || 'Open WhatsApp', url: result.url } });
    } catch (error) {
      this.appendMessage({
        id: randomID(),
        role: 'assistant',
        content: error instanceof WidgetError && error.code === 'handoff_unavailable'
          ? 'Speaking with a person is not set up for this website yet.'
          : 'We could not open WhatsApp just now. Please try again in a moment.'
      });
    } finally {
      nodes.handoffButton.disabled = false;
      this.updateHandoffVisibility();
    }
  };

  // Starting over means a new conversation, not being forgotten. The visitor
  // keeps their identity so a returning customer is still recognised, and the
  // previous transcript stays in the owner's inbox rather than being deleted.
  GarudaWidget.prototype.restartConversation = async function restartConversation() {
    var nodes = this.nodes;
    if (!this.session || this.sending || nodes.restart.disabled) return;
    nodes.restart.disabled = true;
    try {
      var session = await this.api.resetSession(this.session);
      this.session = session;
      this.messages = [];
      this.handoffOffered = false;
      this.leadVisible = false;
      nodes.handoffButton.classList.remove('gw-handoff-offered');
      nodes.leadRegion.textContent = '';
      this.closeBookingPicker(false);
      this.clearTranscript();
      this.hydrateConversation(session.conversation);
      this.clearNotice();
    } catch (_error) {
      this.appendMessage({
        id: randomID(),
        role: 'assistant',
        content: 'We could not start a new conversation just now. Please try again.'
      });
    } finally {
      nodes.restart.disabled = false;
      this.updateHandoffVisibility();
    }
  };

  // The consent region and the history notice are permanent fixtures of the
  // transcript element, so the rows are removed individually rather than by
  // emptying their parent.
  GarudaWidget.prototype.clearTranscript = function clearTranscript() {
    var messages = this.nodes.messages;
    var rows = messages.querySelectorAll('.gw-message-row');
    for (var index = 0; index < rows.length; index += 1) {
      rows[index].remove();
    }
    this.nodes.historyStatus.textContent = '';
    this.nodes.historyStatus.hidden = true;
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
      this.leadVisible ||
      this.bookingVisible;
    this.updateHandoffVisibility();
    this.updateBookingVisibility();
    this.updateVoiceVisibility();
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

  // A panel open long enough for a session to expire must not lose the visitor's
  // work. Every write the visitor makes goes through here: one expiry is
  // answered by opening a fresh session and running the call again, and a second
  // failure is reported rather than retried.
  GarudaWidget.prototype.withFreshSession = async function withFreshSession(operation, retrying) {
    try {
      return await operation();
    } catch (error) {
      var canRefresh = !retrying &&
        error instanceof WidgetError &&
        (error.status === 401 || error.code === 'session_expired' || error.code === 'invalid_session');
      if (!canRefresh) throw error;
      await this.ensureSession(true);
      return this.withFreshSession(operation, true);
    }
  };

  GarudaWidget.prototype.captureLeadWithRefresh = function captureLeadWithRefresh(request, retrying) {
    var self = this;
    return this.withFreshSession(function () {
      return self.api.captureLead(self.session, request);
    }, retrying);
  };

  // ---- appointments ----
  //
  // Real free times from the owner's own calendar, chosen from inside the chat.
  // Three rules shape everything below.
  //
  // The owner's wording is the only wording. Every time a visitor sees is a
  // string the server rendered in the owner's zone; nothing here formats a date.
  //
  // A time can go while it is on screen. The server re-checks the calendar at
  // booking time and answers 409 when the owner has taken the slot since it was
  // offered, so that answer re-reads the times rather than showing an error.
  //
  // A calendar the owner has not connected is not the visitor's problem. It is
  // answered with the lead form, never with a failure that reads as their fault.

  GarudaWidget.prototype.bookingAvailable = function bookingAvailable() {
    var booking = isRecord(this.agent.booking) ? this.agent.booking : null;
    if (!booking || !booking.enabled || !this.session) return false;
    // A calendar that finishes on its own page needs no slots call -- the button
    // is a link. Requiring the API here would hide the only working path.
    if (booking.completesElsewhere) return Boolean(booking.schedulingURL);
    return Boolean(this.api && typeof this.api.listBookingSlots === 'function');
  };

  GarudaWidget.prototype.updateBookingVisibility = function updateBookingVisibility() {
    var nodes = this.nodes;
    if (!nodes.bookingButton) return;
    var available = this.bookingAvailable();
    nodes.bookingButton.hidden = !available || this.leadVisible || this.bookingVisible;
    if (!available) return;
    nodes.bookingLabel.textContent = this.agent.booking.label;
    nodes.bookingButton.setAttribute('aria-label', this.agent.booking.label);
  };

  // A calendar with no create-booking API is handed over rather than faked. The
  // link also goes into the transcript, because a popup blocker swallowing the
  // click on somebody else's website must not leave the visitor with nothing.
  GarudaWidget.prototype.openExternalBooking = function openExternalBooking() {
    var booking = isRecord(this.agent.booking) ? this.agent.booking : null;
    if (!booking || !booking.schedulingURL) return;
    openExternal(booking.schedulingURL);
    // The same reasoning as the WhatsApp handoff: a blocked popup cannot be
    // detected, so the visitor is given something to tap rather than the widget
    // guessing whether the open worked.
    this.appendMessage({
      id: randomID(),
      role: 'assistant',
      content: 'Appointments for this team are booked on ' + booking.providerLabel + '. Opening it now — this chat stays here.'
    }, { action: { label: 'Open ' + booking.providerLabel, url: booking.schedulingURL } });
  };

  GarudaWidget.prototype.showBookingPicker = async function showBookingPicker() {
    var self = this;
    if (this.bookingVisible || !this.bookingAvailable() || !this.nodes.bookingRegion) return;
    this.bookingVisible = true;
    this.updateContactVisibility();

    var card = element('section', 'gw-booking-card');
    card.setAttribute('aria-labelledby', 'gw-booking-title');
    var top = element('div', 'gw-booking-top');
    var headingWrap = element('div');
    headingWrap.appendChild(element('span', 'gw-booking-eyebrow', 'Appointment'));
    var heading = element('h2', '', this.agent.booking.label);
    heading.id = 'gw-booking-title';
    headingWrap.appendChild(heading);
    var dismiss = element('button', 'gw-lead-dismiss');
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', 'Close the appointment times');
    dismiss.appendChild(svgIcon('M6 6l12 12M18 6 6 18'));
    top.appendChild(headingWrap);
    top.appendChild(dismiss);
    // One announced line carries the whole state of the picker: that times are
    // being fetched, which zone they are in, and that a chosen time just went.
    var note = element('p', 'gw-booking-note');
    note.setAttribute('role', 'status');
    var body = element('div', 'gw-booking-body');
    card.appendChild(top);
    card.appendChild(note);
    card.appendChild(body);
    this.bookingPicker = { card: card, note: note, body: body, dismiss: dismiss, payload: null };
    this.nodes.bookingRegion.replaceChildren(card);
    this.scrollToBottom(true);
    dismiss.addEventListener('click', function () { self.closeBookingPicker(true); });
    body.addEventListener('keydown', function (event) { self.moveSlotFocus(event); });
    await this.loadBookingSlots('');
  };

  GarudaWidget.prototype.closeBookingPicker = function closeBookingPicker(returnFocus) {
    if (!this.nodes.bookingRegion) return;
    this.bookingVisible = false;
    this.bookingPicker = null;
    this.nodes.bookingRegion.replaceChildren();
    this.updateContactVisibility();
    if (returnFocus && this.nodes.textarea) this.nodes.textarea.focus({ preventScroll: true });
  };

  GarudaWidget.prototype.setBookingNote = function setBookingNote(text, state) {
    var picker = this.bookingPicker;
    if (!picker) return;
    picker.note.textContent = text;
    if (state) picker.note.setAttribute('data-state', state);
    else picker.note.removeAttribute('data-state');
  };

  // leading carries the sentence that has to survive the round trip -- the one
  // that says a chosen time was taken -- so the visitor reads why the list they
  // were looking at was replaced.
  GarudaWidget.prototype.loadBookingSlots = async function loadBookingSlots(leading) {
    var self = this;
    var picker = this.bookingPicker;
    if (!picker) return;
    this.setBookingNote(
      leading ? leading + ' Finding the times that are still free…' : 'Finding open times…',
      leading ? 'notice' : ''
    );
    picker.body.replaceChildren();
    try {
      await this.ensureSession();
      var payload = await this.withFreshSession(function () {
        return self.api.listBookingSlots(self.session);
      }, false);
      // A visitor who closed the picker while this was in flight gets nothing
      // drawn back on top of them.
      if (this.bookingPicker !== picker) return;
      this.clearNotice();
      picker.payload = payload;
      this.renderBookingSlots(payload, leading);
    } catch (error) {
      if (this.bookingPicker !== picker) return;
      // The promise is handed back so the notice's own button stays busy for as
      // long as the second attempt actually takes.
      this.bookingFailed(error, function () { return self.showBookingPicker(); });
    }
  };

  GarudaWidget.prototype.renderBookingSlots = function renderBookingSlots(payload, leading) {
    var self = this;
    var picker = this.bookingPicker;
    if (!picker) return;
    var booking = this.agent.booking;
    var timezone = payload.timezone || booking.timezone;
    var minutes = payload.durationMinutes || booking.durationMinutes;
    picker.timezone = timezone;
    picker.minutes = minutes;
    picker.body.replaceChildren();
    if (!payload.slots.length) {
      this.setBookingNote(
        leading
          ? leading + ' There are no other free times at the moment.'
          : 'There are no free times at the moment. Ask the assistant and the team can find one for you.',
        'notice'
      );
      picker.dismiss.focus({ preventScroll: true });
      return;
    }
    var lines = [];
    if (leading) lines.push(leading);
    if (minutes) lines.push('Each appointment takes ' + minutes + ' minutes.');
    // The zone is named because the times are the owner's, not the visitor's,
    // and a visitor in another country has no other way to know that.
    if (timezone) lines.push('Times are shown in ' + timezone + '.');
    if (payload.truncated) lines.push('Showing the soonest ' + payload.slots.length + ' times.');
    this.setBookingNote(lines.join(' '), leading ? 'notice' : '');

    var days = element('div', 'gw-booking-days');
    groupBookingSlots(payload.slots).forEach(function (group) {
      var section = element('div', 'gw-slot-day');
      var dayName = element('h3', 'gw-slot-day-name', group.day);
      dayName.id = 'gw-slot-day-' + randomID();
      var list = element('ul', 'gw-slot-list');
      list.setAttribute('aria-labelledby', dayName.id);
      group.slots.forEach(function (slot) {
        var item = element('li');
        var choice = element('button', 'gw-slot', slot.time);
        choice.type = 'button';
        // The visible label is the time alone, because the day above it is not
        // read out with it. The accessible name carries both.
        choice.setAttribute('aria-label', 'Book ' + slot.label);
        choice.addEventListener('click', function () { self.showBookingForm(slot); });
        item.appendChild(choice);
        list.appendChild(item);
      });
      section.appendChild(dayName);
      section.appendChild(list);
      days.appendChild(section);
    });
    picker.body.appendChild(days);
    // The button that opened the picker is hidden by now, so focus has to be
    // taken somewhere deliberate rather than dropped on the document.
    var first = picker.body.querySelectorAll('.gw-slot')[0];
    if (first) first.focus({ preventScroll: true });
    this.scrollToBottom(true);
  };

  // Arrow keys walk the times the way a picker is expected to behave. Every slot
  // is still a real button, so Tab and Enter work without any of this.
  GarudaWidget.prototype.moveSlotFocus = function moveSlotFocus(event) {
    var picker = this.bookingPicker;
    if (!picker || !event || !event.key) return;
    var forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    var backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    if (!forward && !backward && event.key !== 'Home' && event.key !== 'End') return;
    var slots = picker.body.querySelectorAll('.gw-slot');
    if (!slots.length) return;
    var current = -1;
    for (var index = 0; index < slots.length; index += 1) {
      if (slots[index] === event.target) current = index;
    }
    if (current === -1) return;
    var next = event.key === 'Home' ? 0
      : event.key === 'End' ? slots.length - 1
        : current + (forward ? 1 : -1);
    if (next < 0 || next >= slots.length) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    slots[next].focus({ preventScroll: true });
  };

  // The three questions the booking endpoint accepts, in the shape the lead
  // builder uses, so they are drawn, labelled and checked by the helpers the
  // lead form already uses rather than by a second set of them.
  function bookingFormFields() {
    return [
      { id: 'name', label: 'Your name', type: 'text', required: true, options: [], placeholder: '' },
      // Optional because the server books without one. It simply cannot send the
      // invite, which is what the label says rather than a rule the visitor
      // discovers afterwards.
      { id: 'email', label: 'Email for the invite', type: 'email', required: false, options: [], placeholder: '' },
      { id: 'notes', label: 'Anything the team should know', type: 'textarea', required: false, options: [], placeholder: '' }
    ];
  }

  GarudaWidget.prototype.showBookingForm = function showBookingForm(slot) {
    var self = this;
    var picker = this.bookingPicker;
    if (!picker) return;
    var entries = bookingFormFields().map(createLeadField);
    var form = element('form', 'gw-lead-form gw-booking-form');
    form.noValidate = true;
    entries.forEach(function (entry) { form.appendChild(entry.group); });
    var back = element('button', 'gw-secondary-button gw-booking-back', 'Pick another time');
    back.type = 'button';
    var submit = element('button', 'gw-primary-button gw-lead-submit', 'Confirm appointment');
    submit.type = 'submit';
    var formStatus = element('p', 'gw-form-status');
    formStatus.setAttribute('role', 'status');
    form.appendChild(back);
    form.appendChild(submit);
    form.appendChild(formStatus);
    picker.body.replaceChildren(form);
    this.setBookingNote(
      'You are booking ' + slot.label + (picker.timezone ? ' (' + picker.timezone + ')' : '') + '.',
      ''
    );
    entries[0].control.focus({ preventScroll: true });
    this.scrollToBottom(true);

    back.addEventListener('click', function () {
      if (!self.bookingPicker || submit.disabled) return;
      self.renderBookingSlots(self.bookingPicker.payload, '');
    });
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      // One booking at a time. The button is already disabled while the write is
      // in flight; this guards the keyboard path that can fire submit again.
      if (submit.disabled) return;
      var firstProblem = null;
      entries.forEach(function (entry) {
        var problem = leadFieldProblem(entry);
        setLeadFieldProblem(entry, problem);
        if (problem && !firstProblem) firstProblem = entry;
      });
      if (firstProblem) {
        formStatus.textContent = 'Check the highlighted fields and try again.';
        firstProblem.control.focus({ preventScroll: true });
        return;
      }
      var answers = {};
      entries.forEach(function (entry) { answers[entry.field.id] = leadFieldValue(entry); });
      setButtonBusy(submit, true, 'Booking…');
      formStatus.textContent = '';
      try {
        await self.ensureSession();
        var result = await self.withFreshSession(function () {
          return self.api.createBooking(self.session, {
            start: slot.start,
            name: answers.name,
            email: answers.email,
            notes: answers.notes
          });
        }, false);
        self.confirmBooking(slot, result);
      } catch (error) {
        setButtonBusy(submit, false, '', 'Confirm appointment');
        await self.bookingSubmitFailed(error, entries, formStatus);
      }
    });
  };

  GarudaWidget.prototype.confirmBooking = function confirmBooking(slot, result) {
    var picker = this.bookingPicker;
    var booking = this.agent.booking;
    var minutes = result.minutes || (picker && picker.minutes) || booking.durationMinutes;
    var timezone = result.timezone || (picker && picker.timezone) || booking.timezone;
    var detail = [];
    if (minutes) detail.push(minutes + ' minutes');
    if (timezone) detail.push(timezone);
    this.closeBookingPicker(false);
    // Into the transcript, which is the panel's live region, so the confirmation
    // is announced and stays readable after the picker has gone. The time is the
    // owner's own wording for it.
    this.appendMessage({
      id: randomID(),
      role: 'assistant',
      content: 'Your appointment is confirmed for ' + slot.label +
        (detail.length ? ' (' + detail.join(', ') + ')' : '') +
        '. It is in the team calendar — you can keep typing here if anything changes.'
    });
    if (this.nodes.textarea) this.nodes.textarea.focus({ preventScroll: true });
  };

  GarudaWidget.prototype.bookingSubmitFailed = async function bookingSubmitFailed(error, entries, formStatus) {
    var code = error instanceof WidgetError ? error.code : '';
    if (code === 'slot_taken') {
      // Somebody took that time seconds ago. The visitor is told so plainly and
      // handed the times that are still free, rather than an error to decode.
      await this.loadBookingSlots(SLOT_TAKEN_MESSAGE);
      return;
    }
    if (code === 'validation_failed' && showLeadFieldErrors(entries, error.details)) {
      formStatus.textContent = 'Check the highlighted fields and try again.';
      return;
    }
    if (code === 'calendar_not_connected' || code === 'booking_unavailable') {
      this.bookingFailed(error, null);
      return;
    }
    formStatus.textContent = error instanceof WidgetError
      ? error.message
      : 'The appointment could not be booked. Please try again.';
  };

  // None of this is the visitor's fault, so none of it is worded as though it
  // were. A calendar the owner never connected, and an assistant that has
  // stopped offering appointments, both end with the lead form and the button
  // gone. Anything else is a calendar the widget could not reach just now, which
  // is worth another try.
  GarudaWidget.prototype.bookingFailed = function bookingFailed(error, retry) {
    var code = error instanceof WidgetError ? error.code : '';
    if (code === 'calendar_not_connected' || code === 'booking_unavailable') {
      if (code === 'booking_unavailable') this.agent.booking = normalizeBooking(null);
      this.closeBookingPicker(false);
      var offersForm = this.leadCaptureAvailable();
      this.appendMessage({
        id: randomID(),
        role: 'assistant',
        content: offersForm
          ? 'Appointments are not available right now. Leave your details below and the team will come back to you with a time.'
          : 'Appointments are not available right now. Ask me anything else and the team can follow up.'
      });
      if (offersForm) this.showLeadForm(normalizeLeadSpec({}, this.agent));
      return;
    }
    this.closeBookingPicker(false);
    this.showNotice(
      error instanceof WidgetError
        ? error.message
        : 'The calendar could not be reached. Please try again in a moment.',
      typeof retry === 'function' ? retry : null
    );
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
      '.gw-launcher:focus-visible,.gw-icon-button:focus-visible,.gw-send:focus-visible,.gw-mic:focus-visible,.gw-voice-action:focus-visible,.gw-suggestion:focus-visible,.gw-primary-button:focus-visible,.gw-secondary-button:focus-visible,.gw-contact-button:focus-visible,.gw-handoff-button:focus-visible,.gw-booking-button:focus-visible,.gw-slot:focus-visible,.gw-lead-dismiss:focus-visible,.gw-notice-action:focus-visible,a:focus-visible{outline:3px solid color-mix(in srgb,var(--garuda-accent) 36%,white);outline-offset:3px;}',
      '.gw-launcher-icon{width:46px;height:46px;border-radius:15px;display:grid;place-items:center;flex:none;background:rgba(255,255,255,.13);}',
      '.gw-launcher-icon svg{width:25px;height:25px;}',
      '.gw-launcher-label{max-width:0;overflow:hidden;white-space:nowrap;font-size:14px;font-weight:720;letter-spacing:-.01em;opacity:0;transition:max-width .25s ease,opacity .18s ease,padding .25s ease;}',
      '.gw-launcher:hover .gw-launcher-label,.gw-launcher:focus-visible .gw-launcher-label{max-width:190px;opacity:1;padding:0 13px 0 7px;}',
      '.gw-open .gw-launcher{min-width:60px;}',
      '.gw-open .gw-launcher-label{max-width:0!important;opacity:0!important;padding:0!important;}',
      '.gw-unread{position:absolute;right:-4px;top:-6px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;display:grid;place-items:center;background:#EF4444;color:#fff;border:3px solid #fff;font-size:10px;font-weight:800;box-shadow:0 4px 10px rgba(239,68,68,.28);}',
      '.gw-panel{width:min(390px,calc(100vw - 32px));height:min(650px,calc(100dvh - 112px));min-height:440px;border-radius:24px;background:var(--garuda-background);border:1px solid rgba(148,163,184,.26);box-shadow:0 28px 70px rgba(15,23,42,.2),0 8px 25px rgba(15,23,42,.1);overflow:hidden;display:grid;grid-template-rows:auto auto minmax(0,1fr) auto auto auto auto auto;transform-origin:bottom right;animation:gw-enter .22s cubic-bezier(.2,.8,.2,1);}',
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
      '.gw-handoff-button{min-height:35px;border:0;background:transparent;color:#128C7E;display:flex;align-items:center;gap:6px;padding:5px 3px;font-size:11px;font-weight:680;cursor:pointer;border-radius:9px;}',
      '.gw-handoff-button:hover{background:rgba(18,140,126,.09);}',
      '.gw-handoff-button:disabled{opacity:.6;cursor:progress;}',
      '.gw-handoff-button svg{width:15px;height:15px;}',
      // The offer is a nudge, not an alarm: one short pulse, and nothing at all
      // for a visitor who has asked their system not to animate.
      '.gw-handoff-offered{background:rgba(18,140,126,.12);animation:gw-handoff-pulse 1.1s ease-out 2;}',
      '@keyframes gw-handoff-pulse{0%{box-shadow:0 0 0 0 rgba(18,140,126,.35);}70%{box-shadow:0 0 0 7px rgba(18,140,126,0);}100%{box-shadow:0 0 0 0 rgba(18,140,126,0);}}',
      '@media (prefers-reduced-motion: reduce){.gw-handoff-offered{animation:none;}}',
      '.gw-handoff-hint{margin:0 0 2px 3px;font-size:10px;color:#7A8496;}',
      '.gw-bubble-action{display:inline-flex;align-items:center;margin-top:8px;padding:6px 11px;border-radius:8px;background:#128C7E;color:#fff;font-size:11px;font-weight:700;text-decoration:none;}',
      '.gw-bubble-action:hover{background:#0F7568;}',
      '.gw-contact-button svg{width:15px;height:15px;}',
      '.gw-booking-button{min-height:35px;border:0;background:transparent;color:var(--garuda-accent);display:flex;align-items:center;gap:6px;padding:5px 3px;font-size:11px;font-weight:680;cursor:pointer;border-radius:9px;}',
      '.gw-booking-button:hover{background:color-mix(in srgb,var(--garuda-accent) 8%,transparent);}',
      '.gw-booking-button svg{width:15px;height:15px;}',
      '.gw-booking-region{padding:0 15px 13px;}',
      '.gw-booking-card{border-radius:19px;padding:15px;background:var(--garuda-background);border:1px solid color-mix(in srgb,var(--garuda-accent) 19%,#E4E9F0);box-shadow:0 11px 30px rgba(15,23,42,.08);}',
      '.gw-booking-card h2{margin:0;color:var(--garuda-text);font-size:15px;letter-spacing:-.015em;}',
      '.gw-booking-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;}',
      '.gw-booking-eyebrow{display:block;margin-bottom:3px;color:var(--garuda-accent);font-size:9px;font-weight:820;text-transform:uppercase;letter-spacing:.12em;}',
      '.gw-booking-note{margin:7px 0 0;color:var(--garuda-muted);font-size:10px;line-height:1.5;}',
      '.gw-booking-note[data-state="notice"]{color:#9A3412;font-weight:650;}',
      '.gw-booking-days{margin-top:11px;display:flex;flex-direction:column;gap:11px;max-height:232px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;}',
      '.gw-slot-day-name{margin:0 0 6px;color:var(--garuda-text);font-size:10px;font-weight:780;letter-spacing:.01em;}',
      '.gw-slot-list{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px;}',
      '.gw-slot{border:1px solid color-mix(in srgb,var(--garuda-accent) 22%,#DCE2EA);border-radius:11px;padding:8px 10px;background:#fff;color:color-mix(in srgb,var(--garuda-accent) 80%,#172033);font-size:11px;font-weight:680;line-height:1.2;cursor:pointer;transition:background .15s,border-color .15s,transform .15s;}',
      '.gw-slot:hover{background:color-mix(in srgb,var(--garuda-accent) 7%,white);border-color:color-mix(in srgb,var(--garuda-accent) 44%,#DCE2EA);transform:translateY(-1px);}',
      '.gw-booking-form{margin-top:12px;}',
      '.gw-booking-back{grid-column:1/-1;width:100%;}',
      '.gw-composer{display:flex;align-items:flex-end;gap:8px;padding:9px 12px 11px;background:var(--garuda-background);border-top:1px solid var(--garuda-line);}',
      '.gw-input-wrap{position:relative;flex:1;min-width:0;}',
      '.gw-input{display:block;width:100%;min-height:44px;max-height:112px;resize:none;border:1px solid var(--garuda-line);border-radius:15px;background:var(--garuda-surface);padding:11px 12px;color:var(--garuda-text);font-size:13px;line-height:1.45;outline:0;overflow-y:auto;transition:border-color .15s,box-shadow .15s,background .15s;}',
      '.gw-input::placeholder{color:#94A3B8;}',
      '.gw-input:focus{border-color:color-mix(in srgb,var(--garuda-accent) 55%,#DCE2EA);box-shadow:0 0 0 3px color-mix(in srgb,var(--garuda-accent) 10%,transparent);background:var(--garuda-background);}',
      '.gw-input:disabled{cursor:not-allowed;opacity:.65;}',
      '.gw-counter{position:absolute;right:8px;bottom:-17px;font-size:9px;color:#64748B;}',
      // The microphone reads as a control that is doing something, not as an
      // icon that happens to be red: the button fills, the row above it names
      // the state and counts, and both pulse together.
      '.gw-mic{position:relative;width:44px;height:44px;flex:none;border:1px solid var(--garuda-line);border-radius:14px;display:grid;place-items:center;background:var(--garuda-surface);color:var(--garuda-text);cursor:pointer;transition:transform .15s,background .15s,color .15s,border-color .15s;}',
      '.gw-mic:hover:not(:disabled){background:color-mix(in srgb,var(--garuda-accent) 9%,var(--garuda-surface));border-color:color-mix(in srgb,var(--garuda-accent) 40%,var(--garuda-line));color:var(--garuda-accent);}',
      '.gw-mic:active:not(:disabled){transform:scale(.97);}',
      '.gw-mic:disabled{opacity:.35;cursor:not-allowed;}',
      '.gw-mic svg{width:20px;height:20px;}',
      '.gw-mic[data-state="recording"]{background:#DC2626;border-color:#DC2626;color:#fff;box-shadow:0 0 0 4px rgba(220,38,38,.16);animation:gw-record 1.5s ease-in-out infinite;}',
      '.gw-voice{display:flex;align-items:center;gap:8px;padding:9px 12px 0;background:var(--garuda-background);font-size:11px;line-height:1.45;}',
      '.gw-voice-dot{width:10px;height:10px;flex:none;border-radius:50%;background:#DC2626;}',
      '.gw-voice[data-phase="recording"] .gw-voice-dot{animation:gw-record 1.5s ease-in-out infinite;}',
      '.gw-voice[data-phase="starting"] .gw-voice-dot,.gw-voice[data-phase="stopping"] .gw-voice-dot,.gw-voice[data-phase="transcribing"] .gw-voice-dot{width:13px;height:13px;background:transparent;border:2px solid var(--garuda-accent);border-top-color:transparent;animation:gw-spin .7s linear infinite;}',
      '.gw-voice-status{flex:1;min-width:0;color:var(--garuda-muted);font-weight:600;}',
      '.gw-voice[data-state="warn"] .gw-voice-status{color:#9A3412;font-weight:700;}',
      '.gw-voice[data-state="error"] .gw-voice-status{color:#B91C1C;font-weight:700;}',
      // Tabular figures, so a clock counting up does not shift the sentence
      // beside it left and right on every tick.
      '.gw-voice-time{flex:none;color:var(--garuda-text);font-weight:760;font-variant-numeric:tabular-nums;}',
      '.gw-voice-action{flex:none;border:0;border-radius:8px;background:transparent;color:#5B6475;text-decoration:underline;font-size:11px;font-weight:720;cursor:pointer;padding:4px 3px;}',
      '.gw-voice-action:hover{color:#B91C1C;}',
      '@keyframes gw-record{0%,100%{opacity:1}50%{opacity:.5}}',
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
      '.gw-transparent .gw-header,.gw-transparent .gw-body,.gw-transparent .gw-typing,.gw-transparent .gw-contact-row,.gw-transparent .gw-voice,.gw-transparent .gw-composer,.gw-transparent .gw-footer{background:transparent;}',
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
