import type { Metadata } from "next";
import { Barlow, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-barlow",
  display: "swap",
});
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "Dafegen Project Management",
  description: "Plan, schedule and share project programmes with your team.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${barlow.variable} ${mono.variable}`}>
      <body className="flex min-h-full flex-col bg-slate-100 font-sans text-slate-900">{children}</body>
    </html>
  );
}
