/**
 * Анализ соблюдения жёстких ограничений и сводные показатели по версии
 * расписания. Чистый модуль (без prisma/React) — используется и на сервере,
 * и в клиентском редакторе.
 *
 * «Жёсткое ограничение» здесь — то, во что человека в принципе не должны были
 * поставить: «вообще не ставить» (аппарат целиком или конкретная смена на
 * суточном посту), медограничение (нельзя ночь/сутки), недоступный день,
 * пожелание «в этот день недели не сутки/не ночь». Такие места подсвечиваются
 * красным и считаются в сводке как «принуждение к исключению».
 */

export type ShiftKind = "full" | "day" | "night" | "shift";

export interface CompliancePrefs {
  /** id постов с уровнем «вообще не ставить». */
  avoidHardPosts: string[];
  /** Суточные посты: {postId: {full?|day?|night?: true}} — «вообще не ставить» по смене. */
  postShiftAvoidHard: Record<string, { full?: boolean; day?: boolean; night?: boolean }>;
  /** Недоступные дни месяца (жёсткое отсутствие). */
  unavailableDays: number[];
  /** {dow(1=Пн..7=Вс): {full?|night?: true}} — «в этот день не сутки/не ночь». */
  dowShiftAvoid: Record<string, { full?: boolean; night?: boolean }>;
  /** none | no_night | no_24h | day_only */
  medicalRestriction: string;
}

export interface ComplianceEmployee {
  name: string;
  rate: number;
  targetRate: number;
  maxRate: number;
  maxFull?: number | null;
  maxNights?: number | null;
  /** Сколько дней месяца сотрудник доступен (всего минус отсутствия/выходные). */
  availableDays?: number | null;
  /** Дней в месяце (для коэффициента доступности). */
  daysInMonth?: number | null;
  /**
   * Готовый коэффициент доступности по РАБОЧЕЙ норме (доступная норма ÷ полная
   * норма месяца — кадровый алгоритм: будни×6, минус праздники/предпраздничные).
   * Если задан, используется вместо грубого availableDays/daysInMonth — так
   * отображаемая цель совпадает с тем, что фактически держит солвер.
   */
  availFactor?: number | null;
  prefs?: CompliancePrefs | null;
}

export interface Violation {
  day: number;
  postId: string;
  postName: string;
  name: string;
  label: string;
  kind: ShiftKind;
  reason: string;
}

export interface ComplianceRow {
  name: string;
  rate: number;
  targetRate: number;
  hours: number;
  /** Цель с поправкой на доступность (норма × целевая ставка × доступность). */
  targetHours: number;
  /** Номинальная цель без поправки (норма × целевая ставка). */
  nominalTargetHours: number;
  /** Коэффициент доступности (доступные дни / дни месяца), 0..1. */
  availFactor: number;
  /** Доступные дни месяца. */
  availableDays: number | null;
  /** % к целевым часам с поправкой на доступность. */
  pct: number | null;
  shifts: number;
  fullCount: number;
  nightCount: number;
  dayCount: number;
  violations: Violation[];
  /** Превышение личного лимита суток (если задан). */
  fullOverLimit: number;
  /** Превышение личного лимита ночей (если задан). */
  nightOverLimit: number;
}

export interface ComplianceResult {
  rows: ComplianceRow[];
  totalHours: number;
  totalTargetHours: number;
  totalPct: number | null;
  violationCount: number;
  /** Ключи `${day}:${postId}:${label}` для подсветки конкретных ячеек. */
  violationKeys: Set<string>;
}

type Schedule = Record<string, Record<string, string[]>>;
type PostLike = { id: string; name: string; shiftHours: number };

export function parseLabel(label: string): {
  name: string;
  kind: ShiftKind;
  hours: number;
  postShiftHours: number;
} {
  const m = label.match(/\(([сдн])\)$/);
  const name = label.replace(/\([сдн]\)$/, "");
  if (m) {
    if (m[1] === "с") return { name, kind: "full", hours: 24, postShiftHours: 24 };
    if (m[1] === "д") return { name, kind: "day", hours: 12, postShiftHours: 24 };
    return { name, kind: "night", hours: 12, postShiftHours: 24 };
  }
  return { name, kind: "shift", hours: 12, postShiftHours: 12 };
}

/** День месяца → день недели 1=Пн..7=Вс. */
function dowOf(year: number, month: number, day: number): number {
  return ((new Date(year, month - 1, day).getDay() + 6) % 7) + 1;
}

