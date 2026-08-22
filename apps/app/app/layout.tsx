import type { Metadata } from "next";
import { JetBrains_Mono, Titillium_Web } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const titillium = Titillium_Web({
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
  variable: "--font-titillium",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CrowdFlow — F1 circuit crowd intelligence",
    template: "%s | CrowdFlow",
  },
  description:
    "Live Formula 1 circuit congestion prediction, safety-reviewed interventions, and an ops agent for grand prix weekends.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${titillium.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
