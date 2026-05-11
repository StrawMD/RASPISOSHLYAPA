/**
 * Парсинг Google Sheets CSV для июльского графика (колонки КТ ССК1, КТ РСЦ, …).
 */

export const JULY_CSV_POST_IDS = [
  "ssk1",
  "kt_pb",
  "kt_ssk2",
  "kt_2013",
  "ge_siemens",
  "kt_2011",
  "kt_4str",
  "mrt_ssk",
  "mrt_22_1",
  "mrt_21_1",
] as const;

const NAME_FIXES: Record<string, string> = {
  Мхитаря: "Мхитарян",
  Карабаев: "Карабаева",
  Василен: "Василенко",
  Гончару: "Гончарук",
};

export function normalizeJulyCsvCell(raw: string): string {
  const s = raw.trim();
  if (!s || s === "-") return "";

  const spaced = s.match(/^(.+?)\s+([сдн])$/u);
  if (spaced) {
    let base = spaced[1].trim();
    base = NAME_FIXES[base] ?? base;
    return `${base}(${spaced[2]})`;
  }

  if (/\([сдн]\)$/u.test(s)) {
    const m = s.match(/\(([сдн])\)$/u);
    const suf = m?.[1];
    const baseRaw = s.replace(/\([сдн]\)$/u, "");
    const base = NAME_FIXES[baseRaw] ?? baseRaw;
    return suf ? `${base}(${suf})` : s;
  }

  return NAME_FIXES[s] ?? s;
}

export function parseJulyScheduleCsv(content: string): {
  schedule: Record<string, Record<string, string[]>>;
  normHours: number;
} {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  let normHours = 0;
  const header = lines[0] ?? "";
  const normMatch = header.match(/(\d+)\s*ч/u);
  if (normMatch) normHours = parseInt(normMatch[1], 10);

  type Block = { day: number; rows: string[] };
  const blocks: Block[] = [];
  let current: Block | null = null;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const first = line.split(";")[0]?.trim() ?? "";
    const dayMatch = first.match(/^(\d{2})\.июл/i);
    if (dayMatch) {
      if (current) blocks.push(current);
      current = { day: parseInt(dayMatch[1], 10), rows: [line] };
    } else if (current) {
      current.rows.push(line);
    }
  }
  if (current) blocks.push(current);

  const schedule: Record<string, Record<string, string[]>> = {};
  const ids = JULY_CSV_POST_IDS;

  for (const block of blocks) {
    const dayStr = String(block.day);
    schedule[dayStr] = {};
    for (const pid of ids) {
      schedule[dayStr][pid] = [];
    }

    for (const row of block.rows) {
      const cols = row.split(";");
      for (let c = 2; c < 2 + ids.length; c++) {
        const cell = cols[c]?.trim() ?? "";
        const norm = normalizeJulyCsvCell(cell);
        if (!norm) continue;
        const postId = ids[c - 2];
        const arr = schedule[dayStr][postId];
        if (!arr.includes(norm)) arr.push(norm);
      }
    }
  }

  return { schedule, normHours };
}

/** Убирает пустые посты — компактный JSON для solverFixedSlots */
export function compactJulyScheduleForFixedSlots(
  schedule: Record<string, Record<string, string[]>>
): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  for (const [day, byPost] of Object.entries(schedule)) {
    const inner: Record<string, string[]> = {};
    for (const [pid, labels] of Object.entries(byPost)) {
      if (labels.length > 0) inner[pid] = labels;
    }
    if (Object.keys(inner).length > 0) out[day] = inner;
  }
  return out;
}
