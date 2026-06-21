"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  Users,
  Monitor,
  CalendarDays,
  Sparkles,
  History,
  FileEdit,
  ClipboardList,
  ClipboardCheck,
  Palmtree,
  ArrowLeft,
  Pin,
  SlidersHorizontal,
  Grid3x3,
} from "lucide-react";

const ADMIN_NAV = [
  { href: "/admin", label: "Обзор", icon: ClipboardList, exact: true },
  { href: "/admin/preferences", label: "Сбор предпочтений", icon: ClipboardCheck },
  { href: "/admin/affinity", label: "Матрица аппаратов", icon: Grid3x3 },
  { href: "/admin/generate", label: "Генерация", icon: Sparkles },
  { href: "/admin/settings", label: "Веса солвера", icon: SlidersHorizontal },
  { href: "/admin/fixed-slots", label: "Фикс. слоты", icon: Pin },
  { href: "/admin/versions", label: "Версии", icon: History },
  { href: "/admin/schedule/edit", label: "Редактор", icon: FileEdit },
  { href: "/admin/employees", label: "Сотрудники", icon: Users },
  { href: "/admin/posts", label: "Аппараты", icon: Monitor },
  { href: "/admin/vacations", label: "Отпуска", icon: Palmtree },
  { href: "/admin/holidays", label: "Праздники", icon: CalendarDays },
  { href: "/admin/users", label: "Пользователи", icon: Users },
  { href: "/admin/audit", label: "Журнал", icon: History },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r bg-muted/30 p-4 gap-1">
      <Link
        href="/schedule"
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4 px-3 py-1.5"
      >
        <ArrowLeft className="h-4 w-4" />
        К расписанию
      </Link>
      {ADMIN_NAV.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              active
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </aside>
  );
}
