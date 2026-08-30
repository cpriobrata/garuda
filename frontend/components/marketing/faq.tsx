import { ChevronDown } from "lucide-react";

/**
 * The objections a buyer raises before they will pay for a chat agent.
 *
 * Answered from the code rather than from marketing instinct. The full product
 * FAQ lives at /faq and goes wider; this list stays deliberately short and stays
 * on the doubts that stop a purchase.
 *
 * Built on <details>/<summary>, a disclosure widget the browser already makes
 * keyboard operable and announces correctly: no JavaScript, no dependency, and
 * it works before hydration.
 *
 * NOTE ON MEASURED NUMBERS. The "will it slow my site down" answer used to quote
 * a widget size ("about 27 KB gzipped, 106 KB uncompressed", measured 29 August
 * 2026). The bundle has since grown well past both figures and is under active
 * change, so the number was removed rather than replaced: a stale measurement on
 * a page whose whole argument is "everything here is true today" is the most
 * expensive kind of small error. app/faq/page.tsx still carries the same stale
 * "about 27 KB" sentence and needs the same treatment.
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
    question: "Will it work on my website, and is it hard to install?",
    answer:
      "It is one script tag before the closing body tag, on any site where you can add one line of HTML. The portal gives you the tag already filled in with your agent's key, plus step-by-step guides for Webflow, WordPress, Shopify and Framer — including the honest caveats, such as Shopify theme code not running on checkout pages and Webflow serving site-wide custom code only on paid plans. You also list the domains the agent may load on, so the tag does nothing if it is copied onto a site that is not yours.",
  },
  {
    question: "Will it slow my website down?",
    answer:
      "The snippet is a single async script tag, so it never blocks your page from parsing or rendering. It is served with a five-minute public cache header, and it loads no third-party scripts and no web fonts — the only network requests it makes are to the Garuda API. It renders inside a Shadow DOM whose host style starts at all:initial, so your CSS and its CSS cannot collide in either direction.",
  },
  {
    question: "How long does setup actually take?",
    answer:
      "There is no benchmark worth quoting, so here is the honest shape of the work. Four questions produce a draft agent. Reviewing and editing that draft is the part that deserves your attention. Then you give it the knowledge it may answer from — import it from a page on your own website, or paste the text in, up to five sources per agent and 100,000 characters each — and list the domains it is allowed to load on. Publishing itself is copying one line into your site. The slow parts are the ones only you can do: deciding what is true, and what may be said.",
  },
  {
    question: "Is there a free trial, and what happens after I pay?",
    answer:
      "There is no free trial, and we would rather you read that here than discover it at the checkout. The order is: create an account, confirm your email address, pay the first $17 on Stripe's own hosted checkout, and then answer the four questions that draft your agent. Nothing appears on your website until you publish it yourself, so the first month buys you the whole build and review, not just a look at it.",
  },
  {
    question: "Can I cancel?",
    answer:
      "Yes, from the billing page in your workspace, which opens the Stripe billing portal — there is no minimum term and nobody to email. A cancelled subscription stays active until the end of the period you have already paid for, and the widget stops serving once the subscription is no longer active. Cancelling does not delete your agents, conversations or leads.",
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
