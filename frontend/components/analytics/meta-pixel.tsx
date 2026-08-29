"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { META_PIXEL_SCRIPT_ID, metaPixelId, metaPixelSnippet, trackingAllowed } from "./meta-events";

/**
 * The Meta pixel.
 *
 * WHAT IT DOES NOT DO. It renders nothing and loads nothing unless
 * `NEXT_PUBLIC_META_PIXEL_ID` is set to a valid pixel id. With the variable
 * absent — which is every environment until the ad account is live — this
 * component is a `return null` and the site is byte-for-byte what it is today.
 *
 * STRATEGY. `afterInteractive`, which is the right one here rather than the
 * habitual choice. `beforeInteractive` would put a third-party request in front
 * of first paint to buy nothing: the pixel has no effect on what the page looks
 * like. `lazyOnload` waits for the window load event, which on a slow connection
 * is long enough for a visitor who bounces to be missed entirely — and a missed
 * PageView on an ad landing page is a missed attribution. `afterInteractive`
 * runs it once hydration is done, off the critical path but still promptly.
 *
 * ROUTE CHANGES. Meta's snippet fires one PageView when it loads. The App Router
 * navigates on the client without re-running it, so every page after the first
 * would be invisible without the pathname effect below.
 *
 * CONSENT. Nothing loads for a visitor whose browser sends Global Privacy
 * Control or Do-Not-Track. The check has to run in the browser, so the component
 * renders null on the server and on the first client pass and only then decides;
 * that also keeps the server and client markup identical, which is what avoids a
 * hydration mismatch. Pass `consent={false}` to refuse regardless — that is the
 * hook a consent banner should use when one exists, and an explicit refusal must
 * outrank a browser that sends no signal at all.
 *
 * There is deliberately no `<noscript>` tracking image. The consent decision
 * above is made in JavaScript, so a `<noscript>` pixel would be exactly the
 * pixel that fires for the visitors whose preference could not be read.
 */
export function MetaPixel({ consent }: { consent?: boolean }) {
  const pixelId = metaPixelId();
  const pathname = usePathname();
  const [permitted, setPermitted] = useState(false);
  const sawFirstPath = useRef(false);

  useEffect(() => {
    setPermitted(consent === false ? false : trackingAllowed());
  }, [consent]);

  useEffect(() => {
    if (!permitted || !pixelId) return;
    // The snippet itself fires the PageView for the page it loaded on, so the
    // first run here is skipped. Everything after it is a client-side
    // navigation the snippet cannot see.
    if (!sawFirstPath.current) {
      sawFirstPath.current = true;
      return;
    }
    window.fbq?.("track", "PageView");
  }, [pathname, permitted, pixelId]);

  if (!pixelId || !permitted) return null;
  return (
    <Script
      id={META_PIXEL_SCRIPT_ID}
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{ __html: metaPixelSnippet(pixelId) }}
    />
  );
}
