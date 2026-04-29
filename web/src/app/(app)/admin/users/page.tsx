"use client";

import { useState, useEffect, useCallback } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Trash2, Key, UserCog } from "lucide-react";

type UserRow = {
  id: string;
  login: string;
  role: string;
  employeeId: string | null;
  employee: { name: string } | null;
  createdAt: string;
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  schedule_manager: "Ответственный",
  employee: "Сотрудник",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [employees, setEmployees] = useState<{ id: string; name: string }[]>([]);
  const [newLogin, setNewLogin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("employee");
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(await res.json());
  }, []);

  const loadEmployees = useCallback(async () => {
    const res = await fetch("/api/admin/employees");
    if (res.ok) {
      const data = await res.json();
      setEmployees(data.map((e: { id: string; name: string }) => ({ id: e.id, name: e.name })));
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadEmployees();
  }, [loadUsers, loadEmployees]);

  async function createUser() {
    if (!newLogin || !newPassword) {
      toast.error("Заполните логин и пароль");
      return;
    }
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        login: newLogin,
        password: newPassword,
        role: newRole,
        employeeId: newEmployeeId || null,
      }),
    });
    if (res.ok) {
      toast.success("Пользователь создан");
      setNewLogin("");
      setNewPassword("");
      setNewRole("employee");
      setNewEmployeeId("");
      setDialogOpen(false);
      loadUsers();
    } else {
      const data = await res.json();
      toast.error(data.error || "Ошибка");
    }
  }

  async function changeRole(id: string, role: string) {
    const res = await fetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, role }),
    });
    if (res.ok) {
      toast.success("Роль изменена");
      loadUsers();
    }
  }

  async function resetPassword(id: string) {
    const pwd = prompt("Новый пароль:");
    if (!pwd) return;
    const res = await fetch("/api/admin/users", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, newPassword: pwd }),
    });
    if (res.ok) toast.success("Пароль изменён");
  }

  async function deleteUser(id: string) {
    const res = await fetch(`/api/admin/users?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Удалён");
      loadUsers();
    }
  }

  const linkedEmployeeIds = new Set(users.map((u) => u.employeeId).filter(Boolean));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Пользователи</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger className={buttonVariants()}>
            <Plus className="h-4 w-4 mr-1" />
            Создать
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новый пользователь</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Логин</Label>
                <Input
                  value={newLogin}
                  onChange={(e) => setNewLogin(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Пароль</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Роль</Label>
                <Select
                  value={newRole}
                  onValueChange={(v) => v && setNewRole(v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Сотрудник</SelectItem>
                    <SelectItem value="schedule_manager">
                      Ответственный
                    </SelectItem>
                    <SelectItem value="admin">Администратор</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Привязка к сотруднику</Label>
                <Select
                  value={newEmployeeId || "__none"}
                  onValueChange={(v) =>
                    v && setNewEmployeeId(v === "__none" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Не привязан</SelectItem>
                    {employees
                      .filter((e) => !linkedEmployeeIds.has(e.id))
                      .map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={createUser} className="w-full">
                Создать
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border divide-y">
        {users.map((u) => (
          <div key={u.id} className="flex items-center justify-between px-3 py-1.5 gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0">
              <UserCog className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium">{u.login}</span>
              <Badge
                variant={u.role === "admin" ? "default" : u.role === "schedule_manager" ? "secondary" : "outline"}
                className="text-[10px]"
              >
                {ROLE_LABELS[u.role] ?? u.role}
              </Badge>
              {u.employee && (
                <span className="text-xs text-muted-foreground">
                  → {u.employee.name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Select value={u.role} onValueChange={(v) => v && changeRole(u.id, v)}>
                <SelectTrigger className="w-32 h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Сотрудник</SelectItem>
                  <SelectItem value="schedule_manager">Ответственный</SelectItem>
                  <SelectItem value="admin">Администратор</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => resetPassword(u.id)}>
                <Key className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => deleteUser(u.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
