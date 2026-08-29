import type { Article } from "./types";

export const article: Article = {
  slug: "ai-chatbot-vs-live-chat-vs-contact-form",
  title: "AI chatbot vs live chat vs contact form",
  description:
    "An even-handed comparison of the three ways a small business can take enquiries from its website, including a side-by-side table and the cases where an AI chatbot is the wrong choice.",
  excerpt:
    "These are three different jobs, not three grades of the same product. Here is what each one is genuinely good at, what it costs you in attention, and when a chatbot is the wrong answer.",
  datePublished: "2026-08-30",
  dateModified: "2026-08-30",
  author: "The Garuda team",
  topic: "Choosing a tool",
  keywords: [
    "ai chatbot vs live chat",
    "chatbot vs contact form",
    "website enquiry options",
    "when not to use a chatbot",
  ],
  related: [
    "how-to-add-an-ai-chatbot-to-your-website",
    "collecting-leads-from-website-chat-without-breaking-privacy-rules",
  ],
  blocks: [
    {
      kind: "p",
      text: [
        "A contact form, live chat and an AI chatbot get compared as if they were three price tiers of the same thing. They are not. They differ in who does the answering, how long the visitor waits, and what it costs you in attention rather than money — and attention is the scarce resource in a small business.",
      ],
    },
    {
      kind: "p",
      text: [
        "Below is the comparison, then the part most vendor pages leave out: the situations where an AI chatbot is actively the wrong choice.",
      ],
    },

    { kind: "h2", id: "side-by-side", text: "The three side by side" },
    {
      kind: "table",
      caption: "Contact form, live chat and AI chatbot compared across the things that actually decide the choice.",
      columns: ["", "Contact form", "Live chat", "AI chatbot"],
      rows: [
        {
          header: "Who answers",
          cells: [["You, later"], ["A person, now"], ["Software, now"]],
        },
        {
          header: "Visitor waits",
          cells: [
            ["Hours to days"],
            ["Seconds — if somebody is at the desk"],
            ["Seconds, always"],
          ],
        },
        {
          header: "Covers out of hours",
          cells: [
            ["Yes, but the reply is not"],
            ["No, unless you staff it"],
            ["Yes"],
          ],
        },
        {
          header: "Cost that matters",
          cells: [
            ["Almost none"],
            ["A person’s attention, all day"],
            ["Subscription, plus your time writing and maintaining its answers"],
          ],
        },
        {
          header: "Best at",
          cells: [
            ["Considered enquiries where a slow, thorough reply is fine"],
            ["Nuance, negotiation, reassurance, complaints"],
            ["Repetitive questions that have a documented answer"],
          ],
        },
        {
          header: "Falls apart when",
          cells: [
            ["The visitor is comparing three suppliers tonight"],
            ["Volume spikes, or it is 11pm on a Sunday"],
            ["The answer is not written down anywhere"],
          ],
        },
        {
          header: "Wrong answers",
          cells: [
            ["Rare — a human wrote every word"],
            ["Occasional and correctable in the moment"],
            [
              "Possible, fluent and unsupervised. This is the real risk and it needs ",
              {
                kind: "link",
                text: "deliberate work to control",
                href: "/blog/how-to-stop-your-ai-chatbot-inventing-answers",
              },
              ".",
            ],
          ],
        },
        {
          header: "What you learn",
          cells: [
            ["Only what people bothered to type into a box"],
            ["A lot, if anyone reviews the transcripts"],
            ["Every question asked, including the ones you cannot answer yet"],
          ],
        },
        {
          header: "Setup effort",
          cells: [
            ["Minutes"],
            ["Minutes to install, then permanent"],
            ["An afternoon, then about half an hour a week for a month"],
          ],
        },
        {
          header: "Scales with traffic",
          cells: [["Your inbox does not"], ["No, linearly with staff"], ["Yes"]],
        },
      ],
    },

    { kind: "h2", id: "when-form-wins", text: "When the contact form wins" },
    {
      kind: "p",
      text: [
        "The humble form is underrated, and for a lot of businesses it is still the right answer.",
      ],
    },
    {
      kind: "ul",
      items: [
        [
          { kind: "strong", text: "Low volume." },
          " If you get five enquiries a week, no automation is going to pay for the attention it costs to maintain. Answer them yourself, quickly, and you will out-compete a competitor with a chatbot.",
        ],
        [
          { kind: "strong", text: "High-consideration purchases." },
          " Somebody choosing a wedding photographer or a structural engineer is not looking for an instant reply. They are looking for evidence of judgement. A thoughtful email the next morning is worth more than a chat response in four seconds.",
        ],
        [
          { kind: "strong", text: "Every answer is “it depends”." },
          " If you cannot quote without seeing the building, the vehicle or the accounts, an instant answer is a liability. A form that asks the right five questions is doing more work than any chat interface.",
        ],
        [
          { kind: "strong", text: "You want a durable record." },
          " Forms produce structured, consistent fields. Chat produces prose, which is richer and much harder to sort.",
        ],
      ],
    },

    { kind: "h2", id: "when-live-chat-wins", text: "When live chat wins" },
    {
      kind: "p",
      text: [
        "Live chat is the most expensive of the three, and there are cases where it is worth every penny.",
      ],
    },
    {
      kind: "ul",
      items: [
        [
          { kind: "strong", text: "The bottleneck is trust, not information." },
          " In a sale where the customer already knows the facts and is deciding whether to believe you, a person is not replaceable. Software cannot take responsibility, and taking responsibility is the product.",
        ],
        [
          { kind: "strong", text: "Complaints, cancellations and anything emotional." },
          " People who are upset get more upset when they realise they are talking to a machine. Route these to a human as fast as possible.",
        ],
        [
          { kind: "strong", text: "Order values that justify it." },
          " If one saved sale covers a week of somebody’s time, staff the chat.",
        ],
        [
          { kind: "strong", text: "You already have staff at a desk." },
          " If someone is in the shop or on reception with quiet periods, live chat is close to free capacity — as long as answering it does not make the in-person experience worse.",
        ],
      ],
    },
    {
      kind: "callout",
      tone: "caution",
      title: "Unstaffed live chat is worse than no chat",
      body: [
        "A widget that says “we typically reply in a few minutes” and then does not is a broken promise made at the exact moment someone chose to trust you. If you cannot commit to covering it, either take the availability claim off or use something that genuinely answers.",
      ],
    },

    { kind: "h2", id: "when-chatbot-wins", text: "When an AI chatbot wins" },
    {
      kind: "p",
      text: [
        "The pattern is narrower than the marketing suggests, and quite recognisable when you see it.",
      ],
    },
    {
      kind: "ul",
      items: [
        [
          { kind: "strong", text: "The same questions, over and over." },
          " If you can name the fifteen things people ask, and each has a settled answer, a chatbot handles them permanently and consistently.",
        ],
        [
          { kind: "strong", text: "Traffic outside your working hours." },
          " Look at your analytics. If a real share of visits happen in the evening or at weekends, those people currently get nothing.",
        ],
        [
          { kind: "strong", text: "A lot of information across a lot of pages." },
          " When the answer exists but is three clicks deep, a chatbot is a faster route than your navigation.",
        ],
        [
          { kind: "strong", text: "Enquiries that need qualifying before a human is worth involving." },
          " Working out what someone needs and whether you can help is exactly the kind of structured conversation software is good at.",
        ],
      ],
    },

    { kind: "h2", id: "when-chatbot-is-wrong", text: "When an AI chatbot is the wrong choice" },
    {
      kind: "p",
      text: [
        "This is the section worth reading twice, because the cost of getting it wrong lands on your customers rather than on your software bill.",
      ],
    },
    {
      kind: "steps",
      items: [
        {
          title: "You have not written your answers down",
          body: [
            "A chatbot with nothing behind it does not become vague. It becomes confidently wrong, because producing fluent text is the one thing it is guaranteed to do. If you are not prepared to write and maintain the source material, do not launch one.",
          ],
        },
        {
          title: "The stakes of a wrong answer are high",
          body: [
            "Medical, legal, financial, immigration, safety-critical: anywhere a plausible-but-wrong answer causes real harm, or where what you say is regulated, a chatbot should be doing signposting at most. “Here is who to speak to and how to reach them” is a legitimate and useful job. Giving the advice itself is not.",
          ],
        },
        {
          title: "The visitor is already unhappy",
          body: [
            "Complaints, refunds, cancellations, anything that has gone wrong. A machine that cannot make an exception is the wrong thing to meet at that moment, and people can tell.",
          ],
        },
        {
          title: "Your traffic is too low to learn from",
          body: [
            "A chatbot improves because you read its conversations and fix what it got wrong. With a couple of conversations a week you will never see enough to tune it, and you will have added a maintenance job for nothing.",
          ],
        },
        {
          title: "Nobody will own it",
          body: [
            "It needs a person who reads transcripts, updates sources when prices change, and follows up leads. If that person does not exist, the chatbot degrades quietly into a machine that repeats last year’s prices to your customers.",
          ],
        },
        {
          title: "You need a guarantee, not a probability",
          body: [
            "If a specific sentence must appear, exactly, every single time — a legal notice, a safety warning, an eligibility rule — put it on the page in fixed text. A generated answer is a very good approximation, and an approximation is not what you want there.",
          ],
        },
      ],
    },

    { kind: "h2", id: "hybrid", text: "The answer is usually two of them" },
    {
      kind: "p",
      text: [
        "Framing this as a single choice is what makes it hard. Most small businesses end up with a sensible layering:",
      ],
    },
    {
      kind: "ul",
      items: [
        [
          "The chatbot handles the settled, repetitive questions and works at 11pm.",
        ],
        [
          "When it does not know, or the person asks for a human, it collects contact details with consent and hands over — which is the contact form, just gathered conversationally and with context attached.",
        ],
        [
          "A person picks it up in the morning with a transcript that already explains what the customer wants.",
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "That layering is also the honest reason to use a chatbot at all. It is not that software answers better than you do. It is that it answers at 11pm, and it makes sure the enquiry still exists in the morning.",
      ],
    },

    { kind: "h2", id: "how-to-decide", text: "A short way to decide" },
    {
      kind: "p",
      text: ["Four questions, answered honestly:"],
    },
    {
      kind: "ol",
      items: [
        [
          "Can you write down the fifteen questions you get most, with real answers, this week? ",
          { kind: "em", text: "No — start with a contact form." },
        ],
        [
          "Does a wrong answer cost someone money, health or legal standing? ",
          { kind: "em", text: "Yes — a human, or a chatbot restricted to signposting." },
        ],
        [
          "Is there somebody who will read the transcripts every week for a month? ",
          { kind: "em", text: "No — start with a contact form." },
        ],
        [
          "Do you get meaningful traffic when nobody is available to reply? ",
          { kind: "em", text: "Yes — a chatbot is likely to pay for itself." },
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "Whichever you choose, decide before you start how you will tell whether it worked. Not “number of conversations”, which always goes up. Something like: how many enquiries arrived with enough detail to act on without a follow-up email, and how many of the questions you used to answer by hand stopped reaching you.",
      ],
    },
    {
      kind: "callout",
      tone: "note",
      title: "Where Garuda sits",
      body: [
        "Garuda is the third column: an AI chat agent grounded in knowledge sources you approve, which asks before it collects contact details and stores the lead alongside its conversation. It is a good fit for the pattern above and a poor fit for the six cases in the previous section. We would rather say that than sell you something that makes your customers’ experience worse.",
      ],
    },
  ],
};
