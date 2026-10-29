# Step 1 — Backend Security Report (legacy question-paper APIs)

_Date: 2026-10-26 · Scope: `papers/` (backend). `pcmb-paper/` (Expo) was inspected for compatibility and not changed._

---

## 1. Executive summary

All four legacy question-bank operations were **completely unauthenticated**. Anyone on the internet could:

- edit any question, including its answer key,
- delete any question,
- delete any paper, which also wiped **students' graded attempts** and the paper's stored PDF and diagrams,
- upload any file of any size and start heavy PDF extraction.

The `Question` and `Paper` models record **no owner**. The bank is one shared, platform-wide collection that every tuition reads. So no teacher-level or institute-level permission can be derived without inventing ownership. Following the fail-closed rule, these operations now accept **only the platform Super Admin**, through the existing admin console session or the `X-Admin-Key` header.

Every app login gets a **403**, whether tuition owner, teacher, student, or an account with no tuition. Anonymous requests get a **401**. Deletions that would touch student history are **refused with 409** until an archival step exists. Attempts are never deleted. Uploads are size-capped, checked for a real PDF signature and validated *before* extraction, and are rolled back if they fail.

The existing authentication was reused; no new auth system, no JWT change, no schema change, no migration. The Expo app doesn't call any of these operations, so it is unaffected. 39 new automated tests pass against an in-memory MongoDB.

---

## 2. Confirmed problems

The previous audit's claims were verified against the current files. All four were still present.

| # | Endpoint | File | Previous behavior | Weakness | Consequences |
|---|---|---|---|---|---|
| 1 | `PATCH /api/questions/[id]` | `src/app/api/questions/[id]/route.ts` | Updated any question with any allow-listed field from the body. | No authentication, authorization or ownership check. Malformed ids and bodies caused raw 500s. Values weren't type-checked. | Anyone could rewrite answer keys in the bank every tuition shares. That corrupts PYQ practice scoring and every future test built from those questions. |
| 2 | `DELETE /api/questions/[id]` | same file | `findByIdAndDelete` on any id. | No authentication or authorization. Ignored references from `Attempt`, `PracticeAnswer` and `TestRoom`. | Anonymous mass deletion of the bank, leaving student history pointing at missing questions. |
| 3 | `DELETE /api/papers/[id]` | `src/app/api/papers/[id]/route.ts` | Deleted the paper, then **cascade-deleted its questions, every `Attempt` on it, and all its stored files**. | No authentication or authorization. Destroyed assessment history by design. | One anonymous request erased students' graded attempts and the paper's PDF and diagrams. |
| 4 | `POST /api/papers/upload` | `src/app/api/papers/upload/route.ts` | Buffered the whole body with no limit and accepted the file if the name *or* MIME type said PDF. Stored it, then ran up to three extraction passes for up to 60 s. | No authentication or authorization, no size limit, no content check. Metadata was validated only after extraction. Files were orphaned on failure. Internal error messages were echoed in responses. | Anyone could consume CPU, time and database storage (cost and denial of service) and inject content that every institute sees. |

### Investigation answers

| Question | Answer |
|---|---|
| Which screens use these endpoints? | Only the backend's **web Paper Reader** (`src/app/(site)/papers/*`). **No Expo screen** calls them. |
| Who should be allowed? | The platform Super Admin, who curates the shared bank. No tuition, teacher or student role has a mobile workflow that edits or deletes bank content. |
| Do callers send a token? | The web Paper Reader relies on the browser's admin console cookie (`pcmb_admin`, path `/`). The Expo app sends JWTs only through `api()` in `services/api-client.ts`, and never to these routes. |
| Does `Question` / `Paper` track ownership? | **No.** No `tuitionId`, `createdBy` or visibility field. |
| Global or per-institute? | **Global.** Every tuition reads the same bank through `/api/questions`, `/api/pyq` and the test builder. |
| Can teachers from different institutes use the same questions? | Yes, so a change by any one of them would affect all institutes. |
| Are historical attempts linked? | `Attempt` links `paperId` and `answers.questionId`. `PracticeAnswer` links `questionId`. `TestRoom` stores a **copy** of each question plus `sourceId`, so tests are not changed by bank edits (tested). |
| Will securing the routes break the frontend? | Not the Expo app. The web Paper Reader keeps working for a signed-in admin. |
| Can existing helpers be reused? | Yes: `requireAdmin` (`src/lib/admin.ts`) and `requireAccount` (`src/lib/auth.ts`). |

---

## 3. Changes implemented

**New helper `src/lib/question-bank.ts`.** It holds the rules the three routes share:
- `requireBankAdmin(req)` decides who is asking:
  - If an `X-Admin-Key` header or the admin cookie is present, it defers to the existing `requireAdmin`: a wrong key or bad cookie gets 401, and a cross-site cookie request gets 403.
  - Otherwise, a `Bearer` token is verified with the existing `requireAccount`, so an expired or bad token still gets 401. A valid token is then refused with **403**.
  - No credentials at all gets **401**.
