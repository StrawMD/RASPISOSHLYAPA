import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clampRates, maxRecurringDows } from "@/lib/rates";

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const ALLOWED_MODALITIES = new Set(["КТ", "МРТ"]);

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.employeeId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const employeeId = session.user.employeeId;

  const current = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!current) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const rawRate =
    typeof body.rate === "number" && body.rate > 0 ? body.rate : current.rate;
  const rawMax =
    typeof body.maxRate === "number" && body.maxRate > 0
      ? body.maxRate
      : current.maxRate;
  const rawTarget =
    typeof body.targetRate === "number" ? body.targetRate : current.targetRate;
  const { rate, targetRate, maxRate } = clampRates(rawRate, rawTarget, rawMax);

  const modalities: string[] = Array.isArray(body.modalities)
    ? body.modalities.filter((m: unknown) => typeof m === "string" && ALLOWED_MODALITIES.has(m))
    : safeJson(current.modalities, []);

  const canWork24h = modalities.includes("КТ") ? Boolean(body.can24h) : false;

  const posts = await prisma.post.findMany({ orderBy: { sortOrder: "asc" } });
  const modSet = new Set(modalities);
  const allowedPosts = posts
    .filter((p) => p.modality && modSet.has(p.modality))
    .map((p) => p.id);

  const hospitalStartYear =
    body.hospitalStartYear == null ||
    Number.isNaN(Number(body.hospitalStartYear))
      ? null
      : Math.trunc(Number(body.hospitalStartYear));
  const careerStartYear =
    body.careerStartYear == null ||
    Number.isNaN(Number(body.careerStartYear))
      ? null
      : Math.trunc(Number(body.careerStartYear));

  const ALLOWED_CONSEC = new Set([
    "avoid",
    "neutral",
    "prefer_2",
    "prefer_3",
    "prefer_4",
  ]);
  const consecutivePref =
    typeof body.consecutivePref === "string" &&
    ALLOWED_CONSEC.has(body.consecutivePref)
      ? body.consecutivePref
      : current.consecutivePref;

  const ALLOWED_MEDICAL = new Set(["none", "no_night", "no_24h", "day_only"]);
  const medicalRestriction =
    typeof body.medicalRestriction === "string" &&
    ALLOWED_MEDICAL.has(body.medicalRestriction)
      ? body.medicalRestriction
      : current.medicalRestriction;
  const medicalNote =
    typeof body.medicalNote === "string" && body.medicalNote.trim()
      ? body.medicalNote.trim().slice(0, 300)
      : null;

  let recurringUnavailableDows: number[];
  if (Array.isArray(body.recurringUnavailableDows)) {
    const nums = (body.recurringUnavailableDows as unknown[])
      .map((n) => Math.trunc(Number(n)))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    recurringUnavailableDows = Array.from(new Set<number>(nums))
      .sort((a, b) => a - b)
      .slice(0, maxRecurringDows(rate));
  } else {
    recurringUnavailableDows = safeJson<number[]>(
      current.recurringUnavailableDows,
      [],
    );
  }

  const updated = await prisma.employee.update({
    where: { id: employeeId },
    data: {
      rate,
      targetRate,
      maxRate,
      modalities: JSON.stringify(modalities),
      allowedPosts: JSON.stringify(allowedPosts),
      can24h: canWork24h,
      hospitalStartYear,
      careerStartYear,
      consecutivePref,
      medicalRestriction,
      medicalNote,
      recurringUnavailableDows: JSON.stringify(recurringUnavailableDows),
    },
  });

  return NextResponse.json({
    id: updated.id,
    name: updated.name,
    rate: updated.rate,
    targetRate: updated.targetRate,
    maxRate: updated.maxRate,
    modalities: safeJson(updated.modalities, []),
    allowedPosts: safeJson(updated.allowedPosts, []),
    can24h: updated.can24h,
    hospitalStartYear: updated.hospitalStartYear,
    careerStartYear: updated.careerStartYear,
    consecutivePref: updated.consecutivePref,
    medicalRestriction: updated.medicalRestriction,
    medicalNote: updated.medicalNote,
    recurringUnavailableDows: safeJson(updated.recurringUnavailableDows, []),
  });
}
