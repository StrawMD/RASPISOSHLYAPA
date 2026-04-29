"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Search, RotateCcw, Plus, X } from "lucide-react";

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

interface EmployeeInfo {
  id: string;
  name: string;
  rate: number;
}

interface VacationRecord {
  id: string;
  days: number[];
  comment: string | null;
}

interface Props {
  employees: EmployeeInfo[];
  vacationMap: Record<string, VacationRecord>;
  year: number;
  month: number;
}

interface Interval {
  start: number;
  end: number;
}

function daysToIntervals(days: number[]): Interval[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort((a, b) => a - b);
  const result: Interval[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === prev + 1) {
      prev = sorted[i];
    } else {
      result.push({ start, end: prev });
      start = sorted[i];
      prev = sorted[i];
    }
  }
  result.push({ start, end: prev });
  return result;
}

function formatInterval(iv: Interval): string {
  return iv.start === iv.end ? `${iv.start}` : `${iv.start}–${iv.end}`;
}

type EmployeeState = Record<string, number[]>;

export function VacationManager({ employees, vacationMap, year, month }: Props) {
  const router = useRouter();

  const [state, setState] = useState<EmployeeState>(() => {
    const init: EmployeeState = {};
    for (const emp of employees) {
      init[emp.id] = vacationMap[emp.id]?.days ?? [];
    }
    return init;
  });
  const [activeIds, setActiveIds] = useState<string[]>(() =>
    employees
      .filter((e) => (vacationMap[e.id]?.days?.length ?? 0) > 0)
      .map((e) => e.id)
  );
  const [search, setSearch] = useState("");
  const [addValue, setAddValue] = useState<string>("");

  function setYearMonth(nextYear: number, nextMonth: number) {
    const sp = new URLSearchParams();
    sp.set("year", String(nextYear));
    sp.set("month", String(nextMonth));
    router.push(`/admin/vacations?${sp.toString()}`);
  }

  function goPrev() {
    if (month === 1) setYearMonth(year - 1, 12);
    else setYearMonth(year, month - 1);
  }

  function goNext() {
    if (month === 12) setYearMonth(year + 1, 1);
    else setYearMonth(year, month + 1);
  }

  const pendingSavesRef = useRef<Map<string, AbortController>>(new Map());

  const saveEmployee = useCallback(
    async (employeeId: string, days: number[]) => {
      const prev = pendingSavesRef.current.get(employeeId);
      if (prev) prev.abort();
      const ctrl = new AbortController();
      pendingSavesRef.current.set(employeeId, ctrl);

      try {
        const res = await fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId,
            year,
            month,
            unavailableDays: days,
            comment: vacationMap[employeeId]?.comment ?? null,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok && !ctrl.signal.aborted) {
          toast.error("Ошибка сохранения");
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          toast.error("Ошибка сохранения");
        }
      } finally {
        if (pendingSavesRef.current.get(employeeId) === ctrl) {
          pendingSavesRef.current.delete(employeeId);
        }
      }
    },
    [year, month, vacationMap]
  );

  const updateDays = useCallback(
    (employeeId: string, newDays: number[]) => {
      setState((prev) => ({ ...prev, [employeeId]: newDays }));
      saveEmployee(employeeId, newDays);
    },
    [saveEmployee]
  );

  const employeeById = useMemo(() => {
    const m = new Map<string, EmployeeInfo>();
    for (const e of employees) m.set(e.id, e);
    return m;
  }, [employees]);

  const activeEmployees = useMemo(
    () =>
      activeIds
        .map((id) => employeeById.get(id))
        .filter((e): e is EmployeeInfo => !!e),
    [activeIds, employeeById]
  );

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activeEmployees;
    return activeEmployees.filter((e) => e.name.toLowerCase().includes(q));
  }, [activeEmployees, search]);

  const availableToAdd = useMemo(() => {
    const activeSet = new Set(activeIds);
    return employees.filter((e) => !activeSet.has(e.id));
  }, [employees, activeIds]);

  const addEmployee = useCallback(
    (id: string | null | undefined) => {
      if (!id) return;
      setActiveIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setAddValue("");
    },
    []
  );

  const removeEmployee = useCallback(
    (id: string) => {
      setActiveIds((prev) => prev.filter((x) => x !== id));
      const currentDays = state[id] ?? [];
      if (currentDays.length > 0) {
        setState((prev) => ({ ...prev, [id]: [] }));
        saveEmployee(id, []);
      }
    },
    [state, saveEmployee]
  );

  const totalDays = useMemo(
    () => Object.values(state).reduce((s, d) => s + d.length, 0),
    [state]
  );
  const employeesWithVacation = useMemo(
    () => Object.values(state).filter((d) => d.length > 0).length,
    [state]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Отпуска</h1>
          <p className="text-sm text-muted-foreground">
            {employeesWithVacation} сотр. · всего {totalDays} дн.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="h-9 w-9 rounded-md border hover:bg-muted flex items-center justify-center"
            aria-label="Предыдущий месяц"
          >
            ←
          </button>
          <Select
            value={String(month)}
            onValueChange={(v) => v && setYearMonth(year, parseInt(v))}
          >
            <SelectTrigger className="w-32">
              <SelectValue>
                {(val) => MONTH_NAMES[parseInt(val as string) - 1] ?? val}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={i + 1} value={String(i + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(year)}
            onValueChange={(v) => v && setYearMonth(parseInt(v), month)}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[year - 1, year, year + 1].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button
            onClick={goNext}
            className="h-9 w-9 rounded-md border hover:bg-muted flex items-center justify-center"
            aria-label="Следующий месяц"
          >
            →
          </button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground leading-snug">
        Один клик — начало интервала, второй — конец. При наведении подсвечивается будущий интервал. Клик по уже отмеченному дню удаляет содержащий его интервал. Изменения сохраняются автоматически.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Поиск сотрудника..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <Select
          value={addValue}
          onValueChange={(v) => addEmployee(v)}
          disabled={availableToAdd.length === 0}
        >
          <SelectTrigger className="h-8 w-64 text-sm">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Plus className="h-3.5 w-3.5" />
              <SelectValue placeholder="Добавить сотрудника…" />
            </div>
          </SelectTrigger>
          <SelectContent>
            {availableToAdd.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {activeEmployees.length === 0 ? (
        <div className="border border-dashed rounded-lg py-10 text-center text-sm text-muted-foreground">
          Пока никого не добавлено. Выберите сотрудника в селекте выше,
          чтобы проставить ему отпуск.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {filteredEmployees.map((emp) => (
              <EmployeeVacationCard
                key={emp.id}
                employee={emp}
                year={year}
                month={month}
                days={state[emp.id] ?? []}
                onChange={(days) => updateDays(emp.id, days)}
                onRemove={() => removeEmployee(emp.id)}
              />
            ))}
          </div>
          {filteredEmployees.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              По поиску никого не найдено.
            </p>
          )}
        </>
      )}
    </div>
  );
}

