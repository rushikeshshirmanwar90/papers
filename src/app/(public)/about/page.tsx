import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Quest – PCMB tests and question papers",
  description:
    "Quest gives teachers and coaching institutes a ready, topic-organised bank of Class 9–12 Physics, Chemistry, Maths and Biology questions to set tests and print question papers in minutes.",
  openGraph: {
    title: "Quest – PCMB tests and question papers",
    description: "Set Class 9–12 PCMB tests from a ready question bank and see how each student did.",
    images: ["/quest/app-icon.png"],
  },
  icons: { icon: "/quest/app-icon.png", apple: "/quest/app-icon.png" },
};

const FEATURES = [
  {
    title: "A question bank that's already loaded",
    body: "Over 250,000 questions with solutions, organised by class, subject, chapter and topic. Each one shows its difficulty and the past exams it appeared in.",
  },
  {
    title: "Foundation, JEE and NEET",
    body: "Science and Maths for Class 9–10, and Physics, Chemistry, Maths and Biology for Class 11–12.",
  },
  {
    title: "Batches and tests in one place",
    body: "Students join your institute with a joining code. Build a test from the bank for a batch, and students take it on their own phones.",
  },
  {
    title: "See how each student did",
    body: "Scores, right and wrong answers, and time taken for every student, without putting the results together by hand.",
  },
  {
    title: "Printable question papers",
    body: "Turn any selection of questions into a clean PDF paper, with your institute's logo on it.",
  },
  {
    title: "Practice for students",
    body: "Students can practise topic by topic and keep track of their own progress.",
  },
];

export default function QuestAboutPage() {
  return (
    <>
      <section className="bg-[#FAECCF] px-5 pb-16 pt-14 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/quest/app-icon.png"
          alt="Quest app icon"
          width={112}
          height={112}
          className="mx-auto rounded-[26px] shadow-[0_10px_30px_rgba(23,33,61,0.15)]"
        />
        <h1 className="mt-6 text-[clamp(30px,6vw,44px)] font-extrabold leading-tight tracking-tight text-[#17213D]">
          Set a PCMB test in minutes
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-lg">
          Quest gives teachers and coaching institutes a ready bank of Class 9–12 Physics, Chemistry, Maths and
          Biology questions, organised the way you plan your lessons.
        </p>
        <Link
          href="/support"
          className="mt-7 inline-block rounded-full bg-[#17213D] px-6 py-3 font-semibold text-white hover:bg-[#2B3350]"
        >
          Questions? Get support
        </Link>
      </section>

      <section className="mx-auto w-full max-w-4xl px-5 py-12">
        <h2 className="mb-5 text-2xl font-bold text-[#17213D]">Built for teachers who are short of time</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-[#ECDCB8] bg-white p-5">
              <h3 className="mb-1.5 text-lg font-semibold text-[#17213D]">{f.title}</h3>
              <p className="text-[#5D6478]">{f.body}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
