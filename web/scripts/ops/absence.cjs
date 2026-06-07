#!/usr/bin/env node
/*
 * Отсутствия сотрудника на месяц (Availability.unavailableDays) —
 * жёсткое ограничение: в эти дни солвер не ставит человека.
 *
 * Запуск ВНУТРИ контейнера:
 *   docker exec raspisoshlyapa-web-1 node /app/data/absence.cjs '<json>'
 *
 * Действия:
 *   {"action":"show","year":2026,"month":7,"employee":"Кан"}
 *   {"action":"set","year":2026,"month":7,"employee":"Кан","days":[3,4,5,18]}   // заменить
 *   {"action":"add","year":2026,"month":7,"employee":"Кан","days":[20,21]}      // добавить
 *   {"action":"clear","year":2026,"month":7,"employee":"Кан"}
 */
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function fail(msg) { console.error("ОШИБКА: " + msg); process.exit(1); }
function safeJson(v, fb) { if (!v) return fb; try { return JSON.parse(v); } catch { return fb; } }

async function main() {
  const raw = process.argv[2];
  if (!raw) fail("нужен JSON-аргумент");
  let req; try { req = JSON.parse(raw); } catch (e) { fail("невалидный JSON: " + e.message); }
  const { action, year, month, employee } = req;
  if (!year || !month || !employee) fail("нужны поля year, month, employee");

  const emp = await prisma.employee.findUnique({ where: { name: employee } });
  if (!emp) fail(`сотрудник «${employee}» не найден`);

  let m = await prisma.month.findUnique({ where: { year_month: { year, month } } });
  if (!m) m = await prisma.month.create({ data: { year, month, normHours: 0, status: "collecting" } });

  const daysInMonth = new Date(year, month, 0).getDate();
  const validateDays = (arr) => {
    if (!Array.isArray(arr)) fail("days должен быть массивом чисел");
    for (const d of arr) if (!Number.isInteger(d) || d < 1 || d > daysInMonth)
      fail(`день ${d} вне диапазона 1..${daysInMonth}`);
    return Array.from(new Set(arr)).sort((a, b) => a - b);
  };

  const existing = await prisma.availability.findUnique({
    where: { employeeId_monthId: { employeeId: emp.id, monthId: m.id } },
  });

  if (action === "show") {
    console.log(JSON.stringify(safeJson(existing?.unavailableDays, []), null, 2));
    return;
  }

  let days;
  if (action === "clear") days = [];
  else if (action === "set") days = validateDays(req.days ?? []);
  else if (action === "add") {
    const cur = new Set(safeJson(existing?.unavailableDays, []));
    for (const d of validateDays(req.days ?? [])) cur.add(d);
    days = Array.from(cur).sort((a, b) => a - b);
  } else fail(`неизвестное действие «${action}»`);

  await prisma.availability.upsert({
    where: { employeeId_monthId: { employeeId: emp.id, monthId: m.id } },
    update: { unavailableDays: JSON.stringify(days) },
    create: { employeeId: emp.id, monthId: m.id, unavailableDays: JSON.stringify(days) },
  });
  console.log(`${employee}: недоступные дни ${year}-${String(month).padStart(2, "0")} = [${days.join(", ")}]`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
