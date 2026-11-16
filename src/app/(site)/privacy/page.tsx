import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy – PCMB Paper Reader",
  description: "How PCMB Paper Reader collects, uses and protects your data.",
};

const LAST_UPDATED = "15 November 2026";
const CONTACT_EMAIL = process.env.SMTP_USER ?? "support@pcmb.app";

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-10 py-4">

      {/* Header */}
      <div className="space-y-2 border-b border-slate-200 pb-8">
        <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>
        <p className="mt-3 text-slate-600">
          This policy explains what data PCMB Paper Reader collects, how it is
          used, and the choices you have. By using the platform you agree to these
          terms.
        </p>
      </div>

      {/* Sections */}
      <Section id="who-we-are" title="1. Who we are">
        <P>
          PCMB Paper Reader is an educational platform that helps tuition centres
          upload JEE and NEET question papers, manage students and teachers, and
          deliver online tests. The platform is operated by the tuition that invited
          you (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
        </P>
      </Section>

      <Section id="data-we-collect" title="2. Data we collect">
        <P>We collect only what is necessary to run the service:</P>
        <Table
          head={["Category", "Examples", "Why"]}
          rows={[
            ["Account details", "Name, email address, phone number", "Create and secure your account"],
            ["Authentication data", "Hashed password, login timestamps, device push tokens", "Let you log in and send notifications"],
            ["Academic profile", "Class, program (JEE / NEET / Foundation), batch, subjects", "Assign you to the right content and tests"],
            ["Activity data", "Test attempts, answers submitted, XP events, daily activity", "Track progress and show your results"],
            ["Uploaded content", "PDF question papers, diagrams", "Extract and serve questions"],
            ["Technical data", "IP address, browser/device info (via Next.js server logs)", "Diagnose errors and prevent abuse"],
          ]}
        />
      </Section>

      <Section id="how-we-use" title="3. How we use your data">
        <Ul
          items={[
            "Authenticate you and keep your account secure.",
            "Assign you to batches and deliver the correct tests and study material.",
            "Show your teachers and tuition admins your performance and progress.",
            "Send you one-time verification and password-reset codes by email.",
            "Send push notifications about upcoming tests or announcements.",
            "Improve the platform by understanding how features are used.",
          ]}
        />
        <P>
          We do not sell your data to third parties, use it for advertising, or
          share it with any party outside the tuition that operates your account
          except as described in Section 5.
        </P>
      </Section>

      <Section id="data-sharing" title="4. Data sharing">
        <P>Your data is accessible to:</P>
        <Ul
          items={[
            "Your tuition's admin and teachers — to manage batches, monitor test results and support you.",
            "Other students in your batch — only your name is visible, never your contact details or scores.",
            "The PCMB platform administrators — to operate and maintain the service.",
          ]}
        />
        <P>
          We use the following third-party services, each bound by their own
          privacy policies:
        </P>
        <Table
          head={["Service", "Purpose", "Data shared"]}
          rows={[
            ["MongoDB Atlas", "Database hosting", "All stored data, encrypted at rest"],
            ["Vercel", "Application hosting and edge network", "Request logs, server-side data"],
            ["Google / SMTP provider", "Sending verification and reset emails", "Your name and email address"],
            ["Expo (push notifications)", "Delivering in-app notifications", "Device push token only"],
          ]}
        />
      </Section>

      <Section id="data-retention" title="5. Data retention">
        <P>
          Your data is kept for as long as your account is active. If your tuition
          deletes your account, all personally identifiable data — your name, email,
          phone, test answers and activity — is permanently removed within 30 days.
          Anonymised, aggregated statistics (e.g. total number of test attempts) may
          be retained indefinitely.
        </P>
      </Section>

      <Section id="cookies" title="6. Cookies and local storage">
        <P>
          The web app uses a single session cookie (<Code>pcmb_admin</Code>) to
          keep the admin console logged in. The mobile app stores your login token
          in secure device storage. No third-party tracking or advertising cookies
          are used.
        </P>
      </Section>

      <Section id="security" title="7. Security">
        <Ul
          items={[
            "Passwords are stored as bcrypt hashes — never in plain text.",
            "Login tokens are signed JWTs with a 30-day expiry, invalidated immediately on a password change.",
            "All data in transit is encrypted over HTTPS / TLS.",
            "Accounts are locked for 15 minutes after 5 consecutive wrong password attempts.",
            "Email codes are stored as HMAC hashes and expire after 10 minutes.",
          ]}
        />
        <P>
          No system is completely secure. If you believe your account has been
          compromised, change your password immediately and contact your tuition
          admin.
        </P>
      </Section>

      <Section id="your-rights" title="8. Your rights">
        <P>You have the right to:</P>
        <Ul
          items={[
            "Access the personal data we hold about you.",
            "Correct inaccurate information — you can update your name, phone and password from the app.",
            "Delete your account — contact your tuition admin or email us at the address below.",
            "Withdraw consent — you may turn off push notifications in your device settings at any time.",
            "Data portability — request an export of your test results and activity by emailing us.",
          ]}
        />
      </Section>

      <Section id="children" title="9. Children's privacy">
        <P>
          Many of our users are under 18. We do not knowingly collect data from
          children under 13 without verifiable parental consent. Student accounts
          for under-13 users must be created by the tuition admin, not through
          self-registration. If you believe a child&apos;s data has been collected
          without consent, please contact us immediately.
        </P>
      </Section>

      <Section id="changes" title="10. Changes to this policy">
        <P>
          We may update this policy when the platform changes in ways that affect
          how data is handled. The &ldquo;Last updated&rdquo; date at the top of this page will
          change, and we will notify tuition admins by email of any material
          changes. Continued use of the platform after a change means you accept the
          updated policy.
        </P>
      </Section>

      <Section id="contact" title="11. Contact">
        <P>
          Questions, access requests or deletion requests:{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-indigo-600 hover:text-indigo-500"
          >
            {CONTACT_EMAIL}
          </a>
          . We aim to respond within 5 business days.
        </P>
      </Section>

      {/* Back link */}
      <div className="border-t border-slate-200 pt-6">
        <Link href="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  );
}

// ─── Local primitives ────────────────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="space-y-4 scroll-mt-6">
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="leading-relaxed text-slate-600">{children}</p>;
}

function Ul({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5 pl-5 text-slate-600">
      {items.map((item, i) => (
        <li key={i} className="list-disc leading-relaxed">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2.5 font-semibold text-slate-700">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i} className="bg-white">
              {row.map((cell, j) => (
                <td key={j} className={`px-4 py-3 text-slate-600 ${j === 0 ? "font-medium text-slate-800 whitespace-nowrap" : ""}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-slate-800">
      {children}
    </code>
  );
}
