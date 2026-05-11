/**
 * Фиксированные слоты для солвера: тот же формат, что и schedule.data
 * (день → пост → список строк «Фамилия» или «Фамилия(д)/(н)/(с)» на сутках).
 */

export type FixedSlotsMap = Record<string, Record<string, string[]>>;

type PostLite = { id: string; shiftHours: number };
type EmpLite = { name: string; allowedPosts: string[] };

export function validateFixedSlots(
  raw: unknown,
  year: number,
  month: number,
  posts: PostLite[],
  employees: EmpLite[]
): { ok: true; data: FixedSlotsMap } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, data: {} };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Ожидается JSON-объект: { \"15\": { \"ssk1\": [\"…\"] }, … }" };
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const postMap = new Map(posts.map((p) => [p.id, p]));
  const empMap = new Map(employees.map((e) => [e.name, e]));

  const out: FixedSlotsMap = {};
  const namesFixedPerDay = new Map<number, Set<string>>();

  for (const [dayStr, byPost] of Object.entries(
    raw as Record<string, unknown>
  )) {
    const day = parseInt(dayStr, 10);
    if (!Number.isFinite(day) || day < 1 || day > daysInMonth) {
      return {
        ok: false,
        error: `Некорректный день «${dayStr}» (в месяце ${daysInMonth} дн.)`,
      };
    }

    if (!byPost || typeof byPost !== "object" || Array.isArray(byPost)) {
      return {
        ok: false,
        error: `День ${day}: для каждого поста нужен объект со списками имён`,
      };
    }

    for (const [postId, labels] of Object.entries(
      byPost as Record<string, unknown>
    )) {
      const post = postMap.get(postId);
      if (!post) {
        return { ok: false, error: `Неизвестный пост «${postId}»` };
      }

      if (!Array.isArray(labels)) {
        return {
          ok: false,
          error: `День ${day}, пост ${postId}: ожидается массив строк`,
        };
      }

      for (const label of labels) {
        const s = String(label).trim();
        if (!s) continue;

        const m = s.match(/^(.+)\(([сдн])\)$/u);
        let baseName: string;
        if (post.shiftHours === 24) {
          if (!m) {
            return {
              ok: false,
              error: `«${s}»: на суточном посту обязательно (с), (д) или (н)`,
            };
          }
          baseName = m[1];
        } else {
          baseName = m ? m[1] : s;
        }

        const emp = empMap.get(baseName);
        if (!emp) {
          return { ok: false, error: `Неизвестный сотрудник «${baseName}»` };
        }

        if (!emp.allowedPosts.includes(postId)) {
          return {
            ok: false,
            error: `«${baseName}» не может работать на посту «${postId}»`,
          };
        }

        const set = namesFixedPerDay.get(day) ?? new Set<string>();
        if (set.has(baseName)) {
          return {
            ok: false,
            error: `«${baseName}» уже зафиксирован ${day}-го числа (одна смена в сутки)`,
          };
        }
        set.add(baseName);
        namesFixedPerDay.set(day, set);

        const ds = String(day);
        if (!out[ds]) out[ds] = {};
        if (!out[ds][postId]) out[ds][postId] = [];
        out[ds][postId].push(s);
      }
    }
  }

  return { ok: true, data: out };
}
