"""
Данные: посты (аппараты), сотрудники, конфигурация месяца.

Все данные извлечены из реального расписания (март–май 2026).
Для корректировки: правьте списки POSTS и EMPLOYEES ниже.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta


# ---------------------------------------------------------------------------
#  Посты / аппараты
# ---------------------------------------------------------------------------

@dataclass
class Post:
    id: str
    name: str
    shift_hours: int          # 12 или 24
    staff_required: int       # людей на смену
    weekday_active: bool = True
    weekend_active: bool = False
    staff_required_day: int | None = None
    staff_required_night: int | None = None

    def __hash__(self):
        return hash(self.id)


POSTS: list[Post] = [
    Post("ssk1",       "ССК1 Приёмник",      24, 2, weekday_active=True,  weekend_active=True, staff_required_day=2, staff_required_night=1),
    Post("kt_pb",      "КТ пищеблок",        24, 1, weekday_active=True,  weekend_active=True, staff_required_day=1, staff_required_night=1),
    Post("mrt_ssk",    "МРТ ССК",            12, 1, weekday_active=True,  weekend_active=False),
    Post("kt_ssk2",    "КТ ССК2",            12, 2, weekday_active=True,  weekend_active=False),
    Post("ge_siemens", "GE / Siemens (ЦАОП)", 12, 1, weekday_active=True, weekend_active=False),
    Post("kt_2011",    "КТ 2011",            12, 2, weekday_active=True,  weekend_active=True),
    Post("kt_2013",    "КТ 2013",            12, 1, weekday_active=True,  weekend_active=False),
    Post("toshiba",    "Тошиба 1 корп",      12, 1, weekday_active=False, weekend_active=False),
    Post("kt_4str",    "КТ 4стр",            12, 2, weekday_active=True,  weekend_active=False),
    Post("mrt_22_1",   "МРТ 22-1 эт",        12, 1, weekday_active=True,  weekend_active=True),
    Post("mrt_21_1",   "МРТ 21-1 (3Т)",      12, 1, weekday_active=True,  weekend_active=True),
]

POST_BY_ID: dict[str, Post] = {p.id: p for p in POSTS}


# ---------------------------------------------------------------------------
#  Сотрудники
# ---------------------------------------------------------------------------

@dataclass
class Employee:
    name: str
    rate: float                        # 0.5 / 1.0
    allowed_posts: list[str]           # ID постов, на которых может работать
    max_rate: float = 1.5              # потолок в ставках (1.5 по умолчанию)
    seniority: int = 0                 # устаревшее поле (fallback)
    hospital_years: int = 0            # стаж именно в больнице
    career_years: int = 0              # общий стаж в профессии
    seniority_score: int = 0           # взвешенный скор = 3*hospital + external
    # Очерёдность смен: avoid | neutral | prefer_2 | prefer_3 | prefer_4
    consecutive_pref: str = "avoid"
    # Жёсткое мед/правовое ограничение: none | no_night | no_24h | day_only
    medical_restriction: str = "none"
    # Допуск на суточные (24ч) смены. False → суточные (с) и ночные (н) запрещены.
    can_24h: bool = True
    # Личные лимиты за месяц (None = без лимита)
    max_nights: int | None = None
    max_full: int | None = None

    def __hash__(self):
        return hash(self.name)


# allowed_posts извлечены из реальных расписаний март–май 2026:
# если сотрудник хоть раз появлялся на посту — он туда допущен.

EMPLOYEES: list[Employee] = [
    # --- Суточники (только 24ч посты) ---
    Employee("Саломахина",   1.0, ["ssk1", "kt_pb"]),
    Employee("Курзанцева",   1.0, ["ssk1", "kt_pb"]),
    Employee("Дохтова",      1.0, ["ssk1", "kt_pb"]),
    Employee("Гурова",       1.0, ["kt_pb"]),
    Employee("Корнилов",     1.0, ["ssk1", "kt_pb"]),
    Employee("Мышкин",       0.5, ["ssk1", "kt_pb"]),
    Employee("Ким",          0.5, ["ssk1", "kt_pb"]),
    Employee("Серебрякова",  0.5, ["kt_pb"]),

    # --- Универсалы (и 24ч, и 12ч) ---
    Employee("Муравьева",    1.0, ["ssk1", "kt_pb", "kt_ssk2", "kt_2011", "kt_2013"]),
    Employee("Гаджиева",     1.0, ["ssk1", "kt_pb", "kt_ssk2", "kt_2011", "kt_2013"]),
    Employee("Иванов",       1.0, ["ssk1", "kt_pb", "mrt_ssk", "kt_2013", "kt_4str", "mrt_22_1", "mrt_21_1"]),
    Employee("Баратов",      1.0, ["ssk1", "kt_pb", "mrt_ssk", "kt_2013"]),
    Employee("Румер",        1.0, ["ssk1", "kt_pb", "mrt_ssk", "ge_siemens", "kt_2013", "mrt_21_1"],
             max_rate=2.0),
    Employee("Знатнова",     1.0, ["ssk1", "kt_pb", "kt_ssk2", "ge_siemens", "kt_2011", "kt_2013"]),
    Employee("Буславская",   1.0, ["ssk1", "kt_pb", "ge_siemens", "kt_2011", "kt_2013"]),
    Employee("Китова",       1.0, ["ssk1", "kt_pb", "kt_2013", "toshiba"]),
    Employee("Сорокин",      1.0, ["ssk1", "kt_pb", "ge_siemens"]),
    Employee("Слепов",       1.0, ["ssk1", "kt_pb", "kt_2013"]),
    Employee("Осипов",       1.0, ["ssk1", "kt_pb", "kt_2013"]),
    Employee("Егиян",        1.0, ["ssk1", "kt_ssk2", "kt_2011", "kt_2013", "kt_4str"]),
    Employee("Сланская",     1.0, ["ssk1", "kt_ssk2", "ge_siemens", "kt_2011", "kt_2013"]),
    Employee("Костарев",     1.0, ["ssk1", "kt_ssk2", "ge_siemens", "kt_2011", "kt_2013", "toshiba", "kt_4str"]),
    Employee("Кузахметова",  1.0, ["ssk1", "kt_ssk2", "kt_2011", "kt_2013", "toshiba", "kt_4str"]),
    Employee("Лисина",       1.0, ["ssk1", "kt_ssk2", "ge_siemens", "kt_2011", "kt_2013", "kt_4str"]),

    # --- Только 12-часовые посты ---
    Employee("Череватенко",  1.0, ["kt_ssk2", "kt_2011", "kt_2013", "toshiba", "kt_4str"]),
    Employee("Байтаева",     1.0, ["kt_ssk2", "kt_2011", "toshiba", "kt_4str"]),
    Employee("Борзунова",    1.0, ["kt_ssk2", "ge_siemens", "kt_2013"]),
    Employee("Шокирова",     1.0, ["kt_ssk2", "kt_2011", "kt_2013", "toshiba"]),
    Employee("Федорова",     1.0, ["kt_2011", "kt_2013"]),
    Employee("Хорова",       1.0, ["kt_2011", "kt_2013"]),
    Employee("Федотов",      1.0, ["kt_ssk2", "kt_2011", "kt_2013", "kt_4str"]),
    Employee("Смирнова",     1.0, ["kt_2013", "toshiba", "kt_4str"]),
    Employee("Шейх",         1.0, ["toshiba", "kt_4str"]),
    Employee("Карабаева",    1.0, ["mrt_ssk", "kt_ssk2", "ge_siemens", "kt_2011",
                                   "toshiba", "kt_4str", "mrt_22_1", "mrt_21_1"]),
    Employee("Соломка",      1.0, ["mrt_ssk", "kt_ssk2", "kt_2013", "kt_4str", "mrt_22_1", "mrt_21_1"]),
    Employee("Чураянц",      1.0, ["kt_4str", "mrt_22_1"]),
    Employee("Василенко",    1.0, ["kt_4str", "mrt_22_1"]),
    Employee("Мхитарян",     1.0, ["mrt_ssk", "kt_4str", "mrt_22_1", "mrt_21_1"]),
    Employee("Гончарук",     1.0, ["mrt_ssk", "kt_4str", "mrt_22_1", "mrt_21_1"]),
    Employee("Магомедов",    1.0, ["mrt_ssk", "mrt_22_1", "mrt_21_1"]),
    Employee("Кучук",        0.5, ["mrt_ssk", "mrt_22_1", "mrt_21_1"]),
]

EMPLOYEE_BY_NAME: dict[str, Employee] = {e.name: e for e in EMPLOYEES}


# ---------------------------------------------------------------------------
#  Конфигурация месяца
# ---------------------------------------------------------------------------

RUSSIAN_HOLIDAYS_2026 = {
    date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3),
    date(2026, 1, 4), date(2026, 1, 5), date(2026, 1, 6),
    date(2026, 1, 7), date(2026, 1, 8),
    date(2026, 2, 23),
    date(2026, 3, 8),
    date(2026, 5, 1), date(2026, 5, 9),
    date(2026, 6, 12),
    date(2026, 11, 4),
}


@dataclass
class MonthConfig:
    year: int
    month: int
    norm_hours: float                                      # часов на 1.0 ставку
    post_active_days: dict[str, list[int]] = field(default_factory=dict)
    absences: dict[str, list[int]] = field(default_factory=dict)
    exclusions: dict[str, list[int]] = field(default_factory=dict)
    employee_target_hours: dict[str, float] = field(default_factory=dict)
    employee_max_hours: dict[str, float] = field(default_factory=dict)

    @property
    def days(self) -> list[int]:
        """Все дни месяца (1..N)."""
        _, num_days = calendar.monthrange(self.year, self.month)
        return list(range(1, num_days + 1))

    @property
    def num_days(self) -> int:
        _, n = calendar.monthrange(self.year, self.month)
        return n

    def day_of_week(self, day: int) -> int:
        """0=Пн … 6=Вс."""
        return date(self.year, self.month, day).weekday()

    def is_weekend(self, day: int) -> bool:
        return self.day_of_week(day) >= 5

    def is_holiday(self, day: int) -> bool:
        return date(self.year, self.month, day) in RUSSIAN_HOLIDAYS_2026


def compute_norm_hours(year: int, month: int) -> float:
    """Рабочие дни (пн–пт, минус праздники) × 6 часов."""
    _, num_days = calendar.monthrange(year, month)
    work_days = 0
    for d in range(1, num_days + 1):
        dt = date(year, month, d)
        if dt.weekday() < 5 and dt not in RUSSIAN_HOLIDAYS_2026:
            work_days += 1
    return work_days * 6.0


def generate_month_config(
    year: int,
    month: int,
    norm_hours: float | None = None,
    post_overrides: dict[str, list[int]] | None = None,
    absences: dict[str, list[int]] | None = None,
    exclusions: dict[str, list[int]] | None = None,
    employee_target_hours: dict[str, float] | None = None,
    employee_max_hours: dict[str, float] | None = None,
    posts: list[Post] | None = None,
) -> MonthConfig:
    """Генерация конфига на месяц с дефолтными активными днями для каждого поста.

    `posts` берётся из БД (передаётся вызывающей стороной); если не передан —
    используется захардкоженный список POSTS (обратная совместимость).
    """

    norm = norm_hours if norm_hours is not None else compute_norm_hours(year, month)
    _, num_days = calendar.monthrange(year, month)
    posts = posts if posts is not None else POSTS

    post_active: dict[str, list[int]] = {}
    for post in posts:
        active = []
        for d in range(1, num_days + 1):
            dt = date(year, month, d)
            is_wknd = dt.weekday() >= 5
            is_hol = dt in RUSSIAN_HOLIDAYS_2026

            if post.shift_hours == 24:
                active.append(d)
            elif is_hol:
                pass
            elif is_wknd:
                if post.weekend_active:
                    active.append(d)
            else:
                if post.weekday_active:
                    active.append(d)

        post_active[post.id] = active

    if post_overrides:
        for pid, days_list in post_overrides.items():
            post_active[pid] = days_list

    return MonthConfig(
        year=year,
        month=month,
        norm_hours=norm,
        post_active_days=post_active,
        absences=absences or {},
        exclusions=exclusions or {},
        employee_target_hours=employee_target_hours or {},
        employee_max_hours=employee_max_hours or {},
    )
