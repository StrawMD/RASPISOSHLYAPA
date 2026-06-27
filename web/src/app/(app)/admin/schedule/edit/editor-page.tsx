"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { Loader2, Plus, X, ArrowLeftRight, History, AlertTriangle, Undo2, Redo2, UserPlus } from "lucide-react";
import {
  analyzeSchedule,
  type ComplianceEmployee,
  type CompliancePrefs,
} from "@/lib/schedule-compliance";
import {
  formatScheduleLabel,
  inverseFixedEdit,
  type FixedEditOp,
  type ShiftKind,
} from "@/lib/schedule-labels";

const KIND_LABELS: { key: ShiftKind; label: string }[] = [
  { key: "full", label: "сутки (с)" },
  { key: "day", label: "день (д)" },
  { key: "night", label: "ночь (н)" },
];

const KIND_SHORT: Record<ShiftKind, string> = {
  full: "с",
  day: "д",
  night: "н",
};

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

type Post = { id: string; name: string; shiftHours: number; staffRequired: number };
type Employee = {
  id: string;
  name: string;
  rate: number;
  targetRate: number;
  maxRate: number;
  medicalRestriction: string;
  allowedPosts: string[];
  availableDays?: number | null;
  daysInMonth?: number | null;
  availFactor?: number | null;
};
type PrefInfo = CompliancePrefs & {
  maxFull: number | null;
  maxNights: number | null;
};
type Schedule = Record<string, Record<string, string[]>>;
type EditOp = {
  day: number;
  postId: string;
  editType: string;
  oldValue: string | null;
  newValue: string | null;
};
type HistEntry =
  | { scope: "version"; op: EditOp }
  | { scope: "fixed"; op: FixedEditOp };

type EditLog = {
  id: string;
  day: number;
  postId: string;
  editType: string;
  oldValue: string | null;
  newValue: string | null;
  userName: string;
  createdAt: string;
};

type VersionInfo = {
  id: string;
  versionNumber: number;
  name: string | null;
  status: string;
  year: number;
  month: number;
  normHours: number;
};

interface HourStat {
  hours: number;
  target: number;
  cap: number;
  remaining: number;
  level: "green" | "yellow" | "red" | "neutral";
}

function computeHourStat(
  employee: Employee | undefined,
  currentHours: number,
  normHours: number
): HourStat {
  if (!normHours || normHours <= 0) {
    return {
      hours: currentHours,
      target: 0,
      cap: 0,
      remaining: 0,
      level: "neutral",
    };
  }

  const rate = employee?.rate ?? 1;
  const maxRate = employee?.maxRate ?? rate;
  // Поправка на доступность: при отпуске цель и потолки масштабируются так же,
  // как это делает солвер (иначе человек на отпуске «вечно жёлтый»).
  const avail =
    employee?.availFactor != null
      ? Math.max(0, Math.min(1, employee.availFactor))
      : 1;
  const target = normHours * rate * avail;
  // Желаемый потолок (maxRate) — пока в его пределах загрузка нормальна
  // («зелёная»), даже если солвер сознательно тянет всех к ~1.25 ставки.
  const cap = normHours * Math.max(maxRate, rate) * avail;
  // Аварийный потолок: выход за желаемый штрафуется, но физически разрешён до
  // maxRate+0.5 (не выше 2.0 ставки). Жёлтый — в этой зоне, красный — выше.
  const emergencyRate = Math.min(2.0, Math.max(maxRate, rate) + 0.5);
  const emergencyCap = normHours * emergencyRate * avail;
  const remaining = cap - currentHours;
  let level: HourStat["level"] = "green";
  if (currentHours > emergencyCap + 0.01) level = "red";
  else if (currentHours > cap + 0.01) level = "yellow";
  return { hours: currentHours, target, cap, remaining, level };
}

// Принуждение к жёсткому исключению (вообще не ставить / медотвод /
// недоступный день / не сутки-ночь по дню недели) — ярко-красный.
const VIOLATION_CLASS =
  "bg-red-600 text-white border-red-700 dark:bg-red-600 dark:text-white";

// Зафиксированная админом ячейка (solverFixedSlots) — синяя «прибита гвоздём».
// Намеренно перекрывает запреты, поэтому не красная, а отдельным цветом.
const FIXED_CLASS =
  "bg-sky-500/25 text-sky-900 dark:text-sky-100 border-sky-500/60";

// Режим «выделить сотрудника»: выбранный — ярко-жёлтый, остальные приглушены.
const HIGHLIGHT_ON_CLASS =
  "bg-yellow-300 text-black border-yellow-500 font-semibold ring-1 ring-yellow-500";
const HIGHLIGHT_OFF_CLASS =
  "bg-transparent text-muted-foreground/70 border-transparent";

const LEVEL_CLASSES: Record<HourStat["level"], string> = {
  green:
    "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40",
  yellow:
    "bg-amber-500/30 text-amber-900 dark:text-amber-100 border-amber-500/60",
  red:
    "bg-red-500/35 text-red-900 dark:text-red-100 border-red-500/70",
  neutral:
    "bg-muted/60 text-muted-foreground border-muted-foreground/30",
};

