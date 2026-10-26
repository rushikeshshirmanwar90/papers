import { Schema, model, models, type Document, type Types } from "mongoose";
import { ROLES, STANDARDS, SUBJECTS, TRACKS, type Role, type SchoolStandard, type SchoolSubject, type Track } from "@/lib/school";

/**
 * Everyone who logs in to the app: a tuition's own account, its teachers and
 * its students. Each belongs to one tuition. Role-specific details sit on the
 * same document (subjects for a teacher; track, class and batch for a student).
 */
export interface UserDoc extends Document {
  email: string;
  passwordHash: string;
  role: Role;
  name: string;
  phone: string;
  tuitionId: Types.ObjectId;
  active: boolean;
  /** Raised on a password change or reset, which signs out every device. */
  tokenVersion: number;
  failedLogins: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  /** Expo push tokens of the phones the user is logged in on. */
  pushTokens: { token: string; platform: string; updatedAt: Date }[];

  // Teacher
  subjects: SchoolSubject[];

  // Student
  track?: Track;
  standard?: SchoolStandard;
  batchId?: Types.ObjectId | null;
  parentPhone?: string;

  createdAt: Date;
  updatedAt: Date;
}

const PushTokenSchema = new Schema<UserDoc["pushTokens"][number]>(
  {
    token: { type: String, required: true },
    platform: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const UserSchema = new Schema<UserDoc>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    tuitionId: { type: Schema.Types.ObjectId, ref: "Tuition", required: true, index: true },
    active: { type: Boolean, default: true },
    tokenVersion: { type: Number, default: 0 },
    failedLogins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
    pushTokens: { type: [PushTokenSchema], default: [], select: false },

    subjects: { type: [{ type: String, enum: SUBJECTS }], default: [] },

    track: { type: String, enum: TRACKS },
    standard: { type: String, enum: STANDARDS },
    batchId: { type: Schema.Types.ObjectId, ref: "Batch", default: null, index: true },
    parentPhone: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

UserSchema.index({ tuitionId: 1, role: 1 });
UserSchema.index({ "pushTokens.token": 1 });

export default models.User || model<UserDoc>("User", UserSchema);
