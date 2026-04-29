"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  Settings2,
  Shield,
  LogOut,
  User,
  Menu,
} from "lucide-react";

const EMPLOYEE_NAV = [
  { href: "/schedule", label: "Расписание", icon: CalendarDays },
  { href: "/preferences", label: "Предпочтения", icon: Settings2 },
];

export function Header() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAdmin =
    session?.user?.role === "admin" ||
    session?.user?.role === "schedule_manager";

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center gap-4 px-4">
        <Link
          href="/schedule"
          className="font-semibold text-sm sm:text-base whitespace-nowrap"
        >
          График смен БОТ ОЛД
        </Link>

        <nav className="hidden md:flex items-center gap-1 ml-4">
          {EMPLOYEE_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                  active
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors",
                pathname.startsWith("/admin")
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <Shield className="h-4 w-4" />
              Управление
            </Link>
          )}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm hover:bg-muted transition-colors outline-none">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">{session?.user?.name}</span>
              <Menu className="h-4 w-4 md:hidden" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                disabled
                className="text-xs text-muted-foreground"
              >
                {session?.user?.name} ({session?.user?.role})
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isAdmin && (
                <DropdownMenuItem
                  className="md:hidden"
                  onClick={() => (window.location.href = "/admin")}
                >
                  <Shield className="h-4 w-4 mr-2" />
                  Управление
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/login" })}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
