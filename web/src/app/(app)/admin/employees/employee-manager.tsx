"use client";

import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Plus, Trash2, Save, ChevronDown, ChevronUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { computeTenure, yearsWord } from "@/lib/seniority";

const MODALITIES = ["КТ", "МРТ"] as const;
const PREF_LEVELS = [
  { value: "prefer", label: "Предпочитаю", color: "text-green-500" },
  { value: "neutral", label: "Нейтрально", color: "text-muted-foreground" },
  { value: "avoid", label: "Не ставить", color: "text-red-400" },
] as const;

function prefLabel(v: string) {
  const pl = PREF_LEVELS.find((o) => o.value === v);
  return <span className={pl?.color ?? ""}>{pl?.label ?? v}</span>;
}

type Employee = {
  id: string;
  name: string;
  rate: number;
  maxRate: number;
  seniority: number;
  hospitalStartYear: number | null;
  careerStartYear: number | null;
  allowedPosts: string[];
  modalities: string[];
  can24h: boolean;
  postPreferences: Record<string, string>;
};

type Post = {
  id: string;
  name: string;
  shiftHours: number;
  modality: string;
};

interface Props {
  initialEmployees: Employee[];
  posts: Post[];
}

export function EmployeeManager({ initialEmployees, posts }: Props) {
  const router = useRouter();
  const [employees, setEmployees] = useState(initialEmployees);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">Сотрудники</h1>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Поиск..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-48"
          />
          <Button onClick={addEmployee}>
            <Plus className="h-4 w-4 mr-1" />
            Добавить
          </Button>
        </div>
      </div>

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
                </div>
                {expanded ? (
                  <ChevronUp className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                )}
              </div>
              {expanded && (
                <CardContent className="space-y-4 pt-0">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                        onValueChange={(v) =>
                          v && updateLocal(emp.id, { rate: parseFloat(v) })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[0.25, 0.5, 0.75, 1.0].map((r) => (
                            <SelectItem key={r} value={String(r)}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Макс. ставки (макс. допустимая переработка)</Label>
                      <Input
                        type="number"
                        step={0.25}
                        min={0.5}
                        max={2.0}
                        value={emp.maxRate}
                        onChange={(e) =>
                          updateLocal(emp.id, {
                            maxRate: parseFloat(e.target.value),
                          })
                        }
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

                  {visiblePosts.length > 0 && (
                    <div>
                      <Label className="mb-2 block">
                        Предпочтения по аппаратам
                      </Label>
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
          <Label>Год начала в больнице</Label>
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
          <Label>Год начала карьеры</Label>
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
