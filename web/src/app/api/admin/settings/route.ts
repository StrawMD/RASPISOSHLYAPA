import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_WEIGHTS, mergeWeights } from "@/lib/solver-weights";

const KEY = "solverWeights";

async function checkAdmin() {
  const session = await auth();
  if (
    !session?.user ||
    !["admin", "schedule_manager"].includes(session.user.role)
  ) {
    return null;
  }
  return session;
}

export async function GET() {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  let saved: Record<string, number> | null = null;
  if (row) {
    try {
      saved = JSON.parse(row.value);
    } catch {
      saved = null;
    }
  }
  return NextResponse.json({ weights: mergeWeights(saved) });
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const incoming = body?.weights;
  if (!incoming || typeof incoming !== "object") {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  // Сохраняем только известные ключи в допустимом диапазоне.
  const clean: Record<string, number> = {};
  for (const k of Object.keys(DEFAULT_WEIGHTS)) {
    const v = incoming[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      clean[k] = Math.min(100000, Math.max(0, Math.round(v)));
    } else {
      clean[k] = DEFAULT_WEIGHTS[k];
    }
  }

  await prisma.setting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(clean) },
    create: { key: KEY, value: JSON.stringify(clean) },
  });

  return NextResponse.json({ ok: true, weights: clean });
}
