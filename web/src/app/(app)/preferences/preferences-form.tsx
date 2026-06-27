"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Clock } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  isPartTime,
  minFreeWorkDays,
  maxRecurringDows,
  round2,
} from "@/lib/rates";

const MONTH_NAMES = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const PREF_OPTIONS = [
  { value: "null", label: "Нейтрально" },
  { value: "prefer", label: "Предпочитаю" },
  { value: "avoid", label: "Лучше не ставить" },
];

const PREF3 = [
  { value: "prefer", label: "Предпочитаю" },
  { value: "neutral", label: "Нейтрально" },
  { value: "avoid", label: "Лучше не ставить" },
];

// Предпочтения по аппаратам — 5 градаций. Центр «нейтрально».
// Крайний «avoid_hard» = жёсткий запрет (солвер ставит только в крайнем
// случае; админ может переопределить вручную/фикс-слотом).
const POST_PREF5 = [
  { value: "prefer_strong", label: "Очень хочу" },
  { value: "prefer", label: "Скорее хочу" },
  { value: "neutral", label: "Нейтрально" },
  { value: "avoid", label: "Лучше не ставить" },
  { value: "avoid_hard", label: "Вообще не ставить" },
] as const;

const PREF_COLOR: Record<string, string> = {
  prefer_strong: "text-green-500",
  prefer: "text-green-400",
  avoid: "text-amber-400",
  avoid_hard: "text-red-500",
  neutral: "text-muted-foreground",
  null: "text-muted-foreground",
};

type ShiftTimeMode =
  | "only_full"
  | "prefer_full"
  | "neutral"
  | "prefer_day"
  | "prefer_night";

function isShiftTimeMode(v: unknown): v is ShiftTimeMode {
  return (
    v === "only_full" ||
    v === "prefer_full" ||
    v === "neutral" ||
    v === "prefer_day" ||
    v === "prefer_night"
  );
}

const MEDICAL_OPTIONS = [
  { value: "none", label: "Нет ограничений" },
  { value: "no_night", label: "Нельзя ночные смены" },
  { value: "no_24h", label: "Нельзя суточные (24ч)" },
  { value: "day_only", label: "Только дневные смены" },
] as const;

const VARIETY_OPTIONS = [
  { value: "neutral", label: "Без разницы" },
  { value: "same", label: "Хочу один и тот же аппарат" },
  { value: "variety", label: "Хочу разные аппараты" },
] as const;

// Лимиты на отмечаемые даты для ОСНОВНЫХ сотрудников (ставка ≥ 1.0):
// максимум подряд и максимум всего — отдельно для «не могу» и «лучше не ставить».
const DATE_MAX_CONSEC = 4;
const DATE_MAX_TOTAL = 12;

