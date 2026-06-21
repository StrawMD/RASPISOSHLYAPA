import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_WEIGHTS, mergeWeights } from "@/lib/solver-weights";
import { mergeSolverConfig, type SolverConfig } from "@/lib/solver-config";

const WEIGHTS_KEY = "solverWeights";
const CONFIG_KEY = "solverConfig";

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
  const [weightsRow, configRow] = await Promise.all([
    prisma.setting.findUnique({ where: { key: WEIGHTS_KEY } }),
    prisma.setting.findUnique({ where: { key: CONFIG_KEY } }),
  ]);
  let savedWeights: Record<string, number> | null = null;
  if (weightsRow) {
    try {
      savedWeights = JSON.parse(weightsRow.value);
    } catch {
      savedWeights = null;
    }
  }
  let savedConfig: Partial<SolverConfig> | null = null;
  if (configRow) {
    try {
      savedConfig = JSON.parse(configRow.value);
    } catch {
      savedConfig = null;
    }
  }
  return NextResponse.json({
    weights: mergeWeights(savedWeights),
    solverConfig: mergeSolverConfig(savedConfig),
  });
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);

  let weightsOut = mergeWeights(null);
  let configOut = mergeSolverConfig(null);

  if (body?.weights && typeof body.weights === "object") {
    const clean: Record<string, number> = {};
    for (const k of Object.keys(DEFAULT_WEIGHTS)) {
      const v = body.weights[k];
      if (typeof v === "number" && Number.isFinite(v)) {
        clean[k] = Math.min(100000, Math.max(0, Math.round(v)));
      } else {
        clean[k] = DEFAULT_WEIGHTS[k];
      }
    }
    await prisma.setting.upsert({
      where: { key: WEIGHTS_KEY },
      update: { value: JSON.stringify(clean) },
      create: { key: WEIGHTS_KEY, value: JSON.stringify(clean) },
    });
    weightsOut = clean;
  } else {
    const row = await prisma.setting.findUnique({ where: { key: WEIGHTS_KEY } });
    weightsOut = mergeWeights(
      row ? safeJson(row.value, null) : null,
    );
  }

  if (body?.solverConfig && typeof body.solverConfig === "object") {
    const merged = mergeSolverConfig(body.solverConfig);
    await prisma.setting.upsert({
      where: { key: CONFIG_KEY },
      update: { value: JSON.stringify(merged) },
      create: { key: CONFIG_KEY, value: JSON.stringify(merged) },
    });
    configOut = merged;
  } else {
    const row = await prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
    configOut = mergeSolverConfig(row ? safeJson(row.value, null) : null);
  }

  return NextResponse.json({
    ok: true,
    weights: weightsOut,
    solverConfig: configOut,
  });
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
