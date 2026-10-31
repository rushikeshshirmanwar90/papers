# 002: Teacher invitations

Development data only; no real institute used the old institute join code.

## Required once per database

`batchinvites.batchId_1` used to be a non-sparse unique index. With teacher
codes (no `batchId`) it must be sparse, and MongoDB will not change the options
of an existing index. Drop it once; the app recreates it on the next start:

```js
db.batchinvites.dropIndex("batchId_1")
```

Optional clean-up of the removed field and its index:

```js
db.tuitions.updateMany({}, { $unset: { joinCode: "" } })
db.tuitions.dropIndex("joinCode_1")
```

## Data

- Existing `batchinvites` have no `kind`; they read as "student".
- Existing `joinrequests` have no `role` or `subjects`; they read as "student" and []. Old pending requests that carry no batch (made with the removed institute code) can no longer be approved: reject or delete them.
- Nothing in questions, papers, answers, explanations or tests is touched.
