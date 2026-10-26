# Step 2B — Legacy API Cleanup Report

_Date: 2026-10-26 · Branch: `refactor/step2b-remove-legacy-apis` in both repos, from the latest `origin/main` (Steps 1, 1.5 and 2A merged) · Not committed, pushed or deployed._

## Summary

Four unauthenticated endpoints from the original "name + email login" app had **no consumers**: not in the current code, not in any version of the Expo app's git history, and not in the backend's web pages. They are **deleted**, together with the scoring helper and shared types only they used.

`/api/dashboard` **is still used** by the backend's web Paper Reader home page, so it was **kept**.

No database collection, record or model was deleted. The mobile app needed **no changes**.

## 1. Endpoints investigated

| Endpoint | What it did | Auth |
|---|---|---|
| `POST /api/students` | Find-or-create a legacy `Student` by name + email ("mobile login", no password) | None |
| `GET /api/students` | List **every** legacy student (names, emails) | None |
| `GET /api/students/[id]/attempts` | A student's legacy paper attempts with paper details | None |
| `POST /api/attempts` | Score answers for any `studentId` / `paperId` and store an `Attempt` | None |
| `GET /api/attempts/[id]` | Rebuild an attempt's review, **including correct answers** | None |
| `GET /api/dashboard` | Counts of papers, questions, legacy attempts and legacy students | None |

## 2. Consumers and evidence

| Endpoint | Current backend source | Backend web pages | Expo app (current) | Expo app (**all** git history, every branch) | Backend git history |
|---|---|---|---|---|---|
| `/api/students` | Its own route only | None | None | **Never referenced** | Added in the initial commit `71c6285` (2026-09-06); never called anywhere else |
| `/api/students/[id]/attempts` | Its own route only | None | None | **Never referenced** | Same |
| `/api/attempts` | Its own route only | None | None | **Never referenced** | Same |
| `/api/attempts/[id]` | Its own route only | None | None | **Never referenced** | Same |
| `/api/dashboard` | — | **`src/app/(site)/page.tsx`**, the Paper Reader home: four stat cards | None | Never referenced | — |

How this was checked:
- Searched both repos' `src/`, `scripts/` and `tests/` for these URLs, ignoring the newer `/tuition/students`, `/analysis/student/*` and `/tests/*` routes.
- Ran `git log --all -S` for `/students`, `/attempts`, `attempt-questions` and `submitAttempt` across the whole Expo history (31 commits since 2026-09-27). It never contained them.

The new app does all of this through its own routes:
- **Logins:** `/api/auth/*`, with roles on `User`.
- **Tests:** `/api/tests/*` → `TestRoom` / `TestAttempt`.
- **Results:** `/api/analysis/*`.
- **Practice:** `/api/pyq*` → `PracticeAnswer`.

## 3. Classification

| Endpoint | Category | Decision |
|---|---|---|
| `/api/students` (POST, GET) | **C**: confirmed obsolete, no identified consumers | **Deleted** |
| `/api/students/[id]/attempts` | **C** | **Deleted** |
| `/api/attempts` | **C** | **Deleted** |
| `/api/attempts/[id]` | **C** | **Deleted** |
| `/api/dashboard` | **A**: used by the backend web interface | **Kept** |

**Why not category B (deployed clients)?** Every build of the Expo app comes from `pcmb-paper`, and no version of it ever called these routes. A client outside these repos can't be ruled out from source code alone. Your teammate can confirm by checking Vercel's request logs for `/api/students` and `/api/attempts` before merging (see section 7).

Deleting these routes also **closes security holes**:
- `GET /api/students` exposed every legacy student's name and email to anyone.
- `POST /api/students` and `POST /api/attempts` let anyone create records. Fake `Attempt` records could even be used to block an admin from deleting any paper, through Step 1's history guard.
- `GET /api/attempts/[id]` revealed answer keys.

## 4. Files modified or deleted

### Backend (`papers/`)

| File | Change |
|---|---|
| `src/app/api/students/route.ts` | **Deleted** |
| `src/app/api/students/[id]/attempts/route.ts` | **Deleted** |
| `src/app/api/attempts/route.ts` | **Deleted** |
| `src/app/api/attempts/[id]/route.ts` | **Deleted** |
| `src/lib/scoring.ts` | **Deleted**: its two exports (`buildReview`, `GivenAnswerInput`) were used only by the deleted attempt routes. The new tests use `lib/marking.ts` / `lib/attempts.ts`, which are untouched. |
| `src/shared/types.ts` | Removed `MARKING_SCHEME` (only `scoring.ts` imported it) and the response types of the deleted endpoints (`Student`, `GivenAnswer`, `AnsweredReview`, `Attempt`, `AttemptResult`), which nothing imports. `DashboardStats` and `QuestionForAttempt` stay. |
| `README.md` | Removed the four deleted endpoints from the API table. |
| `tests/step2b-legacy-cleanup.test.ts` | **New**: regression tests (section 8). |
| `STEP2B_LEGACY_CLEANUP_REPORT.md` | **New**: this report. |

Deleted code is kept in git history, and nothing was commented out.

### Mobile (`pcmb-paper/`)

**No changes.** It never referenced these endpoints. The `refactor/step2b-remove-legacy-apis` branch exists there but is identical to `origin/main`, so it can be deleted (`git branch -d refactor/step2b-remove-legacy-apis`).

## 5. Endpoints retained and why

