import type { Article } from "./types";

export const article: Article = {
  slug: "how-to-add-an-ai-chatbot-to-your-website",
  title: "How to add an AI chatbot to your website",
  description:
    "A practical guide to putting an AI chatbot on a small-business website: what to prepare first, how the embed snippet works, how to test it before launch, and the failures that catch people out.",
  excerpt:
    "Installing the chatbot takes about ten minutes. Almost everything that makes it useful happens before and after that. This is the honest version of the work.",
  datePublished: "2026-08-30",
  dateModified: "2026-08-30",
  author: "The Garuda team",
  topic: "Getting started",
  keywords: [
    "add ai chatbot to website",
    "install website chatbot",
    "chatbot embed code",
    "small business chatbot setup",
  ],
  related: [
    "ai-chatbot-vs-live-chat-vs-contact-form",
    "how-to-stop-your-ai-chatbot-inventing-answers",
  ],
  blocks: [
    {
      kind: "p",
      text: [
        "Search for this and you will mostly find installation instructions. Paste a script, pick a colour, done. That part is real, and on most platforms it genuinely does take ten minutes. It is also the least important part of the job.",
      ],
    },
    {
      kind: "p",
      text: [
        "A chatbot is a promise to answer questions in public, instantly, in your company’s name, without you in the room. The work is deciding what it is allowed to promise, writing down the answers it will draw on, and checking how it behaves before a customer meets it. The script tag is the easy bit at the end.",
      ],
    },
    {
      kind: "p",
      text: [
        "Here is the whole sequence, including the parts that are tedious and the parts that go wrong.",
      ],
    },

    { kind: "h2", id: "decide-the-job", text: "Step 1: decide the one job it does" },
    {
      kind: "p",
      text: [
        "The most common way to waste a month is to launch a chatbot that is vaguely supposed to help. Pick one job and write it in a sentence you could read aloud to a member of staff.",
      ],
    },
    {
      kind: "ul",
      items: [
        [
          { kind: "strong", text: "Answer the questions you keep answering." },
          " Opening hours, delivery areas, what is included in a price, whether you take a particular payment method, whether you cover a particular postcode.",
        ],
        [
          { kind: "strong", text: "Qualify enquiries before a human sees them." },
          " Find out what someone actually needs, then hand a summary and contact details to whoever follows up, rather than a bare name in an inbox.",
        ],
        [
          { kind: "strong", text: "Get people to the right page." },
          " On a site with a hundred pages, a chatbot is often a better search box than the search box.",
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "You can add the others later. Starting with all three means you cannot tell whether it is working, because you never decided what working looks like.",
      ],
    },
    {
      kind: "callout",
      tone: "tip",
      title: "The single most useful hour of preparation",
      body: [
        "Open your inbox and your call log and write down the last twenty questions a customer actually asked, in their words rather than yours. That list is your specification, your knowledge sources and your test script, all at once. Almost nobody does it, and it is most of the difference between a chatbot that helps and one that produces confident noise.",
      ],
    },

    { kind: "h2", id: "gather-answers", text: "Step 2: write the answers down before you pick a tool" },
    {
      kind: "p",
      text: [
        "A modern chatbot does not deduce your business from thin air. It answers from material you give it: a description of what you do, your policies, your prices, your service area. Tools differ in what they call this — knowledge base, sources, training data, context. The idea is the same everywhere. The bot is only as good as the text behind it.",
      ],
    },
    {
      kind: "p",
      text: [
        "Good source material looks less like a brochure and more like a set of answers. Compare two ways of saying the same thing:",
      ],
    },
    {
      kind: "ul",
      items: [
        [
          { kind: "em", text: "Brochure: " },
          "“We pride ourselves on rapid, reliable delivery across the region.”",
        ],
        [
          { kind: "em", text: "Answer: " },
          "“We deliver to postcodes beginning SW, SE and CR. Orders placed before 2pm go out the same working day. We do not deliver on Sundays or bank holidays.”",
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "The second is duller and enormously more useful, because it contains the exceptions, and the exceptions are what people ask about. Write the negative space as well: what you do not do, where you do not go, what you will not quote for over chat.",
      ],
    },
    {
      kind: "p",
      text: [
        "Split it into a handful of short documents by topic rather than one long page. One on delivery, one on returns, one on pricing, one on what you actually sell. Retrieval works better on focused documents, and when your delivery policy changes you replace one file instead of hunting through a wall of text. Most tools cap how many sources you can attach to a single bot — Garuda allows five per agent — which is usually enough if each one is doing a real job.",
      ],
    },

    { kind: "h2", id: "install", text: "Step 3: install it" },
    {
      kind: "p",
      text: [
        "Hosted chatbots are almost always a single script tag you add once to your site. It loads asynchronously, draws its own interface, and talks to the vendor’s API. A Garuda embed looks like this:",
      ],
    },
    {
      kind: "code",
      label: "The embed snippet",
      code: '<script async\n  src="https://api.garuda.ravan.ai/widget.js"\n  data-agent-key="pub_your_agent_key">\n</script>',
    },
    {
      kind: "p",
      text: [
        "Two things about that line are worth understanding, because they are true of most vendors and they explain several of the problems further down.",
      ],
    },
    {
      kind: "ul",
      items: [
        [
          { kind: "code", text: "async" },
          " means the browser carries on rendering your page while the script downloads. A chat widget should never be able to hold up your content. If a vendor’s snippet is neither async nor deferred, ask why.",
        ],
        [
          "The agent key is ",
          { kind: "strong", text: "public" },
          ". It sits in your page source where anyone can read it. It is an identifier, not a password — which is exactly why step 4 matters.",
        ],
      ],
    },
    { kind: "h3", text: "Where the snippet goes" },
    {
      kind: "p",
      text: [
        "It belongs just before the closing body tag, on every page you want the widget to appear on. How you get it there depends on your platform, and the exact wording moves around between versions, so look for a setting named something along the lines of custom code, code injection, footer scripts or third-party scripts. Most site builders have one. If yours offers a header field and a footer field, use the footer field.",
      ],
    },
    {
      kind: "p",
      text: [
        "If your site is hand-built or uses a framework, put it in the shared layout so it renders everywhere, rather than pasting it into individual templates and forgetting three of them.",
      ],
    },
    {
      kind: "callout",
      tone: "caution",
      title: "Check it against your content security policy",
      body: [
        "If your site sends a Content-Security-Policy header, a third-party script is blocked unless its origin is explicitly allowed. The symptom is a widget that works perfectly in the vendor’s preview and is invisible on your live site, with an error in the browser console that nobody thinks to open. This catches out a surprising number of otherwise careful launches.",
      ],
    },

    { kind: "h2", id: "restrict-domains", text: "Step 4: restrict it to your own domains" },
    {
      kind: "p",
      text: [
        "Because the agent key is public, anybody who views your page source can paste your snippet onto their own site and run a chatbot that answers as your business, using your knowledge, on your bill. The fix is a list of approved domains held by the vendor and checked on every request.",
      ],
    },
    {
      kind: "p",
      text: [
        "In Garuda that is the allowed-domains list on the agent: a widget request arriving from an origin you have not approved is refused before a session is created. Whatever tool you use, find this setting before launch and put your real domain in it. Add the www and non-www forms if both resolve, and add your staging domain if you test there.",
      ],
    },

    { kind: "h2", id: "test-before-launch", text: "Step 5: test it properly, which takes about an hour" },
    {
      kind: "p",
      text: [
        "Take the twenty questions from step 1 and ask them one at a time, exactly as a customer typed them — including the typos and the one-word ones. Then deliberately add questions in these five categories.",
      ],
    },
    {
      kind: "ol",
      items: [
        [
          { kind: "strong", text: "Things you never wrote down." },
          " “Do you offer a student discount?” when you have no student discount policy. The right answer is a clean admission that it does not know, plus an offer to pass the question on. A confident invented answer here is the failure that costs you money.",
        ],
        [
          { kind: "strong", text: "Price." },
          " Ask for a discount. Ask whether you will match a competitor. Watch whether the bot starts negotiating on your behalf.",
        ],
        [
          { kind: "strong", text: "Commitments." },
          " “Can you get it here by Thursday?” A chatbot should not promise a delivery date it has no way to verify.",
        ],
        [
          { kind: "strong", text: "Off-topic and adversarial." },
          " Ask it to write a poem. Ask about a competitor. Tell it to ignore its instructions. You are checking that it stays in role and does not turn into a free general-purpose assistant funded by you.",
        ],
        [
          { kind: "strong", text: "The handover." },
          " Type “I want to speak to a person” and make sure something useful happens.",
        ],
      ],
    },
    {
      kind: "p",
      text: [
        "Then test the interface, not just the answers. Open it on a real phone rather than a resized browser window: check that the on-screen keyboard does not cover the text box, and that the launcher button does not land on top of your cookie banner or your basket button. Tab through it with the keyboard and confirm you can reach the input, send a message and close the panel without a mouse. The ",
        {
          kind: "link",
          text: "W3C Web Content Accessibility Guidelines",
          href: "https://www.w3.org/TR/WCAG22/",
        },
        " set out what “usable without a mouse” actually requires, and a floating chat panel is one of the easiest things on a site to get wrong.",
      ],
    },
    {
      kind: "p",
      text: [
        "One more check people skip: turn on your operating system’s reduce-motion setting and reopen the widget. Anything that slides, bounces or pulses should calm down. The ",
        {
          kind: "link",
          text: "prefers-reduced-motion",
          href: "https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion",
        },
        " signal has been supported by browsers for years, and a widget that ignores it is a widget that makes some of your visitors feel unwell.",
      ],
    },

    { kind: "h2", id: "what-goes-wrong", text: "What usually goes wrong" },
    {
      kind: "p",
      text: ["In rough order of how often it happens and how much it costs:"],
    },
    {
      kind: "steps",
      items: [
        {
          title: "It answers confidently when it should not",
          body: [
            "The expensive one, because the customer believes it. This is a content problem far more than a technology problem, and it has its own guide: ",
            {
              kind: "link",
              text: "how to stop your AI chatbot inventing answers",
              href: "/blog/how-to-stop-your-ai-chatbot-inventing-answers",
            },
            ".",
          ],
        },
        {
          title: "Nobody reads the transcripts",
          body: [
            "The conversations are the best customer research you will get all year, and after week two most owners stop looking at them. Put a recurring fifteen minutes in the calendar. Every question the bot fumbled is a source you have not written yet.",
          ],
        },
        {
          title: "Leads arrive and sit there",
          body: [
            "A chatbot that collects contact details is only worth having if somebody follows up. Decide who, and how fast, before you launch. Same-day and same-week are different businesses.",
          ],
        },
        {
          title: "It gets in the way",
          body: [
            "A panel that opens by itself and covers the page on a phone annoys more people than it helps. Let the launcher sit quietly and let visitors choose.",
          ],
        },
        {
          title: "It quietly stops working",
          body: [
            "A redesign drops the snippet, a plan limit is reached, a domain is renamed. Nothing alerts you, because a missing chat widget looks exactly like a page that never had one. Load your own site once a week and say hello to your own bot.",
          ],
        },
      ],
    },

    { kind: "h2", id: "first-month", text: "The first month" },
    {
      kind: "p",
      text: [
        "Plan for roughly half an hour a week for the first four weeks. Read every conversation while there are still few enough to read. You are looking for three things: questions with no answer behind them, answers that have gone out of date, and the moment where the visitor gave up. Each one turns into a small edit.",
      ],
    },
    {
      kind: "p",
      text: [
        "After about a month the flow of genuinely new question types drops sharply, because most businesses really are asked the same fifteen things. That is the point where the thing starts saving you time rather than costing it.",
      ],
    },
    {
      kind: "p",
      text: [
        "Decide up front how you will judge it, too. Number of chats is a vanity metric. Better questions: how many enquiries reached you with enough detail to act on without a follow-up email, and how many of the questions you used to answer by hand have stopped arriving.",
      ],
    },

    { kind: "h2", id: "should-you", text: "Should you add one at all?" },
    {
      kind: "p",
      text: [
        "Sometimes the answer is no, and it is worth saying so plainly. If your site gets a handful of visitors a week, if every enquiry genuinely needs a human to scope it, or if you have not written any of your answers down yet, a well-placed contact form and a fast reply will beat a chatbot comfortably. We have written an even-handed comparison of ",
        {
          kind: "link",
          text: "an AI chatbot against live chat and a contact form",
          href: "/blog/ai-chatbot-vs-live-chat-vs-contact-form",
        },
        ", including the cases where a chatbot is the wrong tool.",
      ],
    },
    {
      kind: "p",
      text: [
        "If you do go ahead: pick one job, write the answers down, restrict the embed to your domains, test with real questions including the unanswerable ones, and read the transcripts for a month. That order matters more than which vendor you choose.",
      ],
    },
    {
      kind: "callout",
      tone: "note",
      title: "How this works in Garuda",
      body: [
        "Garuda asks you a few questions about your business, drafts an agent from your answers, and waits for you to edit and explicitly publish it before anything goes live. You add your approved knowledge sources, test the draft privately against them, then copy one script tag and set the domains the widget is allowed to run on. It is $17 a month.",
      ],
    },
  ],
};
