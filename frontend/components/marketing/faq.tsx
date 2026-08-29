import { ChevronDown } from "lucide-react";

/**
 * The six objections a buyer raises before they will pay for a chat agent.
 *
 * Answered from the code rather than from marketing instinct. The full product
 * FAQ lives at /faq and goes wider; this list stays deliberately short and stays
 * on the doubts that stop a purchase.
 *
 * Built on <details>/<summary>, a disclosure widget the browser already makes
 * keyboard operable and announces correctly: no JavaScript, no dependency, and
 * it works before hydration.
 */

export type FaqItem = { question: string; answer: string };

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "How accurate is it, and what stops it inventing things?",
    answer:
      "Two mechanisms, both already in the product. The agent Garuda drafts is instructed to use only the supplied business knowledge and the conversation, to say so when information is missing, and never to make up prices, availability, policies, guarantees or legal claims. Separately, passages retrieved from your sources are inserted into the prompt labelled as untrusted reference data rather than as instructions, so a document you paste in cannot quietly rewrite how your agent behaves. That reduces invention; it does not abolish it. Any AI assistant can still be wrong, which is why you read the draft, test it privately, and choose when to publish.",
  },
  {
    question: "What happens when it does not know the answer?",
    answer:
      "It says so, and offers a person instead. That behaviour is written into the instructions Garuda drafts for every agent: when information is missing, say so and offer a human follow-up. The visitor can then ask to be contacted, which is the moment the consent-based contact form appears.",
  },
  {
    question: "What do you collect about my website visitors?",
    answer:
      "The conversation, the page the chat started on, and contact details only when a visitor fills in the form and ticks the consent box. Visitors are identified by an opaque token that is HMAC-scoped to a single agent, so the same person on two Garuda-powered sites produces two unrelated identifiers. There is no cross-site identifier and no third-party tracking cookie. A first-time visitor is asked whether the assistant may remember the chat on that browser; choose “Use once” and no visitor token is stored at all.",
  },
  {
    question: "Will it slow my website down?",
    answer:
      "The snippet is a single async script tag, so it never blocks your page from parsing or rendering. Measured against api.garuda.ravan.ai on 29 August 2026, the widget is about 20 KB gzipped (81 KB uncompressed) and is served with a five-minute public cache header. It renders inside a Shadow DOM whose host style starts at all:initial, so your CSS and its CSS cannot collide in either direction.",
  },
  {
    question: "How long does setup actually take?",
    answer:
      "There is no benchmark worth quoting, so here is the honest shape of the work. Four questions produce a draft agent. Reviewing and editing that draft is the part that deserves your attention. Then you paste in the knowledge it may answer from — up to five sources per agent, up to 100,000 characters each — and list the domains it is allowed to load on. Publishing itself is copying one line into your site. The slow parts are the ones only you can do: deciding what is true, and what may be said.",
  },
  {
    question: "Can I cancel?",
    answer:
      "Yes. Billing runs through Stripe, and cancellation is done from the Stripe billing portal linked in your workspace. A cancelled subscription stays active until the end of the period you have already paid for, and the widget stops serving once the subscription is no longer active.",
  },
];

export function Faq({ items = FAQ_ITEMS }: { items?: FaqItem[] }) {
  return (
    <div className="mx-auto mt-12 max-w-3xl divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-soft">
      {items.map((item) => (
        <details key={item.question} className="group px-5 sm:px-7">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded py-5 text-left text-[15px] font-semibold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
            {item.question}
            <ChevronDown
              className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <p className="pb-6 pr-6 text-sm leading-7 text-slate-600">{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
