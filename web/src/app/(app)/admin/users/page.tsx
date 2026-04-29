"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Save, Copy, Eye, EyeOff, RefreshCcw } from "lucide-react";

type UserRow = {
  id: string;
  login: string;
  role: string;
  employeeId: string | null;
  employee: { name: string } | null;
  plaintextPassword: string | null;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  schedule_manager: "Ответственный",
  employee: "Сотрудник",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [pendingPw, setPendingPw] = useState<Record<string, string>>({});
  const [pendingLogin, setPendingLogin] = useState<Record<string, string>>({});

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (res.ok) {
        setUsers(await res.json());
        setLoadError(null);
      } else {
        const data = await res.json().catch(() => null);
        setLoadError(
          data?.error ?? `Не удалось получить список (HTTP ${res.status})`,
        );
      }
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  async function patchUser(id: string, patch: Record<string, unknown>) {
    const res = await fetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    if (res.ok) {
      await loadUsers();
      return true;
    }
    const data = await res.json().catch(() => null);
    toast.error(data?.error ?? "Ошибка");
    return false;
  }

  async function changeRole(id: string, role: string) {
    if (await patchUser(id, { role })) {
      toast.success("Роль изменена");
    }
  }

  async function savePassword(id: string) {
    const pwd = pendingPw[id];
    if (!pwd) return;
    if (await patchUser(id, { newPassword: pwd })) {
      toast.success("Пароль изменён");
      setPendingPw((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  async function saveLogin(id: string) {
    const login = pendingLogin[id];
    if (!login) return;
    if (await patchUser(id, { login })) {
      toast.success("Логин изменён");
      setPendingLogin((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }


  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Скопировано");
    } catch {
      toast.error("Не удалось скопировать");
    }
  }

  const filtered = users.filter((u) => {
    const q = filter.toLowerCase();
    if (!q) return true;
    return (
      u.login.toLowerCase().includes(q) ||
      (u.employee?.name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">Пользователи</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <Input
            placeholder="Поиск по логину или фамилии..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-56"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPasswords((v) => !v)}
            className="gap-1.5"
          >
            {showPasswords ? (
              <>
                <EyeOff className="h-4 w-4" />
                Скрыть пароли
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" />
                Показать пароли
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={loadUsers}
            className="gap-1.5"
          >
            <RefreshCcw className="h-4 w-4" />
            Синхронизировать
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground space-y-1">
          <div>
            Учётки создаются автоматически из списка сотрудников. Логин —
            фамилия в нижнем регистре (вход нечувствителен к регистру).
            Стандартный пароль:{" "}
            <code className="font-mono bg-muted px-1 rounded">Боткин1!</code>.
          </div>
          <div>
            Администраторы:{" "}
            <code className="font-mono bg-muted px-1 rounded">соломка</code>{" "}
            (пароль <code className="font-mono">admin123</code>) и{" "}
            <code className="font-mono bg-muted px-1 rounded">знатнова</code>.
            Роль «Администратор» даёт доступ к разделу «Управление».
          </div>
        </CardContent>
      </Card>

      {loadError && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardContent className="p-3 text-sm text-destructive">
            Ошибка загрузки: {loadError}
          </CardContent>
        </Card>
      )}

      <div className="rounded-md border overflow-hidden">
        <div className="grid grid-cols-[minmax(140px,1.2fr)_minmax(120px,1fr)_minmax(130px,1fr)_minmax(180px,1.4fr)] gap-2 px-3 py-2 bg-muted/40 text-xs font-medium text-muted-foreground">
          <span>Логин</span>
          <span>Сотрудник</span>
          <span>Роль</span>
          <span>Пароль</span>
        </div>
        <div className="divide-y">
          {filtered.map((u) => {
            const pwValue = pendingPw[u.id] ?? u.plaintextPassword ?? "";
            const loginValue = pendingLogin[u.id] ?? u.login;
            const pwChanged =
              pendingPw[u.id] !== undefined &&
              pendingPw[u.id] !== (u.plaintextPassword ?? "");
            const loginChanged =
              pendingLogin[u.id] !== undefined &&
              pendingLogin[u.id] !== u.login;

            return (
              <div
                key={u.id}
                className="grid grid-cols-[minmax(140px,1.2fr)_minmax(120px,1fr)_minmax(130px,1fr)_minmax(180px,1.4fr)] gap-2 px-3 py-2 items-center text-sm"
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={loginValue}
                    onChange={(e) =>
                      setPendingLogin((prev) => ({
                        ...prev,
                        [u.id]: e.target.value,
                      }))
                    }
                    className="h-8 text-xs"
                  />
                  {loginChanged && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => saveLogin(u.id)}
                      title="Сохранить логин"
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>

                <div className="min-w-0 truncate">
                  {u.employee ? (
                    <span className="text-sm">{u.employee.name}</span>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">
                      не привязан
                    </span>
                  )}
                </div>

                <div>
                  <Select
                    value={u.role}
                    onValueChange={(v) => v && changeRole(u.id, v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue>
                        {ROLE_LABELS[u.role] ?? u.role}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="employee">Сотрудник</SelectItem>
                      <SelectItem value="schedule_manager">
                        Ответственный
                      </SelectItem>
                      <SelectItem value="admin">Администратор</SelectItem>
                    </SelectContent>
                  </Select>
                  {u.role === "admin" && (
                    <Badge variant="default" className="text-[10px] mt-1">
                      управление
                    </Badge>
                  )}
                </div>

                <div className="flex items-center gap-1 min-w-0">
                  <Input
                    type={showPasswords ? "text" : "password"}
                    value={pwValue}
                    onChange={(e) =>
                      setPendingPw((prev) => ({
                        ...prev,
                        [u.id]: e.target.value,
                      }))
                    }
                    className="h-8 text-xs font-mono"
                  />
                  {u.plaintextPassword && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 shrink-0"
                      onClick={() => copyToClipboard(u.plaintextPassword ?? "")}
                      title="Скопировать"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {pwChanged && (
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 px-2 shrink-0"
                      onClick={() => savePassword(u.id)}
                      title="Сохранить пароль"
                    >
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
          {!loading && filtered.length === 0 && !loadError && (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              {users.length === 0
                ? "Нет сотрудников — добавьте их во вкладке «Сотрудники»."
                : "Ничего не найдено по текущему фильтру."}
            </div>
          )}
          {loading && (
            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
              Загружаю…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
