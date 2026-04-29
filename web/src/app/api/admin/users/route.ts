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

export async function GET() {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      login: true,
      role: true,
      employeeId: true,
      employee: { select: { name: true } },
      createdAt: true,
    },
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

  const existing = await prisma.user.findUnique({ where: { login } });
  if (existing) {
    return NextResponse.json(
      { error: "Login already exists" },
      { status: 400 }
    );
  }

  const passwordHash = await hash(password, 12);

  const user = await prisma.user.create({
    data: {
      login,
      passwordHash,
      role: role ?? "employee",
      employeeId: employeeId || null,
    },
    select: {
      id: true,
      login: true,
      role: true,
      employeeId: true,
      employee: { select: { name: true } },
      createdAt: true,
    },
  });

  return NextResponse.json(user);
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { id, role, employeeId, newPassword } = body;

  const data: Record<string, unknown> = {};
  if (role) data.role = role;
  if (employeeId !== undefined) data.employeeId = employeeId || null;
  if (newPassword) data.passwordHash = await hash(newPassword, 12);

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      login: true,
      role: true,
      employeeId: true,
      employee: { select: { name: true } },
      createdAt: true,
    },
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
