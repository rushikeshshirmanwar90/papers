import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import type { ResolvedCode } from "@/lib/batch-invite";

const tuition = { name: "Sunrise" } as never;
const batch = { name: "NEET 2027" } as never;
let joinRequestPush: typeof import("@/lib/batch-invite").joinRequestPush;

describe("join request push", () => {
  before(async () => {
    // The models read this at import time; the helper never touches the database.
    process.env.MONGODB_URI ??= "mongodb://127.0.0.1:1/unused";
    ({ joinRequestPush } = await import("@/lib/batch-invite"));
  });

  test("a batch request opens People, not Home", () => {
    const push = joinRequestPush({ kind: "batch", tuition, batch } as ResolvedCode, "Asha");
    assert.deepEqual(push.data, { tab: "people", kind: "batch-enrollment" });
    assert.match(push.body, /Asha asked to join NEET 2027/);
  });

  test("a teacher request opens People", () => {
    const push = joinRequestPush({ kind: "teacher", tuition } as ResolvedCode, "Asha");
    assert.deepEqual(push.data, { tab: "people", kind: "teacher-request" });
    assert.match(push.body, /People › Teachers/);
  });
});
