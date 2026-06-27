/**
 * Единые правила ставок (rate / targetRate / maxRate).
 *
 * Договорная ставка — только 0.5 (полставки) или 1.0 (полная).
 * Полставочники (rate ≤ 0.5) ограничены потолком 0.75 ставки; их целевая и
 * максимальная ставки выбираются мелким шагом 0.05 (0.5, 0.55, …, 0.75).
 * Полные ставки переходят шагом 0.25 до абсолютного потолка по ТК (2.0).
 *
 * Этот модуль — единственный источник правды: его используют формы (админ и
 * сотрудник), API-сохранение и расчёт ёмкости в генерации.
 */

export const RATE_OPTIONS = [0.5, 1.0] as const;
export const PART_TIME_MAX_RATE = 0.75;
export const ABSOLUTE_MAX_RATE = 2.5;

const PART_TIME_STEPS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75];
const FULL_TIME_STEPS = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5];

const EPS = 1e-9;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Полставочник (договорная ставка 0.5 и ниже). */
export function isPartTime(rate: number): boolean {
  return rate <= 0.5 + EPS;
}

/** Максимально допустимый потолок ставок для данной договорной ставки. */
export function maxRateCap(rate: number): number {
  return isPartTime(rate) ? PART_TIME_MAX_RATE : ABSOLUTE_MAX_RATE;
}

/** Варианты для селекта «макс. ставка (потолок)». */
export function maxRateOptions(rate: number): number[] {
  const steps = isPartTime(rate) ? PART_TIME_STEPS : FULL_TIME_STEPS;
  const cap = maxRateCap(rate);
  return steps.filter((r) => r >= rate - EPS && r <= cap + EPS);
}

/** Варианты для селекта «целевая ставка» (между rate и потолком). */
export function targetRateOptions(rate: number, maxRate: number): number[] {
  const cap = Math.min(maxRate, maxRateCap(rate));
  const steps = isPartTime(rate) ? PART_TIME_STEPS : FULL_TIME_STEPS;
  return steps.filter((r) => r >= rate - EPS && r <= cap + EPS);
}

/**
 * Мелкие (0.05) деления целевой ставки от договорной ставки до потолка —
 * для тонкой настройки целевой загрузки в карточке/модалке сотрудника.
 */
export function targetRateFineOptions(rate: number, maxRate: number): number[] {
  const cap = Math.min(Math.max(maxRate, rate), maxRateCap(rate));
  const out: number[] = [];
  for (let v = rate; v <= cap + EPS; v = round2(v + 0.05)) out.push(round2(v));
  return out;
}

/**
 * Максимум дней недели для регулярной недоступности:
 *   • совместители (полставка) — до 6;
 *   • основные сотрудники — до 3.
 */
export function maxRecurringDows(rate: number): number {
  return isPartTime(rate) ? 6 : 3;
}

/** Свести тройку ставок к согласованным значениям (rate ≤ target ≤ max ≤ cap). */
export function clampRates(
  rate: number,
  targetRate: number,
  maxRate: number,
): { rate: number; targetRate: number; maxRate: number } {
  const cap = maxRateCap(rate);
  const max = round2(Math.min(Math.max(maxRate, rate), cap));
  const target = round2(Math.min(Math.max(targetRate, rate), max));
  return { rate, targetRate: target, maxRate: max };
}

/**
 * Минимум свободных (рабочих) дней, которые сотрудник должен оставить под свою
 * целевую ставку: число 12-часовых смен, нужное чтобы набрать целевые часы.
 * Используется как «не закрашивай весь месяц» для полставочников.
 */
export function minFreeWorkDays(targetRate: number, normHours: number): number {
  if (!normHours || normHours <= 0) return 1;
  return Math.max(1, Math.ceil((targetRate * normHours) / 12));
}

/** Часов на ставку 1.0 за один рабочий будний день. */
const HOURS_PER_WORKDAY = 6;

/** День месяца (1..N) → день недели 0=Пн … 6=Вс. */
function dowMon0(year: number, month: number, day: number): number {
  return (new Date(year, month - 1, day).getDay() + 6) % 7;
}

/**
 * Норма рабочих часов на ПОЛНУЮ (1.0) ставку за месяц — так, как её считает
 * отдел кадров (см. AGENTS.md / голосовое от пользователя):
 *
 *   • каждый будний день (Пн–Пт), не являющийся праздником, = 6 часов
 *     (30-часовая рабочая неделя ÷ 5 дней);
 *   • праздничные дни не считаются вовсе;
 *   • предпраздничный рабочий день — на 1 час короче (5 часов);
 *   • выходные (Сб/Вс) в норму не входят.
 *
 * Для месяца с отпуском/недоступностью передаётся `isAvailableDay`: тогда
 * считаются только доступные будни. Это НЕ пропорция по календарным дням —
 * вычитаются именно рабочие дни отпуска (с учётом праздников и предпраздничных),
 * как требует кадровый алгоритм. Полставка = результат ÷ 2 (через `rate`).
 *
 * `isHolidayDate` получает дату (в т.ч. 1-е число следующего месяца — для
 * проверки «предпраздничный ли сегодня день»).
 */
/**
 * Норма часов на ПОЛНУЮ (1.0) ставку за месяц как ИСТОЧНИК ИСТИНЫ:
 *   • если в `overrides` есть значение для `${year}-${month}` (>0) — берём его;
 *   • иначе считаем по кадровому алгоритму (`workNormHours` — будни×6, праздники
 *     не считаются, предпраздничный день короче на час).
 *
 * `overrides` — карта вида `{ "2026-7": 126 }` (хранится в Setting `monthNorms`).
 */
export function resolveMonthNorm(
  year: number,
  month: number,
  isHolidayDate: (d: Date) => boolean,
  overrides?: Record<string, number> | null,
): number {
  const key = `${year}-${month}`;
  const ov = overrides?.[key];
  if (typeof ov === "number" && Number.isFinite(ov) && ov > 0) {
    return ov;
  }
  return workNormHours(year, month, isHolidayDate);
}

export function workNormHours(
  year: number,
  month: number,
  isHolidayDate: (d: Date) => boolean,
  isAvailableDay?: (dayOfMonth: number) => boolean,
): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let hours = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (dowMon0(year, month, day) >= 5) continue; // выходной
    const dt = new Date(year, month - 1, day);
    if (isHolidayDate(dt)) continue; // праздник не считается
    if (isAvailableDay && !isAvailableDay(day)) continue; // отпуск/недоступность
    let h = HOURS_PER_WORKDAY;
    const next = new Date(year, month - 1, day + 1);
    if (isHolidayDate(next)) h -= 1; // предпраздничный день короче на час
    hours += h;
  }
  return hours;
}
