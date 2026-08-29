/**
 * The browser half of Meta conversion reporting.
 *
 * The server reports every captured lead through the Conversions API
 * (backend/internal/meta). The browser pixel reports the same lead again, and
 * the two are collapsed into one conversion by a shared `event_id`. Sending
 * both is deliberate: the pixel sees signals the server never will (the click
 * id in the URL, the browser cookie, the referrer chain) and the server sees
 * every lead the pixel loses to an ad blocker or a closed tab.
 *
 * `metaLeadEventId` is the contract between the two halves. It MUST agree with
 * `meta.EventID` in backend/internal/meta/client.go byte for byte. If it ever
 * stops agreeing, nothing errors: Meta simply counts every lead twice and the
 * ad account optimises towards a cost per lead that is half the truth. Both
 * sides pin the same literal in a test — see
 * TestEventIDIsStableAndDerivedFromTheLeadID.
 *
 * Nothing here sends a contact detail. The browser event carries the dedup id
 * and nothing else; the identifiers Meta matches on are hashed server-side,
 * where the hashing can be verified.
 */

type MetaPixelFunction = {
  (command: "init", pixelId: string): void;
  (
    command: "track",
    eventName: string,
    parameters?: Record<string, unknown>,
    options?: { eventID: string },
  ): void;
  queue?: unknown[];
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: MetaPixelFunction;
    _fbq?: MetaPixelFunction;
    doNotTrack?: string;
  }
  interface Navigator {
    /** Global Privacy Control, the successor signal to Do-Not-Track. */
    readonly globalPrivacyControl?: boolean;
    /** Internet Explorer and old Edge spelled Do-Not-Track this way. */
    readonly msDoNotTrack?: string;
  }
}

/** The DOM id of the inline pixel snippet, so it is written in exactly one place. */
export const META_PIXEL_SCRIPT_ID = "meta-pixel";

/** Meta's standard event name for a captured lead. */
export const META_LEAD_EVENT = "Lead";

/**
 * The configured pixel, or null when Meta is not configured.
 *
 * A pixel id is a decimal number. It is validated rather than trusted because
 * it is interpolated into an inline `<script>`: an environment variable that
 * could contain `</script>` would otherwise be a cross-site scripting hole with
 * a deployment step as its only gate. Anything that is not digits is treated as
 * "not configured", which fails closed.
 */
export function metaPixelId(): string | null {
  const configured = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
  if (!configured || !/^\d{5,20}$/.test(configured)) return null;
  return configured;
}

/**
 * The deduplication key for one lead.
 *
 * Deliberately the identity function on the lead id, trimmed — see the Go
 * doc comment on meta.EventID. Any cleverer derivation has to be reimplemented
 * identically on both sides, and the failure mode when they drift is silent.
 */
export function metaLeadEventId(leadId: string): string {
  return leadId.trim();
}

/**
 * Whether this visitor may be tracked.
 *
 * There is no site-wide consent store in this codebase today — the only consent
 * mechanism that exists is the widget's own lead-capture consent, which is a
 * different question asked of a different person on a customer's site, and its
 * `data-analytics-consent` attribute is scoped to that embed. So the honest
 * signals available here are the ones the browser itself sends: Global Privacy
 * Control, which is legally binding in several jurisdictions, and Do-Not-Track.
 * Both are respected.
 *
 * When a consent banner does arrive, pass its answer to `<MetaPixel consent />`
 * rather than editing this function — an explicit refusal must still win over a
 * browser that sends neither signal.
 */
export function trackingAllowed(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (navigator.globalPrivacyControl === true) return false;
  const doNotTrack = navigator.doNotTrack ?? window.doNotTrack ?? navigator.msDoNotTrack;
  if (doNotTrack === "1" || doNotTrack === "yes") return false;
  return true;
}

/**
 * Report a captured lead from the browser.
 *
 * `leadId` is the `lead_id` the API returns from the lead endpoint. The event is
 * dropped silently when the pixel never loaded — because Meta is unconfigured,
 * because the visitor signalled Do-Not-Track, or because an ad blocker removed
 * it. That is not an error worth surfacing to a visitor, and the server-side
 * conversion has already been recorded from committed state regardless.
 */
export function trackMetaLead(leadId: string): void {
  const eventId = metaLeadEventId(leadId);
  if (!eventId) return;
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq("track", META_LEAD_EVENT, {}, { eventID: eventId });
}

/**
 * The inline snippet that boots the pixel.
 *
 * This is Meta's own loader: it defines `fbq` with a queue so calls made before
 * connect.facebook.net answers are buffered rather than thrown, then injects the
 * real library asynchronously. `pixelId` is already validated as digits by
 * `metaPixelId`, which is what makes the interpolation safe.
 */
export function metaPixelSnippet(pixelId: string): string {
  return `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${pixelId}');fbq('track','PageView');`;
}
