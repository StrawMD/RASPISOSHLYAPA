"""
JSON-хранилище для данных расписания.

Структура data/:
  employees.json       — список сотрудников
  posts.json           — список постов/аппаратов
  holidays.json        — праздничные дни по годам
  months/2026_06.json  — конфиг конкретного месяца
"""

from __future__ import annotations

import calendar
import json
from pathlib import Path

from .data import (
    EMPLOYEES,
    POSTS,
    RUSSIAN_HOLIDAYS_2026,
    Employee,
    MonthConfig,
    Post,
    compute_norm_hours,
    generate_month_config,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


class Storage:

    def __init__(self, data_dir: Path = DATA_DIR):
        self.data_dir = data_dir
        self.months_dir = data_dir / "months"
        self.data_dir.mkdir(exist_ok=True)
        self.months_dir.mkdir(exist_ok=True)
        self._seed_defaults()

    # ------------------------------------------------------------------
    #  Сотрудники
    # ------------------------------------------------------------------

    def load_employees_raw(self) -> list[dict]:
        return self._read_json(self.data_dir / "employees.json", [])

    def save_employees_raw(self, data: list[dict]):
        self._write_json(self.data_dir / "employees.json", data)

    def load_employees(self) -> list[Employee]:
        raw = self.load_employees_raw()
        from datetime import date as _date
        ref_year = _date.today().year

        def years(start: int | None) -> int:
            if start is None:
                return 0
            return max(0, ref_year - start)

        result: list[Employee] = []
        for r in raw:
            seniority = r.get("seniority", 0) or 0
            hospital_start = r.get("hospital_start_year")
            career_start = r.get("career_start_year")

            hospital = years(hospital_start) if hospital_start else seniority
            career = (
                max(years(career_start), hospital)
                if career_start
                else max(seniority, hospital)
            )
            external = max(0, career - hospital)
            score = min(3 * hospital + external, 60)

            result.append(
                Employee(
                    name=r["name"],
                    rate=r.get("rate", 1.0),
                    allowed_posts=r.get("allowed_posts", []),
                    max_rate=r.get("max_rate", 1.5),
                    seniority=seniority,
                    hospital_years=hospital,
                    career_years=career,
                    seniority_score=score,
                )
            )
        return result

    # ------------------------------------------------------------------
    #  Посты / аппараты
    # ------------------------------------------------------------------

    def load_posts_raw(self) -> list[dict]:
        return self._read_json(self.data_dir / "posts.json", [])

    def save_posts_raw(self, data: list[dict]):
        self._write_json(self.data_dir / "posts.json", data)

    def load_posts(self) -> list[Post]:
        raw = self.load_posts_raw()
        return [
            Post(
                id=r["id"],
                name=r["name"],
                shift_hours=r.get("shift_hours", 12),
                staff_required=r.get("staff_required", 1),
                weekday_active=r.get("weekday_active", True),
                weekend_active=r.get("weekend_active", False),
            )
            for r in raw
        ]

    # ------------------------------------------------------------------
    #  Праздники
    # ------------------------------------------------------------------

    def load_holidays(self, year: int) -> list[str]:
        all_hol = self._read_json(self.data_dir / "holidays.json", {})
        return all_hol.get(str(year), [])

    def save_holidays(self, year: int, dates_iso: list[str]):
        all_hol = self._read_json(self.data_dir / "holidays.json", {})
        all_hol[str(year)] = sorted(set(dates_iso))
        self._write_json(self.data_dir / "holidays.json", all_hol)

    # ------------------------------------------------------------------
    #  Конфиг месяца
    # ------------------------------------------------------------------

    def _month_path(self, year: int, month: int) -> Path:
        return self.months_dir / f"{year}_{month:02d}.json"

    def load_month_raw(self, year: int, month: int) -> dict:
        default = {
            "year": year,
            "month": month,
            "norm_hours": compute_norm_hours(year, month),
            "post_overrides": {},
            "absences": {},
            "exclusions": {},
            "pinned": {},
        }
        return self._read_json(self._month_path(year, month), default)

    def save_month_raw(self, year: int, month: int, data: dict):
        self._write_json(self._month_path(year, month), data)

    def build_month_config(self, year: int, month: int) -> MonthConfig:
        """Собирает MonthConfig из JSON-файлов."""
        from datetime import date as _date
        raw = self.load_month_raw(year, month)
        _, num_days = calendar.monthrange(year, month)

        post_overrides = {}
        for pid, days_list in raw.get("post_overrides", {}).items():
            post_overrides[pid] = days_list

        for pid, cfg in raw.get("post_day_config", {}).items():
            mode = cfg.get("mode", "default")
            if mode == "weekdays":
                wds = set(cfg.get("weekdays", []))
                post_overrides[pid] = [
                    d for d in range(1, num_days + 1)
                    if _date(year, month, d).weekday() in wds
                ]
            elif mode == "specific":
                post_overrides[pid] = cfg.get("specific_days", [])

        absences = dict(raw.get("absences", {}))
        for name, periods in raw.get("absence_periods", {}).items():
            days = set(absences.get(name, []))
            for p in periods:
                for d in range(p["start"], p["end"] + 1):
                    days.add(d)
            if days:
                absences[name] = sorted(days)

        for name, cfg in raw.get("employee_day_config", {}).items():
            mode = cfg.get("mode", "default")
            existing = set(absences.get(name, []))
            if mode == "default":
                work_wd = cfg.get("work_weekdays", True)
                work_we = cfg.get("work_weekends", True)
                blocked = set()
                for d in range(1, num_days + 1):
                    dow = _date(year, month, d).weekday()
                    if dow < 5 and not work_wd:
                        blocked.add(d)
                    elif dow >= 5 and not work_we:
                        blocked.add(d)
                if blocked:
                    existing |= blocked
            elif mode == "weekdays":
                allowed = set(cfg.get("weekdays", []))
                existing |= {
                    d for d in range(1, num_days + 1)
                    if _date(year, month, d).weekday() not in allowed
                }
            elif mode == "specific":
                allowed = set(cfg.get("specific_days", []))
                existing |= {d for d in range(1, num_days + 1)
                             if d not in allowed}

            excluded = set(cfg.get("excluded_days", []))
            existing |= excluded

            if existing:
                absences[name] = sorted(existing)

        norm = raw.get("norm_hours", compute_norm_hours(year, month))

        emps_raw = self.load_employees_raw()
        emp_target_hours: dict[str, float] = {}
        emp_max_hours: dict[str, float] = {}
        for e in emps_raw:
            name = e["name"]
            rate = e.get("rate", 1.0)
            max_r = e.get("max_rate", 1.5)
            absent_count = len(absences.get(name, []))
            avail = max(0.0, (num_days - absent_count) / num_days)
            emp_target_hours[name] = norm * rate * avail
            emp_max_hours[name] = norm * max_r * avail

        return generate_month_config(
            year=year,
            month=month,
            norm_hours=norm,
            post_overrides=post_overrides if post_overrides else None,
            absences=absences,
            exclusions=raw.get("exclusions", {}),
            employee_target_hours=emp_target_hours,
            employee_max_hours=emp_max_hours,
        )

    def load_pinned(self, year: int, month: int) -> dict[str, dict[str, list[str]]]:
        raw = self.load_month_raw(year, month)
        return raw.get("pinned", {})

    # ------------------------------------------------------------------
    #  Инициализация дефолтов
    # ------------------------------------------------------------------

    def _seed_defaults(self):
        if not (self.data_dir / "employees.json").exists():
            data = []
            for e in EMPLOYEES:
                data.append({
                    "name": e.name,
                    "rate": e.rate,
                    "allowed_posts": e.allowed_posts,
                    "post_preferences": list(e.allowed_posts),
                    "max_rate": e.max_rate,
                    "seniority": e.seniority,
                    "prefers_overtime": None,
                    "avoid_weekends": False,
                })
            self.save_employees_raw(data)

        if not (self.data_dir / "posts.json").exists():
            data = []
            for p in POSTS:
                data.append({
                    "id": p.id,
                    "name": p.name,
                    "shift_hours": p.shift_hours,
                    "staff_required": p.staff_required,
                    "weekday_active": p.weekday_active,
                    "weekend_active": p.weekend_active,
                })
            self.save_posts_raw(data)

        if not (self.data_dir / "holidays.json").exists():
            hol_2026 = [d.isoformat() for d in RUSSIAN_HOLIDAYS_2026]
            self.save_holidays(2026, hol_2026)

    # ------------------------------------------------------------------
    #  Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _read_json(path: Path, default):
        if not path.exists():
            return default
        with open(path, encoding="utf-8") as f:
            return json.load(f)

    @staticmethod
    def _write_json(path: Path, data):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2, default=str)
