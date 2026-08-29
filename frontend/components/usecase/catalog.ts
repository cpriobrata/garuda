/**
 * The catalogue of industry and use-case pages.
 *
 * One list, used by the two hub pages, by the cross-links at the foot of every
 * page, and by the breadcrumbs. Adding a page means adding an entry here and a
 * route; nothing else has to be kept in sync by hand.
 */
export type LandingKind = "industry" | "use-case";

export type LandingPage = {
  href: string;
  kind: LandingKind;
  /** Short label, used in breadcrumbs and cross-links. */
  label: string;
  /** The promise of the page, in one sentence, for hub cards and link text. */
  summary: string;
};

export const LANDING_PAGES: LandingPage[] = [
  {
    href: "/for/real-estate",
    kind: "industry",
    label: "Real estate",
    summary:
      "Answer listing questions on the listing page, and receive an enquiry with the property reference, the budget and the viewing window already attached.",
  },
  {
    href: "/for/home-services",
    kind: "industry",
    label: "Home services",
    summary:
      "Roofing, plumbing and HVAC: qualify the service area, the job and the urgency before anyone picks up the phone — without quoting a price you have not seen.",
  },
  {
    href: "/for/professional-services",
    kind: "industry",
    label: "Professional services",
    summary:
      "Legal, accounting and consulting: answer about the firm, decline to advise on the visitor’s own matter, and collect what a conflict check actually needs.",
  },
  {
    href: "/for/healthcare-clinics",
    kind: "industry",
    label: "Healthcare clinics",
    summary:
      "Front-desk administration only. No medical advice, no diagnosis, no triage, and no health records — stated on the page and written into the agent.",
  },
  {
    href: "/use-cases/after-hours-lead-capture",
    kind: "use-case",
    label: "Capturing leads after hours",
    summary:
      "What a 1am enquiry should turn into by morning, how to configure the handover, and exactly where the lead lands when nobody is awake.",
  },
  {
    href: "/use-cases/repeat-questions",
    kind: "use-case",
    label: "Answering repeat questions",
    summary:
      "Write the answer once, keep it correct, and stop a three-person team retyping the same twenty replies every week.",
  },
];

export function landingPage(href: string): LandingPage | undefined {
  return LANDING_PAGES.find((page) => page.href === href);
}

export function otherLandingPages(currentHref: string): LandingPage[] {
  return LANDING_PAGES.filter((page) => page.href !== currentHref);
}
