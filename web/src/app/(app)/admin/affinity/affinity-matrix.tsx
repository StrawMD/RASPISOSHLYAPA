"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, Check, ChevronDown, Undo2, Redo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type Post = { id: string; name: string; shiftHours: number; modality: string };
type Kind = "full" | "day" | "night";

type Row = {
  id: string;
  name: string;
  rate: number;
  allowed: Record<string, boolean>;
  postPrefs: Record<string, string>;
  shiftPrefs: Record<string, Record<string, string>>;
};

type InputEmployee = {
  id: string;
  name: string;
  rate: number;
  allowedPosts: string[];
  postPreferences: Record<string, string>;
  postShiftPrefs: Record<string, Record<string, string>>;
};

type LevelMeta = {
  label: string; // полная подпись в выпадающем меню
  short: string; // подпись на 12ч-триггере
  tiny: string; // подпись на узком суточном триггере
  dot: string;
  trigger: string;
  text: string;
};

// Шкала: «активные/желаемые» аппараты выделяются (зелёным), а отказ/запрет/
// «не допущен» приглушены и уходят из поля зрения.
const LEVEL_META: Record<string, LevelMeta> = {
  prefer_strong: {
    label: "Очень хочу",
    short: "Очень хочу",
    tiny: "оч.хочу",
    dot: "bg-emerald-500",
    trigger: "bg-emerald-500/20 ring-emerald-500/40 hover:bg-emerald-500/30",
    text: "text-emerald-700 dark:text-emerald-300 font-semibold",
  },
  prefer: {
    label: "Скорее хочу",
    short: "Хочу",
    tiny: "хочу",
    dot: "bg-emerald-400",
    trigger: "bg-emerald-500/10 ring-emerald-500/25 hover:bg-emerald-500/20",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  neutral: {
    label: "Нейтрально",
    short: "Нейтрально",
    tiny: "нейтр.",
    dot: "bg-muted-foreground/30",
    trigger: "ring-border/60 hover:bg-muted/60",
    text: "text-foreground/55",
  },
  avoid: {
    label: "Лучше не ставить",
    short: "Не очень",
    tiny: "не оч.",
    dot: "bg-muted-foreground/25",
    trigger: "ring-border/40 hover:bg-muted/50",
    text: "text-muted-foreground/70",
  },
  avoid_hard: {
    label: "Вообще не ставить (запрет)",
    short: "Запрет",
    tiny: "запрет",
    dot: "bg-muted-foreground/20",
    trigger: "ring-border/30 hover:bg-muted/40",
    text: "text-muted-foreground/45 line-through",
  },
};

const LEVEL_ORDER = [
  "prefer_strong",
  "prefer",
  "neutral",
  "avoid",
  "avoid_hard",
] as const;

const SHIFT_KINDS: { key: Kind; label: string }[] = [
  { key: "full", label: "сутки" },
  { key: "day", label: "день" },
  { key: "night", label: "ночь" },
];

function metaOf(value: string): LevelMeta {
  return LEVEL_META[value] ?? LEVEL_META.neutral;
}

/** Красивый кастомный выбор уровня предпочтения (Base UI + портал). */
function LevelSelect({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (v: string) => void;
  compact?: boolean;
}) {
  const meta = metaOf(value);
  const options: string[] = [...LEVEL_ORDER];

  return (
    <SelectPrimitive.Root
      value={value}
      onValueChange={(v) => {
        if (typeof v === "string") onChange(v);
      }}
    >
      <SelectPrimitive.Trigger
        className={cn(
          "group inline-flex w-full items-center gap-1 rounded-md ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
          compact ? "h-6 px-1 text-[10px]" : "h-7 justify-between px-1.5 text-xs",
          meta.trigger,
          meta.text,
        )}
        title={meta.label}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              meta.dot || "border border-dashed border-muted-foreground/50",
            )}
          />
          <span className="truncate">{compact ? meta.tiny : meta.short}</span>
        </span>
        {!compact && (
          <ChevronDown className="size-3 shrink-0 opacity-30 transition group-hover:opacity-60" />
        )}
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          side="bottom"
          sideOffset={6}
          align="start"
          className="z-50"
        >
          <SelectPrimitive.Popup className="min-w-48 origin-(--transform-origin) overflow-hidden rounded-xl border bg-popover p-1 shadow-lg ring-1 ring-foreground/5 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
            {options.map((v) => {
              const m = metaOf(v);
              return (
                <SelectPrimitive.Item
                  key={v}
                  value={v}
                  className="relative flex cursor-pointer items-center gap-2 rounded-lg py-1.5 pr-8 pl-2 text-xs outline-none select-none focus:bg-accent data-[highlighted]:bg-accent"
                >
                  <span
                    className={cn(
                      "size-2.5 rounded-full",
                      m.dot ||
                        "border border-dashed border-muted-foreground/50",
                    )}
                  />
                  <SelectPrimitive.ItemText
                    className={cn("flex-1 font-medium", m.text)}
                  >
                    {m.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator
                    render={
                      <span className="absolute right-2 flex items-center" />
                    }
                  >
                    <Check className="size-3.5" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

type SatInfo = {
  postId: string;
  demandHours: number;
  coveredHours: number;
  ratio: number;
  eligibleCount: number;
  activeDays: number;
};

const MONTH_NAMES = [
  "янв",
  "фев",
  "мар",
  "апр",
  "май",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

/** Лаконичный индикатор насыщения поста людьми на выбранный месяц. */
function SatBadge({ info }: { info?: SatInfo }) {
  if (!info) {
    return <div className="mt-1 h-[15px]" aria-hidden />;
  }
  const pct = Math.round(info.ratio * 100);
  const tone =
    info.ratio >= 1
      ? "text-emerald-600 dark:text-emerald-400"
      : info.ratio >= 0.85
        ? "text-amber-600 dark:text-amber-500"
        : "text-red-600 dark:text-red-500";
  const dot =
    info.ratio >= 1
      ? "bg-emerald-500"
      : info.ratio >= 0.85
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <div
      className={cn("mt-1 flex items-center gap-1 text-[10px] font-medium", tone)}
      title={`Покрытие ${pct}% · спрос ${info.demandHours} ч, людей под аппарат: ${info.eligibleCount}`}
    >
      <span className={cn("size-1.5 rounded-full", dot)} />
      <span>{pct}%</span>
      <span className="font-normal text-muted-foreground">
        · {info.eligibleCount} чел
      </span>
    </div>
  );
}

export function AffinityMatrix({
  posts,
  employees,
  months,
}: {
  posts: Post[];
  employees: InputEmployee[];
  months: { year: number; month: number }[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [query, setQuery] = useState("");

  // ── Прогноз насыщения аппаратов на выбранный месяц ──
  const monthOptions = useMemo(() => {
    const now = new Date();
    const set = new Map<string, { year: number; month: number }>();
    for (const m of months) set.set(`${m.year}-${m.month}`, m);
    // добавим ближайшие 3 месяца от текущего, если их нет
    for (let i = 0; i < 4; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      set.set(`${d.getFullYear()}-${d.getMonth() + 1}`, {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
      });
    }
    return Array.from(set.values()).sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month,
    );
  }, [months]);

  const defaultMonth = useMemo(() => {
    const now = new Date();
    const cur = now.getFullYear() * 12 + now.getMonth() + 1;
    const upcoming = monthOptions.find((m) => m.year * 12 + m.month >= cur);
    return upcoming ?? monthOptions[monthOptions.length - 1];
  }, [monthOptions]);

  const [satKey, setSatKey] = useState<string>(
    defaultMonth ? `${defaultMonth.year}-${defaultMonth.month}` : "",
  );
  const [sat, setSat] = useState<Record<string, SatInfo> | null>(null);
  const [satLoading, setSatLoading] = useState(false);

  useEffect(() => {
    if (!satKey) return;
    const [y, m] = satKey.split("-").map(Number);
    let cancelled = false;
    setSatLoading(true);
    fetch(`/api/admin/affinity/saturation?year=${y}&month=${m}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { posts: SatInfo[] }) => {
        if (cancelled) return;
        const map: Record<string, SatInfo> = {};
        for (const p of data.posts) map[p.postId] = p;
        setSat(map);
      })
      .catch(() => {
        if (!cancelled) setSat(null);
      })
      .finally(() => {
        if (!cancelled) setSatLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // перезапрашиваем и после сохранения матрицы (router.refresh меняет employees)
  }, [satKey, employees]);

  const initialRows = useMemo<Row[]>(
    () =>
      employees.map((e) => ({
        id: e.id,
        name: e.name,
        rate: e.rate,
        allowed: Object.fromEntries(e.allowedPosts.map((p) => [p, true])),
        postPrefs: { ...e.postPreferences },
        shiftPrefs: JSON.parse(JSON.stringify(e.postShiftPrefs ?? {})),
      })),
    [employees],
  );

  // История для undo/redo.
  const [hist, setHist] = useState<{
    past: Row[][];
    present: Row[];
    future: Row[][];
  }>(() => ({ past: [], present: initialRows, future: [] }));
  const rows = hist.present;
  const canUndo = hist.past.length > 0;
  const canRedo = hist.future.length > 0;

  const applyRows = useCallback((updater: (rows: Row[]) => Row[]) => {
    setHist((h) => {
      const next = updater(h.present);
      if (next === h.present) return h;
      return { past: [...h.past, h.present], present: next, future: [] };
    });
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    setHist((h) => {
      if (h.past.length === 0) return h;
      const prev = h.past[h.past.length - 1];
      return {
        past: h.past.slice(0, -1),
        present: prev,
        future: [h.present, ...h.future],
      };
    });
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    setHist((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      return {
        past: [...h.past, h.present],
        present: next,
        future: h.future.slice(1),
      };
    });
    setDirty(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "z") return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  function patchRow(id: string, fn: (r: Row) => void) {
    applyRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const copy: Row = {
          ...r,
          allowed: { ...r.allowed },
          postPrefs: { ...r.postPrefs },
          shiftPrefs: JSON.parse(JSON.stringify(r.shiftPrefs)),
        };
        fn(copy);
        return copy;
      }),
    );
  }

  // 12ч-пост: уровень предпочтения (только для допущенных постов).
  function setRegularCell(id: string, postId: string, value: string) {
    patchRow(id, (r) => {
      if (value === "neutral") delete r.postPrefs[postId];
      else r.postPrefs[postId] = value;
    });
  }

  function setShiftCell(id: string, postId: string, kind: Kind, value: string) {
    patchRow(id, (r) => {
      const inner = { ...(r.shiftPrefs[postId] ?? {}) };
      if (value === "neutral") delete inner[kind];
      else inner[kind] = value;
      if (Object.keys(inner).length > 0) r.shiftPrefs[postId] = inner;
      else delete r.shiftPrefs[postId];
    });
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        employees: rows.map((r) => {
          const allowedPosts = Object.keys(r.allowed).filter((p) => r.allowed[p]);
          const allowedSet = new Set(allowedPosts);
          const postPreferences: Record<string, string> = {};
          for (const [pid, lvl] of Object.entries(r.postPrefs)) {
            if (allowedSet.has(pid)) postPreferences[pid] = lvl;
          }
          const postShiftPrefs: Record<string, Record<string, string>> = {};
          for (const [pid, inner] of Object.entries(r.shiftPrefs)) {
            if (allowedSet.has(pid)) postShiftPrefs[pid] = inner;
          }
          return {
            id: r.id,
            allowedPosts,
            postPreferences,
            postShiftPrefs,
          };
        }),
      };
      const res = await fetch("/api/admin/affinity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? "Ошибка сохранения");
      }
      toast.success("Матрица сохранена");
      setDirty(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Поиск по фамилии…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-48"
          />
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={undo}
              disabled={!canUndo}
              title="Отменить (⌘Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-8 w-8"
              onClick={redo}
              disabled={!canRedo}
              title="Вернуть (⌘⇧Z)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Насыщение:</span>
            <select
              value={satKey}
              onChange={(e) => setSatKey(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              title="Месяц для оценки достаточности людей"
            >
              {monthOptions.map((m) => (
                <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                  {MONTH_NAMES[m.month - 1]} {m.year}
                </option>
              ))}
            </select>
            {satLoading && (
              <span className="text-[10px] text-muted-foreground">…</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {LEVEL_ORDER.map((lvl) => {
            const m = LEVEL_META[lvl];
            return (
              <span key={lvl} className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", m.dot)} />
                <span className={m.text}>{m.label}</span>
              </span>
            );
          })}
        </div>
        <Button size="sm" onClick={save} disabled={saving || !dirty}>
          <Save className="mr-1 h-4 w-4" />
          {saving ? "Сохранение…" : dirty ? "Сохранить" : "Сохранено"}
        </Button>
      </div>

      <div className="overflow-auto max-h-[calc(100vh-220px)]">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-40 border-b border-r bg-background px-3 py-2 text-left font-medium min-w-[140px]">
                Сотрудник
              </th>
              {posts.map((p) => (
                <th
                  key={p.id}
                  className={cn(
                    "sticky top-0 z-30 border-b border-r bg-background px-1.5 py-2 text-left align-bottom",
                    p.shiftHours === 24 ? "min-w-[190px]" : "min-w-[112px]",
                  )}
                >
                  <div className="font-medium leading-tight">{p.name}</div>
                  <div className="mt-0.5 flex items-center gap-1">
                    {p.modality && (
                      <span className="text-[10px] text-muted-foreground">
                        {p.modality}
                      </span>
                    )}
                    {p.shiftHours === 24 && (
                      <Badge variant="outline" className="h-4 px-1 text-[9px]">
                        суточный
                      </Badge>
                    )}
                  </div>
                  <SatBadge info={sat?.[p.id]} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-muted/30">
                <th className="sticky left-0 z-10 border-b border-r bg-background px-3 py-1 text-left font-normal">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{r.name}</span>
                    {r.rate <= 0.5 && (
                      <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                        0.5
                      </Badge>
                    )}
                  </div>
                </th>

                {posts.map((p) => {
                  const allowed = !!r.allowed[p.id];

                  // Не допущен к посту (модальность/допуск) — пустая
                  // приглушённая ячейка без селекта. Допуск задаётся в
                  // карточке сотрудника, а не здесь.
                  if (!allowed) {
                    return (
                      <td
                        key={p.id}
                        className="border-b border-r bg-muted/20 px-1 py-1 align-middle"
                        title="Не допущен к этому аппарату"
                      >
                        <div className="flex h-7 items-center justify-center text-muted-foreground/30">
                          —
                        </div>
                      </td>
                    );
                  }

                  if (p.shiftHours === 24) {
                    return (
                      <td
                        key={p.id}
                        className="border-b border-r px-1 py-1 align-middle"
                      >
                        <div className="grid grid-cols-3 gap-1">
                          {SHIFT_KINDS.map(({ key, label }) => {
                            const lvl = r.shiftPrefs[p.id]?.[key] ?? "neutral";
                            return (
                              <div
                                key={key}
                                className="flex flex-col items-stretch gap-0.5"
                              >
                                <span className="text-center text-[9px] leading-none text-muted-foreground">
                                  {label}
                                </span>
                                <LevelSelect
                                  value={lvl}
                                  compact
                                  onChange={(v) =>
                                    setShiftCell(r.id, p.id, key, v)
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    );
                  }

                  // 12ч-пост: только уровень предпочтения (без «не допущен»).
                  const value = r.postPrefs[p.id] ?? "neutral";
                  return (
                    <td
                      key={p.id}
                      className="border-b border-r px-1 py-1 align-middle"
                    >
                      <LevelSelect
                        value={value}
                        onChange={(v) => setRegularCell(r.id, p.id, v)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
