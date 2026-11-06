// Student invitation lifecycle: account status, invitation tracking,
// resend, activation via password change, and count exclusions.
// Run with: npx tsx --test tests/student-invitation.test.ts
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server";
import { NextRequest } from "next/server";

const BASE = "http://localhost:3000";

let mongod: MongoMemoryServer | undefined;
let m: Awaited<ReturnType<typeof load>>;

async function load() {
  const [students, studentId, checkEmail, changePw, resendInvite, overview, auth, db] = await Promise.all([
    import("@/app/api/tuition/students/route"),
    import("@/app/api/tuition/students/[id]/route"),
    import("@/app/api/tuition/students/check-email/route"),
    import("@/app/api/auth/change-password/route"),
    import("@/app/api/tuition/students/[id]/resend-invitation/route"),
    import("@/app/api/tuition/overview/route"),
    import("@/lib/auth"),
    import("@/lib/db"),
  ]);
  return {
    students,
    studentId,
    checkEmail,
    changePw,
    resendInvite,
    overview,
    auth,
    db,
    Tuition: (await import("@/models/Tuition")).default,
    User: (await import("@/models/User")).default,
    Batch: (await import("@/models/Batch")).default,
  };
}

const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

const req = (method: string, path: string, who: string, body?: unknown) =>
  new NextRequest(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[who]}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const json = async (response: Response, status?: number) => {
  const data = await response.json();
  if (status !== undefined) assert.equal(response.status, status, `expected ${status}, got ${response.status}: ${JSON.stringify(data)}`);
  return data;
};

const noParams = {};

before(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "student_invitation_test";
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long!!";
  // No SMTP configured: email will fail, which is what we want to test.
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  m = await load();
  await m.db.connectDB();

  // Create a tuition and its admin.
  const tuition = await m.Tuition.create({ name: "Test Tuition", active: true });
  ids.tuition = String(tuition._id);
  const admin = await m.User.create({
    email: "admin@test.com",
    passwordHash: await m.auth.hashPassword("admin123"),
    role: "tuition",
    name: "Admin",
    tuitionId: tuition._id,
    active: true,
    emailVerified: true,
  });
  tokens.admin = await m.auth.signToken(admin);

  // Create a batch.
  const batch = await m.Batch.create({
    tuitionId: tuition._id,
    name: "NEET 11th A",
    nameKey: "neet 11th a",
    program: "NEET",
    track: "NEET",
    standard: "11th",
    subjects: ["Physics", "Chemistry", "Biology"],
    active: true,
  });
  ids.batch = String(batch._id);
});