- `assessmentUses(questionIds, paperId?)` reports whether any `Attempt`, `PracticeAnswer` or `TestRoom` uses those questions or that paper.
- `inUse()` builds the 409 error. `enumOf()` reads allowed values from the Mongoose schema, so the enums aren't duplicated.

**`PATCH /api/questions/[id]`**
- Admin only. The id must be a valid ObjectId (400) and the body a JSON object (400). Returns 404 if the question doesn't exist.
- Editable fields stay limited to the same allow-list as before. Each is now checked: text fields must be strings within a length cap, and `questionText` can't be blank. `subject`, `section`, `answerType` and `difficulty` must be schema enum values. `questionNumber` must be an integer from 1 to 10000.
- Non-string values such as `{ "$gt": "" }` are refused. `_id`, `paperId`, diagram URLs and any other fields are ignored.
- The web editor sends the whole question back, so fields equal to the stored value are skipped. Older imports holding values the checks would refuse therefore don't block an edit to another field.

**`DELETE /api/questions/[id]`**
- Admin only, with id validation and 404 as above.
- Refused with **409** if any attempt, practice answer or test references the question.
- When a delete succeeds, the paper's `totalQuestions` is decremented so the count stays accurate.

**`DELETE /api/papers/[id]`**
- Admin only, with id validation and 404.
- **Never deletes `Attempt` records.** Refused with **409** if the paper has attempts, or if any of its questions is in a student's practice answers or a test.
- A paper nothing uses (for example a bad upload) is still removed, together with its own questions and its own stored files only (matched by its id). The paper is deleted last, so a partial failure can be retried.
- `GET` in the same file is unchanged.

**`POST /api/papers/upload`**
- Admin is checked **before** the body is read.
- A `Content-Length` over the cap is refused (413) up front. The body is then read through a byte-counting stream, so an oversized body is cut off even **without** a `Content-Length`.
- The PDF cap is 15 MB, because the PDF is stored in a single Mongo document and those can't exceed 16 MB.
- The file must start with the real `%PDF-` signature; a `.pdf` name or MIME type is no longer enough. Empty files are refused.
- All form fields are validated with the existing `text()` / `oneOf()` helpers against schema enums before extraction: `examType`, `examCategory`, `standard`, `difficulty` (must suit the Question model), `subject`, and `year` (1950 to next year).
- At most 2 uploads extract at once in each server process; more get a 429.
- On any failure, everything this upload stored is rolled back: files, paper and questions all carry its fresh id. The 500 response is now a generic message, with details only in the server log.
- **The extraction code itself is untouched.**

**`src/lib/admin.ts`**: an opaque `Origin: null` on a cookie-authenticated change now gets a 403, where `new URL("null")` used to throw and give a 500.

**Web Paper Reader** (`src/app/(site)/papers/page.tsx`, `src/app/(site)/papers/[id]/page.tsx`): on a refused save or delete it now shows the server's message. Before, a failed save replaced the question on screen with the error body, and a failed delete removed the item locally anyway. No layout or style changes.

**Tests**: `tests/step1-security.test.ts` and an `npm test` script (`tsx --test`, using the already-installed `tsx` and `mongodb-memory-server`, so no new dependencies).

---

## 4. Before vs after

| Request | Before | After |
|---|---|---|
| Anonymous PATCH/DELETE question, DELETE paper, upload | 200 / 201 (action performed) | **401** |
| Expired or bad app token | 200 | **401** |
| Student, teacher (any institute), tuition owner, or no-tuition account | 200 | **403** |
| Wrong `X-Admin-Key` | 200 | **401** |
| Admin cookie sent from another site, or `Origin: null` | 200 | **403** |
| Admin, malformed id | 500 (CastError) | **400** |
| Admin, unknown id | 404 | 404 |
| Admin PATCH with bad value types or enums | 500, or the bad value saved | **400** |
| Admin PATCH that tries to change `paperId` / `_id` | Ignored | Ignored (400 if nothing editable was sent) |
| Admin DELETE question used by an attempt, practice answer or test | Deleted | **409**, kept |
| Admin DELETE paper with student attempts | Paper, questions, **attempts** and files deleted | **409**, everything kept |
| Admin DELETE unused paper | Deleted with questions and files | Same |
| Admin upload, non-PDF bytes named `.pdf` | Accepted, extraction run | **400** |
| Admin upload over the limit | Fully buffered, then processed | **413**, no extraction |
| Admin upload with invalid `examType` / `difficulty` / `year` | Failed after extraction (500), files orphaned | **400** before extraction |
| Admin upload that crashes during extraction | 500 echoing the internal error, files orphaned | Generic 500, everything rolled back |
| Admin upload of a valid paper | 201, questions extracted | 201, questions extracted (unchanged) |

