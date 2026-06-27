"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
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
import {
  Loader2,
  Plus,
  X,
  ArrowLeftRight,
  Undo2,
  Redo2,
  Save,
  ChevronDown,
  ChevronUp,
  UserPlus,
} from "lucide-react";
import type { FixedSlotsMap } from "@/lib/validate-fixed-slots";
import {
  applyFixedSlotEdit,
  computeEmployeeHoursFromSchedule,
  formatScheduleLabel,
  type FixedEditOp,
  type ShiftKind,
} from "@/lib/schedule-labels";
import { cn } from "@/lib/utils";

type Post = {
  id: string;
  name: string;
  shiftHours: number;
  staffRequired: number;
};
type Employee = {
  id: string;
  name: string;
  rate: number;
  allowedPosts: string[];
};

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const FIXED_CLASS =
  "border-sky-500/60 bg-sky-500/15 text-sky-900 dark:text-sky-100";

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

export function FixedSlotsEditor({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("{}");
  // Режим быстрой фиксации: выбранная фамилия проставляется кликом по ячейкам.
  const [quickAddName, setQuickAddName] = useState("");
  const [quickAddKind, setQuickAddKind] = useState<ShiftKind>("full");
  const [quickPickerOpen, setQuickPickerOpen] = useState(false);

  const [hist, setHist] = useState<{
    past: FixedSlotsMap[];
    present: FixedSlotsMap;
    future: FixedSlotsMap[];
  }>({ past: [], present: {}, future: [] });
  const slots = hist.present;
  const canUndo = hist.past.length > 0;
  const canRedo = hist.future.length > 0;

  const numDays = new Date(year, month, 0).getDate();

  const applyLocal = useCallback((updater: (m: FixedSlotsMap) => FixedSlotsMap) => {
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/fixed-slots?year=${year}&month=${month}`,
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Ошибка загрузки");
        return;
      }
      const fs = (data.fixedSlots ?? {}) as FixedSlotsMap;
      setPosts(data.posts ?? []);
      setEmployees(data.employees ?? []);
      setHist({ past: [], present: fs, future: [] });
      setJsonText(JSON.stringify(fs, null, 2));
      setDirty(false);
    } catch {
      toast.error("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    load();
  }, [load]);

  const employeeHours = useMemo(
    () => computeEmployeeHoursFromSchedule(slots),
    [slots],
  );

  function patchEdit(op: FixedEditOp) {
    applyLocal((m) =>
      applyFixedSlotEdit(
        m,
        op.day,
        op.postId,
        op.editType,
        op.oldValue,
        op.newValue,
      ),
    );
  }

  function quickAssignFixed(day: number, postId: string, shiftHours: number) {
    if (!quickAddName) return;
    const label = formatScheduleLabel(
      quickAddName,
      shiftHours,
      shiftHours === 24 ? quickAddKind : undefined,
    );
    patchEdit({ day, postId, editType: "assign", oldValue: null, newValue: label });
  }

  function quickRemoveFixed(day: number, postId: string, label: string) {
    patchEdit({ day, postId, editType: "remove", oldValue: label, newValue: null });
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/fixed-slots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, fixedSlots: slots }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Ошибка сохранения");
        return;
      }
      const fs = data.fixedSlots as FixedSlotsMap;
      setHist({ past: [], present: fs, future: [] });
      setJsonText(JSON.stringify(fs, null, 2));
      setDirty(false);
      toast.success("Фиксы сохранены");
    } catch {
      toast.error("Ошибка соединения");
    } finally {
      setSaving(false);
    }
  }

  function applyJson() {
    try {
      const parsed = JSON.parse(jsonText) as FixedSlotsMap;
      applyLocal(() => parsed);
      toast.success("JSON применён локально — нажмите «Сохранить»");
    } catch {
      toast.error("Некорректный JSON");
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
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
        <Button onClick={save} disabled={saving || !dirty} size="sm">
          <Save className="mr-1 h-4 w-4" />
          {saving ? "Сохранение…" : dirty ? "Сохранить" : "Сохранено"}
        </Button>
        <Button variant="outline" size="sm" onClick={load}>
          Перезагрузить
        </Button>
        <Popover open={quickPickerOpen} onOpenChange={setQuickPickerOpen}>
          <PopoverTrigger
            className={cn(
              "inline-flex items-center h-8 px-2 text-xs rounded-md border transition-colors",
              quickAddName
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-input hover:bg-muted",
            )}
            title="Быстрая фиксация: выберите фамилию и кликайте по ячейкам"
          >
            <UserPlus className="mr-1 h-3.5 w-3.5" />
            Быстрая фиксация
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
                    onSelect={() => {
                      setQuickAddName(e.name);
                      setQuickPickerOpen(false);
                    }}
                  >
                    {e.name}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {quickAddName && (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-md border border-violet-400 bg-violet-50 px-3 py-2 text-sm dark:bg-violet-950/30">
          <UserPlus className="h-4 w-4 shrink-0 text-violet-600" />
          <span>
            Быстрая фиксация:{" "}
            <strong className="text-violet-700 dark:text-violet-300">
              {quickAddName}
            </strong>
            . Кликайте по ячейкам, чтобы закрепить (повторный клик по этой
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
            className="ml-auto h-7 px-2"
            onClick={() => setQuickAddName("")}
            title="Выключить быструю фиксацию"
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Выйти
          </Button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[800px] border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 w-16 border bg-muted px-2 py-1.5">
                Дата
              </th>
              <th className="sticky left-16 z-10 w-8 border bg-muted px-2 py-1.5">
                ДН
              </th>
              {posts.map((p) => (
                <th
                  key={p.id}
                  className="whitespace-nowrap border bg-muted px-2 py-1.5"
                >
                  <div>{p.name}</div>
                  <div className="font-normal text-muted-foreground">
                    {p.shiftHours}ч ×{p.staffRequired}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: numDays }, (_, i) => i + 1).map((d) => {
              const date = new Date(year, month - 1, d);
              const dow = DAY_NAMES[(date.getDay() + 6) % 7];
              const weekend = date.getDay() === 0 || date.getDay() === 6;
              const dayData = slots[String(d)] ?? {};

              return (
                <tr
                  key={d}
                  className={weekend ? "bg-red-50/50 dark:bg-red-950/10" : ""}
                >
                  <td className="sticky left-0 z-[5] border bg-inherit px-2 py-1 font-medium">
                    {String(d).padStart(2, "0")}.{String(month).padStart(2, "0")}
                  </td>
                  <td className="sticky left-16 z-[5] border bg-inherit px-2 py-1">
                    {dow}
                  </td>
                  {posts.map((p) => {
                    const people = dayData[p.id] ?? [];
                    const eligible = employees.filter((e) =>
                      e.allowedPosts.includes(p.id),
                    );
                    const assigned = new Set(
                      people.map((x) => x.replace(/\([сдн]\)$/, "")),
                    );
                    const available = eligible.filter(
                      (e) => !assigned.has(e.name),
                    );

                    return (
                      <td key={p.id} className="border px-1 py-0.5">
                        <div className="flex min-h-[1.5rem] flex-wrap items-center gap-0.5">
                          {quickAddName ? (
                            <>
                              {people.map((person, idx) => {
                                const bn = person.replace(/\([сдн]\)$/, "");
                                const isTarget = bn === quickAddName;
                                return (
                                  <button
                                    key={idx}
                                    type="button"
                                    disabled={!isTarget}
                                    onClick={
                                      isTarget
                                        ? () =>
                                            quickRemoveFixed(d, p.id, person)
                                        : undefined
                                    }
                                    className={cn(
                                      "inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-xs",
                                      isTarget
                                        ? "cursor-pointer bg-violet-500/20 ring-2 ring-violet-500"
                                        : cn("opacity-50", FIXED_CLASS),
                                    )}
                                    title={isTarget ? "Убрать фикс" : person}
                                  >
                                    🔒 {person}
                                  </button>
                                );
                              })}
                              {eligible.some((e) => e.name === quickAddName) &&
                                !assigned.has(quickAddName) && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      quickAssignFixed(d, p.id, p.shiftHours)
                                    }
                                    className="inline-flex items-center gap-0.5 rounded border border-violet-500 bg-violet-500/10 px-1.5 py-0.5 text-xs text-violet-700 transition-colors hover:bg-violet-500/20 dark:text-violet-300"
                                    title={`Закрепить ${quickAddName}${
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
                          {people.map((person, idx) => (
                            <Popover key={idx}>
                              <PopoverTrigger
                                className={cn(
                                  "inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-xs hover:opacity-80",
                                  FIXED_CLASS,
                                )}
                              >
                                🔒 {person}
                                <span className="text-[10px] opacity-70">
                                  ·{" "}
                                  {Math.round(
                                    employeeHours[
                                      person.replace(/\([сдн]\)$/, "")
                                    ] ?? 0,
                                  )}
                                  ч
                                </span>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-64 p-2"
                                align="start"
                              >
                                <div className="space-y-1">
                                  <div className="mb-1 text-xs font-medium">
                                    {person} — {p.name}, день {d}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 w-full justify-start text-xs"
                                    onClick={() =>
                                      patchEdit({
                                        day: d,
                                        postId: p.id,
                                        editType: "remove",
                                        oldValue: person,
                                        newValue: null,
                                      })
                                    }
                                  >
                                    <X className="mr-1 h-3 w-3" />
                                    Убрать
                                  </Button>
                                  {available.length > 0 && (
                                    <>
                                      <p className="pt-1 text-[10px] text-muted-foreground">
                                        Заменить на:
                                      </p>
                                      {available.map((e) =>
                                        p.shiftHours === 24 ? (
                                          <div key={e.id} className="space-y-0.5">
                                            <p className="text-[10px] font-medium">
                                              {e.name}
                                            </p>
                                            {KIND_LABELS.map(({ key, label }) => (
                                              <Button
                                                key={key}
                                                variant="ghost"
                                                size="sm"
                                                className="h-7 w-full justify-start text-xs"
                                                onClick={() =>
                                                  patchEdit({
                                                    day: d,
                                                    postId: p.id,
                                                    editType: "swap",
                                                    oldValue: person,
                                                    newValue: formatScheduleLabel(
                                                      e.name,
                                                      p.shiftHours,
                                                      key,
                                                    ),
                                                  })
                                                }
                                              >
                                                <ArrowLeftRight className="mr-1 h-3 w-3" />
                                                {label}
                                              </Button>
                                            ))}
                                          </div>
                                        ) : (
                                          <Button
                                            key={e.id}
                                            variant="ghost"
                                            size="sm"
                                            className="h-7 w-full justify-start text-xs"
                                            onClick={() =>
                                              patchEdit({
                                                day: d,
                                                postId: p.id,
                                                editType: "swap",
                                                oldValue: person,
                                                newValue: e.name,
                                              })
                                            }
                                          >
                                            <ArrowLeftRight className="mr-1 h-3 w-3" />
                                            {e.name}
                                          </Button>
                                        ),
                                      )}
                                    </>
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>
                          ))}

                          {available.length > 0 && (
                            <Popover>
                              <PopoverTrigger className="inline-flex h-5 w-5 items-center justify-center rounded border border-dashed text-muted-foreground hover:bg-muted">
                                <Plus className="h-3 w-3" />
                              </PopoverTrigger>
                              <PopoverContent
                                className="max-h-[60vh] w-72 overflow-y-auto p-2"
                                align="start"
                              >
                                <p className="mb-2 text-xs font-medium">
                                  Добавить на {p.name}, день {d}
                                </p>
                                {available.map((e) =>
                                  p.shiftHours === 24 ? (
                                    <div key={e.id} className="mb-2">
                                      <p className="text-[10px] font-medium">
                                        {e.name}
                                      </p>
                                      {KIND_LABELS.map(({ key, label }) => (
                                        <Button
                                          key={key}
                                          variant="ghost"
                                          size="sm"
                                          className="h-7 w-full justify-start text-xs"
                                          onClick={() =>
                                            patchEdit({
                                              day: d,
                                              postId: p.id,
                                              editType: "assign",
                                              oldValue: null,
                                              newValue: formatScheduleLabel(
                                                e.name,
                                                p.shiftHours,
                                                key,
                                              ),
                                            })
                                          }
                                        >
                                          <Plus className="mr-1 h-3 w-3" />
                                          {label}
                                        </Button>
                                      ))}
                                    </div>
                                  ) : (
                                    <Button
                                      key={e.id}
                                      variant="ghost"
                                      size="sm"
                                      className="h-auto w-full justify-start py-1 text-xs"
                                      onClick={() =>
                                        patchEdit({
                                          day: d,
                                          postId: p.id,
                                          editType: "assign",
                                          oldValue: null,
                                          newValue: e.name,
                                        })
                                      }
                                    >
                                      <Plus className="mr-1 h-3 w-3" />
                                      {e.name}
                                    </Button>
                                  ),
                                )}
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

      <div className="rounded-lg border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium"
          onClick={() => setShowJson((v) => !v)}
        >
          <span>Расширенный режим: JSON</span>
          {showJson ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        {showJson && (
          <div className="space-y-2 border-t p-4">
            <textarea
              className="min-h-[200px] w-full rounded-md border bg-background p-2 font-mono text-xs"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              spellCheck={false}
            />
            <Button variant="outline" size="sm" onClick={applyJson}>
              Применить JSON локально
            </Button>
          </div>
        )}
      </div>

      <div className="rounded-lg border p-3">
        <h3 className="mb-2 text-sm font-medium">Часы по фиксам</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(employeeHours)
            .sort(([a], [b]) => a.localeCompare(b, "ru"))
            .map(([name, h]) => (
              <Badge key={name} variant="secondary" className="text-xs">
                {name}: {Math.round(h)}ч
              </Badge>
            ))}
          {Object.keys(employeeHours).length === 0 && (
            <span className="text-sm text-muted-foreground">
              Нет зафиксированных смен
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
