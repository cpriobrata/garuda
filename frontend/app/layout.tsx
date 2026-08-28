import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Garuda — AI agents that turn conversations into customers", template: "%s · Garuda" },
  description: "Create, configure, test, and publish knowledge-grounded AI agents for your website.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fafbff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