function detectReasons(
  prefs: CompliancePrefs,
  postId: string,
  kind: ShiftKind,
  day: number,
  dow: number,
): string[] {
  const reasons: string[] = [];

  if (prefs.unavailableDays.includes(day)) {
    reasons.push("недоступный день");
  }

  if (prefs.avoidHardPosts.includes(postId)) {
    reasons.push("аппарат «вообще не ставить»");
  }

  const ksh = prefs.postShiftAvoidHard[postId];
  if (ksh) {
    if (kind === "full" && ksh.full) reasons.push("сутки «вообще не ставить»");
    if (kind === "day" && ksh.day) reasons.push("день «вообще не ставить»");
    if (kind === "night" && ksh.night) reasons.push("ночь «вообще не ставить»");
  }

  const med = prefs.medicalRestriction;
  if (med === "no_night" && kind === "night") reasons.push("медотвод: нельзя ночь");
  if (med === "no_24h" && kind === "full") reasons.push("медотвод: нельзя сутки");
  if (med === "day_only" && (kind === "night" || kind === "full"))
    reasons.push("медотвод: только день");

  const dsa = prefs.dowShiftAvoid[String(dow)];
  if (dsa) {
    if (kind === "full" && dsa.full) reasons.push("в этот день недели не сутки");
    if (kind === "night" && dsa.night) reasons.push("в этот день недели не ночь");
  }

  return reasons;
}

export function analyzeSchedule(
  schedule: Schedule,
  posts: PostLike[],
  employees: ComplianceEmployee[],
  normHours: number,
  year: number,
  month: number,
): ComplianceResult {
  const postMap = new Map(posts.map((p) => [p.id, p]));
  const empMap = new Map(employees.map((e) => [e.name, e]));

  const rows = new Map<string, ComplianceRow>();
  const ensureRow = (name: string): ComplianceRow => {
    let r = rows.get(name);
    if (!r) {
      const emp = empMap.get(name);
      const targetRate = emp?.targetRate ?? emp?.rate ?? 1;
      const nominalTargetHours = normHours > 0 ? normHours * targetRate : 0;
      // Поправка на доступность: человек, доступный 7 дней из 31, не отработает
      // полную ставку — цель и % считаем от достижимого, как и солвер.
      const dim = emp?.daysInMonth ?? null;
      const availDays = emp?.availableDays ?? null;
      const availFactor =
        emp?.availFactor != null
          ? Math.max(0, Math.min(1, emp.availFactor))
          : dim && dim > 0 && availDays != null
            ? Math.max(0, Math.min(1, availDays / dim))
            : 1;
      const targetHours = nominalTargetHours * availFactor;
      r = {
        name,
        rate: emp?.rate ?? 0,
        targetRate,
        hours: 0,
        targetHours,
        nominalTargetHours,
        availFactor,
        availableDays: availDays,
        pct: null,
        shifts: 0,
        fullCount: 0,
        nightCount: 0,
        dayCount: 0,
        violations: [],
        fullOverLimit: 0,
        nightOverLimit: 0,
      };
      rows.set(name, r);
    }
    return r;
  };

  const violationKeys = new Set<string>();

  for (const [dayStr, byPost] of Object.entries(schedule)) {
    const day = parseInt(dayStr, 10);
    if (!Number.isFinite(day)) continue;
    const dow = dowOf(year, month, day);

    for (const [postId, people] of Object.entries(byPost)) {
      if (!Array.isArray(people)) continue;
      const post = postMap.get(postId);
      for (const label of people) {
        const { name, kind, hours } = parseLabel(label);
        const realHours = kind === "shift" ? post?.shiftHours ?? 12 : hours;
        const row = ensureRow(name);
        row.hours += realHours;
        row.shifts += 1;
        if (kind === "full") row.fullCount += 1;
        else if (kind === "night") row.nightCount += 1;
        else if (kind === "day") row.dayCount += 1;

        const emp = empMap.get(name);
        const prefs = emp?.prefs;
        if (prefs) {
          const reasons = detectReasons(prefs, postId, kind, day, dow);
          if (reasons.length > 0) {
            const reason = reasons.join("; ");
            row.violations.push({
              day,
              postId,
              postName: post?.name ?? postId,
              name,
              label,
              kind,
              reason,
            });
            violationKeys.add(`${day}:${postId}:${label}`);
          }
        }
      }
    }
  }

  // Превышение личных лимитов суток/ночей.
  for (const row of rows.values()) {
    const emp = empMap.get(row.name);
    if (emp?.maxFull != null && row.fullCount > emp.maxFull) {
      row.fullOverLimit = row.fullCount - emp.maxFull;
    }
    if (emp?.maxNights != null && row.nightCount > emp.maxNights) {
      row.nightOverLimit = row.nightCount - emp.maxNights;
    }
    row.pct = row.targetHours > 0 ? (row.hours / row.targetHours) * 100 : null;
  }

  const rowList = Array.from(rows.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const totalHours = rowList.reduce((s, r) => s + r.hours, 0);
  const totalTargetHours = rowList.reduce((s, r) => s + r.targetHours, 0);
  const violationCount = rowList.reduce((s, r) => s + r.violations.length, 0);

  return {
    rows: rowList,
    totalHours,
    totalTargetHours,
    totalPct: totalTargetHours > 0 ? (totalHours / totalTargetHours) * 100 : null,
    violationCount,
    violationKeys,
  };
}
