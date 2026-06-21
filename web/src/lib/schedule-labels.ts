import { parseLabel } from "@/lib/schedule-compliance";
import type { FixedSlotsMap } from "@/lib/validate-fixed-slots";

export type ShiftKind = "full" | "day" | "night";

/** Собрать метку ячейки для 12ч или 24ч поста. */
export function formatScheduleLabel(
  name: string,
  shiftHours: number,
  kind?: ShiftKind,
): string {
  if (shiftHours === 24) {
    const k = kind ?? "day";
    if (k === "full") return `${name}(с)`;
    if (k === "night") return `${name}(н)`;
    return `${name}(д)`;
  }
  return name;
}

export { parseLabel };

/** Часы по сотрудникам из карты расписания/фиксов. */
export function computeEmployeeHoursFromSchedule(
  schedule: FixedSlotsMap,
): Record<string, number> {
  const hours: Record<string, number> = {};
  for (const byPost of Object.values(schedule)) {
    for (const [, labels] of Object.entries(byPost)) {
      for (const label of labels) {
        const { name, hours: h } = parseLabel(label);
        hours[name] = (hours[name] ?? 0) + h;
      }
    }
  }
  return hours;
}

/** Применить одну правку к карте фиксов (локально, до валидации на сервере). */
export function applyFixedSlotEdit(
  schedule: FixedSlotsMap,
  day: number,
  postId: string,
  editType: "assign" | "remove" | "swap",
  oldValue: string | null,
  newValue: string | null,
): FixedSlotsMap {
  const ds = String(day);
  const next: FixedSlotsMap = JSON.parse(JSON.stringify(schedule));
  if (!next[ds]) next[ds] = {};
  const cell = [...(next[ds][postId] ?? [])];

  if (editType === "assign" && newValue) {
    cell.push(newValue);
  } else if (editType === "remove" && oldValue) {
    const i = cell.indexOf(oldValue);
    if (i >= 0) cell.splice(i, 1);
  } else if (editType === "swap" && oldValue && newValue) {
    const i = cell.indexOf(oldValue);
    if (i >= 0) cell[i] = newValue;
  }

  if (cell.length > 0) next[ds][postId] = cell;
  else {
    delete next[ds][postId];
    if (Object.keys(next[ds]).length === 0) delete next[ds];
  }
  return next;
}

export type FixedEditOp = {
  day: number;
  postId: string;
  editType: "assign" | "remove" | "swap";
  oldValue: string | null;
  newValue: string | null;
};

export function inverseFixedEdit(op: FixedEditOp): FixedEditOp {
  if (op.editType === "assign")
    return { ...op, editType: "remove", oldValue: op.newValue, newValue: null };
  if (op.editType === "remove")
    return { ...op, editType: "assign", oldValue: null, newValue: op.oldValue };
  return { ...op, oldValue: op.newValue, newValue: op.oldValue };
}
