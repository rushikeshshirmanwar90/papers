# PCMB Paper Reader — Web

Next.js 14 (App Router) app for uploading JEE/NEET PDF question papers,
auto-extracting questions, and reviewing/editing them. Also serves the REST
API used by the `/mobile` Expo app.

## Setup

1. Have a MongoDB instance available (local `mongod`, Docker, or Atlas).
2. Copy the connection string into `.env.local`:

   ```
   MONGODB_URI=mongodb://127.0.0.1:27017/pcmb_exam_reader
   ```

3. Install dependencies and run the dev server:

   ```bash
   npm install
   npm run dev
   ```

4. Open http://localhost:3000 — go to **Upload Paper** to upload a PDF.

## PDF format expected by the extractor

- Subject headers on their own line: `Physics`, `Chemistry`, `Mathematics`,
  `Biology`, `Botany`, `Zoology`.
- Section headers: `SECTION - A` / `SECTION - B`.
- Questions: `1. Question text` (wraps onto following lines until the next
  marker).
- Options: `(A) option text` through `(D)`.
- Answers: `Ans. [A]`, `Ans. [42]`, or `Ans. [Bonus]` — determines whether the
  question is stored as `MCQ`, `Numerical`, or `Bonus`.

See `src/lib/pdfText.ts` (pdf.js line extraction) and
`src/lib/questionParser.ts` (the actual parsing state machine).

## API routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/papers/upload` | POST | Upload a PDF (`multipart/form-data`: `pdf`, `title`, `examType`, `year`), extract & store questions |
| `/api/papers` | GET | List papers with subject breakdown |
| `/api/papers/:id` | GET / DELETE | Paper + its questions / delete paper |
| `/api/papers/:id/attempt-questions` | GET | Questions with `correctAnswer` withheld (used by mobile during an attempt) |
| `/api/questions/:id` | PATCH / DELETE | Edit or delete a single question |
| `/api/dashboard` | GET | Aggregate stats for the dashboard |
| `/api/students` | POST / GET | Find-or-create a student by email (mobile login) / list students |
| `/api/students/:id/attempts` | GET | A student's past attempts |
| `/api/attempts` | POST | Submit an attempt — scores server-side (+4 / -1 / 0) and returns the full review |
| `/api/attempts/:id` | GET | Re-fetch a past attempt's review |

## Notes

- Uploaded PDFs are stored under `public/uploads/` (gitignored).
- `@shared/*` resolves to `../shared` — TypeScript types shared with `/mobile`.
