/**
 * Reset all user accounts based on current Employee list.
 *
 * Rules:
 *  - login = employee surname lowercased (Russian, first word)
 *  - default password = "Боткин1!"
 *  - Соломка / Знатнова -> role=admin, password=Боткин1! (вход в админ-режиме)
 *  - everyone else      -> role=employee (вход по фамилии без пароля)
 *
 * Login lookup is case-insensitive (auth.ts lowercases input); we persist the
 * canonical lowercase form here.
 *
 * The script is idempotent — it upserts Users keyed by employeeId.  Orphan
 * users (no linked employee) are left untouched; stale user bindings to
 * deleted employees are cleaned up.
 *
 * Usage:  npx tsx scripts/reset-accounts.ts
 *
 * Общий пароль для рассылки коллегам можно задать через переменные окружения:
 *   EMPLOYEE_PASSWORD="одинпароль" ADMIN_PASSWORD="..." npx tsx scripts/reset-accounts.ts
 * или через npm-скрипт: npm run reset-accounts
 */

import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = process.env.EMPLOYEE_PASSWORD || "Боткин1!";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Боткин1!";
const ADMIN_SURNAMES = new Set(["Соломка", "Знатнова"]);
const PRIMARY_ADMIN_SURNAME = "Соломка";

function loginFromName(name: string): string {
  const firstWord = name.trim().split(/\s+/)[0] ?? name;
  return firstWord.toLowerCase();
}

async function main() {
  const employees = await prisma.employee.findMany({
    orderBy: { name: "asc" },
    include: { user: true },
  });

  console.log(`Found ${employees.length} employees`);

  let created = 0;
  let updated = 0;

  // Preload all users to check for login collisions across different
  // employees (e.g. two employees share a surname).
  const allUsers = await prisma.user.findMany();
  const userByLogin = new Map(allUsers.map((u) => [u.login, u]));

  for (const emp of employees) {
    const surname = emp.name.trim().split(/\s+/)[0] ?? emp.name;
    const isAdmin = ADMIN_SURNAMES.has(surname);
    const isPrimaryAdmin = surname === PRIMARY_ADMIN_SURNAME;

    const password = isPrimaryAdmin ? ADMIN_PASSWORD : DEFAULT_PASSWORD;
    const role = isAdmin ? "admin" : "employee";
    const login = loginFromName(emp.name);

    const passwordHash = await hash(password, 12);

    const collision = userByLogin.get(login);
    if (collision && collision.employeeId && collision.employeeId !== emp.id) {
      console.warn(
        `  ! login collision '${login}' between employees ` +
          `${collision.employeeId} and ${emp.id}, skipping`,
      );
      continue;
    }

    if (emp.user) {
      await prisma.user.update({
        where: { id: emp.user.id },
        data: {
          login,
          passwordHash,
          plaintextPassword: password,
          role,
        },
      });
      updated++;
      console.log(
        `  ~ ${emp.name.padEnd(18)} login=${login.padEnd(16)} ` +
          `role=${role.padEnd(10)} pwd=${password}`,
      );
    } else if (collision && !collision.employeeId) {
      // A dangling user with this login exists — bind to this employee.
      await prisma.user.update({
        where: { id: collision.id },
        data: {
          login,
          passwordHash,
          plaintextPassword: password,
          role,
          employeeId: emp.id,
        },
      });
      updated++;
      console.log(
        `  + bound existing user '${login}' to ${emp.name} (role=${role})`,
      );
    } else {
      await prisma.user.create({
        data: {
          login,
          passwordHash,
          plaintextPassword: password,
          role,
          employeeId: emp.id,
        },
      });
      created++;
      console.log(
        `  + ${emp.name.padEnd(18)} login=${login.padEnd(16)} ` +
          `role=${role.padEnd(10)} pwd=${password}`,
      );
    }
  }

  // Drop the legacy "admin" user if it exists and isn't linked to Соломка
  // anymore (we now log in by surname).
  const legacyAdmin = await prisma.user.findUnique({ where: { login: "admin" } });
  if (legacyAdmin) {
    const solomka = employees.find((e) => e.name.startsWith("Соломка"));
    if (solomka && legacyAdmin.employeeId === solomka.id) {
      await prisma.user.delete({ where: { id: legacyAdmin.id } });
      console.log("  - removed legacy 'admin' login (Соломка теперь логинится по фамилии)");
    }
  }

  console.log(`\nDone. Created ${created}, updated ${updated}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