interface EmployeeCardProps {
  employee: EmployeeInfo;
  year: number;
  month: number;
  days: number[];
  onChange: (days: number[]) => void;
  onRemove: () => void;
}

function EmployeeVacationCard({ employee, year, month, days, onChange, onRemove }: EmployeeCardProps) {
  const [firstClick, setFirstClick] = useState<number | null>(null);
  const [hoveredDay, setHoveredDay] = useState<number | null>(null);

  const numDays = new Date(year, month, 0).getDate();
  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);

  const selected = useMemo(() => new Set(days), [days]);
  const intervals = useMemo(() => daysToIntervals(days), [days]);

  const previewRange = useMemo(() => {
    if (firstClick === null || hoveredDay === null) return new Set<number>();
    const from = Math.min(firstClick, hoveredDay);
    const to = Math.max(firstClick, hoveredDay);
    const s = new Set<number>();
    for (let d = from; d <= to; d++) s.add(d);
    return s;
  }, [firstClick, hoveredDay]);

  function intervalContaining(day: number): Interval | null {
    for (const iv of intervals) {
      if (day >= iv.start && day <= iv.end) return iv;
    }
    return null;
  }

  function handleDayClick(day: number) {
    if (firstClick === null) {
      const iv = intervalContaining(day);
      if (iv) {
        const next: number[] = [];
        for (const d of days) {
          if (d < iv.start || d > iv.end) next.push(d);
        }
        onChange(next);
        return;
      }
      setFirstClick(day);
      setHoveredDay(day);
      return;
    }

    const from = Math.min(firstClick, day);
    const to = Math.max(firstClick, day);
    const next = new Set(days);
    for (let d = from; d <= to; d++) next.add(d);
    onChange(Array.from(next).sort((a, b) => a - b));
    setFirstClick(null);
    setHoveredDay(null);
  }

  function handleClear() {
    onChange([]);
    setFirstClick(null);
    setHoveredDay(null);
  }

  return (
    <Card>
      <CardHeader className="py-2 px-3 flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-sm truncate">
          {employee.name}
          <span className="text-xs text-muted-foreground font-normal ml-1.5">
            {employee.rate} ст.
          </span>
        </CardTitle>
        <div className="flex items-center gap-1 shrink-0">
          {days.length > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground">
                {days.length} дн.
              </span>
              <button
                onClick={handleClear}
                title="Очистить"
                className="h-5 w-5 rounded hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </>
          )}
          <button
            onClick={onRemove}
            title="Убрать карточку (очистит отпуск)"
            className="h-5 w-5 rounded hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </CardHeader>
      <CardContent
        className="px-3 pb-3 space-y-1.5"
        onMouseLeave={() => {
          if (firstClick !== null) setHoveredDay(firstClick);
        }}
      >
        <div className="grid grid-cols-7 gap-px text-center text-[10px] text-muted-foreground">
          {DAY_NAMES.map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {cells.map((day, i) => {
            if (day === null) return <div key={`e-${i}`} className="aspect-square" />;

            const isSelected = selected.has(day);
            const isPreviewing = previewRange.has(day);
            const isStart = day === firstClick;
            const date = new Date(year, month - 1, day);
            const weekend = date.getDay() === 0 || date.getDay() === 6;

            let bg = "bg-muted/20 hover:bg-muted/60";
            if (weekend && !isSelected && !isPreviewing)
              bg = "bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40";
            if (isPreviewing && !isSelected) bg = "bg-orange-300/60 dark:bg-orange-500/40";
            if (isSelected) bg = "bg-destructive/85 text-destructive-foreground";
            if (isStart) bg = "bg-orange-500 text-white";

            return (
              <button
                key={day}
                onClick={() => handleDayClick(day)}
                onMouseEnter={() => {
                  if (firstClick !== null) setHoveredDay(day);
                }}
                className={`aspect-square rounded text-[11px] font-medium transition-colors cursor-pointer ${bg}`}
              >
                {day}
              </button>
            );
          })}
        </div>

        {intervals.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {intervals.map((iv, i) => (
              <Badge key={i} variant="destructive" className="text-[10px] h-5">
                {formatInterval(iv)}
              </Badge>
            ))}
          </div>
        )}
        {firstClick !== null && (
          <p className="text-[10px] text-orange-600 dark:text-orange-400">
            Выберите конечную дату… (или кликните ту же ещё раз)
          </p>
        )}
      </CardContent>
    </Card>
  );
}
