/**
 * Seed script: imports data from the old JSON files into SQLite.
 * Also creates the initial admin account.
 *
 * Usage: npx tsx scripts/seed.ts
 */

import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

const DATA_DIR = join(__dirname, "../../data");

function readJson<T>(filename: string, fallback: T): T {
  const path = join(DATA_DIR, filename);
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function main() {
  console.log("Seeding database...\n");

  // 1. Posts
  const postsRaw = readJson<
    {
      id: string;
      name: string;
      shift_hours?: number;
      staff_required?: number;
      weekday_active?: boolean;
      weekend_active?: boolean;
    }[]
  >("posts.json", []);

  function inferModality(id: string, name: string): string {
    const lower = (id + " " + name).toLowerCase();
    if (lower.includes("мрт") || lower.includes("mrt")) return "МРТ";
    if (lower.includes("кт") || lower.includes("kt") || lower.includes("тошиба") || lower.includes("toshiba") || lower.includes("сск") || lower.includes("ssk") || lower.includes("ge") || lower.includes("siemens")) return "КТ";
    return "";
  }

  for (let i = 0; i < postsRaw.length; i++) {
    const p = postsRaw[i];
    const modality = inferModality(p.id, p.name);
    const shiftHours = p.shift_hours ?? 12;
    const staffRequired = p.staff_required ?? 1;
    let staffRequiredDay: number | null = null;
    let staffRequiredNight: number | null = null;
    if (shiftHours === 24) {
      if (p.id === "ssk1") { staffRequiredDay = 2; staffRequiredNight = 1; }
      else if (p.id === "kt_pb") { staffRequiredDay = 1; staffRequiredNight = 1; }
      else { staffRequiredDay = staffRequired; staffRequiredNight = staffRequired; }
    }

    await prisma.post.upsert({
      where: { id: p.id },
      update: {
        name: p.name,
        shiftHours,
        staffRequired,
        staffRequiredDay,
        staffRequiredNight,
        modality,
        weekdayActive: p.weekday_active ?? true,
        weekendActive: p.weekend_active ?? false,
        sortOrder: i,
      },
      create: {
        id: p.id,
        name: p.name,
        shiftHours,
        staffRequired,
        staffRequiredDay,
        staffRequiredNight,
        modality,
        weekdayActive: p.weekday_active ?? true,
        weekendActive: p.weekend_active ?? false,
        sortOrder: i,
      },
    });
  }
  console.log(`  Posts: ${postsRaw.length}`);

  // 2. Employees
  const empsRaw = readJson<
    {
      name: string;
      rate?: number;
      max_rate?: number;
      seniority?: number;
      hospital_start_year?: number | null;
      career_start_year?: number | null;
      allowed_posts?: string[];
    }[]
  >("employees.json", []);

  const employeeMap: Record<string, string> = {};

  const allPosts = await prisma.post.findMany();
  const postModalityMap: Record<string, string> = {};
  for (const p of allPosts) postModalityMap[p.id] = p.modality;
  const has24hPost = new Set(allPosts.filter(p => p.shiftHours === 24 && p.modality === "КТ").map(p => p.id));

  for (const e of empsRaw) {
    const allowed = e.allowed_posts ?? [];
    const mods = new Set<string>();
    let can24h = false;
    for (const pid of allowed) {
      const mod = postModalityMap[pid];
      if (mod) mods.add(mod);
      if (has24hPost.has(pid)) can24h = true;
    }

    const emp = await prisma.employee.upsert({
      where: { name: e.name },
      update: {
        rate: e.rate ?? 1.0,
        maxRate: e.max_rate ?? 1.5,
        seniority: e.seniority ?? 0,
        hospitalStartYear: e.hospital_start_year ?? null,
        careerStartYear: e.career_start_year ?? null,
        allowedPosts: JSON.stringify(allowed),
        modalities: JSON.stringify(Array.from(mods)),
        can24h,
      },
      create: {
        name: e.name,
        rate: e.rate ?? 1.0,
        maxRate: e.max_rate ?? 1.5,
        seniority: e.seniority ?? 0,
        hospitalStartYear: e.hospital_start_year ?? null,
        careerStartYear: e.career_start_year ?? null,
        allowedPosts: JSON.stringify(allowed),
        modalities: JSON.stringify(Array.from(mods)),
        can24h,
      },
    });
    employeeMap[e.name] = emp.id;
  }
  console.log(`  Employees: ${empsRaw.length}`);

  // 3. Holidays
  const holidaysRaw = readJson<Record<string, string[]>>("holidays.json", {});
  let holidayCount = 0;
  for (const [yearStr, dates] of Object.entries(holidaysRaw)) {
    const year = parseInt(yearStr);
    for (const d of dates) {
      await prisma.holiday.upsert({
        where: { date: d },
        update: { year },
        create: { date: d, year },
      });
      holidayCount++;
    }
  }
  console.log(`  Holidays: ${holidayCount}`);

  // 4. Admin account (linked to Соломка)
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123";
  const adminHash = await hash(adminPassword, 12);
  const solomkaId = employeeMap["Соломка"] ?? null;

  await prisma.user.upsert({
    where: { login: "admin" },
    update: { passwordHash: adminHash, role: "admin", employeeId: solomkaId },
    create: {
      login: "admin",
      passwordHash: adminHash,
      role: "admin",
      employeeId: solomkaId,
    },
  });
  console.log(`\n  Admin account: login=admin, password=${adminPassword}, employee=${solomkaId ? "Соломка" : "(not found)"}`);
  console.log("  (Change the password after first login!)\n");

  console.log("Done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
