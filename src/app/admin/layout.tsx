import type { Metadata } from "next";
import localFont from "next/font/local";

// Self-hosted (not next/font/google) so `next build` needs no network access.
const publicSans = localFont({
  src: "../../../node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2",
  variable: "--font-admin",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: { default: "PCMB Admin", template: "%s | PCMB Admin" },
  description: "Run the tuitions on PCMB: onboard, oversee and support.",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${publicSans.variable} flex min-h-screen flex-1 bg-omr-paper font-admin text-omr-ink [font-variant-numeric:tabular-nums]`}>{children}</div>;
}
