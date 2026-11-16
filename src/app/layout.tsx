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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