| Endpoint | Why kept | Follow-up |
|---|---|---|
| `GET /api/dashboard` | Category A: the Paper Reader home page shows its counts. | It's public and still counts legacy `Attempt` / `Student`. Either move it behind the admin session, or have it count `TestAttempt` / `User` instead, when the Paper Reader is next reworked. |
| `GET /api/papers/[id]/attempt-questions` (not in scope; related) | The question feed of the same legacy "attempt a paper" flow. **No consumers found** in either repo or the Expo history. It's a shared Paper API, and the brief says not to delete those just because they're old. | Candidate for removal in a later cleanup. It's read-only and withholds answers, so it's low risk. |
| Question / Paper / files / filters / PDF APIs | Used by the current app and the Paper Reader. | — |

## 6. Database safety and unused models

Nothing in the database was touched: no collections dropped, no records deleted, no migrations.

| Model | Status | Still referenced by | Recommendation |
|---|---|---|---|
| `Student` (`students` collection) | **Obsolete.** Nothing writes to it any more; it only held the old name+email students. | `/api/dashboard` (count) | Keep for now. Later, decide whether to keep, archive or delete these old **personal records (names, emails)**. They're no longer readable through the API. |
| `Attempt` (`attempts` collection) | **Obsolete for new data.** Nothing writes to it any more. It is **historical assessment data.** | `/api/dashboard` (count) and `lib/question-bank.ts` (Step 1 guard: papers or questions with past attempts can't be deleted) | **Keep**, as the archival step planned in Step 1 requires. |

All the other models are part of the new architecture and actively used: `User`, `Tuition`, `Batch`, `TestRoom`, `TestAttempt`, `PracticeAnswer`, `Question`, `Paper`, `StoredFile`, `SyllabusProgress`, `ChapterWeightage`, `TimetableEntry`, `Announcement`, `JoinRequest`, `EmailCode`, `NotificationLog`.

## 7. Compatibility risks

1. **Unknown external client.** If something outside these repos still calls the deleted routes, it now gets **404**. Mitigation: before merging, check Vercel's logs for traffic to `/api/students*` and `/api/attempts*` over a recent period.
2. **Legacy attempt reviews.** Students of the old app can no longer re-open old reviews through `/api/attempts/[id]`. The current app never offered this, and the `Attempt` records themselves are kept.
3. **Nothing in the new app is affected.** It uses different routes (section 2), and its route files are checked by a test.

## 8. Tests and build results (all executed)

| Check | Result |
|---|---|
| Backend `npm run lint` | **Pass** |
| Backend `npx tsc --noEmit` | **Pass.** Before the build it showed 8 errors, all in `.next/types/` for the deleted routes: stale, gitignored output from an earlier local build. The build regenerates that folder, after which TypeScript is clean. Fresh clones and CI aren't affected. |
| Backend `npm test` | **Pass: 64/64** (39 Step 1, 21 Step 2A, 4 new) |
| Backend `next build` with a reachable database (in-memory) | **Pass** |
| Backend `npm run build` with no database | Fails at prerendering `GET /api/papers`: the known issue from earlier steps, unrelated to this change. Compiling, lint and types pass first. |
| Mobile `npx expo lint` | **Pass** (0 problems) |
| Mobile `npx tsc --noEmit` | **Pass** |

New regression tests (`tests/step2b-legacy-cleanup.test.ts`):
- The `students` and `attempts` route folders and `scoring.ts` are gone.
- No source file in backend `src/` or `scripts/`, or in mobile `src/`, calls `/api/students` or `/api/attempts`.
- The new app's routes still exist: auth, tuition batches and students, tests start/submit, analysis, PYQ, question bank, papers, PDF and dashboard.
- With legacy `Student` / `Attempt` records present, `/api/dashboard` still counts them, so the data and models are intact.

The existing suites still pass and cover the features the brief lists:
- **Authentication** for students, teachers and tuition accounts (JWT on `/api/auth/me`).
- **Starting a test** (`/api/tests/[id]/start`).
- **PDF generation** (real PDFs).
- **Question bank** protections.

**Not covered by automated tests here:** batch management, test creation and submission scoring, analytics, and PYQ answering. Their routes and libraries weren't touched by this step (only deletions of unrelated files), the build compiles them, and the route-existence test checks they're still there.

## 9. Remaining security vulnerabilities

1. **Public answer keys:** `GET /api/questions`, `GET /api/papers/[id]` (and `/api/papers`) return `correctAnswer` and `explanation` to anyone.
2. **`GET /api/dashboard`** is public. Aggregate counts only; low risk.
3. **`GET /api/papers/[id]/attempt-questions`** is public and has no consumers (section 5).
4. **`GET /api/files/[id]`** serves stored PDFs and diagrams to anyone with the id.
5. **No per-user rate limits** on PDF generation and uploads; the per-instance limits from Steps 1 and 2A apply.
6. **Legacy `students` records** (names, emails) are still stored. They're no longer exposed, but there's a data-retention decision to make.
7. The rollout risk from Step 2A (old app versions can't make PDFs) still applies until the new mobile build is released.

## 10. Recommended next step

**Step 2C: stop serving answer keys to anonymous users.**
- Check which current screens read `correctAnswer` / `explanation` from `GET /api/questions` and `GET /api/papers/[id]`: the teacher question bank, the PDF builder, the Paper Reader.
- Require a staff login (teacher, tuition, or the admin) for answer fields, and serve students only through `/api/pyq*`, which already withholds and reveals answers per question.
- At the same time, decide what to do with `/api/papers/[id]/attempt-questions` and `/api/dashboard`.

Step 2C has not been started.
