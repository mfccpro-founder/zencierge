import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "Zencierge · Autonomous Host OS for Airbnb & Vrbo",
  description:
    "AI voice reception, turnover photo inspection, and AirCover dispute proof. Flat pricing from $49/month. 14-day free trial.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning={true}
    >
      <body
        className="min-h-full flex flex-col bg-background text-foreground"
        suppressHydrationWarning={true}
      >
        {/* No third-party analytics SDKs are loaded in this app. */}
        {children}
      </body>
    </html>
  );
}
