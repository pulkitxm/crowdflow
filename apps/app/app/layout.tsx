import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../src/tokens.css";
import "../src/style.css";

export const metadata: Metadata = {
  title: {
    default: "CrowdFlow Operator Console",
    template: "%s | CrowdFlow",
  },
  description: "Live venue operations and race-day simulation for crowd movement.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
