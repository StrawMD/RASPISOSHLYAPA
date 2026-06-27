import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clampRates, maxRecurringDows } from "@/lib/rates";

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

const ALLOWED_CONSEC = new Set([
  "avoid",
  "neutral",
  "prefer_2",
  "prefer_3",
  "prefer_4",
]);
const ALLOWED_MEDICAL = new Set(["none", "no_night", "no_24h", "day_only"]);

function normConsec(v: unknown): string {
  return typeof v === "string" && ALLOWED_CONSEC.has(v) ? v : "avoid";
}
function normMedical(v: unknown): string {
  return typeof v === "string" && ALLOWED_MEDICAL.has(v) ? v : "none";
}
function normMedicalNote(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null;
}
function normDows(v: unknown, rate: number): string {
  if (!Array.isArray(v)) return "[]";
  const nums = (v as unknown[])
    .map((n) => Math.trunc(Number(n)))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const unique = Array.from(new Set<number>(nums)).sort((a, b) => a - b);
  return JSON.stringify(unique.slice(0, maxRecurringDows(rate)));
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
      recurringUnavailableDows: safeJson(e.recurringUnavailableDows, []),
    }))
  );
}

export async function POST(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { rate, targetRate, maxRate } = clampRates(
    body.rate ?? 1.0,
    body.targetRate ?? body.rate ?? 1.0,
    body.maxRate ?? 1.5,
  );
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
      consecutivePref: normConsec(body.consecutivePref),
      medicalRestriction: normMedical(body.medicalRestriction),
      medicalNote: normMedicalNote(body.medicalNote),
      recurringUnavailableDows: normDows(body.recurringUnavailableDows, rate),
    },
  });

  return NextResponse.json({
    ...employee,
    allowedPosts: safeJson(employee.allowedPosts, []),
    modalities: safeJson(employee.modalities, []),
    postPreferences: safeJson(employee.postPreferences, {}),
    recurringUnavailableDows: safeJson(employee.recurringUnavailableDows, []),
  });
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { rate, targetRate, maxRate } = clampRates(
    body.rate,
    body.targetRate ?? body.rate,
    body.maxRate,
  );
  // Предпочтения по аппаратам (postPreferences/postShiftPrefs) — источник
  // истины: «Матрица аппаратов». Их трогаем ТОЛЬКО если переданы явно, иначе
  // редактор профиля (модалка/анкета) затирал бы матрицу пустым объектом.
  const data: Record<string, unknown> = {
    name: body.name,
    rate,
    targetRate,
    maxRate,
    seniority: body.seniority ?? 0,
    hospitalStartYear: body.hospitalStartYear ?? null,
    careerStartYear: body.careerStartYear ?? null,
    can24h: body.can24h ?? false,
    consecutivePref: normConsec(body.consecutivePref),
    medicalRestriction: normMedical(body.medicalRestriction),
    medicalNote: normMedicalNote(body.medicalNote),
    recurringUnavailableDows: normDows(body.recurringUnavailableDows, rate),
  };
  if (body.allowedPosts !== undefined) {
    data.allowedPosts = JSON.stringify(body.allowedPosts);
  }
  if (body.modalities !== undefined) {
    data.modalities = JSON.stringify(body.modalities);
  }
  if (body.postPreferences !== undefined) {
    data.postPreferences = JSON.stringify(body.postPreferences);
  }
  if (body.postShiftPrefs !== undefined) {
    data.postShiftPrefs = JSON.stringify(body.postShiftPrefs);
  }
  const employee = await prisma.employee.update({
    where: { id: body.id },
    data,
  });

  return NextResponse.json({
    ...employee,
    allowedPosts: safeJson(employee.allowedPosts, []),
    modalities: safeJson(employee.modalities, []),
    postPreferences: safeJson(employee.postPreferences, {}),
    recurringUnavailableDows: safeJson(employee.recurringUnavailableDows, []),
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
