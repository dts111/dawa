import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "EaaS Project Management",
  description: "Plan, schedule and share project programmes with your team.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className="flex min-h-full flex-col bg-slate-100 font-sans text-slate-900">{children}</body>
    </html>
  );
}
