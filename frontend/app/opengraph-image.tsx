import { ImageResponse } from "next/og";
import { OG_IMAGE_ALT, SITE_DESCRIPTION } from "@/lib/seo";

/**
 * The site-wide Open Graph and Twitter card image, generated at build time.
 *
 * This is file-based metadata, so Next attaches it automatically to routes that
 * do not declare an `openGraph` object of their own. Routes that do — every page
 * built with `pageMetadata` — point back at this same generated route, which is
 * why the alt text lives in lib/seo.ts and is shared with it.
 *
 * The mark is the same one components/brand.tsx draws, redrawn here because a
 * React component cannot be rendered into an ImageResponse.
 */
export const alt = OG_IMAGE_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 76,
          backgroundColor: "#020617",
          backgroundImage:
            "radial-gradient(circle at 12% 8%, rgba(99,102,241,0.55) 0%, rgba(2,6,23,0) 46%), radial-gradient(circle at 92% 88%, rgba(168,85,247,0.42) 0%, rgba(2,6,23,0) 44%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 76,
              height: 76,
              borderRadius: 22,
              backgroundColor: "rgba(148,163,184,0.14)",
              border: "1px solid rgba(165,180,252,0.4)",
            }}
          >
            <svg width="56" height="56" viewBox="0 0 32 32" fill="none">
              <path d="M5 9.2c4.7.3 7.8 2 9.4 5.1-3.8.2-7-1.5-9.4-5.1Z" fill="#A5B4FC" />
              <path d="M27 9.2c-4.7.3-7.8 2-9.4 5.1 3.8.2 7-1.5 9.4-5.1Z" fill="#C4B5FD" />
              <path d="M7 17c4.2-.8 7.2-.1 9 2.2 1.8-2.3 4.8-3 9-2.2-2.4 3.8-5.4 5.7-9 5.7S9.4 20.8 7 17Z" fill="white" />
              <path d="m16 5 2.4 5.2L16 13l-2.4-2.8L16 5Z" fill="#818CF8" />
            </svg>
          </div>
          <div style={{ marginLeft: 22, fontSize: 40, fontWeight: 700, letterSpacing: "-0.03em" }}>Garuda</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 40, fontWeight: 600, color: "#a5b4fc", letterSpacing: "-0.01em" }}>
            AI chat agents for your website
          </div>
          <div
            style={{
              marginTop: 18,
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.04em",
              maxWidth: 940,
            }}
          >
            Grounded in your knowledge. Published on your terms.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", fontSize: 26, color: "#cbd5e1", maxWidth: 760, lineHeight: 1.35 }}>
            {SITE_DESCRIPTION.split(".")[0]}.
          </div>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 600, color: "#818cf8" }}>garuda.ravan.ai</div>
        </div>
      </div>
    ),
    size,
  );
}
