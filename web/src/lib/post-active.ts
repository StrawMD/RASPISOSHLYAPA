/**
 * Активен ли пост хоть где-то в расписании.
 *
 * Отключённые посты (неактивны и в будни, и в выходные, и без явных
 * активных дней/дней недели) скрываются из опросника и редактора, чтобы
 * сломанные/выведенные из эксплуатации аппараты (напр. «Тошиба 1 корп»)
 * нигде не маячили. Управление постами в админке этим фильтром не
 * затрагивается — там видны все.
 */
export function isPostActive(p: {
  weekdayActive: boolean;
  weekendActive: boolean;
  activeWeekdays?: string | null;
  specificDays?: string | null;
}): boolean {
  if (p.weekdayActive || p.weekendActive) return true;
  const len = (s?: string | null) => {
    try {
      const a = JSON.parse(s || "[]");
      return Array.isArray(a) ? a.length : 0;
    } catch {
      return 0;
    }
  };
  return len(p.activeWeekdays) > 0 || len(p.specificDays) > 0;
}
