# Step 2A — PDF Generation Security Report

_Date: 2026-10-26 · Branch: `feature/step2a-pdf-security` in both repos, based on `verify/step1-security-lint` · Not committed, pushed or deployed._

## 1. Confirmed original problems

`POST /api/question-paper-pdf` (`src/app/api/question-paper-pdf/route.ts`):

| # | Problem | Impact |
|---|---|---|
| 1 | **No authentication**: anyone could ask the server to run headless Chrome. | The most expensive open endpoint. Any internet client could use up function time and memory and drive up hosting cost. |
| 2 | **Body read without limit** (`await req.json()`). The parser capped fields (300 questions, 20,000 characters per text field), but nothing capped the total body. | Up to roughly 54 million characters of text could be parsed, and the whole body was buffered first. |
| 3 | **No limit on total figures.** 300 questions × 6 lists × 12 URLs gives up to about 21,600 downloads of up to 5 MB each. | Long downloads and large memory use for a single request. |
| 4 | **No overall deadline.** Each figure had a 10 s timeout, but the total didn't; Chrome had per-step timeouts, but opening a page had none. Papers print one at a time, so one stuck print blocked every later request. | One hung print could stall PDF generation on that server instance. |
| 5 | **Unbounded print queue.** | Requests could pile up behind each other without limit. |
| 6 | **Internal errors leaked**: the 500 response included `detail: error.message`. | Chrome, protocol and file-path details were visible to clients. |

The Expo app sent this request **without** a token (`pcmb-paper/src/services/question-pdf.ts`).

## 2. Existing PDF workflow (unchanged)

1. A teacher picks questions in the app. There are three entry points:
   - Questions tab → question bank (`createQuestionsPdf`)
   - Tests tab → create-exam modal (`createQuestionsPdf`)
   - My PDFs → "make answer key / solutions version" (`createPdfVersion` → `createQuestionsPdf`)
2. All three go through **one request**, `downloadPdf()` in `services/question-pdf.ts`. It POSTs JSON to `/api/question-paper-pdf`.
3. The server checks the body (`parse.ts`), embeds figures as data URIs (`figures.ts`, allow-listed hosts only), builds HTML with KaTeX and fonts (`html.ts`), and prints with Chrome (`render.ts`). It streams the PDF back with `X-Page-Count`.
4. The app saves the bytes with `addPdf()` (`pdf-library.ts`). My PDFs then opens, shares and deletes the files on the phone; no server is involved.

Who can reach PDF generation in the app: **teachers only.** It appears in the teacher's Questions and Tests tabs and Profile → My PDFs. The tuition and student tab sets don't include it.

## 3. Changes implemented

### Backend (`papers/`)

| File | Change |
|---|---|
| `src/app/api/question-paper-pdf/route.ts` | Now uses the shared `route()` wrapper. Calls **`requireUser(req, "teacher", "tuition")` first, before the body is read**. The body is read with a 4 MB cap (413), then checked with the existing `parsePaper` (400). Papers over **600 distinct figures** are refused (400). Figures get a 20 s budget and printing an 80 s deadline, both within `maxDuration = 120`. Errors are mapped: busy → **503**, timeout → **504**, any other failure → **500 "Could not make the PDF. Try again."** with **no `detail`**. The cause is logged on the server. On success the response headers, the streaming and the PDF are unchanged. |
| `src/lib/questionPaper/render.ts` | `renderPdf(html, timeoutMs)` now has an **overall deadline that includes time waiting in line**. If the deadline passes, the shared Chrome is **closed, or killed with SIGKILL if it doesn't close within 5 s**, so nothing keeps running and the next paper starts a fresh browser. At most **4 papers** can wait per instance; more get `RenderBusyError`. Page timeouts are capped by the time left. Pages are still closed in `finally`. Added `setBrowserLauncherForTests()`, a test-only hook for a stand-in browser. **Launch arguments, request blocking, JavaScript-off and print options are unchanged.** |
| `src/lib/questionPaper/figures.ts` | `embedFigures(urls, host, budgetMs)`: no new download starts after the budget. Figures not loaded become the existing "could not be loaded" note. |
| `src/lib/http.ts` | New `readBody(req, maxBytes, message)`: a size-limited body reader that checks `Content-Length` up front and also cuts off a body sent without one. |
| `src/app/api/papers/upload/route.ts` | Uses the shared `readBody`, replacing its own copy from Step 1. Behavior is the same (its tests pass). |
| `tests/step2a-pdf.test.ts` | New: 21 tests (section 9). |

`parse.ts` and `html.ts` were **not changed**, so the layout, KaTeX maths, fonts and diagram handling are exactly as before.

### Mobile (`pcmb-paper/`)

