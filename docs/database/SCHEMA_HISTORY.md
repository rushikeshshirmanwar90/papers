# Schema history

Newest first. Each entry lists only what changed. The current full shape of the
enrollment-related models is in [SCHEMA_CURRENT.md](SCHEMA_CURRENT.md); each
data migration has its own file under [migrations/](migrations/).

## 2026-10-31: Teacher invitations (migration 002)

Teachers join with an institute-wide teacher code that reuses the student
invitation code machinery. The tuition's old `joinCode` (never used) is gone.

| Model | Change |
|---|---|
| `BatchInvite` (`batchinvites`) | New `kind` "student" / "teacher" (default "student"). `batchId` is now optional and its unique index is **sparse**, so the institute's teacher code can omit it. New unique partial index `one_teacher_invite_per_tuition` on `{tuitionId: 1}` where `kind = "teacher"`. A teacher code's ciphertext is bound to the tuition id instead of a batch id. Hashing and sealing are the same functions as for student codes. |
| `JoinRequest` (`joinrequests`) | New `role` "student" / "teacher" (default "student"; set by the server from the code) and `subjects` string[] (default []). Teacher requests have `batchId` null. |
| `Tuition` (`tuitions`) | Removed `joinCode` and its unique sparse index. |

API changes: removed `/api/tuition/join-code` and the "accept as student or teacher" body of `/api/tuition/join-requests/:id/accept` (it now only approves a pending teacher request). New `/api/tuition/teacher-invite`. `POST /api/join-requests` takes `subjects` for a teacher code. Nothing about batches, assignments, tests or question data changed.

See [migrations/002-teacher-invitations.md](migrations/002-teacher-invitations.md).

## 2026-10-31: Student joining codes (migration 001)

Source of the "before" side: the last commit (`093815a`) of this repository. All
joining-code work was uncommitted when this was written, so `git diff HEAD --
src/models` shows exactly this change. Every change is additive and optional:
no existing document needed rewriting.

### `joinrequests` (`src/models/JoinRequest.ts`)

| | Before | After |
|---|---|---|
| Fields | `userId` ObjectId (ref User, required), `tuitionId` ObjectId (ref Tuition, required), `status` string enum pending / accepted / rejected / cancelled (default pending), `acceptedAs` "student" / "teacher" / null, `decidedAt` Date / null, `createdAt` Date | all of those, plus `batchId` ObjectId (ref Batch), default null |
| Indexes | `_id_`; `userId_1` (from `index: true`); `tuitionId_1_status_1_createdAt_-1` | unchanged, plus `one_pending_per_user`: unique on `{userId: 1}` where `status = "pending"` |
| Meaning | A person asks a tuition, using the tuition's own join code, to be let in as student or teacher. | Same. When `batchId` is set, the request came with a batch's joining code: it can only ever become a student of that batch. Older requests have no `batchId` and read as null. |

### `users` (`src/models/User.ts`)

| | Before | After |
|---|---|---|
| New fields | none | `joinCodeFailures` Number (default 0, hidden from queries), `joinCodeLockedUntil` Date / null (default null, hidden) |
| Indexes | `_id_`, `email_1`, `tuitionId_1`, `batchId_1`, `tuitionId_1_role_1`, `pushTokens.token_1` | unchanged |
| Meaning | | Counts wrong joining codes in a row and locks code entry for 15 minutes after 10. Missing on older users; they read as 0 / null. |

### `batchinvites` (new collection, `src/models/BatchInvite.ts`)

One document per batch, holding the code students join that batch with.

| Field | Type | Notes |
|---|---|---|
| `tuitionId` | ObjectId, ref Tuition, required | |
| `batchId` | ObjectId, ref Batch, required | unique |
| `status` | "active" / "revoked" | default active |
| `codeHash` | string | HMAC-SHA256 of the code, to look it up. Unique, sparse. Removed on revoke. |
| `codeCipher` | string | AES-256-GCM `iv.tag.body` (base64), bound to the batch id, so the tuition can read the code again. Removed on revoke. |
| `expiresAt` | Date / null | null: never expires |
| `createdBy` | ObjectId, ref User / null | |
| `rotatedAt`, `revokedAt` | Date / null | |
| `createdAt` | Date | |

Indexes: `_id_`, `batchId_1` (unique), `codeHash_1` (unique, sparse), `tuitionId_1`.

### Unchanged by this work

`tuitions` (the old `joinCode` was later removed, see the teacher invitations entry),
`batches`, and every academic collection (`paper`, `questions`, `testrooms`,
`testattempts`, `attempts`, `practiceanswers`, `selfassessments`,
`syllabusprogresses`, `chapterweightages`, `storedfiles`, `timetableentries`,
`announcements`).

### Code changes that depend on the schema

- Batch-code requests are decided through `POST /api/tuition/enrollments/decide`. The older `/api/tuition/join-requests/:id/accept` refuses any request that has a `batchId`, so a batch code can never produce a teacher.
- A batch can only take a code while it is active, JEE or NEET, and has a class (11th or 12th).

## 2026-10-30: Academic programs (migration `2026-10-30-step25-academic-programs`)

Added `program` to batches and students. Not part of this entry's scope; see `scripts/migrations/2026-10-30-step25-academic-programs.mjs`.
