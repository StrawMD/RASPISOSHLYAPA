import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

// Массовое сохранение affinity-матрицы (только админ/составитель):
//   • allowedPosts — жёсткие допуски (выводятся из модальностей);
//   • postPreferences — 5-уровневые предпочтения по 12ч-постам (и суточным как пост);
//   • postShiftPrefs — посменные (с/д/н) предпочтения на суточных постах.
// modalities выводятся из allowedPosts (как в ops-скрипте employee.cjs).

const PREF_LEVELS = new Set([
  "prefer_strong",
  "prefer",
  "neutral",
  "avoid",
  "avoid_hard",
]);
const SHIFT_KINDS = ["full", "day", "night"] as const;

function cleanPostPrefs(
  v: unknown,
  validPosts: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object") return out;
  for (const [pid, lvl] of Object.entries(v as Record<string, unknown>)) {
    if (!validPosts.has(pid)) continue;
    if (typeof lvl !== "string" || !PREF_LEVELS.has(lvl) || lvl === "neutral")
      continue;
    out[pid] = lvl;
  }
  return out;
}

function cleanShiftPrefs(
  v: unknown,
  validPosts: Set<string>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  if (!v || typeof v !== "object") return out;
  for (const [pid, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!validPosts.has(pid) || !raw || typeof raw !== "object") continue;
    const inner: Record<string, string> = {};
    for (const k of SHIFT_KINDS) {
      const lvl = (raw as Record<string, unknown>)[k];
      if (typeof lvl === "string" && PREF_LEVELS.has(lvl) && lvl !== "neutral")
        inner[k] = lvl;
    }
    if (Object.keys(inner).length > 0) out[pid] = inner;
  }
  return out;
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (
    !session?.user ||
    !["admin", "schedule_manager"].includes(session.user.role)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const rows = Array.isArray(body?.employees) ? body.employees : null;
  if (!rows) {
    return NextResponse.json(
      { error: "Ожидается { employees: [...] }" },
      { status: 400 },
    );
  }

  const posts = await prisma.post.findMany({
    select: { id: true, modality: true },
  });
  const validPosts = new Set(posts.map((p) => p.id));
  const modalityByPost = new Map(posts.map((p) => [p.id, p.modality]));

  const updates = [];
  for (const row of rows) {
    if (!row || typeof row.id !== "string") continue;
    const allowedPosts: string[] = Array.isArray(row.allowedPosts)
      ? Array.from(
          new Set(
            row.allowedPosts.filter(
              (p: unknown): p is string =>
                typeof p === "string" && validPosts.has(p),
            ),
          ),
        )
      : [];
    // Предпочтения держим только для допущенных постов: запрет (avoid_hard)
    // на недопущенном посту бессмысленен и стал бы stale.
    const allowedSet = new Set(allowedPosts);
    const postPreferences = cleanPostPrefs(row.postPreferences, allowedSet);
    const postShiftPrefs = cleanShiftPrefs(row.postShiftPrefs, allowedSet);

    // modalities = уникальные модальности допущенных постов.
    const modalities = Array.from(
      new Set(
        allowedPosts
          .map((p) => modalityByPost.get(p))
          .filter((m): m is string => Boolean(m)),
      ),
    );

    updates.push(
      prisma.employee.update({
        where: { id: row.id },
        data: {
          allowedPosts: JSON.stringify(allowedPosts),
          modalities: JSON.stringify(modalities),
          postPreferences: JSON.stringify(postPreferences),
          postShiftPrefs: JSON.stringify(postShiftPrefs),
        },
      }),
    );
  }

  await prisma.$transaction(updates);
  return NextResponse.json({ ok: true, updated: updates.length });
}
