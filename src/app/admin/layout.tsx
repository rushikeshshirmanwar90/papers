import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";

const publicSans = Public_Sans({ subsets: ["latin"], variable: "--font-admin", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "PCMB Admin", template: "%s | PCMB Admin" },
  description: "Run the tuitions on PCMB: onboard, oversee and support.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${publicSans.variable} flex min-h-screen flex-1 bg-omr-paper font-admin text-omr-ink [font-variant-numeric:tabular-nums]`}>{children}</div>;
}