function HourBadge({ stat }: { stat: HourStat }) {
  const remainingLabel =
    stat.level === "neutral"
      ? "норма месяца?"
      : stat.remaining >= 0
      ? `ещё ${Math.round(stat.remaining)}ч`
      : `+${Math.round(-stat.remaining)}ч сверх`;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1 py-px text-[10px] leading-none font-medium ${LEVEL_CLASSES[stat.level]}`}
      title={
        stat.level === "neutral"
          ? `Всего: ${Math.round(stat.hours)}ч · Норма месяца не задана`
          : `Всего: ${Math.round(stat.hours)}ч · По ставке: ${Math.round(stat.target)}ч · Потолок: ${Math.round(stat.cap)}ч`
      }
    >
      {Math.round(stat.hours)}ч
      <span className="opacity-70">· {remainingLabel}</span>
    </span>
  );
}

export function ScheduleEditPage() {
  const searchParams = useSearchParams();
  const versionId = searchParams.get("versionId");

  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [schedule, setSchedule] = useState<Schedule>({});
  const [fixedSlots, setFixedSlots] = useState<Schedule>({});
  // Режим «выделить сотрудника»: пустая строка = выкл. Когда включён —
  // компактный вид, фамилии мельче и без подсветки часов, ярко горит только
  // выбранный сотрудник (быстро видно его график по месяцу).
  const [highlightName, setHighlightName] = useState<string>("");
  const [employeeHours, setEmployeeHours] = useState<Record<string, number>>({});
  const [posts, setPosts] = useState<Post[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [prefsByName, setPrefsByName] = useState<Record<string, PrefInfo>>({});
  const [recentEdits, setRecentEdits] = useState<EditLog[]>([]);
  const [histStack, setHistStack] = useState<HistEntry[]>([]);
  const [histFuture, setHistFuture] = useState<HistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLog, setShowLog] = useState(false);
  const [relaxed, setRelaxed] = useState(false);
  const [overtime, setOvertime] = useState<
    { name: string; overTarget: number; overCeiling: number }[]
  >([]);
  const [emergencyOvertimeTotal, setEmergencyOvertimeTotal] = useState(0);
  // Версия генерилась без фиксов месяца — тогда совпадения с фиксами не
  // «прибиты гвоздём», поэтому синим их не красим.
  const [versionIgnoredFixed, setVersionIgnoredFixed] = useState(false);
  // Режим быстрого обмена двух ячеек: первый выбранный «источник» хранится тут.
  const [swapMode, setSwapMode] = useState(false);
  const [swapSource, setSwapSource] = useState<
    { day: number; postId: string; label: string } | null
  >(null);
  // Режим быстрого добавления: выбранная фамилия проставляется кликом по
  // ячейкам сразу во многих местах. Для суточных постов — выбранный тип смены.
  const [quickAddName, setQuickAddName] = useState<string>("");
  const [quickAddKind, setQuickAddKind] = useState<ShiftKind>("full");
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);
  // Режим быстрой фиксации: клик по ячейке закрепляет/снимает всех её людей.
  const [fixMode, setFixMode] = useState(false);
  // Целевое число людей в ячейке (на момент открытия) = занято + недобор.
  // Подсветка «дыр» гаснет по мере дозаполнения в текущей сессии.
  const [cellTargets, setCellTargets] = useState<Record<string, number>>({});
  const targetsInitialized = useRef(false);

  const load = useCallback(async () => {
    if (!versionId) return;
    setLoading(true);
    const res = await fetch(`/api/schedule/edit?versionId=${versionId}`);
    if (res.ok) {
      const data = await res.json();
      setVersion(data.version);
      setSchedule(data.schedule);
      setFixedSlots(data.fixedSlots ?? {});
      setEmployeeHours(data.employeeHours);
      setPosts(data.posts);
      setEmployees(data.employees);
      setPrefsByName(data.prefsByName ?? {});
      setRecentEdits(data.recentEdits);
      setRelaxed(Boolean(data.relaxed));
      setOvertime(data.overtime ?? []);
      setEmergencyOvertimeTotal(data.emergencyOvertimeTotal ?? 0);
      setVersionIgnoredFixed(Boolean(data.ignoreFixedSlots));

      if (!targetsInitialized.current) {
        targetsInitialized.current = true;
        const unfilled: { postId: string; day: number; count: number }[] =
          data.unfilled ?? [];
        if (unfilled.length > 0) {
          const sched: Schedule = data.schedule ?? {};
          const targets: Record<string, number> = {};
          for (const u of unfilled) {
            const key = `${u.day}:${u.postId}`;
            const assigned = (sched[String(u.day)]?.[u.postId] ?? []).length;
            targets[key] = (targets[key] ?? assigned) + u.count;
          }
          setCellTargets(targets);
        }
      }
    }
    setLoading(false);
  }, [versionId]);

  useEffect(() => {
    load();
  }, [load]);

  const computedHours = useMemo(() => {
    const map: Record<string, number> = {};
    const postMap = new Map(posts.map((p) => [p.id, p]));
    for (const dayData of Object.values(schedule)) {
      for (const [pid, people] of Object.entries(dayData)) {
        const post = postMap.get(pid);
        for (const person of people) {
          const baseName = person.replace(/\([сдн]\)$/, "");
          const typeMatch = person.match(/\(([сдн])\)$/);
          const h = typeMatch
            ? typeMatch[1] === "с"
              ? 24
              : 12
            : post?.shiftHours ?? 12;
          map[baseName] = (map[baseName] ?? 0) + h;
        }
      }
    }
    return map;
  }, [schedule, posts]);

  const compliance = useMemo(() => {
    if (!version) return null;
    const complianceEmployees: ComplianceEmployee[] = employees.map((e) => {
      const pi = prefsByName[e.name];
      return {
        name: e.name,
        rate: e.rate,
        targetRate: e.targetRate,
        maxRate: e.maxRate,
        availableDays: e.availableDays ?? null,
        daysInMonth: e.daysInMonth ?? null,
        availFactor: e.availFactor ?? null,
        maxFull: pi?.maxFull ?? null,
        maxNights: pi?.maxNights ?? null,
        prefs: pi
          ? {
              avoidHardPosts: pi.avoidHardPosts ?? [],
              postShiftAvoidHard: pi.postShiftAvoidHard ?? {},
              unavailableDays: pi.unavailableDays ?? [],
              dowShiftAvoid: pi.dowShiftAvoid ?? {},
              medicalRestriction:
                pi.medicalRestriction ?? e.medicalRestriction ?? "none",
            }
          : e.medicalRestriction && e.medicalRestriction !== "none"
            ? {
                avoidHardPosts: [],
                postShiftAvoidHard: {},
                unavailableDays: [],
                dowShiftAvoid: {},
                medicalRestriction: e.medicalRestriction,
              }
            : null,
      };
    });
    return analyzeSchedule(
      schedule,
      posts,
      complianceEmployees,
      version.normHours ?? 0,
      version.year,
      version.month,
      fixedSlots,
    );
  }, [schedule, posts, employees, prefsByName, version, fixedSlots]);

  async function runEdit(op: EditOp): Promise<boolean> {
    const res = await fetch("/api/schedule/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId, ...op }),
    });
    if (res.ok) {
      const data = await res.json();
      setSchedule(data.schedule);
      setEmployeeHours(data.employeeHours);
      load();
      return true;
    }
    toast.error("Ошибка");
    return false;
  }

  function inverseOp(op: EditOp): EditOp {
    if (op.editType === "assign")
      return { ...op, editType: "remove", oldValue: op.newValue, newValue: null };
    if (op.editType === "remove")
      return { ...op, editType: "assign", oldValue: null, newValue: op.oldValue };
    // swap A→B  ↔  swap B→A
    return { ...op, oldValue: op.newValue, newValue: op.oldValue };
  }

  async function runFixedEdit(op: FixedEditOp): Promise<boolean> {
    if (!version) return false;
    const res = await fetch("/api/admin/fixed-slots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year: version.year,
        month: version.month,
        ...op,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setFixedSlots(data.fixedSlots ?? {});
      return true;
    }
    const d = await res.json().catch(() => null);
    toast.error(d?.error ?? "Ошибка фикса");
    return false;
  }

  function inverseHist(entry: HistEntry): HistEntry {
    if (entry.scope === "version") {
      return { scope: "version", op: inverseOp(entry.op) };
    }
    return { scope: "fixed", op: inverseFixedEdit(entry.op) };
  }

  async function applyHist(entry: HistEntry): Promise<boolean> {
    if (entry.scope === "version") return runEdit(entry.op);
    return runFixedEdit(entry.op);
  }

  async function doEdit(
    day: number,
    postId: string,
    editType: string,
    oldValue: string | null,
    newValue: string | null,
  ) {
    const op: EditOp = { day, postId, editType, oldValue, newValue };
    if (await runEdit(op)) {
      setHistStack((s) => [...s, { scope: "version", op }]);
      setHistFuture([]);
      toast.success("Изменено");
    }
  }

  async function doFixedEdit(op: FixedEditOp, msg = "Фикс обновлён") {
    if (await runFixedEdit(op)) {
      setHistStack((s) => [...s, { scope: "fixed", op }]);
      setHistFuture([]);
      toast.success(msg);
    }
  }

  async function toggleFix(
    day: number,
    postId: string,
    label: string,
    pin: boolean,
  ) {
    await doFixedEdit(
      pin
        ? {
            day,
            postId,
            editType: "assign",
            oldValue: null,
            newValue: label,
          }
        : {
            day,
            postId,
            editType: "remove",
            oldValue: label,
            newValue: null,
          },
      pin ? "Зафиксировано для генерации" : "Фикс снят",
    );
  }

  function stripSuffix(label: string): string {
    return label.replace(/\([сдн]\)$/, "");
  }

  function labelKind(label: string): ShiftKind | undefined {
    const m = label.match(/\(([сдн])\)$/);
    if (!m) return undefined;
    return m[1] === "с" ? "full" : m[1] === "д" ? "day" : "night";
  }

  // Сменить тип смены (д↔с↔н) у того же человека на суточном посту — без
  // удаления и повторного добавления.
  async function changeShiftType(
    day: number,
    postId: string,
    person: string,
    nextKind: ShiftKind,
  ) {
    const name = stripSuffix(person);
    const newLabel = formatScheduleLabel(name, 24, nextKind);
    if (newLabel === person) return;
    await doEdit(day, postId, "swap", person, newLabel);
  }

  // Быстрый обмен двух занятых ячеек: меняем людей местами, сохраняя тип смены
  // каждой ячейки. Пишется двумя правками (часы пересчитываются на сервере).
  async function performSwap(
    a: { day: number; postId: string; label: string },
    b: { day: number; postId: string; label: string },
  ) {
    const pa = posts.find((p) => p.id === a.postId);
    const pb = posts.find((p) => p.id === b.postId);
    if (!pa || !pb) return;
    const nameA = stripSuffix(a.label);
    const nameB = stripSuffix(b.label);
    if (nameA === nameB) {
      toast.error("Это один и тот же человек");
      return;
    }
    const empA = employees.find((e) => e.name === nameA);
    const empB = employees.find((e) => e.name === nameB);
    if (empA && !empA.allowedPosts.includes(b.postId)) {
      toast.error(`${nameA} не допущен на ${pb.name}`);
      return;
    }
    if (empB && !empB.allowedPosts.includes(a.postId)) {
      toast.error(`${nameB} не допущен на ${pa.name}`);
      return;
    }
    const newA = formatScheduleLabel(nameB, pa.shiftHours, labelKind(a.label));
    const newB = formatScheduleLabel(nameA, pb.shiftHours, labelKind(b.label));
    if (await runEdit({ day: a.day, postId: a.postId, editType: "swap", oldValue: a.label, newValue: newA })) {
      setHistStack((s) => [...s, { scope: "version", op: { day: a.day, postId: a.postId, editType: "swap", oldValue: a.label, newValue: newA } }]);
    }
    if (await runEdit({ day: b.day, postId: b.postId, editType: "swap", oldValue: b.label, newValue: newB })) {
      setHistStack((s) => [...s, { scope: "version", op: { day: b.day, postId: b.postId, editType: "swap", oldValue: b.label, newValue: newB } }]);
    }
    setHistFuture([]);
    toast.success("Поменяли местами");
  }

  function onSwapClick(day: number, postId: string, label: string) {
    if (!swapSource) {
      setSwapSource({ day, postId, label });
      return;
    }
    if (
      swapSource.day === day &&
      swapSource.postId === postId &&
      swapSource.label === label
    ) {
      setSwapSource(null);
      return;
    }
    const src = swapSource;
    setSwapSource(null);
    performSwap(src, { day, postId, label });
  }

  // Зафиксировать/снять фикс на ВСЕ смены человека в текущем черновике.
  async function fixAllForPerson(name: string, pin: boolean) {
    const ops: { day: number; postId: string; label: string }[] = [];
    for (const [dayStr, byPost] of Object.entries(schedule)) {
      for (const [postId, people] of Object.entries(byPost)) {
        for (const label of people) {
          if (stripSuffix(label) !== name) continue;
          const isFixed = (fixedSlots[dayStr]?.[postId] ?? []).includes(label);
          if (pin && !isFixed) ops.push({ day: Number(dayStr), postId, label });
          if (!pin && isFixed) ops.push({ day: Number(dayStr), postId, label });
        }
      }
    }
    if (ops.length === 0) {
      toast.info(pin ? "Нечего фиксировать" : "Нет фиксов этого человека");
      return;
    }
    let ok = 0;
    for (const op of ops) {
      const done = await runFixedEdit({
        day: op.day,
        postId: op.postId,
        editType: pin ? "assign" : "remove",
        oldValue: pin ? null : op.label,
        newValue: pin ? op.label : null,
      });
      if (done) ok += 1;
    }
    toast.success(
      pin
        ? `Зафиксировано смен: ${ok}`
        : `Снято фиксов: ${ok}`,
    );
  }

  // Быстрое добавление выбранной фамилии в ячейку (без тоста на каждый клик —
  // чтобы «расхерачить» одного человека по многим ячейкам было комфортно).
  async function quickAssign(day: number, postId: string, shiftHours: number) {
    if (!quickAddName) return;
    const label = formatScheduleLabel(
      quickAddName,
      shiftHours,
      shiftHours === 24 ? quickAddKind : undefined,
    );
    const op: EditOp = {
      day,
      postId,
      editType: "assign",
      oldValue: null,
      newValue: label,
    };
    if (await runEdit(op)) {
      setHistStack((s) => [...s, { scope: "version", op }]);
      setHistFuture([]);
    }
  }

  async function quickRemove(day: number, postId: string, label: string) {
    const op: EditOp = {
      day,
      postId,
      editType: "remove",
      oldValue: label,
      newValue: null,
    };
    if (await runEdit(op)) {
      setHistStack((s) => [...s, { scope: "version", op }]);
      setHistFuture([]);
    }
  }

  function enableQuickAdd(name: string) {
    setQuickAddName(name);
    setQuickPickerOpen(false);
    // Режимы взаимоисключающие, чтобы клики по ячейкам не конфликтовали.
    setSwapMode(false);
    setSwapSource(null);
    setHighlightName("");
    setFixMode(false);
  }

  // Быстрая фиксация: клик по ячейке закрепляет всех её людей для генерации;
  // если все уже зафиксированы — снимает фиксы. Удобно «прибить» сразу много
  // ячеек.
  async function quickToggleFixCell(
    day: number,
    postId: string,
    people: string[],
  ) {
    if (people.length === 0) return;
    const fixedNow = fixedSlots[String(day)]?.[postId] ?? [];
    const allFixed = people.every((l) => fixedNow.includes(l));
    const pin = !allFixed;
    let ok = 0;
    for (const label of people) {
      const isFixed = fixedNow.includes(label);
      if (pin && isFixed) continue;
      if (!pin && !isFixed) continue;
      const op: FixedEditOp = {
        day,
        postId,
        editType: pin ? "assign" : "remove",
        oldValue: pin ? null : label,
        newValue: pin ? label : null,
      };
      if (await runFixedEdit(op)) {
        ok += 1;
        setHistStack((s) => [...s, { scope: "fixed", op }]);
      }
    }
    if (ok > 0) {
      setHistFuture([]);
      toast.success(pin ? `Закреплено: ${ok}` : `Снято: ${ok}`);
    }
  }

  async function undoEdit() {
    if (histStack.length === 0) return;
    const entry = histStack[histStack.length - 1];
    setHistStack((s) => s.slice(0, -1));
    if (await applyHist(inverseHist(entry))) {
      setHistFuture((f) => [...f, entry]);
      toast.success("Отменено");
    } else {
      setHistStack((s) => [...s, entry]);
    }
  }

  async function redoEdit() {
    if (histFuture.length === 0) return;
    const entry = histFuture[histFuture.length - 1];
    setHistFuture((f) => f.slice(0, -1));
    if (await applyHist(entry)) {
      setHistStack((s) => [...s, entry]);
      toast.success("Возвращено");
    } else {
      setHistFuture((f) => [...f, entry]);
    }
  }

  const undoRef = useRef(undoEdit);
  const redoRef = useRef(redoEdit);
  useEffect(() => {
    undoRef.current = undoEdit;
    redoRef.current = redoEdit;
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      e.preventDefault();
      if (e.shiftKey) redoRef.current();
      else undoRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!versionId) {
    return (
      <div className="p-4 text-muted-foreground">
        Выберите версию в разделе{" "}
        <a href="/admin/versions" className="underline">Версии</a>.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!version) {
    return <div className="p-4 text-muted-foreground">Версия не найдена</div>;
  }

  const numDays = new Date(version.year, version.month, 0).getDate();
  const normHours = version.normHours ?? 0;
  const employeeByName = new Map(employees.map((e) => [e.name, e]));

  const violationReasonByKey = new Map<string, string>();
  compliance?.rows.forEach((r) =>
    r.violations.forEach((v) =>
      violationReasonByKey.set(`${v.day}:${v.postId}:${v.label}`, v.reason),
    ),
  );
  const fixedKeys = compliance?.fixedKeys ?? new Set<string>();
  const highlightMode = highlightName !== "";

  function cellHole(day: number, postId: string): number {
    const target = cellTargets[`${day}:${postId}`];
    if (target == null) return 0;
    const current = (schedule[String(day)]?.[postId] ?? []).length;
    return Math.max(0, target - current);
  }

  const remainingHoles = Object.entries(cellTargets).reduce(
    (acc, [key, target]) => {
      const [day, postId] = key.split(":");
      const current = (schedule[day]?.[postId] ?? []).length;
      return acc + Math.max(0, target - current);
    },
    0,
  );

  const effectiveHours =
    Object.keys(computedHours).length > 0 ? computedHours : employeeHours;

  function getStat(name: string, extraHours = 0): HourStat {
    const emp = employeeByName.get(name);
    const hours = (effectiveHours[name] ?? 0) + extraHours;
    return computeHourStat(emp, hours, normHours);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">
            Редактор — v{version.versionNumber}
            {version.name && ` (${version.name})`}
          </h1>
          <p className="text-sm text-muted-foreground">
            Нажмите на ячейку для редактирования
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <div className="flex items-center gap-1">
            <select
              value={highlightName}
              onChange={(e) => setHighlightName(e.target.value)}
              className={`h-8 rounded-md border bg-background px-2 text-sm ${highlightName ? "border-yellow-500 ring-1 ring-yellow-400" : "border-input"}`}
              title="Выделить сотрудника: компактный вид, горит только выбранный"
            >
              <option value="">Выделить сотрудника…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.name}>
                  {e.name}
                </option>
              ))}
            </select>
            {highlightName && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => fixAllForPerson(highlightName, true)}
                  title="Зафиксировать все смены выбранного сотрудника"
                >
                  🔒 Все смены
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => fixAllForPerson(highlightName, false)}
                  title="Снять все фиксы выбранного сотрудника"
                >
                  🔓 Снять
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => setHighlightName("")}
                  title="Выключить выделение"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
          <Button
            variant={swapMode ? "default" : "outline"}
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => {
              setSwapMode((v) => !v);
              setSwapSource(null);
              setQuickAddName("");
              setFixMode(false);
            }}
            title="Обмен двух людей местами: включите режим и кликните две ячейки"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 mr-1" />
            {swapMode
              ? swapSource
                ? "Выберите вторую…"
                : "Обмен: вкл"
              : "Обмен"}
          </Button>
          <Button
            variant={fixMode ? "default" : "outline"}
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => {
              setFixMode((v) => !v);
              setQuickAddName("");
              setSwapMode(false);
              setSwapSource(null);
              setHighlightName("");
            }}
            title="Быстрая фиксация: кликайте по ячейкам, чтобы закрепить/снять их для генерации"
          >
            🔒 {fixMode ? "Фиксация: вкл" : "Фиксация"}
          </Button>
          <Popover open={quickPickerOpen} onOpenChange={setQuickPickerOpen}>
            <PopoverTrigger
              className={`inline-flex items-center h-8 px-2 text-xs rounded-md border transition-colors ${
                quickAddName
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-input hover:bg-muted"
              }`}
              title="Быстрое добавление: выберите фамилию и кликайте по ячейкам"
            >
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              Быстрое добавление
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <Command>
                <CommandInput placeholder="Фамилия…" />
                <CommandList>
                  <CommandEmpty>Не найдено</CommandEmpty>
                  {employees.map((e) => (
                    <CommandItem
                      key={e.id}
                      value={e.name}
                      onSelect={() => enableQuickAdd(e.name)}
                    >
                      {e.name}
                    </CommandItem>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={undoEdit}
              disabled={histStack.length === 0}
              title="Отменить (⌘Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={redoEdit}
              disabled={histFuture.length === 0}
              title="Вернуть (⌘⇧Z)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
          <Badge variant={version.status === "published" ? "default" : "outline"}>
            {version.status === "published" ? "Опубликован" : version.status === "archived" ? "Архив" : "Черновик"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowLog(!showLog)}
          >
            <History className="h-3.5 w-3.5 mr-1" />
            Журнал
          </Button>
        </div>
      </div>

      {relaxed && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <div>
            {remainingHoles > 0 ? (
              <>
                Черновик с пропусками: осталось дозакрыть{" "}
                <strong>{remainingHoles}</strong> поз. Ячейки-«дыры» подсвечены
                янтарной рамкой — добавьте людей через «+».
              </>
            ) : (
              <>Все пропуски закрыты вручную. Можно публиковать.</>
            )}
          </div>
        </div>
      )}

      {emergencyOvertimeTotal > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-orange-300 bg-orange-50 dark:bg-orange-950/20 px-3 py-2 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-orange-600" />
          <div className="space-y-1">
            <div>
              На момент генерации месяц не закрывался в пределах желаемых
              потолков — потребовалась аварийная переработка{" "}
              <strong>{emergencyOvertimeTotal}ч</strong> сверх maxRate
              (распределена тем, у кого выше потолок и меньше стаж). Люди с
              превышением подсвечены красным значком «+Nч сверх».
            </div>
            {overtime.filter((o) => o.overCeiling > 0).length > 0 && (
              <div className="text-xs text-muted-foreground">
                Сверх потолка:{" "}
                {overtime
                  .filter((o) => o.overCeiling > 0)
                  .map((o) => `${o.name} +${o.overCeiling}ч`)
                  .join(", ")}
              </div>
            )}
          </div>
        </div>
      )}

      {quickAddName && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-md border border-violet-400 bg-violet-50 dark:bg-violet-950/30 px-3 py-2 text-sm">
          <UserPlus className="h-4 w-4 shrink-0 text-violet-600" />
          <span>
            Быстрое добавление:{" "}
            <strong className="text-violet-700 dark:text-violet-300">
              {quickAddName}
            </strong>
            . Кликайте по ячейкам, чтобы поставить (повторный клик по этой
            фамилии — убрать).
          </span>
          {posts.some((p) => p.shiftHours === 24) && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Сутки:</span>
              {KIND_LABELS.map(({ key, label }) => (
                <Button
                  key={key}
                  size="sm"
                  variant={quickAddKind === key ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setQuickAddKind(key)}
                >
                  {label}
                </Button>
              ))}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 ml-auto"
            onClick={() => setQuickAddName("")}
            title="Выключить быстрое добавление"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Выйти
          </Button>
        </div>
      )}

      {fixMode && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-md border border-sky-400 bg-sky-50 dark:bg-sky-950/30 px-3 py-2 text-sm">
          <span className="text-base leading-none">🔒</span>
          <span>
            Быстрая фиксация: кликайте по ячейкам, чтобы закрепить всех людей
            ячейки для генерации (повторный клик по закреплённой ячейке —
            снять).
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 ml-auto"
            onClick={() => setFixMode(false)}
            title="Выключить быструю фиксацию"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Выйти
          </Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-[800px]">
          <thead>
            <tr>
              <th className="border px-2 py-1.5 bg-muted sticky left-0 z-10 w-16">
                Дата
              </th>
              <th className="border px-2 py-1.5 bg-muted sticky left-[4rem] z-10 w-8">
                ДН
              </th>
              {posts.map((p) => (
                <th key={p.id} className="border px-2 py-1.5 bg-muted whitespace-nowrap">
                  <div>{p.name}</div>
                  <div className="font-normal text-muted-foreground">
                    {p.shiftHours}ч x{p.staffRequired}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: numDays }, (_, i) => i + 1).map((d) => {
              const date = new Date(version.year, version.month - 1, d);
              const dow = DAY_NAMES[(date.getDay() + 6) % 7];
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              const dayData = schedule[String(d)] || {};

              return (
                <tr key={d} className={weekend ? "bg-red-50 dark:bg-red-950/20" : ""}>
                  <td className="border px-2 py-1 font-medium sticky left-0 bg-inherit z-[5]">
                    {String(d).padStart(2, "0")}.{String(version.month).padStart(2, "0")}
                  </td>
                  <td className="border px-2 py-1 sticky left-[4rem] bg-inherit z-[5]">
                    {dow}
                  </td>
                  {posts.map((p) => {
                    const people = dayData[p.id] || [];
                    const eligible = employees.filter((e) =>
                      e.allowedPosts.includes(p.id)
                    );
                    const assignedNames = new Set(
                      people.map((person: string) => person.replace(/\([сдн]\)$/, ""))
                    );
                    const available = eligible.filter(
                      (e) => !assignedNames.has(e.name)
                    );
                    const hole = cellHole(d, p.id);

                    return (
                      <td
                        key={p.id}
                        className={`border ${highlightMode ? "px-0.5 py-px" : "px-1 py-0.5"} ${
                          hole > 0
                            ? "outline outline-2 -outline-offset-2 outline-amber-400 bg-amber-50/60 dark:bg-amber-950/30"
                            : ""
                        }`}
                      >
                        <div className={`flex flex-wrap items-center ${highlightMode ? "gap-px min-h-[1rem]" : "gap-0.5 min-h-[1.5rem]"}`}>
                          {hole > 0 && (
                            <span
                              className="inline-flex items-center rounded bg-amber-500 text-white px-1 py-px text-[10px] font-semibold leading-none"
                              title={`Не закрыто позиций: ${hole}`}
                            >
                              −{hole}
                            </span>
                          )}
                          {fixMode ? (
                            people.length === 0 ? (
                              <span className="text-muted-foreground text-[10px]">
                                —
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  quickToggleFixCell(d, p.id, people)
                                }
                                className="inline-flex flex-wrap items-center gap-0.5 rounded border border-dashed border-sky-400 px-1 py-0.5 hover:bg-sky-500/10 transition-colors"
                                title="Кликните, чтобы закрепить/снять всю ячейку"
                              >
                                {people.map(
                                  (person: string, idx: number) => {
                                    const isFixed =
                                      fixedKeys.has(
                                        `${d}:${p.id}:${person}`,
                                      ) && !versionIgnoredFixed;
                                    return (
                                      <span
                                        key={idx}
                                        className={`inline-flex items-center gap-0.5 rounded border px-1 py-px text-[11px] ${
                                          isFixed ? FIXED_CLASS : "opacity-70"
                                        }`}
                                      >
                                        {isFixed && "🔒"}
                                        {person}
                                      </span>
                                    );
                                  },
                                )}
                              </button>
                            )
                          ) : quickAddName ? (
                            <>
                              {people.map((person: string, idx: number) => {
                                const bn = stripSuffix(person);
                                const isTarget = bn === quickAddName;
                                const st = getStat(bn);
                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    disabled={!isTarget}
                                    onClick={
                                      isTarget
                                        ? () => quickRemove(d, p.id, person)
                                        : undefined
                                    }
                                    className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-xs ${
                                      isTarget
                                        ? "ring-2 ring-violet-500 bg-violet-500/20 cursor-pointer"
                                        : `opacity-50 ${LEVEL_CLASSES[st.level]}`
                                    }`}
                                    title={isTarget ? "Убрать" : person}
                                  >
                                    {person}
                                  </button>
                                );
                              })}
                              {eligible.some((e) => e.name === quickAddName) &&
                                !assignedNames.has(quickAddName) && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      quickAssign(d, p.id, p.shiftHours)
                                    }
                                    className="inline-flex items-center gap-0.5 rounded border border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-300 px-1.5 py-0.5 text-xs hover:bg-violet-500/20 transition-colors"
                                    title={`Добавить ${quickAddName}${
                                      p.shiftHours === 24
                                        ? ` (${KIND_SHORT[quickAddKind]})`
                                        : ""
                                    }`}
                                  >
                                    <Plus className="h-3 w-3" />
                                    {p.shiftHours === 24
                                      ? KIND_SHORT[quickAddKind]
                                      : ""}
                                  </button>
                                )}
                            </>
                          ) : (
                            <>
                          {people.map((person: string, idx: number) => {
                            const baseName = person.replace(/\([сдн]\)$/, "");
                            const personStat = getStat(baseName);
                            const isFixed = fixedKeys.has(
                              `${d}:${p.id}:${person}`,
                            );
                            // Если версия генерилась с игнором фиксов — совпадение
                            // с фикс-слотом случайное (солвер их не применял),
                            // поэтому «как фикс» не подсвечиваем.
                            const fixedActive = isFixed && !versionIgnoredFixed;
                            // Фикс перекрывает запреты — нарушение к нему не применяем.
                            const violation = fixedActive
                              ? undefined
                              : violationReasonByKey.get(`${d}:${p.id}:${person}`);
                            const isHi = highlightMode && baseName === highlightName;
                            // В режиме выделения цвета часов/нарушений приглушаем,
                            // ярко горит только выбранный сотрудник.
                            const cellClass = highlightMode
                              ? isHi
                                ? HIGHLIGHT_ON_CLASS
                                : HIGHLIGHT_OFF_CLASS
                              : violation
                                ? VIOLATION_CLASS
                                : fixedActive
                                  ? FIXED_CLASS
                                  : LEVEL_CLASSES[personStat.level];
                            const swapSelected =
                              swapSource != null &&
                              swapSource.day === d &&
                              swapSource.postId === p.id &&
                              swapSource.label === person;
                            if (swapMode) {
                              return (
                                <button
                                  key={idx}
                                  type="button"
                                  onClick={() => onSwapClick(d, p.id, person)}
                                  className={`inline-flex items-center gap-0.5 rounded border transition-opacity hover:opacity-80 px-1.5 py-0.5 text-xs ${
                                    swapSelected
                                      ? "ring-2 ring-violet-500 bg-violet-500/20"
                                      : cellClass
                                  }`}
                                  title="Обмен: кликните вторую ячейку"
                                >
                                  {person}
                                  <span className="opacity-70 text-[10px]">
                                    · {Math.round(personStat.hours)}ч
                                  </span>
                                </button>
                              );
                            }
                            return (
                              <Popover key={idx}>
                                <PopoverTrigger
                                  className={`inline-flex items-center gap-0.5 rounded border transition-opacity hover:opacity-80 ${highlightMode ? "px-1 py-px text-[10px] leading-tight" : "px-1.5 py-0.5 text-xs"} ${cellClass}`}
                                  title={
                                    violation
                                      ? `⚠ Жёсткое ограничение: ${violation}`
                                      : fixedActive
                                        ? `🔒 Зафиксировано админом (перекрывает запреты) · ${Math.round(personStat.hours)}ч`
                                        : `Всего: ${Math.round(personStat.hours)}ч · По ставке: ${Math.round(personStat.target)}ч · Потолок: ${Math.round(personStat.cap)}ч`
                                  }
                                >
                                  {!highlightMode && violation && (
                                    <span className="mr-0.5">⚠</span>
                                  )}
                                  {!highlightMode && !violation && fixedActive && (
                                    <span className="mr-0.5">🔒</span>
                                  )}
                                  {person}
                                  {!highlightMode && (
                                    <span className="opacity-70 text-[10px]">
                                      · {Math.round(personStat.hours)}ч
                                    </span>
                                  )}
                                </PopoverTrigger>
                                <PopoverContent
                                  className="w-72 p-2 max-h-[60vh] overflow-y-auto overscroll-contain"
                                  align="start"
                                >
                                  <div className="space-y-1">
                                    <div className="text-xs font-medium mb-1">
                                      {person} — {p.name}, день {d}
                                    </div>
                                    {violation && (
                                      <div className="mb-2 rounded bg-red-600/15 border border-red-600/50 px-2 py-1 text-[11px] text-red-700 dark:text-red-300">
                                        ⚠ Жёсткое ограничение: {violation}
                                      </div>
                                    )}
                                    {!violation && fixedActive && (
                                      <div className="mb-2 rounded bg-sky-600/15 border border-sky-600/50 px-2 py-1 text-[11px] text-sky-700 dark:text-sky-300">
                                        🔒 Зафиксировано админом — солвер обязан
                                        сохранить эту ячейку, поэтому она
                                        перекрывает любые запреты (медотвод,
                                        «не ставить», недоступный день).
                                      </div>
                                    )}
                                    {isFixed && versionIgnoredFixed && (
                                      <div className="mb-2 rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                                        Эта версия генерировалась без учёта
                                        фиксов — совпадение с фикс-слотом выбрал
                                        сам солвер. Фикс сработает при следующей
                                        генерации.
                                      </div>
                                    )}
                                    <div className="flex items-center gap-1 mb-2">
                                      <HourBadge stat={personStat} />
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="w-full justify-start text-xs h-7"
                                      onClick={() =>
                                        doEdit(d, p.id, "remove", person, null)
                                      }
                                    >
                                      <X className="h-3 w-3 mr-1" />
                                      Убрать из черновика
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="w-full justify-start text-xs h-7"
                                      onClick={() =>
                                        toggleFix(d, p.id, person, !isFixed)
                                      }
                                    >
                                      {isFixed ? "🔓 Снять фикс" : "🔒 Зафиксировать для генерации"}
                                    </Button>
                                    {p.shiftHours === 24 && (
                                      <>
                                        <p className="text-[10px] text-muted-foreground pt-1">
                                          Сменить тип смены:
                                        </p>
                                        {KIND_LABELS.filter(
                                          ({ key }) => key !== labelKind(person),
                                        ).map(({ key, label }) => (
                                          <Button
                                            key={key}
                                            variant="ghost"
                                            size="sm"
                                            className="w-full justify-start text-xs h-7"
                                            onClick={() =>
                                              changeShiftType(d, p.id, person, key)
                                            }
                                          >
                                            <ArrowLeftRight className="h-3 w-3 mr-1" />
                                            {label}
                                          </Button>
                                        ))}
                                      </>
                                    )}
                                    {available.length > 0 && (
                                      <>
                                        <p className="text-[10px] text-muted-foreground pt-1">
                                          Заменить на:
                                        </p>
                                        {available.map((e) => {
                                          const replStat = getStat(
                                            e.name,
                                            p.shiftHours,
                                          );
                                          if (p.shiftHours === 24) {
                                            return (
                                              <div key={e.id} className="space-y-0.5">
                                                <p className="text-[10px] font-medium pt-1">
                                                  {e.name}
                                                </p>
                                                {KIND_LABELS.map(({ key, label }) => (
                                                  <Button
                                                    key={key}
                                                    variant="ghost"
                                                    size="sm"
                                                    className="w-full justify-between text-xs h-auto py-1"
                                                    onClick={() =>
                                                      doEdit(
                                                        d,
                                                        p.id,
                                                        "swap",
                                                        person,
                                                        formatScheduleLabel(
                                                          e.name,
                                                          p.shiftHours,
                                                          key,
                                                        ),
                                                      )
                                                    }
                                                  >
                                                    <span className="flex items-center gap-1 min-w-0">
                                                      <ArrowLeftRight className="h-3 w-3 shrink-0" />
                                                      <span className="truncate">{label}</span>
                                                    </span>
                                                    <HourBadge stat={replStat} />
                                                  </Button>
                                                ))}
                                              </div>
                                            );
                                          }
                                          return (
                                            <Button
                                              key={e.id}
                                              variant="ghost"
                                              size="sm"
                                              className="w-full justify-between text-xs h-auto py-1"
                                              onClick={() =>
                                                doEdit(d, p.id, "swap", person, e.name)
                                              }
                                            >
                                              <span className="flex items-center gap-1 min-w-0">
                                                <ArrowLeftRight className="h-3 w-3 shrink-0" />
                                                <span className="truncate">{e.name}</span>
                                              </span>
                                              <HourBadge stat={replStat} />
                                            </Button>
                                          );
                                        })}
                                      </>
                                    )}
                                  </div>
                                </PopoverContent>
                              </Popover>
                            );
                          })}

                          {available.length > 0 && (
                            <Popover>
                              <PopoverTrigger className="inline-flex items-center justify-center rounded border border-dashed w-5 h-5 text-muted-foreground hover:bg-muted transition-colors">
                                <Plus className="h-3 w-3" />
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-72 p-2 max-h-[60vh] overflow-y-auto overscroll-contain"
                                align="start"
                              >
                                <p className="text-xs font-medium mb-2">
                                  Добавить на {p.name}, день {d}
                                </p>
                                <div className="space-y-0.5">
                                  {available.map((e) => {
                                    const addStat = getStat(e.name, p.shiftHours);
                                    if (p.shiftHours === 24) {
                                      return (
                                        <div key={e.id} className="mb-2">
                                          <p className="text-[10px] font-medium">{e.name}</p>
                                          {KIND_LABELS.map(({ key, label }) => (
                                            <Button
                                              key={key}
                                              variant="ghost"
                                              size="sm"
                                              className="w-full justify-between text-xs h-auto py-1"
                                              onClick={() =>
                                                doEdit(
                                                  d,
                                                  p.id,
                                                  "assign",
                                                  null,
                                                  formatScheduleLabel(
                                                    e.name,
                                                    p.shiftHours,
                                                    key,
                                                  ),
                                                )
                                              }
                                            >
                                              <span className="flex items-center gap-1 min-w-0">
                                                <Plus className="h-3 w-3 shrink-0" />
                                                <span className="truncate">{label}</span>
                                              </span>
                                              <HourBadge stat={addStat} />
                                            </Button>
                                          ))}
                                        </div>
                                      );
                                    }
                                    return (
                                      <Button
                                        key={e.id}
                                        variant="ghost"
                                        size="sm"
                                        className="w-full justify-between text-xs h-auto py-1"
                                        onClick={() =>
                                          doEdit(d, p.id, "assign", null, e.name)
                                        }
                                      >
                                        <span className="flex items-center gap-1 min-w-0">
                                          <Plus className="h-3 w-3 shrink-0" />
                                          <span className="truncate">{e.name}</span>
                                        </span>
                                        <HourBadge stat={addStat} />
                                      </Button>
                                    );
                                  })}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                            </>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showLog && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-base">
              Журнал изменений (последние 50)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {recentEdits.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет изменений</p>
            ) : (
              <div className="space-y-1 text-xs">
                {recentEdits.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 py-1 border-b last:border-0"
                  >
                    <span className="text-muted-foreground w-32 shrink-0">
                      {new Date(e.createdAt).toLocaleString("ru-RU")}
                    </span>
                    <span className="font-medium">{e.userName}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {e.editType}
                    </Badge>
                    <span>
                      день {e.day}, {e.postId}
                    </span>
                    {e.oldValue && (
                      <span className="text-red-500 line-through">
                        {e.oldValue}
                      </span>
                    )}
                    {e.newValue && (
                      <span className="text-green-600">
                        {e.newValue}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {compliance && (
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-base">
              Сводка по версии
            </CardTitle>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
              <span>
                Часов всего:{" "}
                <strong className="text-foreground">
                  {Math.round(compliance.totalHours)}
                </strong>{" "}
                из{" "}
                <strong className="text-foreground">
                  {Math.round(compliance.totalTargetHours)}
                </strong>{" "}
                целевых
                {compliance.totalPct != null && (
                  <> ({Math.round(compliance.totalPct)}%)</>
                )}
              </span>
              <span>
                Принуждений к исключению:{" "}
                <strong
                  className={
                    compliance.violationCount > 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {compliance.violationCount}
                </strong>
              </span>
              <span>Сотрудников: {compliance.rows.length}</span>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 overflow-x-auto">
            <table className="w-full text-xs border-collapse min-w-[680px]">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Сотрудник</th>
                  <th className="py-1 px-2 font-medium text-right">Ставка</th>
                  <th className="py-1 px-2 font-medium text-right">Часы</th>
                  <th className="py-1 px-2 font-medium text-right">Цель</th>
                  <th className="py-1 px-2 font-medium text-right">%</th>
                  <th className="py-1 px-2 font-medium text-right">Смен</th>
                  <th className="py-1 px-2 font-medium text-right">с/д/н</th>
                  <th className="py-1 pl-2 font-medium">Нарушения</th>
                </tr>
              </thead>
              <tbody>
                {compliance.rows.map((r) => {
                  const pct = r.pct ?? 0;
                  const pctClass =
                    r.pct == null
                      ? "text-muted-foreground"
                      : pct < 90
                        ? "text-amber-600 dark:text-amber-400"
                        : pct > 120
                          ? "text-red-600 dark:text-red-400"
                          : "text-emerald-600 dark:text-emerald-400";
                  const limitNotes: string[] = [];
                  if (r.fullOverLimit > 0)
                    limitNotes.push(`сутки +${r.fullOverLimit} сверх лимита`);
                  if (r.nightOverLimit > 0)
                    limitNotes.push(`ночи +${r.nightOverLimit} сверх лимита`);
                  const hasIssue = r.violations.length > 0 || limitNotes.length > 0;
                  return (
                    <tr
                      key={r.name}
                      className={`border-t ${hasIssue ? "bg-red-500/5" : ""}`}
                    >
                      <td className="py-1 pr-2 font-medium">{r.name}</td>
                      <td className="py-1 px-2 text-right tabular-nums">
                        {r.targetRate}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums">
                        {Math.round(r.hours)}
                      </td>
                      <td
                        className="py-1 px-2 text-right tabular-nums text-muted-foreground"
                        title={
                          r.availFactor < 1
                            ? `Полная ставка: ${Math.round(r.nominalTargetHours)}ч · доступно ${r.availableDays ?? "?"} дн · цель снижена до ${Math.round(r.availFactor * 100)}%`
                            : `Полная ставка: ${Math.round(r.nominalTargetHours)}ч`
                        }
                      >
                        {Math.round(r.targetHours)}
                        {r.availFactor < 1 && (
                          <span className="ml-1 text-[10px] opacity-60">
                            ↓{r.availableDays ?? "?"}д
                          </span>
                        )}
                      </td>
                      <td
                        className={`py-1 px-2 text-right tabular-nums font-medium ${pctClass}`}
                      >
                        {r.pct == null ? "—" : `${Math.round(pct)}%`}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums">
                        {r.shifts}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">
                        {r.fullCount}/{r.dayCount}/{r.nightCount}
                      </td>
                      <td className="py-1 pl-2">
                        {hasIssue ? (
                          <div className="space-y-0.5">
                            {r.violations.map((v, i) => (
                              <div
                                key={i}
                                className="text-red-600 dark:text-red-400"
                              >
                                ⚠ д{v.day} {v.postName}: {v.reason}
                              </div>
                            ))}
                            {limitNotes.map((n, i) => (
                              <div
                                key={`l${i}`}
                                className="text-amber-600 dark:text-amber-400"
                              >
                                {n}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-emerald-600 dark:text-emerald-400">
                            ок
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
