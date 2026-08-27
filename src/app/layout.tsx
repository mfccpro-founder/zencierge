import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { IgnoreThirdPartyAnalytics } from "@/components/ignore-third-party-analytics";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Zencierge · 24/7 AI Voice Receptionist for Hosts Across the US",
  description:
    "Bilingual AI receptionist, Airbnb & Vrbo calendar sync, and co-host payouts for Superhosts nationwide.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col bg-background text-foreground"
        suppressHydrationWarning
      >
        {/* No amplitude.init / @amplitude/analytics-browser / experiment flags SDK in this app. */}
        <IgnoreThirdPartyAnalytics />
        {children}
      </body>
    </html>
  );
}
