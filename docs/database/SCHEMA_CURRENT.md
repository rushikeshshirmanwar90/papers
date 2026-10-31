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

## Academic content (never touched by enrollment)

`paper`, `questions`, `testrooms`, `testattempts`, `attempts`, `practiceanswers`, `selfassessments`, `syllabusprogresses`, `chapterweightages`, `storedfiles`, `timetableentries`, `announcements`. Enrollment code does not read or write them.
