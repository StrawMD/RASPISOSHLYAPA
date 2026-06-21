"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pin } from "lucide-react";
import { FixedSlotsEditor } from "./fixed-slots-editor";

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

export default function FixedSlotsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <Pin className="h-7 w-7" />
          Фиксированные смены
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Смены, которые солвер обязан сохранить при генерации. На суточных
          постах указывайте тип: <span className="font-mono text-xs">(с)</span>,{" "}
          <span className="font-mono text-xs">(д)</span> или{" "}
          <span className="font-mono text-xs">(н)</span>. Сохранять может только
          администратор.
        </p>
      </div>

      <div className="grid max-w-md gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Год</Label>
          <Select
            value={String(year)}
            onValueChange={(v) => v && setYear(parseInt(v, 10))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[2025, 2026, 2027].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Месяц</Label>
          <Select
            value={String(month)}
            onValueChange={(v) => v && setMonth(parseInt(v, 10))}
          >
            <SelectTrigger>
              <SelectValue>
                {(val) =>
                  MONTH_NAMES[parseInt(val as string, 10) - 1] ?? val
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, i) => (
                <SelectItem key={name} value={String(i + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <FixedSlotsEditor year={year} month={month} />
    </div>
  );
}
