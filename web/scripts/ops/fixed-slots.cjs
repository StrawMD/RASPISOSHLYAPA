#!/usr/bin/env node
/*
 * Зафиксированные смены месяца (Month.solverFixedSlots).
 * Их солвер при генерации держит как ЖЁСТКОЕ ограничение — то есть
 * "вот суточники подали смены, распредели остальных, не трогая зафиксированное".
 *
 * Запуск ВНУТРИ контейнера:
 *   docker exec raspisoshlyapa-web-1 node /app/data/fixed-slots.cjs '<json>'
 *
 * Формат слотов: { "<день>": { "<postId>": ["Фамилия" | "Фамилия(с)" | "Фамилия(д)" | "Фамилия(н)"] } }
 *   - на суточных постах (shiftHours=24) суффикс (с)/(д)/(н) ОБЯЗАТЕЛЕН;
 *   - на 12-часовых постах суффикс не нужен.
 *
 * Действия:
 *   {"action":"show","year":2026,"month":7}
 *   {"action":"merge","year":2026,"month":7,"slots":{"15":{"ssk1":["Иванов(с)"]}}}   // добавить к существующим
 *   {"action":"set","year":2026,"month":7,"slots":{...}}                              // заменить целиком
 *   {"action":"clear","year":2026,"month":7}
 *
 * После записи слотов генерацию запусти в админке (Генерация → Сгенерировать)
 * или повторной генерацией через UI — слоты будут учтены.
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function fail(msg) { console.error("ОШИБКА: " + msg); process.exit(1); }
function safeJson(v, fb) { if (!v) return fb; try { return JSON.parse(v); } catch { return fb; } }

async function validate(raw, year, month, posts, employees) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) fail("ожидается объект { день: { пост: [имена] } }");
  const daysInMonth = new Date(year, month, 0).getDate();
  const postMap = new Map(posts.map((p) => [p.id, p]));
  const empMap = new Map(employees.map((e) => [e.name, e]));
  const out = {};
  const perDay = new Map();
  for (const [dayStr, byPost] of Object.entries(raw)) {
    const day = parseInt(dayStr, 10);
    if (!Number.isFinite(day) || day < 1 || day > daysInMonth)
      fail(`некорректный день «${dayStr}» (в месяце ${daysInMonth} дн.)`);
    if (!byPost || typeof byPost !== "object" || Array.isArray(byPost))
      fail(`день ${day}: для каждого поста нужен объект со списками имён`);
    for (const [postId, labels] of Object.entries(byPost)) {
      const post = postMap.get(postId);
      if (!post) fail(`неизвестный пост «${postId}»`);
      if (!Array.isArray(labels)) fail(`день ${day}, пост ${postId}: ожидается массив строк`);
      for (const label of labels) {
        const s = String(label).trim();
        if (!s) continue;
        const m = s.match(/^(.+)\(([сдн])\)$/u);
        let baseName;
        if (post.shiftHours === 24) {
          if (!m) fail(`«${s}»: на суточном посту обязательно (с), (д) или (н)`);
          baseName = m[1];
        } else {
          baseName = m ? m[1] : s;
        }
        const emp = empMap.get(baseName);
        if (!emp) fail(`неизвестный сотрудник «${baseName}»`);
        const allowed = safeJson(emp.allowedPosts, []);
        if (!allowed.includes(postId)) fail(`«${baseName}» не допущен к посту «${postId}»`);
        const set = perDay.get(day) ?? new Set();
        if (set.has(baseName)) fail(`«${baseName}» уже зафиксирован ${day}-го (одна смена в сутки)`);
        set.add(baseName);
        perDay.set(day, set);
        const ds = String(day);
        if (!out[ds]) out[ds] = {};
        if (!out[ds][postId]) out[ds][postId] = [];
        out[ds][postId].push(s);
      }
    }
  }
  return out;
}

async function getMonth(year, month) {
  let m = await prisma.month.findUnique({ where: { year_month: { year, month } } });
  if (!m) m = await prisma.month.create({ data: { year, month, normHours: 0, status: "collecting" } });
  return m;
}

async function main() {
  const raw = process.argv[2];
  if (!raw) fail("нужен JSON-аргумент");
  let req; try { req = JSON.parse(raw); } catch (e) { fail("невалидный JSON: " + e.message); }
  const { action, year, month } = req;
  if (!year || !month) fail("нужны поля year и month");

  const m = await getMonth(year, month);

  if (action === "show") {
    console.log(JSON.stringify(safeJson(m.solverFixedSlots, {}), null, 2));
    return;
  }
  if (action === "clear") {
    await prisma.month.update({ where: { id: m.id }, data: { solverFixedSlots: "{}" } });
    console.log("Фиксы очищены");
    return;
  }
  if (action === "set" || action === "merge") {
    const posts = await prisma.post.findMany();
    const employees = await prisma.employee.findMany();
    const incoming = await validate(req.slots ?? {}, year, month, posts, employees);
    let final = incoming;
    if (action === "merge") {
      const cur = safeJson(m.solverFixedSlots, {});
      final = cur;
      for (const [d, byPost] of Object.entries(incoming)) {
        if (!final[d]) final[d] = {};
        for (const [pid, labels] of Object.entries(byPost)) {
          final[d][pid] = Array.from(new Set([...(final[d][pid] ?? []), ...labels]));
        }
      }
    }
    await prisma.month.update({ where: { id: m.id }, data: { solverFixedSlots: JSON.stringify(final) } });
    const count = Object.values(final).reduce((a, bp) => a + Object.values(bp).reduce((b, l) => b + l.length, 0), 0);
    console.log(`Записано фиксов: ${count}. Теперь запусти генерацию месяца в админке.`);
    return;
  }
  fail(`неизвестное действие «${action}»`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
