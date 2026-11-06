import { requireUser } from "@/lib/auth";
import { HttpError, notFound, readBody, route } from "@/lib/http";
import { checkLogo, logoDataUri, MAX_LOGO_BYTES } from "@/lib/instituteLogo";
import InstituteLogo, { type InstituteLogoDoc } from "@/models/InstituteLogo";

export const dynamic = "force-dynamic";

/** The JSON body of a logo upload: its image as base64, a third larger than the image. */
const MAX_BODY_BYTES = Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 4096;

type Stored = Pick<InstituteLogoDoc, "contentType" | "size" | "width" | "height" | "data" | "updatedAt">;

const out = (logo: Stored) => ({
  contentType: logo.contentType,
  size: logo.size,
  width: logo.width,
  height: logo.height,
  updatedAt: logo.updatedAt,
  dataUri: logoDataUri(logo),
});

/** The tuition's logo, or null when it has none. The tuition's teachers see it too: it prints on their papers. */
export const GET = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition", "teacher");
  // Not .lean(): a lean read hands back a BSON Binary, not a Buffer (see lib/storage.ts).
  const logo = await InstituteLogo.findOne({ tuitionId });
  return { logo: logo ? out(logo) : null };
});

/** The tuition sets its logo (replacing the one it has). Only the tuition's own account. */
export const PUT = route(async (req) => {
  const { tuitionId, userId } = await requireUser(req, "tuition");
  const raw = await readBody(req, MAX_BODY_BYTES, "The logo is too large. Use a smaller image.");
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "Send the logo as JSON.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Send the logo as a JSON object.");
  const { contentType, data, width, height } = checkLogo(body as Record<string, unknown>);
  const logo = await InstituteLogo.findOneAndUpdate(
    { tuitionId },
    { tuitionId, contentType, data, width, height, size: data.length, updatedBy: userId },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true, runValidators: true }
  );
  return { logo: out(logo!) };
});

/** The tuition removes its logo. */
export const DELETE = route(async (req) => {
  const { tuitionId } = await requireUser(req, "tuition");
  const removed = await InstituteLogo.findOneAndDelete({ tuitionId });
  if (!removed) throw notFound("The logo");
  return { ok: true };
});