function varietyLabel(v: string) {
  return VARIETY_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

/** Максимум подряд идущих дней в наборе. */
function maxConsecutiveInSet(set: Set<number>): number {
  const arr = Array.from(set).sort((a, b) => a - b);
  let run = 0;
  let max = 0;
  let prev = -10;
  for (const d of arr) {
    run = d === prev + 1 ? run + 1 : 1;
    if (run > max) max = run;
    prev = d;
  }
  return max;
}

/**
 * Backward-compat: derive the aggregate mode from the legacy per-24h-post
 * flags (pref24hFull/Day/Night).  Used when the explicit `shiftTimeMode`
 * wasn't saved yet on an old preference record.
 */
function deriveLegacyShiftTimeMode(
  full: string | null,
  day: string | null,
  night: string | null,
): ShiftTimeMode {
  if (full === "prefer" && day === "avoid" && night === "avoid")
    return "only_full";
  if (full === "prefer") return "prefer_full";
  if (day === "prefer") return "prefer_day";
  return "neutral";
}

function prefLabel(v: string) {
  const label =
    [...PREF_OPTIONS, ...PREF3, ...POST_PREF5].find((o) => o.value === v)
      ?.label ?? v;
  const color = PREF_COLOR[v] ?? "";
  return <span className={color}>{label}</span>;
}

// Лейблы для триггеров селектов (Base UI отображает «сырое» value, если не
// передать функцию-ребёнка — поэтому подставляем человекочитаемый текст).
function medicalLabel(v: string) {
  return MEDICAL_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

type Post = {
  id: string;
  name: string;
  shiftHours: number;
  modality: string;
};

interface Props {
  employeeId: string;
  employeeName: string;
  employee: {
    rate: number;
    targetRate: number;
    maxRate: number;
    seniority?: number;
    modalities: string[];
    can24h: boolean;
    hospitalStartYear: number | null;
    careerStartYear: number | null;
    consecutivePref: string;
    medicalRestriction: string;
    medicalNote: string | null;
    recurringUnavailableDows: number[];
  };
  coworkers: string[];
  previous: {
    shiftTimeMode: string | null;
    postPreferences: Record<string, string>;
    weekdayPref: string | null;
    weekendPref: string | null;
    dayOfWeekPrefs: Record<string, string>;
    postShiftPrefs: Record<string, Record<string, string>>;
    dowShiftAvoid: Record<string, Record<string, boolean>>;
    softUnavailableDays: number[];
    consecutivePrefOverride: string | null;
    loadPref: string | null;
    maxNights: number | null;
    maxFull: number | null;
    minShifts: number | null;
    avoidSamePost: boolean;
    avoidWith: string[];
    preferWith: string[];
    availabilityMode?: string | null;
    availableDays?: number[];
    postVarietyPref?: string | null;
  } | null;
  posts: Post[];
  has24hPostsInSystem: boolean;
  year: number;
  month: number;
  monthId?: string | null;
  deadline: string | null;
  monthStatus: string;
  isAdmin?: boolean;
  /** Админ редактирует анкету ЗА другого сотрудника (профиль пишем в admin-API). */
  adminOnBehalf?: boolean;
  /** Полный список постов (вкл. неактивные) — только для расчёта allowedPosts
   *  при сохранении профиля админом, чтобы не терять неактивные посты. */
  allPostsForAllowed?: { id: string; modality: string }[];
  existing: {
    pref24hFull: string | null;
    pref24hDay: string | null;
    pref24hNight: string | null;
    shiftTimeMode: string | null;
    postPreferences: Record<string, string>;
    postShiftPrefs: Record<string, Record<string, string>>;
    dowShiftAvoid: Record<string, Record<string, boolean>>;
    unavailableDays: number[];
    weekdayPref: string | null;
    weekendPref: string | null;
    dayOfWeekPrefs: Record<string, string>;
    desiredDates: number[];
    comment: string | null;
    softUnavailableDays: number[];
    consecutivePrefOverride: string | null;
    loadPref: string | null;
    maxNights: number | null;
    maxFull: number | null;
    minShifts: number | null;
    avoidSamePost: boolean;
    avoidWith: string[];
    preferWith: string[];
    availabilityMode?: string | null;
    availableDays?: number[];
    postVarietyPref?: string | null;
  } | null;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function PreferencesForm({
  employeeId,
  employeeName,
  employee,
  coworkers,
  previous,
  posts,
  has24hPostsInSystem,
  year,
  month,
  deadline,
  monthStatus,
  isAdmin = false,
  adminOnBehalf = false,
  allPostsForAllowed,
  existing,
}: Props) {
  const router = useRouter();

  const initialRate =
    typeof employee.rate === "number" && employee.rate > 0
      ? employee.rate
      : 1.0;
  const initialMaxRate =
    typeof employee.maxRate === "number" && employee.maxRate >= initialRate
      ? employee.maxRate
      : Math.max(1.5, initialRate);
  const initialTargetRate =
    typeof employee.targetRate === "number" && employee.targetRate > 0
      ? Math.min(Math.max(employee.targetRate, initialRate), initialMaxRate)
      : initialRate;

  // Профиль (ставки, модальности, стаж) теперь правит только администратор в
  // «Матрице аппаратов» — здесь значения только читаются и пересохраняются как
  // есть, поэтому без сеттеров.
  const [rate] = useState(initialRate);
  const [targetRate] = useState(initialTargetRate);
  const [maxRate] = useState(initialMaxRate);
  const [modalities] = useState<string[]>(employee.modalities);
  const [can24h] = useState(employee.can24h);
  const [hospitalYearStr] = useState(() =>
    employee.hospitalStartYear != null ? String(employee.hospitalStartYear) : "",
  );
  const [careerYearStr] = useState(() =>
    employee.careerStartYear != null ? String(employee.careerStartYear) : "",
  );

  const initialShiftTimeMode: ShiftTimeMode = isShiftTimeMode(
    existing?.shiftTimeMode,
  )
    ? (existing!.shiftTimeMode as ShiftTimeMode)
    : deriveLegacyShiftTimeMode(
        existing?.pref24hFull ?? null,
        existing?.pref24hDay ?? null,
        existing?.pref24hNight ?? null,
      );
  const [shiftTimeMode, setShiftTimeMode] =
    useState<ShiftTimeMode>(initialShiftTimeMode);
  const [postPrefs, setPostPrefs] = useState<Record<string, string>>(
    existing?.postPreferences ?? {},
  );
  // Пожелания по типам смен на суточных постах: {postId: {full|day|night: lvl}}
  const [postShiftPrefs, setPostShiftPrefs] = useState<
    Record<string, Record<string, string>>
  >(existing?.postShiftPrefs ?? {});
  const [unavailable, setUnavailable] = useState<Set<number>>(
    new Set(existing?.unavailableDays ?? []),
  );
  const [desired, setDesired] = useState<Set<number>>(
    new Set(existing?.desiredDates ?? []),
  );
  const [dowPrefs, setDowPrefs] = useState<Record<string, string>>(
    existing?.dayOfWeekPrefs ?? {},
  );
  const [comment, setComment] = useState(existing?.comment ?? "");

  // Профильные (стабильные) поля. Очерёдность смен из анкеты убрана —
  // значение сохраняем как есть (правится администратором при необходимости).
  const [consecutivePref] = useState(employee.consecutivePref || "avoid");
  const [medicalRestriction, setMedicalRestriction] = useState(
    employee.medicalRestriction || "none",
  );
  const [medicalNote, setMedicalNote] = useState(employee.medicalNote ?? "");
  const [recurringDows, setRecurringDows] = useState<Set<number>>(
    new Set(employee.recurringUnavailableDows ?? []),
  );

  // Месячные поля.
  const [softUnavailable, setSoftUnavailable] = useState<Set<number>>(
    new Set(existing?.softUnavailableDays ?? []),
  );
  const [maxNightsStr, setMaxNightsStr] = useState(
    existing?.maxNights != null ? String(existing.maxNights) : "",
  );
  const [maxFullStr, setMaxFullStr] = useState(
    existing?.maxFull != null ? String(existing.maxFull) : "",
  );
  const [postVarietyPref, setPostVarietyPref] = useState<string>(
    existing?.postVarietyPref ??
      (existing?.avoidSamePost ? "variety" : "neutral"),
  );
  // Режим доступности полставочника/совместителя: blacklist (НЕ могу в эти
  // даты) или whitelist (работаю ТОЛЬКО в эти даты).
  const [availabilityMode, setAvailabilityMode] = useState<string>(
    existing?.availabilityMode === "whitelist" ? "whitelist" : "blacklist",
  );
  const [availableDays, setAvailableDays] = useState<Set<number>>(
    new Set(existing?.availableDays ?? []),
  );
  const [avoidWith, setAvoidWith] = useState<string[]>(
    existing?.avoidWith ?? [],
  );
  const [preferWith, setPreferWith] = useState<string[]>(
    existing?.preferWith ?? [],
  );

  const [isPending, startTransition] = useTransition();

  const isLocked = monthStatus !== "collecting";
  const deadlineDate = deadline ? new Date(deadline) : null;
  const isPastDeadline = deadlineDate ? new Date() > deadlineDate : false;
  const readOnly = !isAdmin && (isLocked || isPastDeadline);

  const numDays = getDaysInMonth(year, month);

  // Для полставочников: сколько свободных рабочих дней нужно оставить под их
  // ставку (чтобы «нежелательными» не закрасить весь месяц).
  const approxNorm = useMemo(() => {
    let workdays = 0;
    for (let d = 1; d <= numDays; d++) {
      const wd = new Date(year, month - 1, d).getDay();
      if (wd >= 1 && wd <= 5) workdays++;
    }
    return workdays * 6;
  }, [numDays, year, month]);
  const partTime = isPartTime(rate);
  const minFreeDays = partTime ? minFreeWorkDays(targetRate, approxNorm) : 0;
  const freeForWork = numDays - unavailable.size - softUnavailable.size;
  const softAddBlocked = partTime && freeForWork <= minFreeDays;

  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);

  const visiblePosts = useMemo(() => {
    const modSet = new Set(modalities);
    return posts.filter((p) => p.modality && modSet.has(p.modality));
  }, [posts, modalities]);

  const has24h =
    can24h &&
    modalities.includes("КТ") &&
    has24hPostsInSystem &&
    visiblePosts.some((p) => p.shiftHours === 24);

  function removeFrom(
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    day: number,
  ) {
    setter((p) => {
      if (!p.has(day)) return p;
      const n = new Set(p);
      n.delete(day);
      return n;
    });
  }

  function toggleAvailable(day: number) {
    if (readOnly) return;
    setAvailableDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function toggleUnavailable(day: number) {
    if (readOnly) return;
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
        return next;
      }
      // Лимиты для основных сотрудников (ставка ≥ 1.0): макс. подряд и всего.
      // Полставочники/совместители — без лимита (по согласованию).
      if (!partTime) {
        if (next.size + 1 > DATE_MAX_TOTAL) {
          toast.warning(
            `Максимум ${DATE_MAX_TOTAL} дней «не могу» за месяц. Больше — согласование с админом.`,
          );
          return prev;
        }
        const probe = new Set(next);
        probe.add(day);
        if (maxConsecutiveInSet(probe) > DATE_MAX_CONSEC) {
          toast.warning(
            `Максимум ${DATE_MAX_CONSEC} дней «не могу» подряд. Больше — согласование с админом.`,
          );
          return prev;
        }
      }
      next.add(day);
      removeFrom(setDesired, day);
      removeFrom(setSoftUnavailable, day);
      return next;
    });
  }

  function toggleSoftUnavailable(day: number) {
    if (readOnly) return;
    setSoftUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
        return next;
      }
      // Полставочники могут отмечать сколько угодно «нежелательных», но должны
      // оставить минимум свободных дней под свою ставку — иначе график
      // не наберёт целевые часы и весь месяц окажется закрашен.
      if (partTime) {
        const free = numDays - unavailable.size - (prev.size + 1);
        if (free < minFreeDays) {
          toast.warning(
            `Оставьте минимум ${minFreeDays} свободных дней под ставку ${round2(
              targetRate,
            )} — иначе график не наберёт ваши часы. Больше отмечать нельзя.`,
          );
          return prev;
        }
      } else {
        // Основные сотрудники: те же лимиты, что и для «не могу».
        if (prev.size + 1 > DATE_MAX_TOTAL) {
          toast.warning(
            `Максимум ${DATE_MAX_TOTAL} дней «лучше не ставить» за месяц.`,
          );
          return prev;
        }
        const probe = new Set(prev);
        probe.add(day);
        if (maxConsecutiveInSet(probe) > DATE_MAX_CONSEC) {
          toast.warning(
            `Максимум ${DATE_MAX_CONSEC} дней «лучше не ставить» подряд.`,
          );
          return prev;
        }
      }
      next.add(day);
      removeFrom(setDesired, day);
      removeFrom(setUnavailable, day);
      return next;
    });
  }

  function toggleDesired(day: number) {
    if (readOnly) return;
    setDesired((prev) => {
      const next = new Set(prev);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
        removeFrom(setUnavailable, day);
        removeFrom(setSoftUnavailable, day);
      }
      return next;
    });
  }

  const recurringDowLimit = maxRecurringDows(rate);

  function toggleRecurringDow(idx: number) {
    if (readOnly) return;
    setRecurringDows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        if (next.size >= recurringDowLimit) {
          toast.error(
            `Максимум ${recurringDowLimit} ${
              partTime ? "дней (совместитель)" : "дня (основной сотрудник)"
            } регулярной недоступности`,
          );
          return prev;
        }
        next.add(idx);
      }
      return next;
    });
  }

  function toggleAvoidWith(name: string) {
    if (readOnly) return;
    setAvoidWith((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
    setPreferWith((prev) => prev.filter((n) => n !== name));
  }

  function togglePreferWith(name: string) {
    if (readOnly) return;
    setPreferWith((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
    setAvoidWith((prev) => prev.filter((n) => n !== name));
  }

  function copyFromPrevious() {
    if (readOnly || !previous) return;
    if (isShiftTimeMode(previous.shiftTimeMode)) {
      setShiftTimeMode(previous.shiftTimeMode as ShiftTimeMode);
    }
    setPostPrefs(previous.postPreferences ?? {});
    setPostShiftPrefs(previous.postShiftPrefs ?? {});
    setDowPrefs(previous.dayOfWeekPrefs ?? {});
    setSoftUnavailable(new Set(previous.softUnavailableDays ?? []));
    setMaxNightsStr(previous.maxNights != null ? String(previous.maxNights) : "");
    setMaxFullStr(previous.maxFull != null ? String(previous.maxFull) : "");
    setPostVarietyPref(
      previous.postVarietyPref ?? (previous.avoidSamePost ? "variety" : "neutral"),
    );
    setAvoidWith(previous.avoidWith ?? []);
    setPreferWith(previous.preferWith ?? []);
    toast.success("Скопировано с прошлого месяца — проверьте и сохраните");
  }

  function getConsecutiveWarning(): string | null {
    // У полставочников/совместителей лимитов на даты нет — они задают
    // доступность строго (см. режим whitelist/blacklist).
    if (partTime) return null;
    if (unavailable.size > DATE_MAX_TOTAL) {
      return `Отмечено ${unavailable.size} дней «не могу» (макс. ${DATE_MAX_TOTAL}).`;
    }
    const arr = Array.from(unavailable).sort((a, b) => a - b);
    if (arr.length === 0) return null;
    let run = 1;
    let maxRun = 1;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] === arr[i - 1] + 1) {
        run++;
        if (run > maxRun) maxRun = run;
      } else run = 1;
    }
    if (maxRun > DATE_MAX_CONSEC) {
      return `${maxRun} дней подряд (макс. ${DATE_MAX_CONSEC}).`;
    }
    return null;
  }

  const consecutiveWarning = getConsecutiveWarning();

  async function handleSave() {
    startTransition(async () => {
      const cy = new Date().getFullYear();
      const minY = cy - 60;
      const maxY = cy;

      function parseYearField(s: string): number | null | "bad" {
        const t = s.trim();
        if (!t) return null;
        const n = parseInt(t, 10);
        if (Number.isNaN(n) || n < minY || n > maxY) return "bad";
        return n;
      }

      const hospitalParsed = parseYearField(hospitalYearStr);
      const careerParsed = parseYearField(careerYearStr);
      if (hospitalParsed === "bad" || careerParsed === "bad") {
        toast.error(
          `Год введите числом от ${minY} до ${maxY} или оставьте поле пустым`,
        );
        return;
      }

      const recurringDowsArr = Array.from(recurringDows).sort((a, b) => a - b);
      // Когда админ правит анкету за другого сотрудника, профиль нельзя писать
      // в /api/employees/me (это профиль самого админа). Пишем через admin-API
      // полным объектом сотрудника; allowedPosts выводим из модальностей.
      const profileRes = adminOnBehalf
        ? await fetch("/api/admin/employees", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: employeeId,
              name: employeeName,
              rate,
              targetRate,
              maxRate,
              seniority: employee.seniority ?? 0,
              hospitalStartYear: hospitalParsed,
              careerStartYear: careerParsed,
              modalities,
              allowedPosts: (allPostsForAllowed ?? posts)
                .filter((p) => p.modality && modalities.includes(p.modality))
                .map((p) => p.id),
              can24h,
              consecutivePref,
              medicalRestriction,
              medicalNote: medicalNote.trim() || null,
              recurringUnavailableDows: recurringDowsArr,
            }),
          })
        : await fetch("/api/employees/me", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rate,
              targetRate,
              maxRate,
              modalities,
              can24h,
              hospitalStartYear: hospitalParsed,
              careerStartYear: careerParsed,
              consecutivePref,
              medicalRestriction,
              medicalNote: medicalNote.trim() || null,
              recurringUnavailableDows: recurringDowsArr,
            }),
          });

      if (!profileRes.ok) {
        const data = await profileRes.json().catch(() => null);
        toast.error(data?.error ?? "Ошибка сохранения профиля");
        return;
      }

      if (!readOnly) {
        // Белый список без единого дня = человек не работает весь месяц.
        if (
          partTime &&
          availabilityMode === "whitelist" &&
          availableDays.size === 0
        ) {
          toast.error(
            "Отметьте хотя бы один день, когда можете работать",
          );
          return;
        }

        const visibleIds = new Set(visiblePosts.map((p) => p.id));
        const twentyFourIds = new Set(
          visiblePosts.filter((p) => p.shiftHours === 24).map((p) => p.id),
        );
        // Обычные (12ч) посты идут в postPreferences; суточные — в postShiftPrefs.
        const filteredPostPrefs: Record<string, string> = {};
        for (const [pid, v] of Object.entries(postPrefs)) {
          if (visibleIds.has(pid) && !twentyFourIds.has(pid)) {
            filteredPostPrefs[pid] = v;
          }
        }
        const filteredPostShiftPrefs: Record<string, Record<string, string>> = {};
        for (const [pid, m] of Object.entries(postShiftPrefs)) {
          if (twentyFourIds.has(pid) && Object.keys(m).length > 0) {
            filteredPostShiftPrefs[pid] = m;
          }
        }

        const parseCap = (s: string): number | null => {
          const t = s.trim();
          if (!t) return null;
          const n = parseInt(t, 10);
          return Number.isNaN(n) || n < 0 ? null : n;
        };

        const prefsRes = await fetch("/api/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            year,
            month,
            shiftTimeMode,
            pref24hFull: null,
            pref24hDay: null,
            pref24hNight: null,
            postPreferences: filteredPostPrefs,
            postShiftPrefs: filteredPostShiftPrefs,
            // Удалённые из анкеты факторы: больше не задаются сотрудником.
            dowShiftAvoid: {},
            unavailableDays:
              partTime && availabilityMode === "whitelist"
                ? []
                : Array.from(unavailable).sort((a, b) => a - b),
            weekdayPref: null,
            weekendPref: null,
            dayOfWeekPrefs: dowPrefs,
            desiredDates: Array.from(desired).sort((a, b) => a - b),
            comment: comment || null,
            softUnavailableDays:
              partTime && availabilityMode === "whitelist"
                ? []
                : Array.from(softUnavailable).sort((a, b) => a - b),
            loadPref: null,
            maxNights: parseCap(maxNightsStr),
            maxFull: parseCap(maxFullStr),
            minShifts: null,
            // Разнообразие аппаратов: 3-позиция. avoidSamePost оставлен для
            // обратной совместимости с солвером (variety → true).
            postVarietyPref:
              postVarietyPref === "neutral" ? null : postVarietyPref,
            avoidSamePost: postVarietyPref === "variety",
            availabilityMode: partTime ? availabilityMode : null,
            availableDays:
              partTime && availabilityMode === "whitelist"
                ? Array.from(availableDays).sort((a, b) => a - b)
                : [],
            avoidWith,
            preferWith,
          }),
        });

        if (!prefsRes.ok) {
          const data = await prefsRes.json().catch(() => null);
          toast.error(data?.error ?? "Ошибка сохранения предпочтений");
          return;
        }
      }

      toast.success("Сохранено");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        {adminOnBehalf && (
          <a
            href="/admin/employees"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← К сотрудникам
          </a>
        )}
        <h1 className="text-xl font-semibold">Предпочтения</h1>
        <p className="text-sm text-muted-foreground">
          {employeeName} — на {MONTH_NAMES[month - 1]} {year}
        </p>
        {adminOnBehalf && (
          <Badge variant="outline" className="mt-1">
            Режим администратора: правка анкеты за сотрудника
          </Badge>
        )}
        {deadlineDate && (
          <div className="flex items-center gap-1.5 mt-2 text-sm">
            <Clock className="h-4 w-4" />
            <span>
              Дедлайн:{" "}
              <strong>
                {deadlineDate.toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "long",
                })}
              </strong>
            </span>
            {isPastDeadline && !isAdmin && (
              <Badge variant="destructive" className="ml-2">
                Дедлайн прошёл
              </Badge>
            )}
          </div>
        )}
      </div>

      {readOnly && (
        <Card className="border-yellow-500/30 bg-yellow-950/20">
          <CardContent className="py-3 text-sm">
            Сбор предпочтений на этот месяц завершён — предпочтения не
            изменятся, но профиль можно обновить.
          </CardContent>
        </Card>
      )}

      {previous && !readOnly && (
        <Button
          variant="outline"
          size="sm"
          onClick={copyFromPrevious}
          className="w-full sm:w-auto"
        >
          Скопировать с прошлого месяца
        </Button>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ограничения</CardTitle>
          <CardDescription>
            Медицинские/правовые ограничения и регулярная недоступность.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Медицинские / правовые ограничения</Label>
            <Select
              value={medicalRestriction}
              onValueChange={(v) => v && setMedicalRestriction(v)}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue>{medicalLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MEDICAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {medicalRestriction !== "none" && (
              <>
                <Input
                  placeholder="Комментарий (необязательно): напр. лёгкий труд до…"
                  value={medicalNote}
                  onChange={(e) => setMedicalNote(e.target.value)}
                  disabled={readOnly}
                  className="mt-2"
                />
                <p className="text-[11px] text-muted-foreground">
                  Это <strong>жёсткое</strong> ограничение — такие смены вам
                  ставиться не будут.
                </p>
              </>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Регулярно недоступен по дням недели</Label>
            <div className="flex flex-wrap gap-3">
              {DAY_NAMES.map((name, i) => (
                <label
                  key={name}
                  className="flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={recurringDows.has(i)}
                    disabled={readOnly}
                    onCheckedChange={() => toggleRecurringDow(i)}
                  />
                  {name}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Напр. учёба/кафедра каждый вторник — эти дни всегда будут выходными
              (можно не отмечать вручную каждый раз). Максимум{" "}
              {recurringDowLimit}{" "}
              {partTime ? "дн. (совместитель)" : "дн. (основной сотрудник)"}.
            </p>
          </div>
        </CardContent>
      </Card>

      {visiblePosts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Разнообразие аппаратов</CardTitle>
            <CardDescription>
              Хотите работать на одном и том же аппарате или, наоборот, на разных?
              Конкретные аппараты ведёт администратор — скажите ему отдельно.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={postVarietyPref}
              onValueChange={(v) => v && setPostVarietyPref(v)}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue>{varietyLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {VARIETY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {has24h && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Лимиты смен</CardTitle>
            <CardDescription>
              Необязательно. Личный потолок суточных/ночных именно на{" "}
              {MONTH_NAMES[month - 1]}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Не больше суточных (с) за месяц</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="без лимита"
                  value={maxFullStr}
                  onChange={(e) =>
                    setMaxFullStr(e.target.value.replace(/\D/g, "").slice(0, 2))
                  }
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Не больше ночных (н) за месяц</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="без лимита"
                  value={maxNightsStr}
                  onChange={(e) =>
                    setMaxNightsStr(e.target.value.replace(/\D/g, "").slice(0, 2))
                  }
                  disabled={readOnly}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Дни недели</CardTitle>
          <CardDescription>
            Можно указать предпочтения по конкретным дням недели
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {DAY_NAMES.map((name, i) => {
              const key = String(i + 1);
              const val = dowPrefs[key] ?? "neutral";
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded border px-3 py-1.5 text-sm"
                >
                  <span className="flex-1 font-medium">{name}</span>
                  <Select
                    value={val}
                    onValueChange={(v) => {
                      if (!v) return;
                      setDowPrefs((p) => {
                        const next = { ...p, [key]: v };
                        if (v === "neutral") delete next[key];
                        return next;
                      });
                    }}
                    disabled={readOnly}
                  >
                    <SelectTrigger className="w-40 h-7 text-xs">
                      <SelectValue>{prefLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PREF3.map((o) => (
                        <SelectItem
                          key={o.value}
                          value={o.value}
                          className="text-xs"
                        >
                          <span className={PREF_COLOR[o.value] ?? ""}>
                            {o.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {partTime && (
        <Card className="border-sky-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Как вы задаёте доступность</CardTitle>
            <CardDescription>
              Для полставки/совместительства пожелания по датам соблюдаются
              <strong> строго</strong>. Выберите удобный способ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={availabilityMode}
              onValueChange={(v) => v && setAvailabilityMode(v)}
              disabled={readOnly}
            >
              <SelectTrigger className="w-full sm:w-96">
                <SelectValue>
                  {(v: string) =>
                    v === "whitelist"
                      ? "Работаю ТОЛЬКО в выбранные даты"
                      : "НЕ могу в выбранные даты (всё остальное доступно)"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blacklist">
                  НЕ могу в выбранные даты (всё остальное доступно)
                </SelectItem>
                <SelectItem value="whitelist">
                  Работаю ТОЛЬКО в выбранные даты
                </SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {partTime && availabilityMode === "whitelist" && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Даты, когда МОГУ работать
            </CardTitle>
            <CardDescription>
              Отмечено: {availableDays.size}. Во все остальные дни месяца вас не
              поставят (жёстко).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground mb-1">
              {DAY_NAMES.map((d) => (
                <div key={d} className="py-0.5">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((day, i) => {
                if (day === null)
                  return <div key={`a-${i}`} className="h-8" />;
                const isA = availableDays.has(day);
                const date = new Date(year, month - 1, day);
                const weekend = date.getDay() === 0 || date.getDay() === 6;
                return (
                  <button
                    key={day}
                    onClick={() => toggleAvailable(day)}
                    disabled={readOnly}
                    className={`h-8 rounded text-xs font-medium transition-colors ${
                      isA
                        ? "bg-green-600/30 text-green-400 ring-1 ring-green-500/50"
                        : weekend
                          ? "bg-red-950/20 hover:bg-red-900/30"
                          : "bg-muted/30 hover:bg-muted"
                    } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Желаемые даты</CardTitle>
          <CardDescription>
            Необязательно, повышает вероятность, но не гарантия. Отмечено:{" "}
            {desired.size}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="py-0.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} className="h-8" />;
              const isD = desired.has(day);
              const isU = unavailable.has(day);
              return (
                <button
                  key={day}
                  onClick={() => toggleDesired(day)}
                  disabled={readOnly}
                  className={`h-8 rounded text-xs font-medium transition-colors ${
                    isD
                      ? "bg-green-600/30 text-green-400 ring-1 ring-green-500/50"
                      : isU
                        ? "bg-destructive/20 text-destructive opacity-50 cursor-not-allowed"
                        : "bg-muted/30 hover:bg-muted"
                  } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {!(partTime && availabilityMode === "whitelist") && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Дни, когда НЕ могу работать
          </CardTitle>
          <CardDescription>
            Отмечено: {unavailable.size}.
            {partTime
              ? " Соблюдается строго, без ограничения количества."
              : ` Макс. ${DATE_MAX_CONSEC} дней подряд и ${DATE_MAX_TOTAL} всего.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {consecutiveWarning && (
            <div className="mb-2 rounded bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {consecutiveWarning}
            </div>
          )}
          <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="py-0.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e2-${i}`} className="h-8" />;
              const isU = unavailable.has(day);
              const date = new Date(year, month - 1, day);
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              return (
                <button
                  key={day}
                  onClick={() => toggleUnavailable(day)}
                  disabled={readOnly}
                  className={`h-8 rounded text-xs font-medium transition-colors ${
                    isU
                      ? "bg-destructive text-destructive-foreground"
                      : weekend
                        ? "bg-red-950/20 hover:bg-red-900/30"
                        : "bg-muted/30 hover:bg-muted"
                  } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
      )}

      {!(partTime && availabilityMode === "whitelist") && (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Дни, когда лучше не ставить (мягко)
          </CardTitle>
          <CardDescription>
            В отличие от «не могу» — это не запрет: солвер постарается не ставить
            смену, но может, если иначе график не сходится. Отмечено:{" "}
            {softUnavailable.size}
            {partTime && (
              <>
                {" "}
                · для полставки эти дни очень приоритетны. Свободно под ставку:{" "}
                <strong>{Math.max(0, freeForWork)}</strong> дн. (минимум{" "}
                {minFreeDays})
                {softAddBlocked && (
                  <span className="text-amber-600">
                    {" "}
                    — достигнут лимит, снимите другой день, чтобы отметить новый.
                  </span>
                )}
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground mb-1">
            {DAY_NAMES.map((d) => (
              <div key={d} className="py-0.5">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (day === null) return <div key={`e3-${i}`} className="h-8" />;
              const isSoft = softUnavailable.has(day);
              const isHard = unavailable.has(day);
              const isDes = desired.has(day);
              const blocked = isHard || isDes;
              const limitBlocked = softAddBlocked && !isSoft && !blocked;
              return (
                <button
                  key={day}
                  onClick={() => toggleSoftUnavailable(day)}
                  disabled={readOnly || blocked || limitBlocked}
                  title={
                    isHard
                      ? "День помечен как «не могу»"
                      : isDes
                        ? "День помечен как желаемый"
                        : limitBlocked
                          ? `Оставьте минимум ${minFreeDays} свободных дней под вашу ставку`
                          : undefined
                  }
                  className={`h-8 rounded text-xs font-medium transition-colors ${
                    isSoft
                      ? "bg-amber-500/30 text-amber-300 ring-1 ring-amber-500/50"
                      : blocked || limitBlocked
                        ? "bg-muted/20 text-muted-foreground/40 cursor-not-allowed"
                        : "bg-muted/30 hover:bg-muted"
                  } ${readOnly ? "cursor-default" : ""}`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>
      )}

      {coworkers.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Пожелания по коллегам</CardTitle>
            <CardDescription>
              Необязательно. «Не ставить вместе» учитывается жёстче, «хочу
              вместе» — как мягкое пожелание (напр. работа с наставником).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 items-center text-sm">
              <div className="text-xs text-muted-foreground" />
              <div className="text-[11px] text-muted-foreground text-center w-20">
                Не вместе
              </div>
              <div className="text-[11px] text-muted-foreground text-center w-20">
                Хочу вместе
              </div>
              {coworkers.map((name) => (
                <FragmentRow
                  key={name}
                  name={name}
                  avoid={avoidWith.includes(name)}
                  prefer={preferWith.includes(name)}
                  readOnly={readOnly}
                  onAvoid={() => toggleAvoidWith(name)}
                  onPrefer={() => togglePreferWith(name)}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Комментарий</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            placeholder="Дополнительные пожелания..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            disabled={readOnly}
            rows={3}
          />
        </CardContent>
      </Card>

      <Button
        onClick={handleSave}
        disabled={isPending}
        className="w-full sm:w-auto"
      >
        {isPending
          ? "Сохранение..."
          : readOnly
            ? "Сохранить профиль"
            : "Сохранить"}
      </Button>
    </div>
  );
}

function FragmentRow({
  name,
  avoid,
  prefer,
  readOnly,
  onAvoid,
  onPrefer,
}: {
  name: string;
  avoid: boolean;
  prefer: boolean;
  readOnly: boolean;
  onAvoid: () => void;
  onPrefer: () => void;
}) {
  return (
    <>
      <span className="truncate border-t py-1.5">{name}</span>
      <div className="flex justify-center border-t py-1.5 w-20">
        <Checkbox checked={avoid} disabled={readOnly} onCheckedChange={onAvoid} />
      </div>
      <div className="flex justify-center border-t py-1.5 w-20">
        <Checkbox
          checked={prefer}
          disabled={readOnly}
          onCheckedChange={onPrefer}
        />
      </div>
    </>
  );
}