---

## 5. Files modified

**Backend (`papers/`)**

| File | Why |
|---|---|
| `src/lib/question-bank.ts` (new) | Shared authorization and student-history checks for the three routes, so the rules aren't written three times. |
| `src/app/api/questions/[id]/route.ts` | Secured PATCH and DELETE (section 3). |
| `src/app/api/papers/[id]/route.ts` | Secured DELETE and removed the attempt cascade. GET unchanged. |
| `src/app/api/papers/upload/route.ts` | Auth, size and signature checks, metadata validation, concurrency cap and rollback around the unchanged extraction code. |
| `src/lib/admin.ts` | `Origin: null` gives a 403 instead of a 500. |
| `src/app/(site)/papers/[id]/page.tsx` | Shows the server's error on a refused edit or delete instead of corrupting the on-screen list. |
| `src/app/(site)/papers/page.tsx` | Shows the server's error on a refused paper delete. |
| `tests/step1-security.test.ts` (new) | Automated tests (section 7). |
| `package.json` | Added the `"test"` script only. Dependencies are unchanged. |
| `STEP1_SECURITY_REPORT.md` (new) | This report. |

**Mobile (`pcmb-paper/`)**: no files changed.

Environment note: the local `papers/node_modules` was missing packages already declared in `package.json` and the lockfile (`jose`, `bcryptjs`, `nodemailer`, `puppeteer-core`…), so the auth code couldn't run locally. `npm install` restored them from the lockfile; `package.json` and `package-lock.json` were not changed by it.

---

## 6. Authorization rules

| Who | Edit question | Delete question | Delete paper | Upload PDF |
|---|---|---|---|---|
| Anonymous | 401 | 401 | 401 | 401 |
| Student | 403 | 403 | 403 | 403 |
| Teacher (any tuition) | 403 | 403 | 403 | 403 |
| Tuition owner account | 403 | 403 | 403 | 403 |
| Account not in a tuition | 403 | 403 | 403 | 403 |
| **Platform Super Admin** (admin console cookie from the same site, or `X-Admin-Key`) | Allowed | Allowed **only if** no attempt, practice answer or test uses it | Allowed **only if** no attempt uses the paper and none of its questions is in practice answers or a test | Allowed (≤ 15 MB, real PDF, valid details) |

Ownership condition: all bank content is treated as **platform-owned**, because the model has no owner fields. Cross-institute modification is impossible, since no institute account can modify the bank at all.

How the admin uses the web Paper Reader: sign in at `/admin/login`. The console cookie is then sent to the Paper Reader's API calls automatically.

---

## 7. Testing results

**Tests executed: `npm test` (`tests/step1-security.test.ts`), 39 tests in 5 suites, 39 passed, 0 failed.**

The tests run the real route handlers against an in-memory MongoDB (`mongodb-memory-server`). The suite refuses to run unless the URI is a local `127.0.0.1` server, so no real data can be touched. Tokens are real JWTs from the existing `signToken`.

- **PATCH question:** anonymous → 401. Bad token → 401. Student → 403. Teachers of tuition A and of tuition B → 403. Tuition owner → 403. No-tuition account → 403. Question unchanged after refusals. Wrong admin key → 401. Cross-site admin cookie → 403. `Origin: null` → 403. Bad or missing id → 400 / 404. Bad body, operator object, blank text, bad enum, wrong type, over-long value, or only non-editable fields → 400. Admin edit works and ignores `paperId` / `_id` / diagram URLs without touching other questions. Admin console cookie edit works. A whole-question save with stored legacy `null` / out-of-enum values works, and so does a no-change save.
- **DELETE question:** anonymous → 401. Student, teachers and tuition → 403. Questions used by attempts, practice or tests → 409 and kept. Bad or missing id → 400 / 404. Unused question deleted and the paper count decremented.
- **DELETE paper:** anonymous → 401. Student, teachers and tuition → 403. Paper with an attempt → 409, with the attempt, questions and files all kept. Paper with practised questions → 409. Bad or missing id → 400 / 404. Unused paper deleted with only its own questions and files; other attempts untouched.
- **Upload:** anonymous → 401. Student, teacher and tuition → 403. Oversized `Content-Length` → 413. Oversized body with no `Content-Length` → 413. File just over 15 MB → 413. Non-PDF bytes (even named `.pdf`) or no file → 400. Bad `examType` / `difficulty` / `subject` / `year` → 400 with nothing stored. Corrupt PDF → generic 500 with nothing left behind. **A real sample paper (`Kinematics…pdf`) uploaded as admin is still extracted** (201, questions and PDF stored).
- **Compatibility:** JWT logins for student, teacher, tuition and no-tuition accounts still work on `/api/auth/me`. A student can still start a test, and the test still shows its original question text after the bank question was edited. A teacher still can't start a student's test (403). `GET /api/papers/[id]` is still open.

