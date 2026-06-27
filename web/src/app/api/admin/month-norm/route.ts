import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { workNormHours, resolveMonthNorm } from "@/lib/rates";

const NORMS_KEY = "monthNorms";

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

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function loadOverrides(): Promise<Record<string, number>> {
  const row = await prisma.setting.findUnique({ where: { key: NORMS_KEY } });
  const raw = safeJson<Record<string, unknown>>(row?.value ?? "{}", {});
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

async function holidayChecker(
  year: number,
): Promise<(d: Date) => boolean> {
  const holidays = await prisma.holiday.findMany({ where: { year } });
  const set = new Set(holidays.map((h) => h.date));
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  return (d: Date) => set.has(fmt(d));
}

/** GET ?year=&month= → одна норма; ?year= → все 12 месяцев года. */
export async function GET(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const year = parseInt(searchParams.get("year") ?? "0", 10);
  if (!year) {
    return NextResponse.json({ error: "year required" }, { status: 400 });
  }
  const monthParam = searchParams.get("month");
  const overrides = await loadOverrides();
  // Праздники следующего года нужны для проверки «предпраздничный ли 31-е» в
  // декабре. Грузим и текущий, и следующий год.
  const isHolidayThis = await holidayChecker(year);
  const isHolidayNext = await holidayChecker(year + 1);
  const isHoliday = (d: Date) =>
    d.getFullYear() === year + 1 ? isHolidayNext(d) : isHolidayThis(d);

  if (monthParam) {
    const month = parseInt(monthParam, 10);
    if (!month || month < 1 || month > 12) {
      return NextResponse.json({ error: "bad month" }, { status: 400 });
    }
    const computed = workNormHours(year, month, isHoliday);
    const override = overrides[`${year}-${month}`] ?? null;
    return NextResponse.json({
      year,
      month,
      computed,
      override,
      value: resolveMonthNorm(year, month, isHoliday, overrides),
    });
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
    const computed = workNormHours(year, month, isHoliday);
    const override = overrides[`${year}-${month}`] ?? null;
    return {
      month,
      computed,
      override,
      value: resolveMonthNorm(year, month, isHoliday, overrides),
    };
  });
  return NextResponse.json({ year, months });
}

/** PUT { year, month, override } — записать/снять override нормы месяца. */
export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const year = body?.year as number;
  const month = body?.month as number;
  const override = body?.override;
  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: "year and month required" }, { status: 400 });
  }

  const overrides = await loadOverrides();
  const key = `${year}-${month}`;
  if (
    override == null ||
    override === "" ||
    !(typeof override === "number" && Number.isFinite(override) && override > 0)
  ) {
    delete overrides[key];
  } else {
    overrides[key] = Math.round(override * 10) / 10;
  }

  await prisma.setting.upsert({
    where: { key: NORMS_KEY },
    update: { value: JSON.stringify(overrides) },
    create: { key: NORMS_KEY, value: JSON.stringify(overrides) },
  });

  return NextResponse.json({ ok: true, overrides });
}
