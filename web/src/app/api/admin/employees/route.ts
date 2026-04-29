import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function checkAdmin() {
  const session = await auth();
  if (!session?.user || !["admin", "schedule_manager"].includes(session.user.role)) {
    return null;
  }
  return session;
}

export async function GET() {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const employees = await prisma.employee.findMany({
    orderBy: { name: "asc" },
    include: { user: { select: { id: true, login: true, role: true } } },
  });

  return NextResponse.json(
    employees.map((e) => ({
      ...e,
      allowedPosts: safeJson(e.allowedPosts, []),
      modalities: safeJson(e.modalities, []),
      postPreferences: safeJson(e.postPreferences, {}),
    }))
  );
}

export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const rate = body.rate ?? 1.0;
  const maxRate = body.maxRate ?? 1.5;
  const rawTarget = body.targetRate ?? rate;
  const targetRate = Math.min(Math.max(rawTarget, rate), maxRate);
  const employee = await prisma.employee.create({
    data: {
      name: body.name,
      rate,
      targetRate,
      maxRate,
      seniority: body.seniority ?? 0,
      hospitalStartYear: body.hospitalStartYear ?? null,
      careerStartYear: body.careerStartYear ?? null,
      allowedPosts: JSON.stringify(body.allowedPosts ?? []),
      modalities: JSON.stringify(body.modalities ?? []),
      can24h: body.can24h ?? false,
      postPreferences: JSON.stringify(body.postPreferences ?? {}),
    },
  });

  return NextResponse.json({
    ...employee,
    allowedPosts: safeJson(employee.allowedPosts, []),
    modalities: safeJson(employee.modalities, []),
    postPreferences: safeJson(employee.postPreferences, {}),
  });
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const rate = body.rate;
  const maxRate = body.maxRate;
  const rawTarget = body.targetRate ?? rate;
  const targetRate = Math.min(Math.max(rawTarget, rate), maxRate);
  const employee = await prisma.employee.update({
    where: { id: body.id },
    data: {
      name: body.name,
      rate,
      targetRate,
      maxRate,
      seniority: body.seniority ?? 0,
      hospitalStartYear: body.hospitalStartYear ?? null,
      careerStartYear: body.careerStartYear ?? null,
      allowedPosts: JSON.stringify(body.allowedPosts),
      modalities: JSON.stringify(body.modalities ?? []),
      can24h: body.can24h ?? false,
      postPreferences: JSON.stringify(body.postPreferences ?? {}),
    },
  });

  return NextResponse.json({
    ...employee,
    allowedPosts: safeJson(employee.allowedPosts, []),
    modalities: safeJson(employee.modalities, []),
    postPreferences: safeJson(employee.postPreferences, {}),
  });
}

export async function DELETE(req: NextRequest) {
  const session = await checkAdmin();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  await prisma.employee.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
