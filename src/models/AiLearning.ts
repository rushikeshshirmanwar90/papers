import { Schema, model, models, type Model } from 'mongoose';

// Derived learning data never creates a User, enrollment, or test attempt.
// Real profiles are scoped to BOTH the authenticated student and their tuition.
const options = { versionKey: false as const, autoCreate: false, autoIndex: false };
const scope = {
  studentId: { type: String, required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  tuitionId: { type: Schema.Types.ObjectId, ref: 'Tuition', default: null },
  synthetic: { type: Boolean, required: true },
  examVersion: { type: String, required: true },
  standard: { type: String, required: true },
};
const profileSchema = new Schema({
  ...scope,
  student: Schema.Types.Mixed,
  data: Schema.Types.Mixed,
  sourceHash: String,
  evidenceHash: String,
  generatedAt: Date,
}, { ...options, collection: 'ai_learning_profiles' });
profileSchema.index({ tuitionId: 1, studentId: 1, synthetic: 1, examVersion: 1, standard: 1 }, { unique: true });
profileSchema.index({ synthetic: 1, studentId: 1 });

// Immutable copies of the existing synthetic assessment snapshots ONLY.
// Real assessment history remains in SelfAssessment / TestAttempt / PracticeAnswer.
const historySchema = new Schema({
  ...scope, assessmentId: { type: String, required: true },
  submittedAt: Date, sourceHash: String, data: Schema.Types.Mixed,
}, { ...options, collection: 'ai_learning_history' });
historySchema.index({ synthetic: 1, studentId: 1, assessmentId: 1 }, { unique: true });
historySchema.index({ tuitionId: 1, studentId: 1, submittedAt: -1 });

// Official nodes and many-to-many candidate mappings keep distinct kinds and IDs.
// textbookId/chapterId/topicId are optional references, never inferred from labels.
const mappingSchema = new Schema({
  kind: { type: String, enum: ['node', 'mapping'], required: true },
  identity: { type: String, required: true }, versionId: { type: String, required: true },
  synthetic: { type: Boolean, required: true }, standard: String, subject: String,
  reviewStatus: String, sourceHash: String, data: Schema.Types.Mixed,
}, { ...options, collection: 'ai_syllabus_mappings' });
mappingSchema.index({ kind: 1, identity: 1, versionId: 1 }, { unique: true });
mappingSchema.index({ kind: 1, synthetic: 1, versionId: 1, standard: 1, subject: 1 });

type LearningRecord = Record<string, unknown>;
export const AiProfile = (models.AiLearningProfile || model('AiLearningProfile', profileSchema)) as Model<LearningRecord>;
export const AiHistory = (models.AiLearningHistory || model('AiLearningHistory', historySchema)) as Model<LearningRecord>;
export const AiMapping = (models.AiSyllabusMapping || model('AiSyllabusMapping', mappingSchema)) as Model<LearningRecord>;
