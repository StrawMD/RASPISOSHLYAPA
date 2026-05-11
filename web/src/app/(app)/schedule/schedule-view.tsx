"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalendarDays, List, BarChart3, FileDown, Table } from "lucide-react";

const DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const DAY_NAMES_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const MONTH_ABBR_RU = [
  "янв", "фев", "мар", "апр", "мая", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
] as const;

type Post = { id: string; name: string; shiftHours: number; staffRequired: number };
type Schedule = Record<string, Record<string, string[]>>;

function csvEscape(cell: string): string {
  if (/[;"\r\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

/** Таблица как в Google/Excel: `;`, UTF-8 BOM — открывается в Excel. */
function buildScheduleCsv(
  year: number,
  month: number,
  schedule: Schedule,
  posts: Post[],
  normHours: number | null
): string {
  const lines: string[] = [];
  const numDays = new Date(year, month, 0).getDate();
  const title =
    normHours != null && normHours > 0
      ? `${MONTH_NAMES[month - 1].toUpperCase()} ${normHours} ч`
      : MONTH_NAMES[month - 1].toUpperCase();
  const headerPosts = posts.map((p) => csvEscape(p.name)).join(";");
  lines.push(`${title};;${headerPosts}`);

  for (let d = 1; d <= numDays; d++) {
    const dow =
      DAY_NAMES[(new Date(year, month - 1, d).getDay() + 6) % 7];
    const dateStr = `${String(d).padStart(2, "0")}.${MONTH_ABBR_RU[month - 1]}`;
    const dayStr = String(d);
    const dayData = schedule[dayStr] ?? {};
    const cells = posts.map((p) => {
      const arr = dayData[p.id] ?? [];
      const text = arr.join(" ").trim();
      return csvEscape(text);
    });
    lines.push([dateStr, dow, ...cells].join(";"));
  }

  return "\uFEFF" + lines.join("\r\n");
}

function downloadTextFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

interface Props {
  year: number;
  month: number;
  availableMonths: { year: number; month: number }[];
  schedule: Schedule | null;
  employeeHours: Record<string, number> | null;
  posts: Post[];
  normHours?: number | null;
  employeeName: string | null;
  userRole: string;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function getDayOfWeek(year: number, month: number, day: number) {
  return new Date(year, month - 1, day).getDay();
}

function isWeekend(year: number, month: number, day: number) {
  const dow = getDayOfWeek(year, month, day);
  return dow === 0 || dow === 6;
}

export function ScheduleView({
  year,
  month,
  availableMonths,
  schedule,
  employeeHours,
  posts,
  normHours,
  employeeName,
  userRole,
}: Props) {
  void employeeHours;
  void userRole;
  const router = useRouter();
  const [viewMode, setViewMode] = useState<"calendar" | "list" | "table">(
    "calendar"
  );
  const numDays = getDaysInMonth(year, month);

  const allEmployeeNames = useMemo(() => {
    if (!schedule) return [] as string[];
    const set = new Set<string>();
    for (const dayData of Object.values(schedule)) {
      for (const people of Object.values(dayData)) {
        for (const person of people) {
          set.add(person.replace(/\([сдн]\)$/, ""));
        }
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
  }, [schedule]);

  const monthOptions = useMemo(() => {
    const list = availableMonths.map((m) => ({ ...m, key: `${m.year}-${m.month}` }));
    if (!list.some((m) => m.year === year && m.month === month)) {
      list.unshift({ year, month, key: `${year}-${month}` });
    }
    return list;
  }, [availableMonths, year, month]);

  function goToMonth(ym: string) {
    const [y, m] = ym.split("-").map(Number);
    if (!y || !m) return;
    if (y === year && m === month) return;
    const sp = new URLSearchParams();
    sp.set("year", String(y));
    sp.set("month", String(m));
    router.push(`/schedule?${sp.toString()}`);
  }

  const [exportOpen, setExportOpen] = useState(false);
  const [exportMode, setExportMode] = useState<"none" | "highlight">(
    employeeName ? "highlight" : "none"
  );
  const [exportName, setExportName] = useState<string>(employeeName ?? "");
  const [activeHighlight, setActiveHighlight] = useState<string | null>(null);
  const printRef = useRef<HTMLDivElement>(null);

  function handleExport() {
    const highlight = exportMode === "highlight" ? exportName || null : null;
    setActiveHighlight(highlight);
    const prevView = viewMode;
    setViewMode("table");
    setExportOpen(false);
    setTimeout(() => {
      window.print();
      setTimeout(() => {
        setActiveHighlight(null);
        setViewMode(prevView);
      }, 500);
    }, 200);
  }

  const tableHighlight = activeHighlight ?? employeeName;

  const myShifts: { day: number; post: string; type: string; hours: number }[] = [];
  if (schedule && employeeName) {
    for (let d = 1; d <= numDays; d++) {
      const dayData = schedule[String(d)] || {};
      for (const [postId, people] of Object.entries(dayData)) {
        for (const person of people) {
          const baseName = person.replace(/\([сдн]\)$/, "");
          if (baseName === employeeName) {
            const post = posts.find((p) => p.id === postId);
            const typeMatch = person.match(/\(([сдн])\)$/);
            const shiftType = typeMatch ? typeMatch[1] : "";
            const hours = shiftType === "с" ? 24 : shiftType ? 12 : (post?.shiftHours ?? 12);
            myShifts.push({
              day: d,
              post: post?.name ?? postId,
              type: shiftType,
              hours,
            });
          }
        }
      }
    }
  }

  const totalHours = myShifts.reduce((sum, s) => sum + s.hours, 0);

  const monthSelector = (
    <Select
      value={`${year}-${month}`}
      onValueChange={(v) => v && goToMonth(v)}
    >
      <SelectTrigger className="h-9 w-48">
        <SelectValue>
          {(val) => {
            const [y, m] = (val as string).split("-").map(Number);
            if (!y || !m) return val;
            return `${MONTH_NAMES[m - 1]} ${y}`;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {monthOptions.map((m) => (
          <SelectItem key={m.key} value={m.key}>
            {MONTH_NAMES[m.month - 1]} {m.year}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (!schedule) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">
            {MONTH_NAMES[month - 1]} {year}
          </h1>
          {monthSelector}
        </div>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Расписание на этот месяц ещё не опубликовано.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6" ref={printRef}>
      <PrintStyles />
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap print-hide-controls">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-semibold">
            {MONTH_NAMES[month - 1]} {year}
          </h1>
          {monthSelector}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-sm">
            {totalHours}ч / {myShifts.length} смен
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExportOpen(true)}
            className="gap-1.5"
          >
            <FileDown className="h-4 w-4" />
            <span className="hidden sm:inline">Экспорт PDF</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={!schedule}
            className="gap-1.5"
            onClick={() => {
              if (!schedule) return;
              const csv = buildScheduleCsv(
                year,
                month,
                schedule,
                posts,
                normHours ?? null
              );
              downloadTextFile(
                csv,
                `grafik_${year}_${String(month).padStart(2, "0")}.csv`,
                "text/csv;charset=utf-8"
              );
            }}
          >
            <Table className="h-4 w-4" />
            <span className="hidden sm:inline">Excel (CSV)</span>
          </Button>
        </div>
      </div>

      <div className="print-title hidden print:block text-xl font-semibold mb-2">
        Расписание — {MONTH_NAMES[month - 1]} {year}
        {activeHighlight && (
          <span className="text-base font-normal"> · выделено: {activeHighlight}</span>
        )}
      </div>

      <Tabs
        value={viewMode}
        onValueChange={(v) => v && setViewMode(v as typeof viewMode)}
      >
        <TabsList className="mb-4 print-hide-controls">
          <TabsTrigger value="calendar" className="gap-1.5">
            <CalendarDays className="h-4 w-4" />
            <span className="hidden sm:inline">Календарь</span>
          </TabsTrigger>
          <TabsTrigger value="list" className="gap-1.5">
            <List className="h-4 w-4" />
            <span className="hidden sm:inline">Список</span>
          </TabsTrigger>
          <TabsTrigger value="table" className="gap-1.5">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Таблица</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calendar">
          <CalendarView
            year={year}
            month={month}
            numDays={numDays}
            myShifts={myShifts}
          />
        </TabsContent>

        <TabsContent value="list">
          <ListView myShifts={myShifts} year={year} month={month} />
        </TabsContent>

        <TabsContent value="table">
          <TableView
            year={year}
            month={month}
            numDays={numDays}
            schedule={schedule}
            posts={posts}
            highlightName={tableHighlight}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Экспорт расписания в PDF</DialogTitle>
            <DialogDescription>
              Будет напечатана таблица со всеми сотрудниками. В диалоге печати
              выберите «Сохранить как PDF».
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="export-mode"
                  checked={exportMode === "none"}
                  onChange={() => setExportMode("none")}
                />
                Без выделения фамилии
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="export-mode"
                  checked={exportMode === "highlight"}
                  onChange={() => setExportMode("highlight")}
                />
                Выделить фамилию
              </label>
            </div>
            {exportMode === "highlight" && (
              <div className="space-y-1.5 pl-6">
                <Select
                  value={exportName}
                  onValueChange={(v) => v && setExportName(v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Выберите фамилию…" />
                  </SelectTrigger>
                  <SelectContent>
                    {employeeName && (
                      <SelectItem value={employeeName}>
                        Моя фамилия ({employeeName})
                      </SelectItem>
                    )}
                    {allEmployeeNames
                      .filter((n) => n !== employeeName)
                      .map((n) => (
                        <SelectItem key={n} value={n}>
                          {n}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleExport}
              disabled={exportMode === "highlight" && !exportName}
            >
              Экспортировать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body { background: white !important; }
  .print-hide-controls,
  nav, header, aside,
  [data-slot="toaster"],
  [role="dialog"] { display: none !important; }
  .print-schedule-table { font-size: 10px !important; }
  .print-schedule-table table { width: 100% !important; }
  .schedule-table-wrap {
    max-height: none !important;
    overflow: visible !important;
    border: 0 !important;
  }
  .schedule-table-wrap thead th,
  .schedule-table-wrap tbody td {
    position: static !important;
    left: auto !important;
    top: auto !important;
    z-index: auto !important;
    box-shadow: none !important;
  }
  .print-highlight {
    background: #fde68a !important;
    color: #000 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-weight: 700 !important;
  }
}
`;

function PrintStyles() {
  return <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />;
}

function CalendarView({
  year,
  month,
  numDays,
  myShifts,
}: {
  year: number;
  month: number;
  numDays: number;
  myShifts: { day: number; post: string; type: string; hours: number }[];
}) {
  const shiftByDay = new Map<number, typeof myShifts>();
  for (const s of myShifts) {
    const arr = shiftByDay.get(s.day) || [];
    arr.push(s);
    shiftByDay.set(s.day, arr);
  }

  const firstDow = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= numDays; d++) cells.push(d);

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const todayDay = isCurrentMonth ? today.getDate() : -1;

  return (
    <div>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground mb-0.5">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-0.5">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-[1px]">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="h-14 sm:h-16" />;
          }
          const shifts = shiftByDay.get(day);
          const weekend = isWeekend(year, month, day);
          const isToday = day === todayDay;

          return (
            <div
              key={day}
              className={`h-14 sm:h-16 border rounded p-0.5 sm:p-1 text-[11px] flex flex-col overflow-hidden ${
                weekend ? "bg-red-950/10" : ""
              } ${shifts ? "ring-1 ring-primary/40 bg-primary/5" : ""} ${
                isToday ? "border-primary" : ""
              }`}
            >
              <span
                className={`text-[11px] font-semibold leading-none ${
                  weekend ? "text-red-400" : ""
                } ${isToday ? "text-primary" : ""}`}
              >
                {day}
              </span>
              <div className="flex flex-col gap-0 mt-auto min-w-0">
                {shifts?.map((s, j) => (
                  <span
                    key={j}
                    className="text-[9px] sm:text-[10px] leading-tight text-primary truncate"
                  >
                    {s.post}{s.type && ` (${s.type})`}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RestGap({ days }: { days: number }) {
  if (days <= 0) return null;
  const opacity = Math.min(days / 5, 1);
  return (
    <div className="flex items-center gap-1.5 px-3 py-1">
      <div className="flex gap-0.5">
        {Array.from({ length: days }, (_, i) => {
          const o = 0.15 + ((i + 1) / days) * 0.55 * opacity;
          return (
            <div
              key={i}
              className="w-2 h-2 rounded-sm"
              style={{ backgroundColor: `oklch(0.65 0.15 250 / ${o})` }}
            />
          );
        })}
      </div>
      <span className="text-[10px] text-muted-foreground">
        {days} {days === 1 ? "выходной" : days < 5 ? "выходных" : "выходных"}
      </span>
    </div>
  );
}

function ListView({
  myShifts,
  year,
  month,
}: {
  myShifts: { day: number; post: string; type: string; hours: number }[];
  year: number;
  month: number;
}) {
  if (myShifts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Нет смен в этом месяце.
        </CardContent>
      </Card>
    );
  }

  const items: { kind: "shift"; shift: typeof myShifts[0]; idx: number }[] | { kind: "gap"; days: number }[] = [];
  const result: ({ kind: "shift"; shift: typeof myShifts[0]; idx: number } | { kind: "gap"; days: number })[] = [];

  for (let i = 0; i < myShifts.length; i++) {
    if (i > 0) {
      const gap = myShifts[i].day - myShifts[i - 1].day - 1;
      if (gap > 0) {
        result.push({ kind: "gap", days: gap });
      }
    }
    result.push({ kind: "shift", shift: myShifts[i], idx: i });
  }

  return (
    <div className="rounded-md border divide-y">
      {result.map((item, i) => {
        if (item.kind === "gap") {
          return <RestGap key={`gap-${i}`} days={item.days} />;
        }
        const s = item.shift;
        const date = new Date(year, month - 1, s.day);
        const dowIdx = (date.getDay() + 6) % 7;
        const dowFull = DAY_NAMES_FULL[dowIdx];
        const weekend = date.getDay() === 0 || date.getDay() === 6;

        return (
          <div
            key={item.idx}
            className={`flex items-center gap-3 px-3 py-2 text-sm ${
              weekend ? "bg-red-950/10" : ""
            }`}
          >
            <span className={`shrink-0 font-semibold ${weekend ? "text-red-400" : ""}`}>
              {dowFull} {s.day}
            </span>
            <span className="flex-1 font-medium truncate">{s.post}</span>
            {s.type && (
              <Badge variant="outline" className="text-[10px] shrink-0">
                {s.type === "с" ? "24ч" : s.type === "д" ? "день" : "ночь"}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground w-8 text-right shrink-0">{s.hours}ч</span>
          </div>
        );
      })}
    </div>
  );
}

function TableView({
  year,
  month,
  numDays,
  schedule,
  posts,
  highlightName,
}: {
  year: number;
  month: number;
  numDays: number;
  schedule: Schedule;
  posts: Post[];
  highlightName: string | null;
}) {
  function hasMyShift(dayData: Record<string, string[]>): boolean {
    if (!highlightName) return false;
    return Object.values(dayData).some((people) =>
      people.some((p) => p.replace(/\([сдн]\)$/, "") === highlightName)
    );
  }

  function isMyName(person: string): boolean {
    if (!highlightName) return false;
    return person.replace(/\([сдн]\)$/, "") === highlightName;
  }

  /**
   * Сплошной фон для липких ячеек/строки. Возвращаем CSS-цвет, а не tailwind-класс,
   * чтобы избежать любых каскадных конфликтов и гарантированно перекрыть фамилии.
   */
  function rowColors(myDay: boolean, weekend: boolean) {
    if (myDay) {
      return {
        sticky: "var(--sched-sticky-mine)",
        row: "var(--sched-row-mine)",
        text: "var(--sched-text-mine)",
      };
    }
    if (weekend) {
      return {
        sticky: "var(--sched-sticky-weekend)",
        row: "var(--sched-row-weekend)",
        text: "var(--sched-text-weekend)",
      };
    }
    return {
      sticky: "var(--sched-sticky-default)",
      row: "transparent",
      text: "var(--card-foreground)",
    };
  }

  return (
    /*
     * Обёртке отдаём СОБСТВЕННЫЙ вертикальный скролл — иначе `sticky top`
     * цепляется к ней самой, а скролл-то у окна → шапка никогда не «доходит» до верха.
     * Палитра задаётся CSS-переменными, чтобы у липких ячеек был железно сплошной фон
     * (Safari + border-collapse раньше пропускали sticky на <th>, переходим на border-separate).
     */
    <div
      className="schedule-table-wrap relative overflow-auto max-h-[calc(100vh-13rem)] rounded-md border print-schedule-table"
      style={
        {
          /*
           * Light theme — мягкие фоны на основе card/muted сайта.
           * Dark theme значения переопределяются через `.dark .schedule-table-wrap` ниже.
           */
          ["--sched-sticky-default" as string]: "var(--card)",
          ["--sched-sticky-weekend" as string]: "color-mix(in oklch, var(--muted) 75%, var(--destructive) 25%)",
          ["--sched-sticky-mine" as string]: "color-mix(in oklch, var(--card) 25%, var(--primary) 75%)",
          ["--sched-row-weekend" as string]: "color-mix(in oklch, transparent 75%, var(--destructive) 25%)",
          ["--sched-row-mine" as string]: "color-mix(in oklch, transparent 35%, var(--primary) 65%)",
          ["--sched-text-default" as string]: "var(--card-foreground)",
          ["--sched-text-weekend" as string]: "var(--card-foreground)",
          ["--sched-text-mine" as string]: "var(--primary-foreground)",
          ["--sched-head-bg" as string]: "var(--muted)",
          ["--sched-head-text" as string]: "var(--foreground)",
          ["--sched-head-shadow" as string]: "rgba(0,0,0,0.12)",
          ["--sched-col-shadow" as string]: "rgba(0,0,0,0.1)",
        } as React.CSSProperties
      }
    >
      <style>{`
        .dark .schedule-table-wrap {
          /*
           * Липкие ячейки берут цвет светлее основного card —
           * иначе при горизонтальной прокрутке сливаются с фоном таблицы.
           */
          --sched-sticky-default: color-mix(in oklch, var(--card) 60%, var(--muted) 40%);
          /* Выходные — едва уловимый тёплый оттенок. */
          --sched-sticky-weekend: color-mix(in oklch, var(--sched-sticky-default) 96%, var(--destructive) 4%);
          --sched-row-weekend: color-mix(in oklch, transparent 98%, var(--destructive) 2%);
          --sched-text-weekend: var(--card-foreground);
          /* Своя смена — едва различимая голубая дымка. */
          --sched-sticky-mine: color-mix(in oklch, var(--sched-sticky-default) 92%, var(--primary) 8%);
          --sched-row-mine: color-mix(in oklch, transparent 95%, var(--primary) 5%);
          --sched-text-mine: var(--foreground);
          --sched-head-bg: color-mix(in oklch, var(--card) 50%, var(--muted) 50%);
          --sched-head-text: var(--foreground);
          --sched-head-shadow: rgba(0,0,0,0.55);
          --sched-col-shadow: rgba(0,0,0,0.45);
          /* Подсветка ячеек со «своей» сменой. */
          --sched-mine-cell: color-mix(in oklch, transparent 94%, var(--primary) 6%);
          --sched-mine-ring: oklch(0.85 0.18 95);
        }
        .schedule-table-wrap {
          --sched-mine-cell: color-mix(in oklch, transparent 92%, var(--primary) 8%);
          --sched-mine-ring: oklch(0.78 0.18 90);
        }
      `}</style>
      <table
        className="w-full min-w-max text-xs border-separate"
        style={{ borderSpacing: 0 }}
      >
        <thead>
          <tr>
            <th
              className="px-2 py-1 text-left sticky left-0 top-0 z-50 whitespace-nowrap border-b border-r"
              style={{
                background: "var(--sched-head-bg)",
                color: "var(--sched-head-text)",
                boxShadow: "4px 0 10px -4px var(--sched-head-shadow)",
              }}
            >
              Дата · ДН
            </th>
            {posts.map((p) => (
              <th
                key={p.id}
                className="px-2 py-1 whitespace-nowrap sticky top-0 z-40 border-b border-r"
                style={{
                  background: "var(--sched-head-bg)",
                  color: "var(--sched-head-text)",
                  boxShadow: "0 4px 6px -4px var(--sched-head-shadow)",
                }}
              >
                {p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: numDays }, (_, i) => i + 1).map((d) => {
            const date = new Date(year, month - 1, d);
            const dow = DAY_NAMES[(date.getDay() + 6) % 7];
            const weekend = date.getDay() === 0 || date.getDay() === 6;
            const dayData = schedule[String(d)] || {};
            const myDay = hasMyShift(dayData);
            const colors = rowColors(myDay, weekend);

            return (
              <tr key={d} style={{ background: colors.row, color: colors.text }}>
                <td
                  className="px-2 py-1 font-medium sticky left-0 z-30 whitespace-nowrap border-r border-b"
                  style={{
                    background: colors.sticky,
                    color: colors.text,
                    boxShadow: "4px 0 10px -4px var(--sched-col-shadow)",
                  }}
                >
                  <span className="tabular-nums">
                    {String(d).padStart(2, "0")}.{String(month).padStart(2, "0")}
                  </span>
                  <span className="opacity-60 ml-1.5">{dow}</span>
                </td>
                {posts.map((p) => {
                  const people = dayData[p.id] || [];
                  const cellHasMe = people.some(isMyName);
                  return (
                    <td
                      key={p.id}
                      className="px-2 py-1 border-r border-b relative"
                      style={
                        cellHasMe
                          ? {
                              background: "var(--sched-mine-cell)",
                              boxShadow:
                                "inset 0 0 0 4px var(--sched-mine-ring)",
                            }
                          : undefined
                      }
                    >
                      {people.length > 0
                        ? people.map((person, idx) => {
                            const mine = isMyName(person);
                            return (
                              <div
                                key={idx}
                                className={
                                  mine
                                    ? "font-semibold print-highlight"
                                    : ""
                                }
                                style={
                                  mine
                                    ? { color: "var(--foreground)" }
                                    : undefined
                                }
                              >
                                {person}
                              </div>
                            );
                          })
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
