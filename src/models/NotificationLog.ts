import { Schema, model, models, type Document } from "mongoose";

/**
 * Notifications already sent for a key, e.g. "today's Physics topics for
 * this batch", so ticking ten topics sends one message, not ten. Old entries
 * expire on their own.
 */
export interface NotificationLogDoc extends Document {
  key: string;
  sentAt: Date;
}

const NotificationLogSchema = new Schema<NotificationLogDoc>({
  key: { type: String, required: true, unique: true },
  sentAt: { type: Date, required: true, expires: 60 * 60 * 24 * 3 },
});

export default models.NotificationLog || model<NotificationLogDoc>("NotificationLog", NotificationLogSchema);
