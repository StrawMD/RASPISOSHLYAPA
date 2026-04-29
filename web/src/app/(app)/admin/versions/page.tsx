"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Eye, Upload, Archive, Trash2, FileText } from "lucide-react";
import Link from "next/link";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

type Version = {
  id: string;
  versionNumber: number;
  name: string | null;
  status: string;
  objectiveValue: number | null;
  createdAt: string;
  createdBy: string | null;
  editCount: number;
};

export default function VersionsPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(false);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    const res = await fetch(
      `/api/schedule/versions?year=${year}&month=${month}`
    );
    if (res.ok) {
      setVersions(await res.json());
    }
    setLoading(false);
  }, [year, month]);

  useEffect(() => {
    loadVersions();
  }, [loadVersions]);

  async function doAction(id: string, action: string, extraBody?: Record<string, unknown>) {
    const res = await fetch("/api/schedule/versions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, ...extraBody }),
    });
    if (res.ok) {
      toast.success(
        action === "publish"
          ? "Опубликовано"
          : action === "archive"
          ? "Архивировано"
          : action === "delete"
          ? "Удалено"
          : "Готово"
      );
      loadVersions();
    } else {
      const data = await res.json();
      toast.error(data.error || "Ошибка");
    }
  }

  const statusLabel = (s: string) =>
    s === "published"
      ? "Опубликован"
      : s === "archived"
      ? "Архив"
      : "Черновик";

  const statusVariant = (s: string): "default" | "secondary" | "outline" =>
    s === "published" ? "default" : s === "archived" ? "secondary" : "outline";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">Версии расписания</h1>
        <div className="flex gap-2">
          <Select
            value={String(year)}
            onValueChange={(v) => v && setYear(parseInt(v))}
          >
            <SelectTrigger className="w-24">
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
          <Select
            value={String(month)}
            onValueChange={(v) => v && setMonth(parseInt(v))}
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
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      ) : versions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Нет версий за {MONTH_NAMES[month - 1]} {year}.{" "}
            <Link href="/admin/generate" className="underline">
              Сгенерируйте
            </Link>{" "}
            расписание.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {versions.map((v) => (
            <Card key={v.id}>
              <CardContent className="flex items-center justify-between py-3 px-4 gap-4 flex-wrap">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      v{v.versionNumber}
                      {v.name && ` — ${v.name}`}
                    </span>
                    <Badge variant={statusVariant(v.status)}>
                      {statusLabel(v.status)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString("ru-RU")}
                    {v.createdBy && ` · ${v.createdBy}`}
                    {v.editCount > 0 && ` · ${v.editCount} правок`}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Link
                    href={`/admin/schedule/edit?versionId=${v.id}`}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "sm" })
                    )}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    Открыть
                  </Link>
                  {v.status !== "published" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => doAction(v.id, "publish")}
                    >
                      <Upload className="h-3.5 w-3.5 mr-1" />
                      Опубликовать
                    </Button>
                  )}
                  {v.status !== "archived" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => doAction(v.id, "archive")}
                    >
                      <Archive className="h-3.5 w-3.5 mr-1" />
                      В архив
                    </Button>
                  )}
                  <Dialog>
                    <DialogTrigger className={buttonVariants({ variant: "ghost", size: "sm" })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          Удалить v{v.versionNumber}?
                        </DialogTitle>
                      </DialogHeader>
                      <p className="text-sm text-muted-foreground">
                        Это действие необратимо.
                      </p>
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="destructive"
                          onClick={() => doAction(v.id, "delete")}
                        >
                          Удалить
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