**Regression check:** the same suite run against the *original* route files gives 30 failures out of 36 (the suite at that point). This shows the tests detect the original vulnerabilities.

**Static checks**

| Check | Result |
|---|---|
| `papers`: `npx tsc --noEmit` | **Pass** |
| `papers`: ESLint on all changed files (Next `core-web-vitals` + `typescript` rules) | **Pass** |
| `papers`: `npm run lint` | **Not run: the project's ESLint setup is broken before this change.** `eslint.config.mjs` imports `eslint/config`, which needs ESLint 9, but 8.57.1 is installed. The changed files were linted with the same Next rulesets through a temporary legacy config kept outside the repo. |
| `papers`: `next build` | **Pass** when a database is reachable (built against an in-memory MongoDB). With no database it fails at `GET /api/papers`, which Next tries to prerender at build time. That route is untouched and the failure isn't caused by this change. |
| `pcmb-paper`: `npx tsc --noEmit` | **Pass** |
| `pcmb-paper`: `npx expo lint` | 1 error, 9 warnings, **all already there** and in files not changed (error: `react-hooks/set-state-in-effect` at `src/app/questions.tsx:279`). |

**Reviews:** `/security-review` found no vulnerabilities at confidence 8 or above. `/code-review` raised 10 points. Seven were fixed: the Mongo 16 MB document limit, odd stored values blocking editor saves, the missing-`Content-Length` bypass, the `totalQuestions` drift, the `res.json()` ordering in the web editor, duplicated validators, and `Origin: null`. Three are listed in section 9. `/simplify` was not run separately, because the code review's reuse findings were applied directly.

**Not executed:** tests against a real or staging MongoDB, and a manual end-to-end run of the Expo app on a device. Neither is needed for this change, because the app calls none of the changed routes.

---

## 8. Mobile compatibility

**No Expo functionality is affected.** The app's only question-bank calls are anonymous reads: `GET /api/questions`, `GET /api/papers` and `GET /api/filters` in `services/apiService.ts`. Students practise through `/api/pyq*`, and tests run through `/api/tests/*` with a JWT. None of these changed. The app has no question editing, question or paper deletion, or PDF upload. "My PDFs" are made and deleted on the phone. No mobile file was modified, and no Super Admin secret was added to the app.

The only affected client is the backend's web Paper Reader. It now requires the admin console login and shows the server's message when an action is refused.

---

## 9. Remaining security problems (for Step 2)

1. **No ownership on `Question` / `Paper`.** Teachers and tuitions can't manage their own questions. This needs `ownerType` (`platform` / `tuition`), `tuitionId` and `createdBy` fields plus a backfill of existing records as `platform` (a migration).
2. **No archival.** Deleting used questions or papers is blocked, not archived. Soft delete or archiving is needed so the admin can retire content without losing history.
3. **Race between check and delete.** Between the history check and the delete, a student could start using the question. The window is short and the operation is admin-only, but closing it needs a transaction or soft delete.
4. **Upload limits are per process.** The 2-upload cap counts only within one server instance, so on Vercel each instance has its own. Vercel separately caps request bodies at 4.5 MB.
5. **Other legacy routes are still unauthenticated** (they weren't in Step 1 scope):
   - `POST /api/attempts` creates attempts for any `studentId`.
   - `GET /api/attempts/[id]`, `GET /api/students`, `POST /api/students` (a password-less "login" that creates students), `GET /api/students/[id]/attempts` and `GET /api/dashboard` are open.
   - **`POST /api/question-paper-pdf`** runs headless Chrome with no authentication. It's the most expensive open endpoint, and the Expo app calls it without a token.
6. **Answer keys are publicly readable.** `GET /api/questions` and `GET /api/papers/[id]` return `correctAnswer` and `explanation` to anyone, so PYQ practice answers can be looked up. Online tests use snapshots behind authentication and aren't exposed.
7. `GET /api/papers/[id]` still passes the raw id to Mongo, so a malformed id gives a 500 rather than a 400.
8. Tooling: the ESLint 9 config vs ESLint 8 install mismatch, and `GET /api/papers` being prerendered at build time.

---

## 10. Recommended next step

**Step 2: authenticate the remaining legacy routes, starting with `POST /api/question-paper-pdf`, `POST /api/attempts` and the `/api/students*` routes.** Use the existing `requireUser` for tuition members, and send the JWT from the Expo app's `question-pdf.ts` with the same `api-client` token. After that, decide how answer keys are served to anonymous readers. Ownership fields and archival (items 1–2) can follow as their own step, since they need a planned migration.

Step 2 has not been started.
