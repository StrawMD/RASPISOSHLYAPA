#!/usr/bin/env node
/*
 * Управление сотрудниками в боевой БД.
 * Запускать ВНУТРИ контейнера: docker exec raspisoshlyapa-web-1 node /app/data/employee.cjs '<json>'
 * (Файл нужно положить в смонтированный том ./data — см. AGENTS.md.)
 *
 * Действия (единственный аргумент — JSON):
 *   {"action":"list"}
 *   {"action":"show","name":"Кан"}
 *   {"action":"upsert","name":"Кан","rate":1.0,"maxRate":1.5,
 *      "posts":["kt_2011","kt_2013"],"can24h":false,
 *      "hospitalStartYear":2019,"careerStartYear":2019,"seniority":7}
 *   {"action":"delete","name":"Ким"}
 *
 * Поля upsert необязательны, кроме name. Что не передано — у существующего не трогаем,
 * у нового берётся разумный дефолт. "posts" задаёт allowedPosts И из них выводит modalities/can24h.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function fail(msg) {
  console.error("ОШИБКА: " + msg);
  process.exit(1);
}

async function deriveFromPosts(posts) {
  const all = await prisma.post.findMany();
  const byId = new Map(all.map((p) => [p.id, p]));
  for (const pid of posts) if (!byId.has(pid)) fail(`Неизвестный пост «${pid}»`);
  const mods = new Set();
  let can24h = false;
  for (const pid of posts) {
    const p = byId.get(pid);
    if (p.modality) mods.add(p.modality);
    if (p.shiftHours === 24 && p.modality === "КТ") can24h = true;
  }
  return { modalities: Array.from(mods), can24hFromPosts: can24h };
}

async function main() {
  const raw = process.argv[2];
  if (!raw) fail("нужен JSON-аргумент. Пример: '{\"action\":\"list\"}'");
  let req;
  try { req = JSON.parse(raw); } catch (e) { fail("невалидный JSON: " + e.message); }

  const action = req.action;

  if (action === "list") {
    const emps = await prisma.employee.findMany({ orderBy: { name: "asc" } });
    console.log(`Всего: ${emps.length}`);
    for (const e of emps) {
      console.log(
        [e.name, `ставка=${e.rate}`, `потолок=${e.maxRate}`, `сутки=${e.can24h ? "да" : "нет"}`,
         e.allowedPosts].join("  ")
      );
    }
    return;
  }

  if (!req.name) fail("нужно поле name");

  if (action === "show") {
    const e = await prisma.employee.findUnique({ where: { name: req.name } });
    if (!e) fail(`сотрудник «${req.name}» не найден`);
    console.log(JSON.stringify(e, null, 2));
    return;
  }

  if (action === "delete") {
    const e = await prisma.employee.findUnique({ where: { name: req.name } });
    if (!e) fail(`сотрудник «${req.name}» не найден`);
    await prisma.preference.deleteMany({ where: { employeeId: e.id } }).catch(() => {});
    await prisma.availability.deleteMany({ where: { employeeId: e.id } }).catch(() => {});
    await prisma.employeeMonthConfig.deleteMany({ where: { employeeId: e.id } }).catch(() => {});
    await prisma.user.deleteMany({ where: { employeeId: e.id } }).catch(() => {});
    await prisma.employee.delete({ where: { id: e.id } });
    console.log(`Удалён: ${req.name} (вместе с пожеланиями/доступами)`);
    return;
  }

  if (action === "upsert") {
    const existing = await prisma.employee.findUnique({ where: { name: req.name } });
    const data = {};
    if (typeof req.rate === "number") data.rate = req.rate;
    if (typeof req.maxRate === "number") data.maxRate = req.maxRate;
    if (typeof req.seniority === "number") data.seniority = req.seniority;
    if ("hospitalStartYear" in req) data.hospitalStartYear = req.hospitalStartYear;
    if ("careerStartYear" in req) data.careerStartYear = req.careerStartYear;

    if (Array.isArray(req.posts)) {
      const { modalities, can24hFromPosts } = await deriveFromPosts(req.posts);
      data.allowedPosts = JSON.stringify(req.posts);
      data.modalities = JSON.stringify(modalities);
      data.can24h = typeof req.can24h === "boolean" ? req.can24h : can24hFromPosts;
    } else if (typeof req.can24h === "boolean") {
      data.can24h = req.can24h;
    }

    if (existing) {
      const updated = await prisma.employee.update({ where: { id: existing.id }, data });
      // targetRate не должен выходить за [rate, maxRate]
      const tr = Math.min(Math.max(updated.targetRate ?? updated.rate, updated.rate), updated.maxRate);
      if (tr !== updated.targetRate) await prisma.employee.update({ where: { id: existing.id }, data: { targetRate: tr } });
      console.log(`Обновлён: ${req.name}`);
    } else {
      const rate = data.rate ?? 1.0;
      const created = await prisma.employee.create({
        data: {
          name: req.name,
          rate,
          targetRate: rate,
          maxRate: data.maxRate ?? 1.5,
          seniority: data.seniority ?? 0,
          hospitalStartYear: data.hospitalStartYear ?? null,
          careerStartYear: data.careerStartYear ?? null,
          allowedPosts: data.allowedPosts ?? "[]",
          modalities: data.modalities ?? "[]",
          can24h: data.can24h ?? false,
        },
      });
      console.log(`Создан: ${created.name}`);
    }
    return;
  }

  fail(`неизвестное действие «${action}»`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
