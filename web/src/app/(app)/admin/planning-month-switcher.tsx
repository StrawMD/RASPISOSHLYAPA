"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Pencil, Check, Loader2 } from "lucide-react";
import { MONTH_NAMES_RU } from "@/lib/planning-month";

interface Props {
  year: number;
  month: number;
  status: string;
  source: "setting" | "collecting" | "latest" | "fallback";
}

const STATUS_LABEL: Record<string, string> = {
  collecting: "Сбор данных",
  published: "Опубликован",
  locked: "Заблокирован",
  draft: "Черновик",
};

const SOURCE_HINT: Record<Props["source"], string> = {
  setting: "Выбрано вручную",
  collecting: "Авто: первый месяц в работе",
  latest: "Авто: самый свежий месяц",
  fallback: "Авто: следующий календарный месяц",
};

export function PlanningMonthSwitcher({ year, month, status, source }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draftYear, setDraftYear] = useState(year);
  const [draftMonth, setDraftMonth] = useState(month);
  const [isPending, startTransition] = useTransition();

  const currentYear = new Date().getFullYear();
  const yearOptions = [
    currentYear - 1,
    currentYear,
    currentYear + 1,
    currentYear + 2,
  ];
  if (!yearOptions.includes(year)) yearOptions.push(year);
  yearOptions.sort((a, b) => a - b);

  const changed = draftYear !== year || draftMonth !== month;

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraftYear(year);
      setDraftMonth(month);
    }
    setOpen(next);
  }

  function handleSave() {
    if (!changed) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        const res = await fetch("/api/admin/planning-month", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ year: draftYear, month: draftMonth }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error || "Не удалось сохранить");
          return;
        }
        toast.success(
          `Планируем ${MONTH_NAMES_RU[draftMonth - 1]} ${draftYear}`
        );
        setOpen(false);
        router.refresh();
      } catch {
        toast.error("Ошибка соединения");
      }
    });
  }

  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <span className="text-3xl md:text-4xl font-bold tracking-tight">
        {MONTH_NAMES_RU[month - 1]}
      </span>
      <span className="text-2xl md:text-3xl text-muted-foreground font-semibold">
        {year}
      </span>
      <Badge variant="outline" className="text-xs">
        {STATUS_LABEL[status] ?? status}
      </Badge>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          aria-label="Сменить планируемый месяц"
        >
          <Pencil className="h-3.5 w-3.5" />
          Сменить
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <div>
            <div className="text-sm font-medium">Планируемый месяц</div>
            <div className="text-xs text-muted-foreground">
              {SOURCE_HINT[source]}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={String(draftMonth)}
              onValueChange={(v) => v && setDraftMonth(parseInt(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(val) =>
                    MONTH_NAMES_RU[parseInt(val as string) - 1] ?? val
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MONTH_NAMES_RU.map((name, i) => (
                  <SelectItem key={i + 1} value={String(i + 1)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(draftYear)}
              onValueChange={(v) => v && setDraftYear(parseInt(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Можно планировать за 1–2 месяца вперёд. Если записи о месяце ещё нет
            — она создастся автоматически.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Отмена
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isPending || !changed}
            >
              {isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5 mr-1" />
              )}
              Сохранить
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