| File | Change |
|---|---|
| `src/services/api-client.ts` | Exports `authHeaders()` (the existing JWT as `Authorization: Bearer …`) and `reportLoginExpired()` (the existing sign-out-on-401 hook). `api()` now builds its header with `authHeaders()`; its behavior is unchanged. |
| `src/services/question-pdf.ts` | The PDF request sends the JWT (and `Accept: application/pdf`). On a 401 it signs the user out like every other signed-in request, and the screen shows the server's message. Before saving, it checks that the response really starts with `%PDF-`, so a proxy's error page is never saved to My PDFs. |

No UI, navigation, layout, storage, open/share/delete or PDF-content code changed.

## 4. Authentication and authorization rules

| Caller | Result |
|---|---|
| No token | **401** "Log in to continue." |
| Malformed, forged (wrong secret) or expired token | **401** |
| Token from before a password change (`tokenVersion`) | **401** |
| Account turned off (`active: false`) | **401** |
| Teacher of a turned-off tuition | **401** |
| Student | **403** |
| Signed up but not in a tuition | **403** |
| **Teacher** of an active tuition | **Allowed** |
| **Tuition account** of an active tuition | **Allowed**: it's the institute's own staff account. The app doesn't show it the feature today, so this is a deliberate policy choice; dropping `"tuition"` from the `requireUser` call would make it teacher-only. |

All checks come from the existing `requireUser` / `requireAccount` (`src/lib/auth.ts`). There is no new auth system and no token format change. The check runs **before** the body is read, so an anonymous 5 MB body gets a 401, not a 413.

The PDF is built only from the request body, plus figures from allow-listed hosts or this server's stored files. There is no database content to scope by tuition.

## 5. Request validation

- Body ≤ **4 MB**, checked by Content-Length up front and by counting while reading → **413**. A 300-question paper with solutions is well under 2 MB, and Vercel refuses bodies over 4.5 MB anyway.
- Must be a JSON object → **400**.
- The existing `parsePaper` rules still apply (**400**):
  - 1–300 questions;
  - `marksPerQuestion` a number from 0 to 100;
  - every text field a string, at most 20,000 characters (title 200);
  - at most 12 figures per list;
  - non-strings and objects (e.g. `{ "$gt": "" }`) refused.
- At most **600 distinct figures** per paper → **400**.

## 6. PDF resource protection

| Protection | Value |
|---|---|
| Who | Signed-in teacher or tuition account only |
| Body size | 4 MB |
| Questions | 300 (existing) |
| Figures | 600 distinct, downloads stop after 20 s (each also has the existing 10 s timeout, 5 MB cap and host allow-list) |
| Print deadline | 80 s, including time waiting in line |
| On timeout | Chrome closed, or killed after 5 s; the next paper starts a fresh one |
| Line per instance | 4 papers; more get 503 |
| Pages | Always closed (`finally`); a crashed Chrome is restarted once (existing behavior) |
| Errors | Generic messages to the client, details in the server log only |

## 7. Mobile compatibility

The new app code works with **both** the current production backend, which ignores the extra header, and the secured one. So the mobile update can ship first. Covered by the change:
- PDF generation from all three entry points;
- the same request body;
- binary handling (`arrayBuffer` → `addPdf`), with the new `%PDF-` check;
- My PDFs storage, opening, sharing and deleting, which are local to the phone and untouched.

A 401 now signs the user out, like the rest of the app. The mobile changes pass `npx expo lint` and `npx tsc --noEmit`. **Not tested on a device** (section 9).

## 8. Existing-app deployment compatibility

**Installed app versions send no token, so once this backend is live, PDF generation in them fails.** Teachers would see "Log in to continue." on the PDF screen; old versions don't sign the user out on this request. Everything else in the app keeps working.

