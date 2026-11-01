# Current schema: enrollment-related collections

Database `pcmb` (MongoDB). Source of truth is `src/models/*.ts`; this file
describes the models that tuition membership and joining depend on. What
changed and why: [SCHEMA_HISTORY.md](SCHEMA_HISTORY.md).

## Relationships

```
tuitions 1 ──< users            users.tuitionId        (null until a tuition lets them in)
tuitions 1 ──< batches          batches.tuitionId
batches  1 ──< users            users.batchId          (students)
batches  1 ── 1 batchinvites    batchinvites.batchId   (unique, sparse; student codes)
tuitions 1 ── 1 batchinvites    batchinvites.tuitionId (one with kind "teacher"; no batchId)
users    1 ──< joinrequests     joinrequests.userId    (at most one with status "pending")
tuitions 1 ──< joinrequests     joinrequests.tuitionId
batches  1 ──< joinrequests     joinrequests.batchId   (only requests made with a batch code)
```

Membership means `users.tuitionId` and `users.role` are both set. `requireUser`
refuses everyone else with 403, so a student waiting for approval can reach no
protected API.

## `users`

| Field | Type | Notes |
|---|---|---|
| `email` | string, unique, lowercase | |
| `passwordHash` | string, hidden | bcrypt |
| `role` | "tuition" / "teacher" / "student" / null | null until a tuition lets them in |
| `name`, `phone` | string | |
| `tuitionId` | ObjectId, ref Tuition / null | |
| `active` | boolean | |
| `emailVerified` | boolean | must be true before a joining code can be used |
| `tokenVersion` | number | raised on password change; signs out every device |
| `failedLogins`, `lockedUntil` | number, Date / null (hidden) | login lockout |
| `joinCodeFailures`, `joinCodeLockedUntil` | number, Date / null (hidden) | joining-code lockout (new) |
| `lastLoginAt` | Date / null | |
| `pushTokens` | `{token, platform, updatedAt}[]` (hidden) | |
| `subjects` | string[] | teachers |
| `program`, `track`, `standard`, `batchId`, `parentPhone` | | students |

Indexes: `_id_`, `email_1` (unique), `tuitionId_1`, `batchId_1`, `tuitionId_1_role_1`, `pushTokens.token_1`.

## `joinrequests`

| Field | Type | Notes |
|---|---|---|
| `userId` | ObjectId, ref User, required | |
| `tuitionId` | ObjectId, ref Tuition, required | taken from the code, never from the client |
| `role` | "student" / "teacher" | set from the code used, never from the client; default "student" |
| `batchId` | ObjectId, ref Batch / null | set for a batch's joining code; null for a teacher request |
| `subjects` | string[] (Physics / Chemistry / Mathematics / Biology) | teacher requests: what they said they can teach; copied to `users.subjects` on approval |
| `status` | "pending" / "accepted" / "rejected" / "cancelled" | |
| `acceptedAs` | "student" / "teacher" / null | matches `role` once accepted |
| `decidedAt`, `createdAt` | Date | |

Indexes: `_id_`, `userId_1`, `tuitionId_1_status_1_createdAt_-1`, **`one_pending_per_user`** (unique `{userId: 1}` where `status = "pending"`).

## `batchinvites`

See the field table in SCHEMA_HISTORY.md. Adds `kind` ("student" default / "teacher"); `batchId` is optional (absent for the institute's teacher code). Indexes: `_id_`, `batchId_1` (unique, **sparse**), `codeHash_1` (unique, sparse), `tuitionId_1`, **`one_teacher_invite_per_tuition`** (unique `{tuitionId: 1}` where `kind = "teacher"`).

## `batches` (unchanged)

`tuitionId`, `name`, `program`, `track` (required), `standard` ("11th" / "12th"), `academicYear`, `subjects`, `venue`, `schedule`, `teachers[{teacherId, subject}]`, `active`. Indexes: `_id_`, `tuitionId_1`, `teachers.teacherId_1`.

A batch takes students through a code only when it is active, offered (JEE or NEET) and has a `standard`.

## `tuitions`

`name`, `address`, `phone`, `email`, `active`. The old `joinCode` field was removed (see SCHEMA_HISTORY.md, teacher invitations). Indexes: `_id_`.

## `testrooms` (a test set for a batch)

| Field | Type | Notes |
|---|---|---|
| `tuitionId`, `batchId`, `teacherId` | ObjectId | Scoped to the session's tuition on every query. |
| `title`, `subject`, `standard` | string | `subject` is one the teacher teaches in the batch. |
| `questions` | array | Copies of bank questions taken when the test was made; `sourceId` points at the original `questions` document, which a test never changes. |
| `marksPerQuestion`, `negativeMarks` | number | Right answer +marks; wrong answer −negativeMarks (not more than `marksPerQuestion`). |
| `durationMinutes` | number | Each student's time limit, from when they start. Separate from the window below. |
| `opensAt`, `closesAt` | Date (UTC) | Both required. The window must be at least `durationMinutes` long; the last permitted start is `closesAt − durationMinutes`. "Close now" sets `closesAt` to that moment. |
| `createdAt`, `updatedAt` | Date | |

Not stored, so they can't disagree with the fields above: the status (upcoming = `scheduled`,
live = `open`, completed = `closed`, from `opensAt`/`closesAt` in `statusOf`), the question
count (`questions.length`) and the maximum marks (`questions.length × marksPerQuestion`).

Indexes: `_id_`, `batchId_1`, `teacherId_1`, `tuitionId_1_createdAt_-1`, `tuitionId_1_batchId_1_opensAt_-1`.
A student's attempt is in `testattempts` (unique per `testId` + `studentId`); an upcoming test can only
be edited or cancelled while it has none.

`testattempts.rev` (Number, default 0; added in Phase 2A, no migration: a missing value counts as 0) goes up
by one with every answer save. Scoring (`finalize` in `lib/attempts.ts`) only writes a result if `rev` is
still what it read, so an answer saved at the same moment is never left out. Answers, correctness flags and
solutions reach a student only once the test has closed (`resultsReleased`); submitting early shows the score only.

Secure exam (Phase 2B; no migration: missing values read as `null` / `[]`):

| Field | Type | Meaning |
|---|---|---|
| `testattempts.endedReason` | `"violation"` \| `null` (default `null`) | Set when the attempt was ended because the app was away longer than `AWAY_LIMIT_MS` (10 s). `null` for a normal submit or timeout. An ended attempt can't be restarted or edited. |
| `testattempts.events` | array, newest 50 kept | Interruptions reported by the phone (`POST /api/tests/[id]/events`), recorded by `recordEvent`. |
| `events[].type` | `"away"` | The only event type. |
| `events[].at` | Date | When the server received the report. |
| `events[].awayMs` | Number | Time out of the foreground as measured by the phone (capped at 24 h). |
| `events[].ended` | Boolean | True when the server judged this interruption long enough to end the attempt. |

A violation always ends the attempt, even if the report carries invalid answers: those are not stored, and the
answers already saved are scored.

## Academic content (never touched by enrollment)

`paper`, `questions`, `testrooms`, `testattempts`, `attempts`, `practiceanswers`, `selfassessments`, `syllabusprogresses`, `chapterweightages`, `storedfiles`, `timetableentries`, `announcements`. Enrollment code does not read or write them.
