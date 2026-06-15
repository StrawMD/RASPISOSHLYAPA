"use client";

import { useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  RATE_OPTIONS,
  maxRateCap,
  clampRates,
  isPartTime,
} from "@/lib/rates";
import {
  Plus,
  Trash2,
  Save,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { computeTenure, yearsWord } from "@/lib/seniority";

const MODALITIES = ["КТ", "МРТ"] as const;
const PREF_LEVELS = [
  { value: "prefer_strong", label: "Очень хочу", color: "text-green-500" },
  { value: "prefer", label: "Скорее хочу", color: "text-green-400" },
  { value: "neutral", label: "Нейтрально", color: "text-muted-foreground" },
  { value: "avoid", label: "Лучше не ставить", color: "text-amber-400" },
  { value: "avoid_hard", label: "Вообще не ставить", color: "text-red-500" },
] as const;

const CONSECUTIVE_OPTIONS = [
  { value: "avoid", label: "Не ставить смены подряд" },
  { value: "neutral", label: "Без разницы" },
  { value: "prefer_2", label: "Предпочитает 2 подряд" },
  { value: "prefer_3", label: "Предпочитает 3 подряд" },
  { value: "prefer_4", label: "Предпочитает 4 подряд" },
] as const;

const MEDICAL_OPTIONS = [
  { value: "none", label: "Без ограничений" },
  { value: "no_night", label: "Без ночных (н)" },
  { value: "no_24h", label: "Без суточных (с)" },
  { value: "day_only", label: "Только дневные" },
] as const;

const DOW_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

function prefLabel(v: string) {
  const pl = PREF_LEVELS.find((o) => o.value === v);
  return <span className={pl?.color ?? ""}>{pl?.label ?? v}</span>;
}

// Base UI отображает «сырое» value, если не передать функцию-ребёнка.
function consecLabel(v: string) {
  return CONSECUTIVE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}
function medicalLabel(v: string) {
  return MEDICAL_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

type Employee = {
  id: string;
  name: string;
  rate: number;
  targetRate: number;
  maxRate: number;
  seniority: number;
  hospitalStartYear: number | null;
  careerStartYear: number | null;
  allowedPosts: string[];
  modalities: string[];
  can24h: boolean;
  postPreferences: Record<string, string>;
  consecutivePref: string;
  medicalRestriction: string;
  medicalNote: string | null;
  recurringUnavailableDows: number[];
};

type Post = {
  id: string;
  name: string;
  shiftHours: number;
  modality: string;
};

export type PrefSummary = {
  employeeId: string;
  name: string;
  rate: number;
  targetRate: number;
  maxRate: number;
  modalities: string[];
  can24h: boolean;
  medicalRestriction: string;
  submitted: boolean;
  loadPref: string | null;
  shiftTimeMode: string | null;
  consec: string;
  preferCount: number;
  avoidCount: number;
  banCount: number;
  unavailableCount: number;
  softUnavailableCount: number;
  desiredCount: number;
  minShifts: number | null;
  maxFull: number | null;
  maxNights: number | null;
  avoidWithCount: number;
  preferWithCount: number;
};

interface Props {
  initialEmployees: Employee[];
  posts: Post[];
  prefSummaries: PrefSummary[];
  planningLabel: string;
  submittedCount: number;
}

const LOAD_LABELS: Record<string, string> = {
  less: "Меньше",
  normal: "Как обычно",
  more: "Больше",
};
const SHIFT_MODE_LABELS: Record<string, string> = {
  only_full: "Только сутки",
  prefer_full: "Сутки",
  neutral: "Нейтр.",
  prefer_day: "День",
  prefer_night: "Ночь",
};

export function EmployeeManager({
  initialEmployees,
  posts,
  prefSummaries,
  planningLabel,
  submittedCount,
}: Props) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [tab, setTab] = useState<"cards" | "overview">("cards");

  const filtered = employees.filter((e) =>
    e.name.toLowerCase().includes(filter.toLowerCase()),
  );

  function getPostsForModalities(mods: string[]): Post[] {
    if (mods.length === 0) return [];
    const modSet = new Set(mods);
    return posts.filter((p) => p.modality && modSet.has(p.modality));
  }

  function computeAllowedPosts(emp: Employee): string[] {
    return getPostsForModalities(emp.modalities).map((p) => p.id);
  }

  async function saveEmployee(emp: Employee) {
    const res = await fetch("/api/admin/employees", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...emp,
        allowedPosts: computeAllowedPosts(emp),
      }),
    });
    if (res.ok) {
      toast.success(`${emp.name} сохранён`);
      router.refresh();
    } else {
      toast.error("Ошибка сохранения");
    }
  }

  async function addEmployee() {
    const res = await fetch("/api/admin/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Новый сотрудник",
        rate: 1.0,
        targetRate: 1.0,
        maxRate: 1.5,
        seniority: 0,
        hospitalStartYear: null,
        careerStartYear: null,
        allowedPosts: [],
        modalities: [],
        can24h: false,
      }),
    });
    if (res.ok) {
      const newEmp = await res.json();
      setEmployees((prev) => [...prev, newEmp]);
      setExpandedId(newEmp.id);
      toast.success("Сотрудник добавлен");
    }
  }

  async function deleteEmployee(id: string) {
    const res = await fetch(`/api/admin/employees?id=${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setEmployees((prev) => prev.filter((e) => e.id !== id));
      toast.success("Сотрудник удалён");
    }
  }

  function updateLocal(id: string, updates: Partial<Employee>) {
    setEmployees((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    );
  }

  function toggleModality(empId: string, mod: string) {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return;
    const next = emp.modalities.includes(mod)
      ? emp.modalities.filter((m) => m !== mod)
      : [...emp.modalities, mod];
    const updates: Partial<Employee> = { modalities: next };
    if (mod === "КТ" && !next.includes("КТ")) {
      updates.can24h = false;
    }
    updateLocal(empId, updates);
  }

  function setPostPref(empId: string, postId: string, level: string) {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return;
    const next = { ...emp.postPreferences, [postId]: level };
    if (level === "neutral") delete next[postId];
    updateLocal(empId, { postPreferences: next });
  }

  function toggleRecurringDow(empId: string, dow: number) {
    const emp = employees.find((e) => e.id === empId);
    if (!emp) return;
    const has = emp.recurringUnavailableDows.includes(dow);
    const next = has
      ? emp.recurringUnavailableDows.filter((d) => d !== dow)
      : [...emp.recurringUnavailableDows, dow].sort((a, b) => a - b);
    updateLocal(empId, { recurringUnavailableDows: next });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">Сотрудники</h1>
        <div className="flex items-center gap-2">
          {tab === "cards" && (
            <Input
              placeholder="Поиск..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-48"
            />
          )}
          <Button onClick={addEmployee}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить
          </Button>
        </div>
      </div>

      <div className="inline-flex rounded-md border p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setTab("cards")}
          className={`px-3 py-1 rounded ${tab === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
        >
          Карточки
        </button>
        <button
          type="button"
          onClick={() => setTab("overview")}
          className={`px-3 py-1 rounded ${tab === "overview" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
        >
          Сводка пожеланий
        </button>
      </div>

      {tab === "overview" ? (
        <PreferencesOverview
          rows={prefSummaries}
          planningLabel={planningLabel}
          submittedCount={submittedCount}
        />
      ) : (
        <div className="space-y-2">
        {filtered.map((emp) => {
          const expanded = expandedId === emp.id;
          const visiblePosts = getPostsForModalities(emp.modalities);

          return (
            <Card key={emp.id}>
              <div
                className="flex items-center justify-between cursor-pointer px-3 py-2"
                onClick={() => setExpandedId(expanded ? null : emp.id)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium truncate">
                    {emp.name}
                  </span>
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {emp.rate}
                    {emp.targetRate && emp.targetRate !== emp.rate
                      ? ` → ${emp.targetRate}`
                      : ""}
                  </Badge>
                  {emp.modalities.map((m) => (
                    <Badge
                      key={m}
                      variant="default"
                      className="text-[10px] shrink-0"
                    >
                      {m}
                    </Badge>
                  ))}
                  {emp.can24h && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      24ч
                    </Badge>
                  )}
                  {emp.medicalRestriction !== "none" && (
                    <Badge
                      variant="destructive"
                      className="text-[10px] shrink-0"
                    >
                      {MEDICAL_OPTIONS.find(
                        (o) => o.value === emp.medicalRestriction,
                      )?.label ?? emp.medicalRestriction}
                    </Badge>
                  )}
                </div>
                {expanded ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
              </div>
              {expanded && (
                <CardContent className="space-y-4 pt-0">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1.5">
                      <Label>Имя</Label>
                      <Input
                        value={emp.name}
                        onChange={(e) =>
                          updateLocal(emp.id, { name: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Ставка</Label>
                      <Select
                        value={String(emp.rate)}
                        onValueChange={(v) => {
                          if (!v) return;
                          updateLocal(
                            emp.id,
                            clampRates(
                              parseFloat(v),
                              emp.targetRate,
                              emp.maxRate,
                            ),
                          );
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RATE_OPTIONS.map((r) => (
                            <SelectItem key={r} value={String(r)}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Целевая ставка</Label>
                      <Input
                        type="number"
                        step={isPartTime(emp.rate) ? 0.05 : 0.25}
                        min={emp.rate}
                        max={emp.maxRate}
                        value={emp.targetRate}
                        onChange={(e) => {
                          const raw = parseFloat(e.target.value);
                          if (Number.isNaN(raw)) return;
                          updateLocal(
                            emp.id,
                            clampRates(emp.rate, raw, emp.maxRate),
                          );
                        }}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Желаемая загрузка (в ставках) — между ставкой и макс.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Макс. ставки (потолок)</Label>
                      <Input
                        type="number"
                        step={isPartTime(emp.rate) ? 0.05 : 0.25}
                        min={emp.rate}
                        max={maxRateCap(emp.rate)}
                        value={emp.maxRate}
                        onChange={(e) => {
                          const raw = parseFloat(e.target.value);
                          if (Number.isNaN(raw)) return;
                          updateLocal(
                            emp.id,
                            clampRates(emp.rate, emp.targetRate, raw),
                          );
                        }}
                      />
                    </div>
                  </div>

                  <TenureFields
                    emp={emp}
                    onUpdate={(u) => updateLocal(emp.id, u)}
                  />

                  <div>
                    <Label className="mb-2 block">Модальности</Label>
                    <div className="flex gap-4 flex-wrap">
                      {MODALITIES.map((mod) => (
                        <label
                          key={mod}
                          className="flex items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={emp.modalities.includes(mod)}
                            onCheckedChange={() => toggleModality(emp.id, mod)}
                          />
                          {mod}
                        </label>
                      ))}
                      {emp.modalities.includes("КТ") && (
                        <label className="flex items-center gap-2 text-sm ml-4 border-l pl-4">
                          <Checkbox
                            checked={emp.can24h}
                            onCheckedChange={(c) =>
                              updateLocal(emp.id, { can24h: !!c })
                            }
                          />
                          Суточные КТ
                        </label>
                      )}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Мед/правовое ограничение</Label>
                      <Select
                        value={emp.medicalRestriction}
                        onValueChange={(v) =>
                          v &&
                          updateLocal(emp.id, { medicalRestriction: v })
                        }
                      >
                        <SelectTrigger>
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
                      <p className="text-[11px] text-muted-foreground">
                        Жёсткое ограничение: солвер никогда не нарушит.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Очерёдность смен (по умолчанию)</Label>
                      <Select
                        value={emp.consecutivePref}
                        onValueChange={(v) =>
                          v && updateLocal(emp.id, { consecutivePref: v })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue>{consecLabel}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {CONSECUTIVE_OPTIONS.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        Можно переопределить в предпочтениях на конкретный месяц.
                      </p>
                    </div>
                  </div>

                  {emp.medicalRestriction !== "none" && (
                    <div className="space-y-1.5">
                      <Label>Комментарий к ограничению (необязательно)</Label>
                      <Textarea
                        rows={2}
                        placeholder="напр. справка до 01.09, беременность и т.п."
                        value={emp.medicalNote ?? ""}
                        onChange={(e) =>
                          updateLocal(emp.id, {
                            medicalNote: e.target.value || null,
                          })
                        }
                      />
                    </div>
                  )}

                  <div>
                    <Label className="mb-2 block">
                      Регулярно недоступен по дням недели
                    </Label>
                    <div className="flex gap-1.5 flex-wrap">
                      {DOW_LABELS.map((lbl, idx) => {
                        const active =
                          emp.recurringUnavailableDows.includes(idx);
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => toggleRecurringDow(emp.id, idx)}
                            className={`h-8 w-10 rounded border text-xs transition-colors ${
                              active
                                ? "bg-red-500 text-white border-red-500"
                                : "bg-background hover:bg-muted"
                            }`}
                          >
                            {lbl}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Жёсткая недоступность каждую неделю (напр. учебный день).
                    </p>
                  </div>

                  {visiblePosts.length > 0 && (
                    <div>
                      <Label className="mb-2 block">
                        Предпочтения по аппаратам (постоянные)
                      </Label>
                      <p className="text-[11px] text-muted-foreground mb-2">
                        Это постоянный дефолт сотрудника. Солвер использует его
                        только если на конкретный месяц нет анкеты. Реальные
                        месячные пожелания смотрите во вкладке «Сводка
                        пожеланий».
                      </p>
                      <div className="space-y-1">
                        {visiblePosts.map((post) => {
                          const level =
                            emp.postPreferences[post.id] ?? "neutral";
                          return (
                            <div
                              key={post.id}
                              className="flex items-center gap-3 rounded border px-3 py-1.5 text-sm"
                            >
                              <span className="flex-1">{post.name}</span>
                              <Badge
                                variant="outline"
                                className="text-[10px] shrink-0"
                              >
                                {post.shiftHours}ч
                              </Badge>
                              <Select
                                value={level}
                                onValueChange={(v) =>
                                  v && setPostPref(emp.id, post.id, v)
                                }
                              >
                                <SelectTrigger className="w-36 h-7 text-xs">
                                  <SelectValue>{prefLabel}</SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {PREF_LEVELS.map((pl) => (
                                    <SelectItem key={pl.value} value={pl.value}>
                                      <span className={pl.color}>
                                        {pl.label}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="rounded border border-dashed p-3">
                    <p className="text-xs text-muted-foreground mb-2">
                      Реальные пожелания сотрудника (аппараты, недоступные/
                      желаемые дни, нагрузка, лимиты) задаются помесячно. Их можно
                      посмотреть и изменить за сотрудника в полном редакторе анкеты.
                    </p>
                    <a
                      href={`/admin/employees/${emp.id}/preferences`}
                      className={buttonVariants({ size: "sm", variant: "outline" })}
                    >
                      Анкета на {planningLabel} →
                    </a>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <Button size="sm" onClick={() => saveEmployee(emp)}>
                      <Save className="h-3.5 w-3.5 mr-1" />
                      Сохранить
                    </Button>
                    <Dialog>
                      <DialogTrigger
                        className={buttonVariants({
                          size: "sm",
                          variant: "destructive",
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Удалить
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Удалить {emp.name}?</DialogTitle>
                        </DialogHeader>
                        <p className="text-sm text-muted-foreground">
                          Это действие необратимо.
                        </p>
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="destructive"
                            onClick={() => deleteEmployee(emp.id)}
                          >
                            Удалить
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
        </div>
      )}
    </div>
  );
}

function TenureFields({
  emp,
  onUpdate,
}: {
  emp: Employee;
  onUpdate: (u: Partial<Employee>) => void;
}) {
  const currentYear = new Date().getFullYear();
  const tenure = computeTenure(emp, currentYear);
  const minYear = currentYear - 60;
  const maxYear = currentYear;

  function parseYear(v: string): number | null {
    if (!v.trim()) return null;
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return null;
    if (n < minYear || n > maxYear) return null;
    return n;
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Год начала работы в больнице</Label>
          <Input
            type="number"
            min={minYear}
            max={maxYear}
            placeholder="напр. 2015"
            value={emp.hospitalStartYear ?? ""}
            onChange={(e) =>
              onUpdate({ hospitalStartYear: parseYear(e.target.value) })
            }
          />
          <p className="text-[11px] text-muted-foreground">
            {emp.hospitalStartYear != null
              ? `${tenure.hospitalYears} ${yearsWord(tenure.hospitalYears)} в больнице`
              : "—"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Год начала работы в профессии</Label>
          <Input
            type="number"
            min={minYear}
            max={maxYear}
            placeholder="напр. 2010"
            value={emp.careerStartYear ?? ""}
            onChange={(e) =>
              onUpdate({ careerStartYear: parseYear(e.target.value) })
            }
          />
          <p className="text-[11px] text-muted-foreground">
            {emp.careerStartYear != null
              ? `${tenure.careerYears} ${yearsWord(tenure.careerYears)} общий${
                  tenure.externalYears > 0
                    ? ` (в т.ч. ${tenure.externalYears} ${yearsWord(tenure.externalYears)} вне больницы)`
                    : ""
                }`
              : "—"}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Вес в солвере</Label>
          <div className="h-9 rounded-md border bg-muted/30 px-3 flex items-center text-sm">
            {tenure.score}
            <span className="text-muted-foreground ml-1 text-xs">
              = 3×{tenure.hospitalYears} + {tenure.externalYears}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Выше вес → солвер сильнее старается удовлетворить предпочтения и
            желаемые даты.
          </p>
        </div>
      </div>
    </div>
  );
}

type SortDir = "asc" | "desc";

type OverviewColumn = {
  key: string;
  label: string;
  title?: string;
  align?: "left" | "center";
  sortValue: (r: PrefSummary) => number | string;
  render: (r: PrefSummary) => ReactNode;
};

const LOAD_ORDER: Record<string, number> = { less: 0, normal: 1, more: 2 };

function numCell(n: number | null, zeroDim = true) {
  if (n == null) return <span className="text-muted-foreground">—</span>;
  if (n === 0 && zeroDim)
    return <span className="text-muted-foreground">0</span>;
  return n;
}

const OVERVIEW_COLUMNS: OverviewColumn[] = [
  {
    key: "submitted",
    label: "Анкета",
    title: "Подал(а) пожелания на планируемый месяц",
    align: "center",
    sortValue: (r) => (r.submitted ? 1 : 0),
    render: (r) =>
      r.submitted ? (
        <span className="text-green-500">✓</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "rate",
    label: "Ставка",
    align: "center",
    sortValue: (r) => r.rate,
    render: (r) => r.rate,
  },
  {
    key: "targetRate",
    label: "Целевая",
    align: "center",
    sortValue: (r) => r.targetRate,
    render: (r) => r.targetRate,
  },
  {
    key: "modalities",
    label: "Мод.",
    align: "center",
    sortValue: (r) => r.modalities.join(","),
    render: (r) => r.modalities.join(", ") || "—",
  },
  {
    key: "can24h",
    label: "24ч",
    align: "center",
    sortValue: (r) => (r.can24h ? 1 : 0),
    render: (r) => (r.can24h ? "✓" : "—"),
  },
  {
    key: "loadPref",
    label: "Нагрузка",
    title: "Желаемая нагрузка на месяц",
    align: "center",
    sortValue: (r) => (r.loadPref ? LOAD_ORDER[r.loadPref] ?? 1 : -1),
    render: (r) =>
      r.loadPref ? LOAD_LABELS[r.loadPref] ?? r.loadPref : "—",
  },
  {
    key: "shiftTimeMode",
    label: "Смены",
    title: "Предпочтение по времени смен",
    align: "center",
    sortValue: (r) => r.shiftTimeMode ?? "",
    render: (r) =>
      r.shiftTimeMode
        ? SHIFT_MODE_LABELS[r.shiftTimeMode] ?? r.shiftTimeMode
        : "—",
  },
  {
    key: "consec",
    label: "Очерёдность",
    title: "Предпочтение по сменам подряд",
    align: "center",
    sortValue: (r) => r.consec,
    render: (r) => consecLabel(r.consec),
  },
  {
    key: "preferCount",
    label: "Хочу",
    title: "Сколько аппаратов/смен помечено «хочу»",
    align: "center",
    sortValue: (r) => r.preferCount,
    render: (r) =>
      r.preferCount > 0 ? (
        <span className="text-green-500">{r.preferCount}</span>
      ) : (
        numCell(0)
      ),
  },
  {
    key: "avoidCount",
    label: "Лучше нет",
    title: "Сколько аппаратов помечено «лучше не ставить»",
    align: "center",
    sortValue: (r) => r.avoidCount,
    render: (r) =>
      r.avoidCount > 0 ? (
        <span className="text-amber-400">{r.avoidCount}</span>
      ) : (
        numCell(0)
      ),
  },
  {
    key: "banCount",
    label: "Вообще нет",
    title: "Сколько аппаратов/смен помечено «вообще не ставить»",
    align: "center",
    sortValue: (r) => r.banCount,
    render: (r) =>
      r.banCount > 0 ? (
        <span className="text-red-500">{r.banCount}</span>
      ) : (
        numCell(0)
      ),
  },
  {
    key: "unavailableCount",
    label: "Недост.",
    title: "Число недоступных дней (жёстко)",
    align: "center",
    sortValue: (r) => r.unavailableCount,
    render: (r) => numCell(r.unavailableCount),
  },
  {
    key: "softUnavailableCount",
    label: "Жел. своб.",
    title: "Дни, в которые желательно не ставить (мягко)",
    align: "center",
    sortValue: (r) => r.softUnavailableCount,
    render: (r) => numCell(r.softUnavailableCount),
  },
  {
    key: "desiredCount",
    label: "Жел. даты",
    title: "Число желаемых дат работы",
    align: "center",
    sortValue: (r) => r.desiredCount,
    render: (r) => numCell(r.desiredCount),
  },
  {
    key: "minShifts",
    label: "Мин. смен",
    align: "center",
    sortValue: (r) => r.minShifts ?? -1,
    render: (r) => numCell(r.minShifts, false),
  },
  {
    key: "maxFull",
    label: "Макс. сутки",
    align: "center",
    sortValue: (r) => r.maxFull ?? Number.MAX_SAFE_INTEGER,
    render: (r) => numCell(r.maxFull, false),
  },
  {
    key: "maxNights",
    label: "Макс. ночи",
    align: "center",
    sortValue: (r) => r.maxNights ?? Number.MAX_SAFE_INTEGER,
    render: (r) => numCell(r.maxNights, false),
  },
  {
    key: "preferWithCount",
    label: "С кем",
    title: "Число коллег «хочу вместе»",
    align: "center",
    sortValue: (r) => r.preferWithCount,
    render: (r) => numCell(r.preferWithCount),
  },
  {
    key: "avoidWithCount",
    label: "Не с кем",
    title: "Число коллег «не вместе»",
    align: "center",
    sortValue: (r) => r.avoidWithCount,
    render: (r) => numCell(r.avoidWithCount),
  },
  {
    key: "medical",
    label: "Медотвод",
    align: "center",
    sortValue: (r) => r.medicalRestriction,
    render: (r) =>
      r.medicalRestriction === "none" ? (
        "—"
      ) : (
        <span className="text-red-400">
          {medicalLabel(r.medicalRestriction)}
        </span>
      ),
  },
];

function PreferencesOverview({
  rows,
  planningLabel,
  submittedCount,
}: {
  rows: PrefSummary[];
  planningLabel: string;
  submittedCount: number;
}) {
  const [sortKey, setSortKey] = useState<string>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState("");

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const col = OVERVIEW_COLUMNS.find((c) => c.key === sortKey);
  const filtered = rows.filter((r) =>
    r.name.toLowerCase().includes(filter.toLowerCase()),
  );
  const sorted = [...filtered].sort((a, b) => {
    let av: number | string;
    let bv: number | string;
    if (sortKey === "name" || !col) {
      av = a.name;
      bv = b.name;
    } else {
      av = col.sortValue(a);
      bv = col.sortValue(b);
    }
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
    else cmp = String(av).localeCompare(String(bv), "ru");
    return sortDir === "asc" ? cmp : -cmp;
  });

  function sortIcon(active: boolean) {
    if (!active)
      return <ArrowUpDown className="h-3 w-3 inline opacity-40 ml-0.5" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3 w-3 inline ml-0.5" />
    ) : (
      <ArrowDown className="h-3 w-3 inline ml-0.5" />
    );
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground">
            Пожелания на <span className="font-medium text-foreground">{planningLabel}</span>
            {" · "}
            подали {submittedCount} из {rows.length}. Жми на заголовок, чтобы
            сортировать.
          </p>
          <Input
            placeholder="Поиск..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-44"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="border-b">
                <th
                  className="text-left font-medium py-2 px-2 sticky left-0 bg-card cursor-pointer select-none whitespace-nowrap"
                  onClick={() => toggleSort("name")}
                >
                  Сотрудник
                  {sortIcon(sortKey === "name")}
                </th>
                {OVERVIEW_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    title={c.title}
                    className={`font-medium py-2 px-2 cursor-pointer select-none whitespace-nowrap ${
                      c.align === "left" ? "text-left" : "text-center"
                    }`}
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.label}
                    {sortIcon(sortKey === c.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr
                  key={r.employeeId}
                  className={`border-b last:border-0 hover:bg-muted/40 ${
                    r.submitted ? "" : "opacity-60"
                  }`}
                >
                  <td className="text-left py-1.5 px-2 sticky left-0 bg-card font-medium whitespace-nowrap">
                    {r.name}
                  </td>
                  {OVERVIEW_COLUMNS.map((c) => (
                    <td
                      key={c.key}
                      className={`py-1.5 px-2 whitespace-nowrap ${
                        c.align === "left" ? "text-left" : "text-center"
                      }`}
                    >
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td
                    colSpan={OVERVIEW_COLUMNS.length + 1}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Нет данных
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
