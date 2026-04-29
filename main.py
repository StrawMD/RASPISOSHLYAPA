#!/usr/bin/env python3
"""
Генератор графика смен — отделение лучевой диагностики.

Запуск:
    python main.py                   # генерация на июль 2026
    python main.py 2026 8            # генерация на август 2026
"""

from __future__ import annotations

import sys

from schedule.data import EMPLOYEES, POSTS, generate_month_config
from schedule.export import export_to_excel
from schedule.solver import ScheduleSolver


def main():
    if len(sys.argv) >= 3:
        year, month = int(sys.argv[1]), int(sys.argv[2])
    else:
        year, month = 2026, 7

    print(f"═══ Генерация графика на {month:02d}.{year} ═══\n")

    config = generate_month_config(year, month)

    print(f"  Месяц: {month:02d}.{year}")
    print(f"  Дней в месяце: {config.num_days}")
    print(f"  Норма часов (1.0 ставка): {config.norm_hours:.0f} ч")
    print(f"  Сотрудников: {len(EMPLOYEES)}")
    print(f"  Постов: {len(POSTS)}")
    print()

    for post in POSTS:
        active = config.post_active_days.get(post.id, [])
        print(f"  {post.name:22s}  {post.shift_hours}ч  ×{post.staff_required}чел  "
              f"активен {len(active):2d} дн.")
    print()

    print("Строю модель…")
    solver = ScheduleSolver(POSTS, EMPLOYEES, config)

    print("Запускаю солвер (лимит 120 сек)…\n")
    solution = solver.solve(time_limit_seconds=120)

    if solution is None:
        print("\nНе удалось найти расписание.")
        print("Попробуйте ослабить ограничения или добавить сотрудников.")
        sys.exit(1)

    outfile = f"schedule_{year}_{month:02d}.xlsx"
    export_to_excel(solution, POSTS, EMPLOYEES, config, outfile)

    print("\n═══ Сводка часов ═══")
    hours = solution["employee_hours"]
    norm = config.norm_hours
    for emp in sorted(EMPLOYEES, key=lambda e: e.name):
        actual = hours.get(emp.name, 0)
        target = norm * emp.rate
        delta = actual - target
        marker = "⚠" if abs(delta) > 12 else " "
        print(f"  {marker} {emp.name:18s}  ставка {emp.rate:.1f}  "
              f"цель {target:5.0f}ч  факт {actual:4d}ч  Δ{delta:+.0f}")

    print(f"\nГотово! Файл: {outfile}")


if __name__ == "__main__":
    main()
