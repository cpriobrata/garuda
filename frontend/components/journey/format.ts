import type { JourneyDevice, JourneySource } from "@/lib/api";

// The wording of the journey lives here rather than in the component, so the
// same sentence is produced wherever a visit is shown and so each rule can be
// read on its own. Nothing in this file invents a field: every branch is driven
// by a key publicJourney actually emits.

// A duration is read, not measured. `short` is what fits in a chip; `spoken` is
// the same value written out, because "4m 20s" is read aloud as letters.
export function formatDuration(input: number): { short: string; spoken: string } {
  const seconds = Math.max(0, Math.round(Number.isFinite(input) ? input : 0));
  if (seconds < 1) return { short: "under 1s", spoken: "under a second" };
  if (seconds < 60) return { short: `${seconds}s`, spoken: `${seconds} second${seconds === 1 ? "" : "s"}` };
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return {
      short: rest ? `${minutes}m ${rest}s` : `${minutes}m`,
      spoken: `${minutes} minute${minutes === 1 ? "" : "s"}${rest ? ` ${rest} second${rest === 1 ? "" : "s"}` : ""}`,
    };
  }
  // Past an hour the exact figure stops describing a reader and starts
  // describing a tab left open, so it is rounded down to something honest.
  const hours = Math.floor(seconds / 3600);
  if (hours < 2) return { short: "over an hour", spoken: "over an hour" };
  return { short: `over ${hours}h`, spoken: `over ${hours} hours` };
}

// Go marshals an unset time.Time as year 1, which is not a moment anybody wants
// rendered. Both an unparseable and a zero value answer with empty strings so
// callers can drop the timestamp instead of printing a placeholder date.
export function formatMoment(value?: string): { short: string; full: string; iso: string } {
  const at = value ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime()) || at.getFullYear() < 2000) return { short: "", full: "", iso: "" };
  return {
    short: at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    full: at.toLocaleString(),
    // Kept apart from the display strings: <time dateTime> is machine-read and
    // wants the timestamp itself, not the reader's locale rendering of it.
    iso: at.toISOString(),
  };
}

const channelNames: Record<string, string> = {
  direct: "Direct",
  organic: "Organic search",
  paid: "Paid ad",
  social: "Social",
  email: "Email",
  referral: "Referral",
  campaign: "Campaign",
};

export function channelLabel(channel: string) {
  return channelNames[channel] || "Unrecorded";
}

// describeArrival is the headline of the timeline: one sentence a person can act
// on, assembled from the channel the server derived plus whichever of the
// campaign fields happens to be present.
export function describeArrival(source: JourneySource): string {
  const domain = source.referrer_domain?.trim();
  const campaign = source.utm_campaign?.trim();
  const via = source.utm_source?.trim();
  switch (source.channel) {
    case "paid":
      if (source.click_id_kind === "google") return "Arrived from a Google ad";
      if (source.click_id_kind === "meta") return "Arrived from a Meta ad";
      return via ? `Arrived from a paid ad on ${via}` : "Arrived from a paid ad";
    case "organic":
      return domain ? `Found this site through ${domain}` : "Arrived from a search engine";
    case "social":
      if (domain) return `Came from a link on ${domain}`;
      return via ? `Came from a link on ${via}` : "Came from a link on social";
    case "email":
      return campaign ? `Opened a link in the ${campaign} email` : "Opened a link in an email";
    case "referral":
      return domain ? `Came from a link on ${domain}` : "Came from a link on another site";
    case "campaign":
      if (campaign) return `Arrived through the ${campaign} campaign`;
      return via ? `Arrived through a ${via} campaign` : "Arrived through a tagged campaign";
    case "direct":
      return "Typed the address directly";
    default:
      return "How this visitor arrived was not recorded";
  }
}

// The campaign tags, shown only when the visit actually carried them. A marketer
// reading this wants the exact strings they set on the link, not a paraphrase.
export function campaignTags(source: JourneySource): Array<{ label: string; value: string }> {
  const fields: Array<[string, string | undefined]> = [
    ["utm_source", source.utm_source],
    ["utm_medium", source.utm_medium],
    ["utm_campaign", source.utm_campaign],
    ["utm_term", source.utm_term],
    ["utm_content", source.utm_content],
  ];
  return fields.flatMap(([label, value]) => (value?.trim() ? [{ label, value: value.trim() }] : []));
}

export function deviceLabel(device: JourneyDevice) {
  return device.form === "mobile" ? "Phone" : device.form === "tablet" ? "Tablet" : device.form === "desktop" ? "Desktop" : "Unknown";
}
