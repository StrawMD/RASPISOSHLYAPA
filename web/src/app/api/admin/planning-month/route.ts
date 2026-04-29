import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPlanningMonth, setPlanningMonth } from "@/lib/planning-month";

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
  const planning = await getPlanningMonth();
  return NextResponse.json(planning);
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const year = Number(body?.year);
  const month = Number(body?.month);

  try {
    const { monthId } = await setPlanningMonth(year, month);
    return NextResponse.json({ ok: true, year, month, monthId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid request";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