after(async () => {
  // Closing the connection lets the test process exit; otherwise it waits on it until the runner gives up.
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

describe("student creation sets invited status", () => {
  test("new admin-created student has accountStatus=invited and invitationStatus tracking", async () => {
    const res = await m.students.POST(
      req("POST", "/api/tuition/students", "admin", {
        name: "New Student",
        email: "student1@test.com",
        password: "Password123!",
        program: "NEET",
        standard: "11th",
        batchId: ids.batch,
        enrollmentMethod: "enroll_immediately",
      }), {},
    );
    assert.equal(res.status, 200);
    const data = await json(res);
    assert.equal(data.student.accountStatus, "invited");
    // Email failed because SMTP is not configured.
    assert.equal(data.emailSent, false);
    assert.ok(data.emailError);
    ids.student1 = data.student.id;

    // Verify in DB.
    const dbUser = await m.User.findById(ids.student1);
    assert.equal(dbUser?.accountStatus, "invited");
    assert.equal(dbUser?.invitationStatus, "send_failed");
    assert.equal(dbUser?.mustChangePassword, true);
    assert.ok(dbUser?.invitedAt);
  });

  test("existing self-registered users default to active", async () => {
    const existing = await m.User.create({
      email: "selfregistered@test.com",
      passwordHash: await m.auth.hashPassword("pass1234"),
      role: "student",
      name: "Self Registered",
      tuitionId: ids.tuition,
      active: true,
      emailVerified: true,
      program: "NEET",
      track: "NEET",
      standard: "11th",
    });
    // accountStatus defaults to "active" (schema default).
    assert.equal(existing.accountStatus, "active");
  });
});

describe("student listing filters by accountStatus", () => {
  test("?accountStatus=invited returns only invited students", async () => {
    const res = await m.students.GET(
      req("GET", "/api/tuition/students?accountStatus=invited", "admin"), noParams,
    );
    const data = await json(res);
    assert.ok(data.students.length >= 1);
    assert.ok(data.students.every((s: { accountStatus: string }) => s.accountStatus === "invited"));
  });

  test("?accountStatus=active excludes invited students", async () => {
    const res = await m.students.GET(
      req("GET", "/api/tuition/students?accountStatus=active", "admin"), noParams,
    );
    const data = await json(res);
    assert.ok(data.students.every((s: { accountStatus: string }) => s.accountStatus === "active"));
    assert.ok(!data.students.some((s: { id: string }) => s.id === ids.student1));
  });
});

describe("check-email gives contextual messages", () => {
  test("invited student shows invitation message with studentId", async () => {
    const res = await m.checkEmail.GET(
      req("GET", "/api/tuition/students/check-email?email=student1@test.com", "admin"), noParams,
    );
    const data = await json(res);
    assert.equal(data.available, false);
    assert.equal(data.accountStatus, "invited");
    assert.equal(data.studentId, ids.student1);
    assert.ok(data.reason.includes("invited"));
  });

  test("active student shows active message", async () => {
    const res = await m.checkEmail.GET(
      req("GET", "/api/tuition/students/check-email?email=selfregistered@test.com", "admin"), noParams,
    );
    const data = await json(res);
    assert.equal(data.available, false);
    assert.equal(data.accountStatus, "active");
  });

  test("unknown email is available", async () => {
    const res = await m.checkEmail.GET(
      req("GET", "/api/tuition/students/check-email?email=new@test.com", "admin"), noParams,
    );
    const data = await json(res);
    assert.equal(data.available, true);
  });
});

describe("resend invitation", () => {
  test("resend for invited student updates invitationStatus (email still fails without SMTP)", async () => {
    const res = await m.resendInvite.POST(
      req("POST", `/api/tuition/students/${ids.student1}/resend-invitation`, "admin"),
      { params: { id: ids.student1 } },
    );
    assert.equal(res.status, 200);
    const data = await json(res);
    // Email fails because SMTP is not configured.
    assert.equal(data.emailSent, false);
    assert.ok(data.emailError);
    assert.equal(data.student.invitationStatus, "send_failed");
  });

  test("resend for active student is rejected", async () => {
    const active = await m.User.findOne({ email: "selfregistered@test.com" });
    const res = await m.resendInvite.POST(
      req("POST", `/api/tuition/students/${active!._id}/resend-invitation`, "admin"),
      { params: { id: String(active!._id) } },
    );
    assert.equal(res.status, 409);
  });
});

describe("password change activates student", () => {
  test("changing password transitions invited → active", async () => {
    // Sign in as the student.
    const student = await m.User.findById(ids.student1).select("+passwordHash");
    assert.ok(student);
    assert.equal(student.mustChangePassword, true);
    assert.equal(student.accountStatus, "invited");

    const studentToken = await m.auth.signToken(student);

    // Use requireAccount (not requireUser) since requireUser blocks mustChangePassword students.
    const res = await m.changePw.POST(
      new NextRequest(`${BASE}/api/auth/change-password`, {
        method: "POST",
        headers: { authorization: `Bearer ${studentToken}`, "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "Password123!", newPassword: "NewSecure456!" }),
      }), noParams,
    );
    assert.equal(res.status, 200);

    // Verify activation.
    const updated = await m.User.findById(ids.student1);
    assert.equal(updated?.accountStatus, "active");
    assert.equal(updated?.mustChangePassword, false);
  });
});

describe("overview excludes invited from counts", () => {
  test("invited students don't count in totals or unassigned", async () => {
    // Create a fresh invited student (no batch) to check unassigned.
    await m.User.create({
      email: "invited-nobatch@test.com",
      passwordHash: await m.auth.hashPassword("temp1234"),
      role: "student",
      name: "Invited No Batch",
      tuitionId: ids.tuition,
      active: true,
      emailVerified: true,
      mustChangePassword: true,
      accountStatus: "invited",
      program: "NEET",
      track: "NEET",
      standard: "11th",
    });

    const res = await m.overview.GET(
      req("GET", "/api/tuition/overview", "admin"), noParams,
    );
    const data = await json(res);
    // student1 is now active (password changed above); selfregistered is active;
    // invited-nobatch is invited. Only 2 active students should count.
    assert.equal(data.totals.students, 2);
    // selfregistered has no batch → 1 unassigned. invited-nobatch doesn't count.
    assert.equal(data.totals.unassignedStudents, 1);
  });
});

describe("duplicate account handling", () => {
  test("creating student with existing email fails with MongoDB unique constraint", async () => {
    const res = await m.students.POST(
      req("POST", "/api/tuition/students", "admin", {
        name: "Duplicate",
        email: "student1@test.com",
        password: "Password123!",
        program: "NEET",
        standard: "11th",
      }), {},
    );
    // The unique index on email should cause a failure.
    assert.notEqual(res.status, 200);
  });
});

describe("batch enrollment preserved for invited students", () => {
  test("invited student with batch keeps enrollment after resend attempt", async () => {
    // Create an invited student with a batch.
    const res = await m.students.POST(
      req("POST", "/api/tuition/students", "admin", {
        name: "Batch Student",
        email: "batchstudent@test.com",
        password: "Password123!",
        program: "NEET",
        standard: "11th",
        batchId: ids.batch,
        enrollmentMethod: "enroll_immediately",
      }), {},
    );
    const data = await json(res);
    const studentId = data.student.id;
    assert.ok(data.student.batch);

    // Resend invitation.
    await m.resendInvite.POST(
      req("POST", `/api/tuition/students/${studentId}/resend-invitation`, "admin"),
      { params: { id: studentId } },
    );

    // Batch enrollment is preserved.
    const student = await m.User.findById(studentId);
    assert.ok(student?.batchId);
    assert.equal(String(student?.batchId), ids.batch);
  });
});
