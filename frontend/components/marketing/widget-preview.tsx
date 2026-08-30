import { ChevronDown, Lock, MessageSquare, SendHorizontal, ShieldCheck } from "lucide-react";

/**
 * A static, faithful rendering of the published Garuda widget.
 *
 * Every piece of chrome below mirrors what widget/src/v1.js actually builds and
 * paints: the 390px panel at a 24px radius, the 44px monogram avatar, the
 * assistant bubble on the surface colour with its squared bottom-left corner,
 * the accent bubble for the visitor, the pill suggestions, the composer
 * placeholder ("Type your message…") and the "Secure chat by Garuda" footer.
 *
 * It is deliberately not interactive. The conversation is an illustration and is
 * labelled as one, so nobody can mistake it for a live agent or for a real
 * customer. The controls carry aria-hidden because a button that does nothing is
 * worse for a keyboard user than no button at all; the conversation itself stays
 * readable, because that is the part with something to say.
 */

const conversation = [
  {
    from: "assistant" as const,
    text: "Hi — I’m the assistant for Acme Roofing. Ask me about our services, the areas we cover, or how a job usually runs.",
  },
  { from: "visitor" as const, text: "Do you replace flat roofs in Leeds?" },
  {
    from: "assistant" as const,
    text: "Yes. Flat roof replacement is one of the services in our knowledge base, and Leeds is inside the coverage area listed there.",
  },
  { from: "visitor" as const, text: "What would 60m² cost?" },
  {
    from: "assistant" as const,
    text: "I don’t have pricing for that in Acme’s approved knowledge, so I’d rather not guess at a number. I can pass this to the team — would you like someone to come back to you with a quote?",
  },
];

const suggestions = ["Yes, contact me", "Which areas do you cover?"];

function PanelChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-[390px] overflow-hidden rounded-[24px] border border-slate-300/50 bg-white shadow-[0_28px_70px_rgba(15,23,42,.18),0_8px_25px_rgba(15,23,42,.08)]">
      {children}
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="flex min-h-[76px] items-center justify-between gap-3 border-b border-slate-900/10 bg-gradient-to-br from-white to-slate-900/[0.05] py-3.5 pl-4 pr-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-[15px] bg-gradient-to-br from-indigo-400 to-indigo-600 text-[17px] font-extrabold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.22)]"
          aria-hidden="true"
        >
          A
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-bold tracking-[-0.018em] text-slate-900">Acme Roofing Assistant</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            Online
          </span>
        </span>
      </div>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400" aria-hidden="true">
        <ChevronDown className="h-4 w-4" />
      </span>
    </div>
  );
}

function PanelComposer() {
  return (
    <div className="flex items-end gap-2 border-t border-slate-900/10 bg-white px-3 pb-3 pt-2.5" aria-hidden="true">
      <span className="flex min-h-[44px] flex-1 items-center rounded-[15px] border border-slate-900/10 bg-slate-100 px-3 text-[13px] text-slate-400">
        Type your message…
      </span>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] bg-indigo-600 text-white shadow-[0_6px_14px_rgba(79,70,229,.25)]">
        <SendHorizontal className="h-4 w-4" />
      </span>
    </div>
  );
}

function PanelFooter() {
  return (
    <div className="flex min-h-[28px] items-center justify-center gap-1 bg-white pb-2 text-[9px] text-slate-400">
      <Lock className="h-2.5 w-2.5" aria-hidden="true" />
      <span>
        Secure chat by <span className="font-semibold text-slate-500">Garuda</span>
      </span>
    </div>
  );
}

function Launcher() {
  return (
    <span
      className="inline-flex h-[60px] items-center gap-2 rounded-[20px] border border-white/20 bg-indigo-600 px-5 text-sm font-semibold text-white shadow-[0_14px_35px_rgba(30,41,59,.22)]"
      aria-hidden="true"
    >
      <MessageSquare className="h-5 w-5" />
      Chat with us
    </span>
  );
}

