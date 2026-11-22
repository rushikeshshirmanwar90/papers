import type { Metadata } from "next";
import Link from "next/link";
import { QUEST_SUPPORT_EMAIL } from "@/lib/quest-public";

export const metadata: Metadata = {
  title: "Quest Support",
  description: "Get help with the Quest app: contact support, account questions, joining codes, tests and question papers.",
  icons: { icon: "/quest/app-icon.png", apple: "/quest/app-icon.png" },
};

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "I forgot my password",
    a: (
      <>
        On the login screen, tap <strong>Forgot password</strong> and enter your email. We’ll email you a code; enter
        it in the app and choose a new password. If the email doesn’t arrive, check your spam folder or email us.
      </>
    ),
  },
  {
    q: "I didn't get the verification code",
    a: "Check your spam or promotions folder and make sure the email address was typed correctly. After a minute you can ask for a new code from the verification screen.",
  },
  {
    q: "How do I join my institute or batch?",
    a: "Ask your institute for its 8-character joining code. In Quest, enter the code, check the institute and batch it shows, and send your request. Once the institute approves you, its tests appear in your app. Teachers join the same way with a teacher code.",
  },
  {
    q: "A test or result isn't showing up",
    a: "Make sure you're connected to the internet, then close and reopen the app. Check that you're signed in to the right account and that your institute has approved you for the right batch. If it's still missing, email us your institute and batch name.",
  },
  {
    q: "I found a mistake in a question or solution",
    a: "Thank you! Email us the class, subject, chapter and a few words from the question, and we'll correct it.",
  },
  {
    q: "How do I add my institute's logo to question papers?",
    a: "Open your institute profile and choose a logo from your photos. It's then printed on the question papers your teachers create.",
  },
  {
    q: "How do I delete my account and data?",
    a: (
      <>
        Email us from the address registered to your account and ask for your account to be deleted, or use
        the <Link href="/account/delete" className="underline underline-offset-2">Delete Account</Link> page. We
        delete your account and the personal data linked to it within 30 days. See our{" "}
        <Link href="/privacy" className="underline underline-offset-2">Privacy Policy</Link> for details.
      </>
    ),
  },
];

export default function QuestSupportPage() {
  const mailto = `mailto:${QUEST_SUPPORT_EMAIL}?subject=${encodeURIComponent("Quest app support")}`;
  return (
    <div className="mx-auto w-full max-w-4xl px-5 pb-14 pt-10">
      <h1 className="text-[clamp(28px,5vw,36px)] font-extrabold leading-tight text-[#17213D]">Support</h1>
      <p className="mb-7 mt-1 text-[15px] text-[#5D6478]">We’re here to help with anything in the Quest app.</p>

      <div className="mb-8 rounded-2xl bg-[#FAECCF] p-6">
        <p className="mb-1.5">Email us and we’ll reply within 2 working days:</p>
        <a href={mailto} className="break-all text-lg font-bold text-[#17213D] underline underline-offset-4">
          {QUEST_SUPPORT_EMAIL}
        </a>
        <p className="mt-2.5 text-[15px] text-[#5D6478]">
          To help us fix things quickly, tell us the email you signed up with, your phone model and what happened.
        </p>
      </div>

      <h2 className="mb-2 text-2xl font-bold text-[#17213D]">Common questions</h2>
      {FAQ.map((item) => (
        <details key={item.q} className="border-b border-[#ECDCB8] py-3.5">
          <summary className="cursor-pointer font-semibold text-[#17213D]">{item.q}</summary>
          <p className="mt-2.5">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
