import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { planFor, readSetup } from "@/lib/self-assessment";

export const dynamic = "force-dynamic";

/**
 * What a self-assessment with these choices would be (the same body as
 * creating one), without making it: questions available, how many of each
 * difficulty and topic, and why Smart chose its split. No questions are sent.
 */
export const POST = route(async (req) => {
  const session = await requireUser(req, "student");
  const setup = readSetup(await readJson(req), session.user);
  const { seed, plan, basis, topics } = await planFor(session, setup);
  // seed: send it back when making the test, so it matches this plan.
  return { seed, plan, basis, topics };
});
