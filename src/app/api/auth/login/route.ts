import { checkLogin, publicUser, signToken } from "@/lib/auth";
import { badRequest, email, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Email + password → a login token and the user's details. */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const address = email(body);
  const password = body.password;
  if (typeof password !== "string" || !password) throw badRequest("Enter your password.");

  const user = await checkLogin(address, password);
  return { token: await signToken(user), user: await publicUser(user) };
});
