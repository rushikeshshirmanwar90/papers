import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE, isAdminSession } from "@/lib/admin-session";

// Admin console pages need an admin session; everything else is untouched.
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname === "/admin/login") return NextResponse.next();
  if (await isAdminSession(req.cookies.get(ADMIN_COOKIE)?.value)) return NextResponse.next();
  const login = new URL("/admin/login", req.url);
  login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
