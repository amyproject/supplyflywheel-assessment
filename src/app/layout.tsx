import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { currentLang } from "@/lib/lang";

export const metadata: Metadata = {
  title: "SupplyFlywheel 机器人供应链负责人测评",
  description: "SupplyFlywheel robotics supply chain lead assessment",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await currentLang();
  return (
    <html lang={lang === "en" ? "en" : "zh-CN"} className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
