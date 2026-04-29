import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const ADMIN_ROLES = ["admin", "schedule_manager"];

// Страницы, разрешённые обычному сотруднику (UI).
const EMPLOYEE_ALLOWED_PREFIXES = ["/schedule", "/preferences"];

// API-эндпойнты, доступные сотруднику (необходимые, чтобы страницы работали).
const EMPLOYEE_ALLOWED_API_PREFIXES = [
  "/api/preferences",
  "/api/availability",
  "/api/schedule/versions",
  "/api/employees/me",
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.json"
  ) {
    return NextResponse.next();
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const role = (token.role as string) ?? "employee";
  const isAdmin = ADMIN_ROLES.includes(role);

  if (pathname.startsWith("/admin")) {
    if (!isAdmin) {
      return NextResponse.redirect(new URL("/schedule", req.url));
    }
    return NextResponse.next();
  }

  if (isAdmin) {
    return NextResponse.next();
  }

  // Сотрудник: только schedule/preferences + ограниченный набор API.
  if (pathname.startsWith("/api/")) {
    if (EMPLOYEE_ALLOWED_API_PREFIXES.some((p) => pathname.startsWith(p))) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (pathname === "/" ) {
    return NextResponse.redirect(new URL("/schedule", req.url));
  }

  const allowed = EMPLOYEE_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!allowed) {
    return NextResponse.redirect(new URL("/schedule", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-).*)"],
};
