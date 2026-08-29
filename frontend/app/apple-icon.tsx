import { ImageResponse } from "next/og";

// iOS renders this at 180px on a home screen, so it gets more of the mark than
// the 32px tab icon can carry.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
        }}
      >
        <svg width="132" height="132" viewBox="0 0 32 32" fill="none">
          <path d="M5 9.2c4.7.3 7.8 2 9.4 5.1-3.8.2-7-1.5-9.4-5.1Z" fill="#A5B4FC" />
          <path d="M27 9.2c-4.7.3-7.8 2-9.4 5.1 3.8.2 7-1.5 9.4-5.1Z" fill="#C4B5FD" />
          <path d="M7 17c4.2-.8 7.2-.1 9 2.2 1.8-2.3 4.8-3 9-2.2-2.4 3.8-5.4 5.7-9 5.7S9.4 20.8 7 17Z" fill="#FFFFFF" />
          <path d="m16 5 2.4 5.2L16 13l-2.4-2.8L16 5Z" fill="#818CF8" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
