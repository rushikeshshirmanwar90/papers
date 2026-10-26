import { HttpError, readJson, route } from "@/lib/http";
import { tuitionByCode } from "@/lib/join-code";

export const dynamic = "force-dynamic";

/** Which tuition a join code belongs to, so the teacher sees where they're joining: { code }. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const tuition = await tuitionByCode(body.code);
  if (!tuition) {
    // Slows down guessing codes.
    await new Promise((r) => setTimeout(r, 800));
    throw new HttpError(404, "That code doesn't match any tuition. Check it with your tuition.");
  }
  return { tuition: { name: tuition.name, address: tuition.address } };
});