The app has **no over-the-air updates** (`expo-updates` isn't installed), so the fix reaches phones only through a new EAS / store build.

**Safest coordinated rollout (no insecure bypass):**
1. Build and release the mobile update (EAS production build → stores). It works against today's backend, so releasing it early carries no risk.
2. Ask teachers to update. They're a small, known group, and the backend can't tell app versions apart, so check with them directly.
3. Test the backend on a **Vercel Preview** with a non-production database, using a new build pointed at the preview URL.
4. Deploy the backend to production. Any teacher still on an old build gets the clear error until they update.
5. Optionally, in a later step, add an app-version header so the backend can return a specific "Update the app" message. That isn't done here.

A temporary "allow requests without a token" switch was deliberately **not** added, as instructed.

## 9. Test results (all executed)

**`npm test`: 60 tests, 60 passed, 0 failed** (Step 1: 39, Step 2A: 21). The full suite was run twice and the Step 2A file three more times, with no failures. Tests use a throwaway in-memory MongoDB, never real data.

| Area | Tests (Step 2A) |
|---|---|
| Anonymous | 401; an anonymous 5 MB body also gets 401 (login checked before reading) |
| Invalid / expired JWT | Malformed, forged (wrong secret), expired → 401; token from before a password change → 401 |
| Disabled accounts | Turned-off user → 401; teacher of a turned-off tuition → 401 |
| Unauthorized roles | Student → 403; account with no tuition → 403 |
| Invalid bodies | Not JSON, array, 0 questions, wrong `marksPerQuestion` type, non-object question, operator object → 400 |
| Too large | 301 questions → 400; 660 figures → 400; 5 MB body without Content-Length → 413; oversized Content-Length → 413 |
| Valid PDF, Expo-shaped request | A teacher sends the app's exact body shape with a Bearer token → **200, real PDF printed by local Chrome**: `application/pdf`, `no-store`, filename header, starts with `%PDF-`, `X-Page-Count` equals pdf-lib's count (≥ 2: paper + answer key) |
| Tuition account | 200, real PDF |
| Rendering failure | Print error → 500 `"Could not make the PDF. Try again."`, no `detail`, no internal text; every page closed |
| Cleanup | Hanging print → `RenderTimeoutError`, browser closed, page closed; a Chrome that won't close is killed; after a timeout the next paper starts a fresh browser and prints |
| Busy | 5th waiting paper → `RenderBusyError`; the endpoint answers 503; the line clears afterwards |

**Static checks and builds**

| Check | Result |
|---|---|
| Backend `npm run lint` | Pass |
| Backend `npx tsc --noEmit` | Pass |
| Backend `next build` with a reachable database (in-memory) | **Pass** |
| Backend `npm run build` with no database | Fails at prerendering `GET /api/papers`: the known issue from Steps 1/1.5, not caused by this step. Compiling, lint and types pass first. |
| Mobile `npx expo lint` | Pass (0 problems) |
| Mobile `npx tsc --noEmit` | Pass |

**Not tested:**
- The app on a real phone. The mobile project has no test framework; its request shape is covered by the backend test that replays it.
- The Linux / `@sparticuz/chromium` path, and anything on Vercel. Local tests use Windows Chrome.
- The endpoint's 504 itself, which would take the real 80 s deadline. The deadline and cleanup are tested at the renderer with short limits, and the 504 mapping is a single line.

## 10. Vercel limitations (from the code; Vercel settings not visible)

1. **Function duration.** The route asks for `maxDuration = 120`. The upload route's own comment says 60 s is the Hobby-plan ceiling. Confirm the team's plan supports 120 s, or lower it (and the 80 s print deadline with it).
2. **Request body ≤ 4.5 MB** on Vercel. The new 4 MB cap fits under it.
3. **Response size.** The PDF is streamed (existing) to avoid the 4.5 MB cap on buffered responses. Large solution papers rely on this.
4. **Chromium.** On Linux, `@sparticuz/chromium@153` runs Chrome in `--single-process`. It needs Node ≥ 22.17 (local Node 22.15 warns at install; Vercel's `22.x` should be newer), and its binary is bundled via `outputFileTracingIncludes`. Chrome needs plenty of memory; there's no `vercel.json`, so the default function memory applies.
5. **Per-instance limits.** The one-at-a-time printing and 4-paper line are per instance. Vercel may run many instances, so total Chrome usage isn't capped globally; authentication is what limits who can cause it.
6. **Figures.** Downloads go only to `PDF_FIGURE_HOSTS` (default: the Vedclass CDN). Stored diagrams are read from MongoDB, so Preview needs a database that has them.

## 11. Remaining issues

1. Old installed apps lose PDF generation until updated (section 8). There's no version signal to show "Update the app".
2. No per-user rate limit. A signed-in teacher can still request many PDFs; the per-instance line and deadlines bound each request, not the total.
3. Other legacy routes from the Step 1 report are still open: `POST /api/attempts`, `/api/students*`, `GET /api/attempts/[id]`, `GET /api/dashboard`, and public answer keys in `GET /api/questions` and `GET /api/papers/[id]`.
4. `GET /api/papers` is prerendered at build time, so the build needs a database.
5. The 120 s `maxDuration` vs the Vercel plan is unverified.

## 12. Recommended next step

**Step 2B: secure the remaining legacy student routes.** That means `POST /api/attempts`, `GET /api/attempts/[id]`, `/api/students*` and `GET /api/students/[id]/attempts`, which currently trust a `studentId` from the request. Use `requireUser` and scope each record to the signed-in student or their tuition, after checking which app screens still call them. Coordinate the release with the mobile build from section 8 so one app update covers both.

Step 2B has not been started.
