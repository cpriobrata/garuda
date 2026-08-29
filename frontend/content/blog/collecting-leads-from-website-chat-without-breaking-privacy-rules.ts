import type { Article } from "./types";

export const article: Article = {
  slug: "collecting-leads-from-website-chat-without-breaking-privacy-rules",
  title: "Collecting leads from website chat without breaking privacy rules",
  description:
    "Practical principles for capturing contact details in a website chat: asking properly, collecting less, recording consent, setting a retention period, and knowing who processes the conversation.",
  excerpt:
    "Chat blurs the line between a conversation and a data collection form. These are the principles that keep it on the right side of it — and the questions worth putting to a qualified adviser.",
  datePublished: "2026-08-30",
  dateModified: "2026-08-30",
  author: "The Garuda team",
  topic: "Privacy and consent",
  keywords: [
    "chat lead capture consent",
    "website chat privacy",
    "chatbot data retention",
    "collecting contact details online",
  ],
  related: [
    "how-to-add-an-ai-chatbot-to-your-website",
    "ai-chatbot-vs-live-chat-vs-contact-form",
  ],
  blocks: [
    {
      kind: "callout",
      tone: "caution",
      title: "This is not legal advice",
      body: [
        "We are describing principles that show up consistently in data protection regimes and in the practices of well-run businesses. What applies to you depends on where you are, where your visitors are, and what you do with the data. For anything consequential, ask a qualified adviser and check your own regulator’s guidance.",
      ],
    },
    {
      kind: "p",
      text: [
        "A contact form is obviously a data collection form. Everybody understands what pressing submit means. Chat is slipperier: it feels like a conversation, and somewhere in the middle of it a name and an email address get typed. The interaction feels casual. The obligations are not.",
      ],
    },
    {
      kind: "p",
      text: [
        "The good news is that the principles are short and mostly common sense. The awkward news is that a chatbot makes it very easy to collect more than you meant to, from more people than you expected, and to keep it forever without deciding to.",
      ],
    },

    { kind: "h2", id: "three-things", text: "Three different things people run together" },
    {
      kind: "p",
      text: [
        "Almost every muddle in this area comes from treating these as one question. They are separate, and each has its own answer.",
      ],
    },
    {
      kind: "ol",
      items: [
        [
          { kind: "strong", text: "Storing something on the visitor’s device." },
          " Remembering who someone is between visits means writing an identifier into their browser. In several jurisdictions storing or reading information on someone’s device has its own consent rules, distinct from anything about personal data. The UK regulator’s ",
          {
            kind: "link",
            text: "guidance on storage and access technologies",
            href: "https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-cookies-and-similar-technologies/",
          },
          " is a readable starting point if your visitors are in the UK.",
        ],
        [
          { kind: "strong", text: "Collecting contact details in the conversation." },
          " A name, an email address, a phone number. This is personal data and needs a reason and a basis for holding it.",
        ],
        [
          { kind: "strong", text: "Using those details later to market to someone." },
          " Usually the most tightly regulated of the three, and the one businesses assume is included when it is not.",
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "Somebody telling your chatbot their email address so you can answer a question has not agreed to a newsletter. Treating that as a list signup is the mistake that generates complaints.",
      ],
    },

    { kind: "h2", id: "ask-dont-harvest", text: "Principle 1: ask, do not harvest" },
    {
      kind: "p",
      text: [
        "The chat transcript is not consent. Somebody typing “you can reach me at sam@example.com” in the middle of a sentence has given you an address to reply to, not permission to add them to a database and call them next Tuesday.",
      ],
    },
    {
      kind: "p",
      text: [
        "The clean pattern is an explicit, unmissable moment: the bot asks, the visitor agrees, and only then is anything stored as a lead. In practice that means a distinct step with a clear affirmative action — a box that starts unticked, a button that says what it does — rather than a line of small print under a text field.",
      ],
    },
    {
      kind: "p",
      text: [
        "It is also better sales practice. A contact detail given deliberately, in answer to a question, is worth considerably more than one scraped out of the middle of a conversation.",
      ],
    },
    {
      kind: "p",
      text: [
        "This is how Garuda works: contact details are only stored after the visitor explicitly agrees, and a submission without that agreement is refused by the API rather than merely discouraged in the interface.",
      ],
    },

    { kind: "h2", id: "collect-less", text: "Principle 2: collect noticeably less than you want to" },
    {
      kind: "p",
      text: [
        "Chat makes it tempting to ask one more question while you have somebody’s attention. Company size, budget, timeline, job title, phone number as well as email. Resist it, for three reasons.",
      ],
    },
    {
      kind: "ul",
      items: [
        [
          "Data you did not collect cannot leak, cannot be requested back, and does not need deleting.",
        ],
        [
          "Every extra field lowers completion. The form that asks for a name and an email gets filled in; the one that asks for seven things gets abandoned.",
        ],
        [
          "Collecting information you have no immediate use for is hard to justify if anybody ever asks you why you hold it.",
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "A useful test: for every field, name the thing you will do differently tomorrow because you have it. If you cannot, drop the field. Most businesses need a name, one way to reply, and a sentence about what the person wants.",
      ],
    },

    { kind: "h2", id: "say-what-happens", text: "Principle 3: say what happens next, at the moment you ask" },
    {
      kind: "p",
      text: [
        "One sentence, in the chat, in plain words, before the visitor types anything: who gets it, what it will be used for, and roughly when they will hear back. Not a link to four thousand words of policy. The link should be there as well, but the sentence is what people actually read.",
      ],
    },
    {
      kind: "p",
      text: [
        "“We will use this to reply to your question about installation, usually within one working day. We will not add you to any mailing list.” If that sentence is uncomfortable to write, that discomfort is telling you something about what you were planning to do.",
      ],
    },

    { kind: "h2", id: "record-consent", text: "Principle 4: record the consent, not just the result" },
    {
      kind: "p",
      text: [
        "If somebody asks in six months why you hold their details, “they agreed” is much stronger with evidence attached. Store, alongside the lead itself:",
      ],
    },
    {
      kind: "ul",
      items: [
        [{ kind: "strong", text: "When" }, " they agreed — a timestamp."],
        [
          { kind: "strong", text: "What" },
          " they agreed to — a version identifier for the exact wording shown, so you can reconstruct it after you have changed the copy.",
        ],
        [
          { kind: "strong", text: "Where" },
          " it happened — the page, and the conversation it came from.",
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "The version identifier is the one people skip and later wish they had. Consent wording gets edited; a record that says “agreed” without saying agreed to what is not much of a record.",
      ],
    },
    {
      kind: "p",
      text: [
        "Garuda keeps this with the lead: the consent flag, the notice version, the moment of consent, and the conversation the lead came from, so the transcript and the permission live together rather than in two systems.",
      ],
    },

    { kind: "h2", id: "retention", text: "Principle 5: decide a retention period before you launch" },
    {
      kind: "p",
      text: [
        "“Keep everything forever” is a decision, just an unexamined one. Keeping personal data only as long as you actually need it is one of the most consistent themes across data protection regimes, and it is also straightforwardly good hygiene: a five-year-old lead is not a sales opportunity, it is a liability with an email address attached.",
      ],
    },
    {
      kind: "p",
      text: [
        "Pick a number you can defend, write it in your privacy notice, and put a recurring reminder in the calendar to actually do the deletion. Different categories can have different periods — an enquiry that went nowhere does not need the same retention as a customer record.",
      ],
    },
    {
      kind: "callout",
      tone: "note",
      title: "Plan limits are not a retention policy",
      body: [
        "Software limits and retention rules are different things and it is worth not confusing them. Garuda’s starter plan counts conversations on a rolling 30-day window, and a returning visitor’s remembered session resumes only within that window. Neither of those is a promise that data is deleted on a schedule. Your retention policy is something you decide and carry out; check what your vendor actually does rather than assuming a limit implies erasure.",
      ],
    },

    { kind: "h2", id: "device-storage", text: "Principle 6: be careful about what you leave in the browser" },
    {
      kind: "p",
      text: [
        "Recognising a returning visitor requires storing something on their device. There is a meaningful difference between two ways of doing that:",
      ],
    },
    {
      kind: "ul",
      items: [
        [
          { kind: "strong", text: "A site-specific, opaque token" },
          " that means nothing anywhere else and lets one chat agent resume one conversation.",
        ],
        [
          { kind: "strong", text: "A cross-site identifier" },
          " that follows the same person between unrelated websites and builds a profile.",
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "The second is what most people are actually objecting to when they object to tracking. Garuda uses the first: an opaque token scoped to a single agent, stored on your own domain, with no cross-site identifier. Before anything is stored the widget asks — remember this chat on this browser, or use it once — and “use once” clears what was there.",
      ],
    },
    {
      kind: "p",
      text: [
        "Whatever tool you use, find out which of those two it does. It is a fair question to put to a vendor and the answer should be immediate.",
      ],
    },

    { kind: "h2", id: "sensitive", text: "Principle 7: keep sensitive information out of the chat entirely" },
    {
      kind: "p",
      text: [
        "People will type things into a chat box that they would never put in a form. Card numbers, medical details, identity document numbers, occasionally a password. A chat widget is the wrong place for all of it, and once it is in a transcript it is your problem.",
      ],
    },
    {
      kind: "p",
      text: [
        "Put an explicit instruction in your agent: never ask for payment details, health information, government identifiers or passwords, and if a visitor starts to share them, stop them and give a secure route instead. Then check that it actually behaves that way, because this is one worth testing rather than assuming.",
      ],
    },

    { kind: "h2", id: "requests", text: "Principle 8: know how you would answer a request" },
    {
      kind: "p",
      text: [
        "Sooner or later somebody asks what you hold about them, or asks you to delete it. You do not need an elaborate process, but you do need to be able to answer three questions without a panic:",
      ],
    },
    {
      kind: "ol",
      items: [
        ["Where does chat data live — which systems, which vendors?"],
        ["How would you find every record relating to one person?"],
        ["Who in your business handles the request, and how fast?"],
      ],
    },
    {
      kind: "p",
      text: [
        "Working that out takes an hour while things are calm, and is unpleasant to work out for the first time under a deadline.",
      ],
    },

    { kind: "h2", id: "processors", text: "Principle 9: know who else sees the conversation" },
    {
      kind: "p",
      text: [
        "An AI chatbot is not a closed box on your server. The visitor’s message typically travels to the chatbot vendor, and from there to whichever model provider generates the reply. Both are handling text your customer wrote.",
      ],
    },
    {
      kind: "p",
      text: [
        "You should be able to name them, and they should appear in your privacy notice. Ask your vendor plainly: which model provider do you use, where is the data processed, and is anything used to train models? A vendor that cannot answer that clearly is a vendor you do not know enough about.",
      ],
    },
    {
      kind: "p",
      text: [
        "For the record: Garuda generates replies using Google’s Gemini models through their OpenAI-compatible API.",
      ],
    },

    { kind: "h2", id: "checklist", text: "A pre-launch checklist" },
    {
      kind: "p",
      text: ["Ten minutes with this before you go live is worth a great deal afterwards."],
    },
    {
      kind: "ol",
      items: [
        ["The bot asks before it stores contact details, with a clear affirmative action."],
        ["It says in one sentence what the details will be used for."],
        ["You collect a name, one contact route, and the enquiry — and nothing you cannot justify."],
        ["Consent is recorded with a timestamp and a version of the wording shown."],
        ["You have written down a retention period and put the deletion in the calendar."],
        ["Your privacy notice mentions the chat, and the link is reachable from the widget."],
        ["The agent is instructed to refuse payment, health and identity details."],
        ["You know what the widget stores in the visitor’s browser and whether it asks first."],
        ["You can name every company that processes the conversation."],
        ["Somebody in the business owns requests about data, and knows where to look."],
      ],
    },
    {
      kind: "p",
      text: [
        "None of this is exotic. It comes down to four habits: ask properly, collect less than you would like, write down what you promised, and delete on a schedule you chose in advance. Businesses that do those four rarely have a problem here. Businesses that do none of them usually find out the hard way.",
      ],
    },
  ],
};
