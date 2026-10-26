import { hashPassword, publicUser, signToken } from "@/lib/auth";
import { HttpError, email, password, readJson, route, text } from "@/lib/http";
import User, { type UserDoc } from "@/models/User";

export const dynamic = "force-dynamic";

/**
 * Anyone creates an account: { name, email, phone?, password }. It has no
 * role or tuition until a tuition accepts their join request; they're logged
 * in straight away.
 */
export const POST = route(async (req) => {
  const body = await readJson(req);
  const name = text(body, "name", { required: true, max: 100, label: "your name" })!;
  const address = email(body);
  const passwordHash = await hashPassword(password(body));
  if (await User.exists({ email: address })) {
    throw new HttpError(409, "An account with this email already exists. Log in instead.");
  }
  const user = (await User.create({
    name,
    email: address,
    phone: text(body, "phone", { max: 20 }) ?? "",
    passwordHash,
    role: null,
    tuitionId: null,
    lastLoginAt: new Date(),
  })) as UserDoc;
  return { token: await signToken(user), user: await publicUser(user) };
});
