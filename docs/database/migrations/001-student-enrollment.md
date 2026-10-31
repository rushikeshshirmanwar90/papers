# Migration 001: student enrollment (joining codes)

Id `2026-10-31-student-enrollment`, version 1. Script:
`scripts/migrations/2026-10-31-student-enrollment.mjs`.

## What changes

All schema changes are additive and optional (see [SCHEMA_HISTORY.md](../SCHEMA_HISTORY.md)),
so **no document is rewritten, deleted or normalised**. The migration creates indexes only.

| Collection | Old | New |
|---|---|---|
| `joinrequests` | no `batchId`; indexes `userId_1`, `tuitionId_1_status_1_createdAt_-1` | optional `batchId` (ObjectId or null); adds `one_pending_per_user` (unique `{userId}` where `status = "pending"`) |
| `users` | no `joinCodeFailures`, `joinCodeLockedUntil` | optional fields, default 0 / null |
| `batchinvites` | does not exist | new collection with indexes `batchId_1` (unique), `codeHash_1` (unique, sparse), `tuitionId_1` |

Why: a batch's code leads to one batch of one tuition (`batchId`); two taps or
two devices must not create two pending requests (`one_pending_per_user`);
guessing codes is rate limited (`joinCodeFailures`/`joinCodeLockedUntil`);
codes are stored as a keyed hash plus ciphertext, never plain text
(`batchinvites`).

## Data transformations

None required. Older documents read correctly:

- A `joinrequests` document with no `batchId` is a tuition-code request (`batchId: null` matches a missing field). It keeps using the older accept-as-student-or-teacher flow.
- A `users` document with no `joinCodeFailures` / `joinCodeLockedUntil` counts as 0 / not locked.

The only data condition that matters is the unique index: no person may have
more than one `pending` join request. The script refuses to run if any do.
(Cleaning such rows is the only data cleanup this migration could ever need,
and only of obsolete pending requests; none existed when it was run.)

## Procedure

Run from `papers/`. Every step takes `MONGODB_URI` from `.env.local`; nothing
prints credentials, emails or names.

1. **Dry run** (read-only): `node --env-file=.env.local scripts/migrations/2026-10-31-student-enrollment.mjs`. Lists indexes to create, duplicate pending requests (a blocker if > 0), and document counts.
2. **Backup**: `... --backup --out "<dir outside the repo and outside OneDrive>"`. Exports `users`, `batches`, `tuitions`, `joinrequests`, `batchinvites` (if present) and `schemamigrations` as EJSON with a `manifest.json` (document counts, SHA-256, index specs, and the document counts of every academic collection). It reads each file back and compares it with the live collection before reporting success. The backup holds student accounts: keep it out of Git.
3. **Apply**: `... --apply --confirm-db pcmb --allow-remote --backup-dir "<dir>"`. Refuses without a matching, unmodified backup, refuses if duplicate pending requests exist, creates the missing indexes, checks that the academic collections' document counts are unchanged, and records the run in `schemamigrations`.
4. **Verify** (read-only): `... --verify`. Re-run any time.

Also set `JOIN_CODE_SECRET` (32+ characters) on the server before the first code is issued. It is not part of the database. If it is missing the server falls back to `JWT_SECRET`, and changing either makes stored codes unreadable (the tuition then regenerates them).

## Rollback and recovery

- **Indexes only:** `... --rollback --confirm-db pcmb --allow-remote` drops exactly `one_pending_per_user` and the three `batchinvites` indexes. Documents are untouched. Use this only if the feature is backed out: the application creates the same indexes again on its next start unless the old code is deployed.
- **Documents:** nothing was changed, so there is nothing to restore. If a later change damages `users`, `batches`, `tuitions` or `joinrequests`, restore from the backup's `<collection>.ejson` (parse with `EJSON.parse` from `bson` and `insertMany` into an emptied copy, or into a scratch collection and compare). Never restore over the live collection without comparing first.
- **Join codes** live in `batchinvites`. Dropping that collection only invalidates codes already shared; tuition admins make new ones under Invite Students.
- **Academic content** is never read or written by this migration, so it needs no restore. Its document counts are recorded in `manifest.json` for comparison.

## Result of the run on `pcmb` (2026-10-31)

| | |
|---|---|
| Server | MongoDB 8.0.36 (Atlas) |
| Duplicate pending requests | 0 |
| Indexes created | `joinrequests.one_pending_per_user`, `batchinvites.batchId_1`, `batchinvites.codeHash_1`, `batchinvites.tuitionId_1` |
| Documents migrated | 0 |
| Documents deleted | 0 |
| Backed up (verified) | users 5, batches 7, tuitions 1, joinrequests 2, schemamigrations 1 |
| Academic collections, before and after | identical (e.g. `questions` 278034, `paper` 1465) |
| Mongoose vs live indexes (`diffIndexes`) | nothing to create, nothing to drop, for JoinRequest, BatchInvite, User, Batch, Tuition |