/** The published widget mid-conversation, as a visitor sees it. */
export function WidgetChatPreview() {
  return (
    <figure className="m-0 w-full">
      <div className="relative mx-auto w-full max-w-[390px]">
        <div
          className="pointer-events-none absolute -inset-6 -z-10 rounded-[42px] bg-gradient-to-br from-indigo-200/60 via-violet-100/40 to-cyan-100/50 blur-2xl"
          aria-hidden="true"
        />
        <PanelChrome>
          <PanelHeader />
          <div className="bg-gradient-to-b from-slate-100 to-white px-4 py-4">
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {conversation.map((message) => (
                <li key={message.text} className={message.from === "visitor" ? "flex justify-end" : "flex justify-start"}>
                  <span
                    className={
                      message.from === "visitor"
                        ? "max-w-[86%] rounded-[16px] rounded-br-[5px] border border-indigo-700 bg-indigo-600 px-3 py-2 text-[12.5px] leading-[1.5] text-white"
                        : "max-w-[86%] rounded-[16px] rounded-bl-[5px] border border-slate-900/10 bg-slate-100 px-3 py-2 text-[12.5px] leading-[1.5] text-slate-900"
                    }
                  >
                    {message.text}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2" aria-hidden="true">
              {suggestions.map((suggestion) => (
                <span
                  key={suggestion}
                  className="rounded-full border border-indigo-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold leading-tight text-indigo-700"
                >
                  {suggestion}
                </span>
              ))}
            </div>
          </div>
          <PanelComposer />
          <PanelFooter />
        </PanelChrome>
        <div className="mt-3.5 flex justify-end">
          <Launcher />
        </div>
      </div>
      {/* The caption names what the illustration is for. The last assistant turn
          above is the whole objection — "will it invent something and make me
          apologise" — answered by showing the refusal rather than asserting it,
          and a reader scanning on a phone will not notice that unless told. */}
      <figcaption className="mx-auto mt-5 max-w-[390px] text-center text-xs leading-5 text-slate-500">
        Note the last answer: asked for a price it has not been given, the agent declines to guess and offers a person instead.
        That is the behaviour every drafted agent is instructed to follow. A static illustration of the published widget, drawn
        from its real layout and wording — the business is an example, not a customer, and the panel is not a live chat.
      </figcaption>
    </figure>
  );
}

/**
 * The two consent moments side by side: the memory choice a first-time visitor
 * is offered, and the contact form that cannot be submitted without ticking the
 * box. Both use the widget's own copy.
 */
export function WidgetConsentPreview() {
  return (
    <figure className="m-0 w-full">
      <div className="mx-auto grid w-full max-w-[390px] gap-4">
        <PanelChrome>
          <div className="bg-gradient-to-b from-slate-100 to-white p-4">
            <div className="rounded-[19px] border border-slate-900/10 bg-white p-4 shadow-[0_9px_25px_rgba(15,23,42,.07)]">
              <span className="mb-3 grid h-[35px] w-[35px] place-items-center rounded-xl bg-indigo-50 text-indigo-600" aria-hidden="true">
                <ShieldCheck className="h-[19px] w-[19px]" />
              </span>
              <p className="m-0 text-[15px] font-semibold tracking-[-0.015em] text-slate-900">Your chat, your choice</p>
              <p className="mt-1.5 text-[11px] leading-[1.55] text-slate-500">
                Allow this assistant to remember this conversation on this browser, or continue with a one-time chat.
              </p>
              <div className="mt-3.5 grid grid-cols-2 gap-2" aria-hidden="true">
                <span className="rounded-[11px] border border-slate-900 bg-slate-900 px-3 py-2 text-center text-[11px] font-semibold text-white">
                  Remember this chat
                </span>
                <span className="rounded-[11px] border border-slate-900/15 bg-white px-3 py-2 text-center text-[11px] font-semibold text-slate-700">
                  Use once
                </span>
              </div>
            </div>
          </div>
        </PanelChrome>

        <PanelChrome>
          <div className="bg-gradient-to-b from-slate-100 to-white p-4">
            <div className="rounded-[19px] border border-indigo-200 bg-white p-4 shadow-[0_11px_30px_rgba(15,23,42,.08)]">
              <span className="block text-[9px] font-extrabold uppercase tracking-[0.12em] text-indigo-600">Human follow-up</span>
              <p className="mt-1 text-[15px] font-semibold tracking-[-0.015em] text-slate-900">How can the team reach you?</p>
              <div className="mt-3 grid gap-2" aria-hidden="true">
                {["Name", "Email"].map((label) => (
                  <span key={label} className="grid gap-1">
                    <span className="text-[10px] font-bold text-slate-500">{label}</span>
                    <span className="flex min-h-[39px] items-center rounded-[11px] border border-slate-900/10 bg-slate-100 px-2.5 text-[11px] text-slate-400" />
                  </span>
                ))}
              </div>
              <p className="mt-3 flex items-start gap-2 text-[11px] font-medium leading-[1.5] text-slate-700">
                <span
                  className="mt-px grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border border-indigo-600 bg-indigo-600 text-white"
                  aria-hidden="true"
                >
                  <svg
                    viewBox="0 0 12 12"
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M2.5 6.3 4.8 8.6 9.5 3.9" />
                  </svg>
                </span>
                I agree to be contacted about my request.
              </p>
              <span
                className="mt-3 block rounded-[11px] bg-indigo-600 px-3 py-2 text-center text-[11px] font-semibold text-white"
                aria-hidden="true"
              >
                Send securely
              </span>
            </div>
          </div>
        </PanelChrome>
      </div>
      <figcaption className="mx-auto mt-5 max-w-[390px] text-center text-xs leading-5 text-slate-500">
        The memory prompt and the contact form, in the widget&rsquo;s own words. The tick box is required, and the API refuses a
        submission that arrives without it.
      </figcaption>
    </figure>
  );
}
