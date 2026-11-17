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
  title: {
    default: "PinCheck \u00B7 Pre-flight hardware linter",
    template: "%s \u00B7 PinCheck",
  },
  description:
    "Describe a circuit in plain English and get a verified pinout, power-rail checks, fault injection, and matching firmware before you wire anything.",
  applicationName: "PinCheck",
  keywords: [
    "ESP32",
    "Arduino",
    "Raspberry Pi Pico",
    "circuit linter",
    "pinout",
    "hardware",
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-emerald-500 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#04110C] focus:outline-none"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
