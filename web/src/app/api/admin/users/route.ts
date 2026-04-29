import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hash } from "bcryptjs";

async function checkAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "admin") {
    return null;
  }
  return session;
}

const USER_SELECT = {
  id: true,
  login: true,
  role: true,
  employeeId: true,
  employee: { select: { name: true } },
  plaintextPassword: true,
  createdAt: true,
} as const;

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

const DEFAULT_PASSWORD = "Боткин1!";
const ADMIN_PASSWORD = "admin123";
const ADMIN_SURNAMES = new Set(["Соломка", "Знатнова"]);
const PRIMARY_ADMIN_SURNAME = "Соломка";

function surnameFromName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * Ensure every Employee has a linked User. Newly-added employees get:
 *   login = surname lowercased
 *   password = "Боткин1!" (or admin123 for Соломка)
 *   role    = employee (or admin for Соломка/Знатнова)
 *
 * Existing users are left untouched (so admin can freely change passwords).
 * Logs and returns the number of accounts auto-created.
 */
async function ensureEmployeeUsers(): Promise<number> {
  const employees = await prisma.employee.findMany({
    include: { user: true },
  });

  let created = 0;
  for (const emp of employees) {
    if (emp.user) continue;

    const surname = surnameFromName(emp.name);
    const login = surname.toLowerCase();
    const isAdmin = ADMIN_SURNAMES.has(surname);
    const isPrimaryAdmin = surname === PRIMARY_ADMIN_SURNAME;
    const password = isPrimaryAdmin ? ADMIN_PASSWORD : DEFAULT_PASSWORD;
    const role = isAdmin ? "admin" : "employee";

    const collision = await prisma.user.findUnique({ where: { login } });
    if (collision) {
      if (!collision.employeeId) {
        await prisma.user.update({
          where: { id: collision.id },
          data: {
            passwordHash: await hash(password, 12),
            plaintextPassword: password,
            role,
            employeeId: emp.id,
          },
        });
        created++;
      }
      continue;
    }

    await prisma.user.create({
      data: {
        login,
        passwordHash: await hash(password, 12),
        plaintextPassword: password,
        role,
        employeeId: emp.id,
      },
    });
    created++;
  }

  return created;
}

export async function GET() {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await ensureEmployeeUsers();

  const users = await prisma.user.findMany({
    orderBy: [{ login: "asc" }],
    select: USER_SELECT,
  });

  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { login, password, role, employeeId } = body;

  if (!login || !password) {
    return NextResponse.json(
      { error: "Login and password required" },
      { status: 400 }
    );
  }

  const canonicalLogin = normalizeLogin(String(login));
  if (!canonicalLogin) {
    return NextResponse.json({ error: "Invalid login" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({
    where: { login: canonicalLogin },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Login already exists" },
      { status: 400 }
    );
  }

  const passwordHash = await hash(password, 12);

  const user = await prisma.user.create({
    data: {
      login: canonicalLogin,
      passwordHash,
      plaintextPassword: password,
      role: role ?? "employee",
      employeeId: employeeId || null,
    },
    select: USER_SELECT,
  });

  return NextResponse.json(user);
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { id, role, employeeId, newPassword, login } = body;

  const data: Record<string, unknown> = {};
  if (role) data.role = role;
  if (employeeId !== undefined) data.employeeId = employeeId || null;
  if (newPassword) {
    data.passwordHash = await hash(newPassword, 12);
    data.plaintextPassword = newPassword;
  }
  if (typeof login === "string") {
    const canonicalLogin = normalizeLogin(login);
    if (!canonicalLogin) {
      return NextResponse.json({ error: "Invalid login" }, { status: 400 });
    }
    data.login = canonicalLogin;
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: USER_SELECT,
  });

  return NextResponse.json(user);
}

export async function DELETE(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
