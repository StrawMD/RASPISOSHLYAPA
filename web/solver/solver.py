"""
CP-SAT солвер для автоматического составления графика смен.

Жёсткие ограничения:
  1. Покрытие постов.
  2. Допуск по квалификации.
  3. Максимум одна смена в день.
  4. Отдых после суточной (с) — нельзя работать на следующий день.
  5. Отдых после ночной (н) — нельзя ставить суточную/дневную на следующий день.
  6. Не ставить в дни отсутствия.
  7. Потолок часов.

Мягкие ограничения (штрафы):
  1. Отклонение от целевых часов.
  2. Запрет смен подряд (любых) — очень высокий штраф.
  3. Желательно 2+ дня отдыха после суточной/ночной.
  4. Предпочтения по постам (иерархия).
  5. Равномерность выходных.
  6. Предпочтения по типу смены (с/д/н) на суточных постах.

Суточные посты (24ч) поддерживают три типа смен:
  (с) — полные сутки (24ч, один человек)
  (д) — дневная (12ч)
  (н) — ночная (12ч)
  Каждая позиция может закрываться одним (с) или парой (д)+(н).
"""

from __future__ import annotations

import re
import sys

from ortools.sat.python import cp_model

from data import Post, Employee, MonthConfig

def _log(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


# Веса целевой функции. Значения по умолчанию совпадают с историческими
# константами, поэтому без переданного конфига поведение не меняется.
# Любой вес можно обнулить (0) — это эквивалентно выключению фактора.
DEFAULT_WEIGHTS: dict[str, int] = {
    "under_hours": 500,          # штраф за час недобора до целевых часов
    "over_hours": 200,           # штраф за час переработки сверх цели
    "consec_avoid": 1000,        # штраф за пару смен подряд (pref=avoid)
    "block_reward": 150,         # награда за смежность смен (pref=prefer_N)
    "overrun_penalty": 800,      # штраф за серию длиннее N (pref=prefer_N)
    "rest2": 80,                 # желателен 2-й день отдыха после суток/ночи
    "full_reward": 500,          # награда за монолитные сутки (с)
    "partial_penalty": 200,      # штраф за дробление суток на (д)+(н)
    "post_prefer": 30,           # база: предпочитаемый пост (скорее хочу)
    "post_prefer_strong": 80,    # база: очень предпочитаемый пост
    "post_avoid": 50,            # база: нежелательный пост (скорее не хочу)
    "post_ban": 80000,           # «просьба не ставить»: квази-запрет (override админом)
    "legacy_24h_prefer": 120,    # легаси: «предпочитаю» по типам 24ч-смен
    "shift_time_bias": 600,      # сила режима prefer_full / prefer_day
    "weekend_fairness": 30,      # равномерность выходных между людьми
    "weekday_prefer": 10,        # база: предпочтение будней/выходных (prefer)
    "weekday_avoid": 30,         # база: избегание будней/выходных (avoid)
    "dow_prefer": 10,            # база: предпочтение по дню недели
    "dow_avoid": 25,             # база: избегание по дню недели
    "desired_date": 20,          # база: желаемая дата
    "soft_unavailable": 200,     # штраф за работу в «мягко нежелательный» день
    "avoid_with": 300,           # штраф за совместную смену с нежелательным коллегой
    "prefer_with": 40,           # награда за совместную смену с желаемым коллегой
    "same_post_repeat": 40,      # штраф за один и тот же аппарат два дня подряд
    "min_shifts_short": 600,     # штраф за каждую смену ниже желаемого минимума
    "understaff": 100000,        # релаксация: штраф за каждый незакрытый слот
}


class ScheduleSolver:

    def __init__(
        self,
        posts: list[Post],
        employees: list[Employee],
        config: MonthConfig,
        post_preferences: dict[str, dict[str, str]] | None = None,
        shift_preferences: dict[str, dict] | None = None,
        shift_time_modes: dict[str, str] | None = None,
        seniority_filter: bool = False,
        weekday_prefs: dict[str, str] | None = None,
        weekend_prefs: dict[str, str] | None = None,
        dow_prefs: dict[str, dict[str, str]] | None = None,
        desired_dates: dict[str, list[int]] | None = None,
        soft_unavailable: dict[str, list[int]] | None = None,
        avoid_with: dict[str, list[str]] | None = None,
        prefer_with: dict[str, list[str]] | None = None,
        weights: dict[str, int] | None = None,
        fixed_slots: dict[int, dict[str, list[str]]] | None = None,
        relax: bool = False,
    ):
        self.posts = posts
        self.employees = employees
        self.config = config
        self.post_prefs = post_preferences or {}
        self.shift_prefs = shift_preferences or {}
        self.shift_time_modes = shift_time_modes or {}
        self.seniority_filter = seniority_filter
        self.weekday_prefs = weekday_prefs or {}
        self.weekend_prefs = weekend_prefs or {}
        self.dow_prefs = dow_prefs or {}
        self.desired_dates = desired_dates or {}
        self.soft_unavailable = soft_unavailable or {}
        self.avoid_with = avoid_with or {}
        self.prefer_with = prefer_with or {}
        self.fixed_slots = fixed_slots or {}
        # Режим релаксации: покрытие становится мягким (допускается недобор
        # с большим штрафом), солвер всегда выдаёт черновик + список «дыр».
        self.relax = relax
        self.shortfalls: list[tuple] = []

        self.W = dict(DEFAULT_WEIGHTS)
        if weights:
            for k, v in weights.items():
                if k in self.W and isinstance(v, (int, float)):
                    self.W[k] = int(v)

        self.model = cp_model.CpModel()

        self.x: dict[tuple[int, int, int], cp_model.IntVar] = {}
        self.xf: dict[tuple[int, int, int], cp_model.IntVar] = {}
        self.xd: dict[tuple[int, int, int], cp_model.IntVar] = {}
        self.xn: dict[tuple[int, int, int], cp_model.IntVar] = {}

        self._24h_pidxs = frozenset(
            i for i, p in enumerate(self.posts) if p.shift_hours == 24
        )
        self._penalties: list = []
        self.diagnostics: list[str] = []
        self._worked: dict[tuple[int, int], cp_model.IntVar | None] = {}
        self._post_worked: dict[tuple[int, int, int], cp_model.IntVar | None] = {}
        self._build()

    # ------------------------------------------------------------------
    #  Helpers
    # ------------------------------------------------------------------

    def _all_vars_day(self, e: int, d: int) -> list:
        vs = []
        for p in range(len(self.posts)):
            if p in self._24h_pidxs:
                for dd in (self.xf, self.xd, self.xn):
                    if (e, d, p) in dd:
                        vs.append(dd[e, d, p])
            else:
                if (e, d, p) in self.x:
                    vs.append(self.x[e, d, p])
        return vs

    def _dayfull_vars(self, e: int, d: int) -> list:
        """Full 24h, day 12h on 24h posts, and all regular 12h posts."""
        vs = []
        for p in range(len(self.posts)):
            if p in self._24h_pidxs:
                if (e, d, p) in self.xf:
                    vs.append(self.xf[e, d, p])
                if (e, d, p) in self.xd:
                    vs.append(self.xd[e, d, p])
            else:
                if (e, d, p) in self.x:
                    vs.append(self.x[e, d, p])
        return vs

    def _worked_var(self, e: int, d: int):
        """Bool «сотрудник e работает в день d» (с кэшированием)."""
        key = (e, d)
        if key in self._worked:
            return self._worked[key]
        vs = self._all_vars_day(e, d)
        if not vs:
            self._worked[key] = None
            return None
        w = self.model.new_bool_var(f"wk_{e}_{d}")
        self.model.add_max_equality(w, vs)
        self._worked[key] = w
        return w

    def _post_day_vars(self, e: int, d: int, p: int) -> list:
        """Все переменные «сотрудник e на посту p в день d» (12ч/сутки/день/ночь)."""
        if p in self._24h_pidxs:
            vs = []
            for dd in (self.xf, self.xd, self.xn):
                if (e, d, p) in dd:
                    vs.append(dd[e, d, p])
            return vs
        return [self.x[e, d, p]] if (e, d, p) in self.x else []

    def _post_day_var(self, e: int, d: int, p: int):
        """Bool «сотрудник e работает на посту p в день d» (с кэшированием)."""
        key = (e, d, p)
        if key in self._post_worked:
            return self._post_worked[key]
        vs = self._post_day_vars(e, d, p)
        if not vs:
            self._post_worked[key] = None
            return None
        if len(vs) == 1:
            self._post_worked[key] = vs[0]
            return vs[0]
        w = self.model.new_bool_var(f"pw_{e}_{d}_{p}")
        self.model.add_max_equality(w, vs)
        self._post_worked[key] = w
        return w

    def _hour_terms(self, e: int) -> list:
        terms = []
        for d in self.config.days:
            for p, post in enumerate(self.posts):
                if p in self._24h_pidxs:
                    if (e, d, p) in self.xf:
                        terms.append(self.xf[e, d, p] * 24)
                    if (e, d, p) in self.xd:
                        terms.append(self.xd[e, d, p] * 12)
                    if (e, d, p) in self.xn:
                        terms.append(self.xn[e, d, p] * 12)
                else:
                    if (e, d, p) in self.x:
                        terms.append(self.x[e, d, p] * post.shift_hours)
        return terms

    # ------------------------------------------------------------------
    #  Build
    # ------------------------------------------------------------------

    def _build(self):
        self._create_variables()
        self._apply_fixed_slots()
        self._coverage()
        self._one_shift_per_day()
        self._rest_constraints()
        self._max_hours()
        self._personal_shift_caps()
        self._hour_target_penalty()
        self._min_shifts_floor()
        self._consecutive_sequencing()
        self._prefer_2day_rest()
        self._prefer_full_shifts()
        self._post_preference_penalty()
        self._shift_type_penalty()
        self._shift_time_mode_penalty()
        self._weekend_fairness()
        self._weekday_weekend_penalty()
        self._day_of_week_penalty()
        self._desired_dates_bonus()
        self._soft_unavailable_penalty()
        self._avoid_same_post_consecutive()
        self._pairing_penalty()

        if self._penalties:
            self.model.Minimize(sum(self._penalties))

    # ------------------------------------------------------------------
    #  Переменные
    # ------------------------------------------------------------------

    def _create_variables(self):
        blocked: dict[str, set[int]] = {}
        for name, dl in self.config.absences.items():
            blocked.setdefault(name, set()).update(dl)
        for name, dl in self.config.exclusions.items():
            blocked.setdefault(name, set()).update(dl)

        for e, emp in enumerate(self.employees):
            emp_blocked = blocked.get(emp.name, set())
            sp = self.shift_prefs.get(emp.name, {})
            mode = self.shift_time_modes.get(emp.name, "neutral")
            med = getattr(emp, "medical_restriction", "none") or "none"
            no_night = med in ("no_night", "day_only")
            no_full = med in ("no_24h", "no_night", "day_only")

            for d in self.config.days:
                if d in emp_blocked:
                    continue
                for p, post in enumerate(self.posts):
                    if post.id not in emp.allowed_posts:
                        continue
                    if d not in self.config.post_active_days.get(post.id, []):
                        continue

                    if p in self._24h_pidxs:
                        # Full-shift (с) eligibility. Blocked by: стаж-фильтр,
                        # легаси-флаг avoid, отсутствие допуска на сутки
                        # (can_24h=False) или мед-ограничение. "only_full"
                        # сохраняет xf — в этом режиме блокируются прочие смены.
                        can_full = True
                        # Фильтр суточных по ОБЩЕМУ стажу в профессии (career_years),
                        # а не только по стажу в этой больнице.
                        if self.seniority_filter and emp.career_years < 5:
                            can_full = False
                        if sp.get("pref_24h_full") is False:
                            can_full = False
                        if not getattr(emp, "can_24h", True):
                            can_full = False
                        if no_full:
                            can_full = False

                        # Жёсткие блокировки: легаси avoid, режим only_full,
                        # либо мед-ограничение на ночь. Мягкие режимы
                        # (prefer_full / prefer_day) — через штрафы.
                        block_day = (
                            sp.get("pref_24h_day") is False
                            or mode == "only_full"
                        )
                        block_night = (
                            sp.get("pref_24h_night") is False
                            or mode == "only_full"
                            or no_night
                        )

                        if can_full:
                            self.xf[e, d, p] = self.model.new_bool_var(
                                f"xf_{e}_{d}_{p}")

                        if not block_day:
                            self.xd[e, d, p] = self.model.new_bool_var(
                                f"xd_{e}_{d}_{p}")

                        if not block_night:
                            self.xn[e, d, p] = self.model.new_bool_var(
                                f"xn_{e}_{d}_{p}")
                    else:
                        # Regular 12h posts: for "only_full" we forbid any
                        # 12h work, so no variable is created at all.
                        if mode == "only_full":
                            continue
                        self.x[e, d, p] = self.model.new_bool_var(
                            f"x_{e}_{d}_{p}")

    def _apply_fixed_slots(self):
        """Жёстко задать выбранные смены (админ): соответствующая bool-переменная == 1."""
        self._fixed_slot_errors: list[str] = []
        if not self.fixed_slots:
            return

        label_re = re.compile(r"^(.+)\(([сдн])\)$")

        emp_idx = {emp.name: i for i, emp in enumerate(self.employees)}
        post_idx = {post.id: i for i, post in enumerate(self.posts)}

        for d, by_post in sorted(self.fixed_slots.items()):
            if d not in self.config.days:
                self._fixed_slot_errors.append(
                    f"День {d} не входит в месяц (активные дни: "
                    f"{self.config.days[0]}–{self.config.days[-1]})"
                )
                continue
            for post_id, labels in by_post.items():
                if post_id not in post_idx:
                    self._fixed_slot_errors.append(f"Неизвестный пост «{post_id}»")
                    continue
                p = post_idx[post_id]
                post = self.posts[p]
                if not isinstance(labels, list):
                    self._fixed_slot_errors.append(
                        f"День {d}, {post_id}: ожидается массив имён"
                    )
                    continue
                for label in labels:
                    raw = str(label).strip()
                    if not raw:
                        continue
                    m = label_re.match(raw)
                    if post.shift_hours == 24:
                        if not m:
                            self._fixed_slot_errors.append(
                                f"«{raw}»: на суточном посту укажите тип смены "
                                f"— (с), (д) или (н)"
                            )
                            continue
                        name, st = m.group(1), m.group(2)
                    else:
                        if m:
                            name = m.group(1)
                        else:
                            name = raw

                    ei = emp_idx.get(name)
                    if ei is None:
                        self._fixed_slot_errors.append(
                            f"«{raw}»: сотрудник «{name}» не найден"
                        )
                        continue

                    var = None
                    if post.shift_hours == 24:
                        if st == "с":
                            var = self.xf.get((ei, d, p))
                        elif st == "д":
                            var = self.xd.get((ei, d, p))
                        elif st == "н":
                            var = self.xn.get((ei, d, p))
                    else:
                        var = self.x.get((ei, d, p))

                    if var is None:
                        self._fixed_slot_errors.append(
                            f"«{raw}» нельзя зафиксировать: день {d}, "
                            f"{post.name} — нет подходящей смены "
                            f"(выходной, квалификация, пост не активен в этот день, "
                            f"или режим only_full и т.п.)"
                        )
                        continue

                    self.model.add(var == 1)

    # ------------------------------------------------------------------
    #  Жёсткие ограничения
    # ------------------------------------------------------------------

    def _coverage(self):
        for d in self.config.days:
            for p, post in enumerate(self.posts):
                if d not in self.config.post_active_days.get(post.id, []):
                    continue

                if p in self._24h_pidxs:
                    S_day = post.staff_required_day or post.staff_required
                    S_night = post.staff_required_night or post.staff_required

                    f_vars = [self.xf[e, d, p]
                              for e in range(len(self.employees))
                              if (e, d, p) in self.xf]
                    d_vars = [self.xd[e, d, p]
                              for e in range(len(self.employees))
                              if (e, d, p) in self.xd]
                    n_vars = [self.xn[e, d, p]
                              for e in range(len(self.employees))
                              if (e, d, p) in self.xn]

                    day_emps = {e for e in range(len(self.employees))
                                if (e, d, p) in self.xf or (e, d, p) in self.xd}
                    night_emps = {e for e in range(len(self.employees))
                                  if (e, d, p) in self.xf or (e, d, p) in self.xn}

                    if len(day_emps) < S_day:
                        _log(f"  ⚠  {post.name} день {d}: "
                             f"дневное покрытие {len(day_emps)}/{S_day}")
                        self.diagnostics.append(
                            f"{post.name}, день {d}: некем закрыть день "
                            f"(доступно {len(day_emps)} из {S_day})")
                    if len(night_emps) < S_night:
                        _log(f"  ⚠  {post.name} день {d}: "
                             f"ночное покрытие {len(night_emps)}/{S_night}")
                        self.diagnostics.append(
                            f"{post.name}, день {d}: некем закрыть ночь "
                            f"(доступно {len(night_emps)} из {S_night})")

                    all_day = f_vars + d_vars
                    all_night = f_vars + n_vars
                    self._cover_target(all_day, S_day, len(day_emps),
                                       post, d, "день")
                    self._cover_target(all_night, S_night, len(night_emps),
                                       post, d, "ночь")
                else:
                    S = post.staff_required
                    assigned = [self.x[e, d, p]
                                for e in range(len(self.employees))
                                if (e, d, p) in self.x]
                    n = len(assigned)
                    if n < S:
                        _log(f"  ⚠  {post.name} день {d}: "
                             f"доступно {n}, нужно {S}")
                        self.diagnostics.append(
                            f"{post.name}, день {d}: доступно {n}, нужно {S}")
                    self._cover_target(assigned, S, n, post, d, "смена")

    def _cover_target(self, assigned, required, available, post, d, kind):
        """Ограничение покрытия одного слота.

        Обычный режим: жёстко закрыть min(required, available) позиций.
        Режим релаксации: стремиться к полному `required`, но допускать
        недобор `shortfall` с большим штрафом и регистрировать «дыру».
        """
        if not self.relax:
            if not assigned:
                return
            self.model.add(sum(assigned) == min(required, available))
            return

        # Релаксация: required может превышать число доступных переменных —
        # тогда недобор неизбежен и будет отражён в отчёте.
        short = self.model.new_int_var(0, required, f"short_{post.id}_{d}_{kind}")
        if assigned:
            self.model.add(sum(assigned) + short == required)
        else:
            self.model.add(short == required)
        self._penalties.append(self.W["understaff"] * short)
        self.shortfalls.append((post, d, kind, short))

    def _one_shift_per_day(self):
        for e in range(len(self.employees)):
            for d in self.config.days:
                shifts = self._all_vars_day(e, d)
                if len(shifts) > 1:
                    self.model.add(sum(shifts) <= 1)

    def _rest_constraints(self):
        """After full 24h (с): next day off.
        After night (н): no full/day next day (night→night penalized by consecutive)."""
        days = self.config.days
        for e in range(len(self.employees)):
            for i in range(len(days) - 1):
                d, dn = days[i], days[i + 1]

                for p in self._24h_pidxs:
                    if (e, d, p) in self.xf:
                        for nv in self._all_vars_day(e, dn):
                            self.model.add(self.xf[e, d, p] + nv <= 1)

                    if (e, d, p) in self.xn:
                        for nv in self._dayfull_vars(e, dn):
                            self.model.add(self.xn[e, d, p] + nv <= 1)

    def _max_hours(self):
        for e, emp in enumerate(self.employees):
            terms = self._hour_terms(e)
            if not terms:
                continue
            cap = int(self.config.employee_max_hours.get(
                emp.name, self.config.norm_hours * emp.max_rate))
            self.model.add(sum(terms) <= cap)

    # ------------------------------------------------------------------
    #  Мягкие ограничения
    # ------------------------------------------------------------------

    def _hour_target_penalty(self):
        for e, emp in enumerate(self.employees):
            terms = self._hour_terms(e)
            if not terms:
                continue
            total = sum(terms)
            target = int(self.config.employee_target_hours.get(
                emp.name, self.config.norm_hours * emp.rate))
            over = self.model.new_int_var(0, 500, f"over_{e}")
            under = self.model.new_int_var(0, 500, f"under_{e}")
            self.model.add(total - target == over - under)
            self._penalties.append(self.W["under_hours"] * under)
            self._penalties.append(self.W["over_hours"] * over)

    def _personal_shift_caps(self):
        """Жёсткие личные лимиты на число суточных (с) и ночных (н) за месяц."""
        for e, emp in enumerate(self.employees):
            mf = getattr(emp, "max_full", None)
            mn = getattr(emp, "max_nights", None)
            if mf is not None and mf >= 0:
                fvars = [v for (ee, _d, _p), v in self.xf.items() if ee == e]
                if fvars:
                    self.model.add(sum(fvars) <= mf)
            if mn is not None and mn >= 0:
                nvars = [v for (ee, _d, _p), v in self.xn.items() if ee == e]
                if nvars:
                    self.model.add(sum(nvars) <= mn)

    def _min_shifts_floor(self):
        """Мягкий пол по числу смен: «хочу заработать не меньше N смен».

        Реализован как штраф за недобор ниже минимума (не жёсткое
        ограничение), поэтому никогда не делает задачу нерешаемой и не ломает
        баланс часов — лишь подтягивает человека вверх, когда есть свободные
        места. Жёсткий потолок часов (max_hours) по-прежнему ограничивает
        сверху, так что недостижимый минимум просто частично штрафуется.
        """
        w = self.W["min_shifts_short"]
        if not w:
            return
        for e, emp in enumerate(self.employees):
            m = getattr(emp, "min_shifts", None)
            if not m or m <= 0:
                continue
            worked = [self._worked_var(e, d) for d in self.config.days]
            worked = [v for v in worked if v is not None]
            if not worked:
                continue
            cap = min(int(m), len(worked))
            short = self.model.new_int_var(0, cap, f"minsh_{e}")
            # short >= m - сумма_смен  (и short >= 0) → при минимизации
            # short = max(0, m - факт).
            self.model.add(short >= cap - sum(worked))
            self._penalties.append(w * short)

    def _avoid_same_post_consecutive(self):
        """Мягкий штраф за один и тот же аппарат два дня подряд.

        Применяется ТОЛЬКО к сотрудникам, которые сами отметили это пожелание
        (avoid_same_post=True). По умолчанию выключено. Сила — вес
        same_post_repeat (можно выключить глобально = 0).
        """
        w = self.W["same_post_repeat"]
        if not w:
            return
        days = self.config.days
        for e, emp in enumerate(self.employees):
            if not getattr(emp, "avoid_same_post", False):
                continue
            for p in range(len(self.posts)):
                for i in range(len(days) - 1):
                    d, dn = days[i], days[i + 1]
                    a = self._post_day_var(e, d, p)
                    b = self._post_day_var(e, dn, p)
                    if a is None or b is None:
                        continue
                    both = self.model.new_bool_var(f"samepost_{e}_{p}_{d}")
                    self.model.add_min_equality(both, [a, b])
                    self._penalties.append(w * both)

    def _consecutive_sequencing(self):
        """Персональная очерёдность смен.

          avoid (по умолчанию) — штраф за любые две смены подряд.
          neutral             — без штрафа.
          prefer_N (N=2..4)   — поощряем серии до N смен подряд, штрафуем
                                 серии длиннее N.

        Замечание: жёсткий отдых после суток (с) и ночи (н) сохраняется
        всегда, поэтому очерёдность реально влияет на дневные 12ч-смены.
        """
        days = self.config.days
        for e, emp in enumerate(self.employees):
            pref = getattr(emp, "consecutive_pref", "avoid") or "avoid"

            if pref == "neutral":
                continue

            if pref.startswith("prefer_"):
                try:
                    n = int(pref.split("_", 1)[1])
                except (IndexError, ValueError):
                    n = 2
                n = max(2, min(n, 6))
                block_reward = self.W["block_reward"]
                overrun = self.W["overrun_penalty"]

                if block_reward:
                    for i in range(len(days) - 1):
                        a = self._worked_var(e, days[i])
                        b = self._worked_var(e, days[i + 1])
                        if a is None or b is None:
                            continue
                        both = self.model.new_bool_var(f"adj_{e}_{days[i]}")
                        self.model.add_min_equality(both, [a, b])
                        self._penalties.append(-block_reward * both)

                if overrun:
                    for i in range(len(days) - n):
                        window = [self._worked_var(e, days[i + k])
                                  for k in range(n + 1)]
                        if any(v is None for v in window):
                            continue
                        over = self.model.new_bool_var(f"over_{e}_{days[i]}")
                        self.model.add_min_equality(over, window)
                        self._penalties.append(overrun * over)
            else:  # avoid
                w = self.W["consec_avoid"]
                if not w:
                    continue
                for i in range(len(days) - 1):
                    a = self._worked_var(e, days[i])
                    b = self._worked_var(e, days[i + 1])
                    if a is None or b is None:
                        continue
                    c = self.model.new_bool_var(f"consec_{e}_{days[i]}")
                    self.model.add(a + b <= 1 + c)
                    self._penalties.append(w * c)

    def _prefer_2day_rest(self):
        """2 days rest after full 24h or night shift (soft)."""
        rest_w = self.W["rest2"]
        if not rest_w:
            return
        days = self.config.days
        for e in range(len(self.employees)):
            for i in range(len(days) - 2):
                d, d2 = days[i], days[i + 2]
                d2v = self._all_vars_day(e, d2)
                if not d2v:
                    continue
                wd2 = self.model.new_bool_var(f"wd2_{e}_{d}")
                self.model.add_max_equality(wd2, d2v)

                for p in self._24h_pidxs:
                    if (e, d, p) in self.xf:
                        v = self.model.new_bool_var(f"r2f_{e}_{d}_{p}")
                        self.model.add(self.xf[e, d, p] + wd2 <= 1 + v)
                        self._penalties.append(rest_w * v)
                    if (e, d, p) in self.xn:
                        v = self.model.new_bool_var(f"r2n_{e}_{d}_{p}")
                        self.model.add(self.xn[e, d, p] + wd2 <= 1 + v)
                        self._penalties.append(rest_w * v)

    def _prefer_full_shifts(self):
        """Prefer monolithic 24h shifts (с) over two separate 12h (д)+(н).

        Monolith reward (strong) plus a per-partial-shift penalty so that the
        solver only falls back to split day/night when hour balance truly
        requires it.
        """
        FULL_REWARD = self.W["full_reward"]
        PARTIAL_PENALTY = self.W["partial_penalty"]
        for d in self.config.days:
            for p in self._24h_pidxs:
                for e in range(len(self.employees)):
                    if (e, d, p) in self.xf:
                        self._penalties.append(-FULL_REWARD * self.xf[e, d, p])
                    if (e, d, p) in self.xd:
                        self._penalties.append(PARTIAL_PENALTY * self.xd[e, d, p])
                    if (e, d, p) in self.xn:
                        self._penalties.append(PARTIAL_PENALTY * self.xn[e, d, p])

    def _post_preference_penalty(self):
        """Per-post preference levels: prefer/neutral/avoid.

        Seniority boost: weight is scaled by the employee's seniority score
        (3*hospital + external_years), so more tenured people get their
        preferred/avoided posts honoured more strongly.
        """
        for e, emp in enumerate(self.employees):
            prefs = self.post_prefs.get(emp.name, {})
            if not prefs:
                continue
            if isinstance(prefs, list):
                level_map = {}
                for rank, pid in enumerate(prefs):
                    level_map[pid] = "prefer" if rank == 0 else "neutral"
                prefs = level_map

            # 60 score → +30 weight on top of base (roughly doubles weight).
            senior_bonus = emp.seniority_score // 2

            # 5 градаций предпочтения по аппарату:
            #   prefer_strong — очень хочу (большая награда)
            #   prefer        — скорее хочу (награда)
            #   neutral       — без влияния
            #   avoid         — скорее не хочу (мягкий штраф)
            #   avoid_hard    — просьба не ставить (квази-запрет, override
            #                   админом через фикс-слот/ручную правку)
            def level_weight(level: str) -> int:
                if level == "prefer_strong":
                    return -(self.W["post_prefer_strong"] + senior_bonus)
                if level == "prefer":
                    return -(self.W["post_prefer"] + senior_bonus)
                if level == "avoid":
                    return self.W["post_avoid"] + senior_bonus
                if level == "avoid_hard":
                    return self.W["post_ban"]
                return 0

            for d in self.config.days:
                for p, post in enumerate(self.posts):
                    level = prefs.get(post.id, "neutral")
                    w = level_weight(level)
                    if w == 0:
                        continue
                    if p in self._24h_pidxs:
                        for dd in (self.xf, self.xd, self.xn):
                            if (e, d, p) in dd:
                                self._penalties.append(w * dd[e, d, p])
                    else:
                        if (e, d, p) in self.x:
                            self._penalties.append(w * self.x[e, d, p])

    def _shift_type_penalty(self):
        """Legacy per-24h-post 'prefer' flags (kept for backward compat).

        'avoid' values are already hard-blocked at variable creation.  New
        preferences are expressed through `shift_time_modes` instead, handled
        in `_shift_time_mode_penalty`.
        """
        PREFER_REWARD = self.W["legacy_24h_prefer"]
        if not PREFER_REWARD:
            return
        for e, emp in enumerate(self.employees):
            sp = self.shift_prefs.get(emp.name, {})
            pf = sp.get("pref_24h_full")
            pd = sp.get("pref_24h_day")
            pn = sp.get("pref_24h_night")

            for d in self.config.days:
                for p in self._24h_pidxs:
                    if pf is True and (e, d, p) in self.xf:
                        self._penalties.append(-PREFER_REWARD * self.xf[e, d, p])
                    if pd is True and (e, d, p) in self.xd:
                        self._penalties.append(-PREFER_REWARD * self.xd[e, d, p])
                    if pn is True and (e, d, p) in self.xn:
                        self._penalties.append(-PREFER_REWARD * self.xn[e, d, p])

    def _shift_time_mode_penalty(self):
        """Aggregate shift-time preferences (applies to any post).

        Modes:
          only_full   - hard block on non-xf is enforced at variable creation
          prefer_full - reward xf, penalise any 12h shift (x / xd / xn)
          neutral     - no bias
          prefer_day  - reward 12h day shifts (x regular, xd on 24h posts),
                        penalise 24h monolith (xf) and nights (xn)

        BIAS is tuned to dominate the global monolith reward (500) so that
        personal shift-time preferences are respected even when the solver
        would otherwise prefer a 24h monolith for coverage reasons.
        """
        BIAS = self.W["shift_time_bias"]
        for e, emp in enumerate(self.employees):
            mode = self.shift_time_modes.get(emp.name, "neutral")
            if mode in ("neutral", "only_full", ""):
                # only_full is already enforced at variable-creation time.
                continue

            for d in self.config.days:
                for p in range(len(self.posts)):
                    if p in self._24h_pidxs:
                        xf = self.xf.get((e, d, p))
                        xd = self.xd.get((e, d, p))
                        xn = self.xn.get((e, d, p))
                        if mode == "prefer_full":
                            if xf is not None:
                                self._penalties.append(-BIAS * xf)
                            if xd is not None:
                                self._penalties.append(BIAS * xd)
                            if xn is not None:
                                self._penalties.append(BIAS * xn)
                        elif mode == "prefer_day":
                            if xf is not None:
                                self._penalties.append(BIAS * xf)
                            if xd is not None:
                                self._penalties.append(-BIAS * xd)
                            if xn is not None:
                                self._penalties.append(BIAS * xn)
                    else:
                        x = self.x.get((e, d, p))
                        if x is None:
                            continue
                        if mode == "prefer_full":
                            self._penalties.append(BIAS * x)
                        elif mode == "prefer_day":
                            self._penalties.append(-BIAS * x)

    def _weekend_fairness(self):
        if not self.W["weekend_fairness"]:
            return
        weekend_days = [d for d in self.config.days if self.config.is_weekend(d)]
        if not weekend_days:
            return
        wk_max = len(weekend_days) * 2
        counts: list[cp_model.IntVar] = []
        for e in range(len(self.employees)):
            wvars = []
            for d in weekend_days:
                wvars.extend(self._all_vars_day(e, d))
            if wvars:
                cnt = self.model.new_int_var(0, wk_max, f"wk_{e}")
                self.model.add(cnt == sum(wvars))
                counts.append(cnt)

        if len(counts) < 2:
            return
        mx = self.model.new_int_var(0, wk_max, "max_wk")
        mn = self.model.new_int_var(0, wk_max, "min_wk")
        self.model.add_max_equality(mx, counts)
        self.model.add_min_equality(mn, counts)
        sp = self.model.new_int_var(0, wk_max, "wk_spread")
        self.model.add(sp == mx - mn)
        self._penalties.append(self.W["weekend_fairness"] * sp)

    def _weekday_weekend_penalty(self):
        """Soft pref for weekdays/weekends: prefer -> reward, avoid -> penalty.

        Seniority boost amplifies both reward and penalty so tenured staff are
        more likely to get weekday/weekend slots as they prefer.
        """
        for e, emp in enumerate(self.employees):
            wd_pref = self.weekday_prefs.get(emp.name)
            we_pref = self.weekend_prefs.get(emp.name)
            if not wd_pref and not we_pref:
                continue

            senior_bonus = emp.seniority_score // 3
            base_prefer = self.W["weekday_prefer"]
            base_avoid = self.W["weekday_avoid"]

            for d in self.config.days:
                is_wknd = self.config.is_weekend(d)
                vs = self._all_vars_day(e, d)
                if not vs:
                    continue

                pref = we_pref if is_wknd else wd_pref
                if not pref:
                    continue
                if pref == "prefer":
                    w = -(base_prefer + senior_bonus)
                elif pref == "avoid":
                    w = base_avoid + senior_bonus
                else:
                    w = 0
                if w == 0:
                    continue
                for v in vs:
                    self._penalties.append(w * v)

    def _day_of_week_penalty(self):
        """Per day-of-week preferences (1=Mon..7=Sun).

        Seniority-weighted just like the other soft preferences.
        """
        for e, emp in enumerate(self.employees):
            prefs = self.dow_prefs.get(emp.name, {})
            if not prefs:
                continue
            senior_bonus = emp.seniority_score // 3
            base_prefer = self.W["dow_prefer"]
            base_avoid = self.W["dow_avoid"]
            for d in self.config.days:
                dow_str = str(self.config.day_of_week(d) + 1)
                level = prefs.get(dow_str)
                if not level:
                    continue
                if level == "prefer":
                    w = -(base_prefer + senior_bonus)
                elif level == "avoid":
                    w = base_avoid + senior_bonus
                else:
                    w = 0
                if w == 0:
                    continue
                vs = self._all_vars_day(e, d)
                for v in vs:
                    self._penalties.append(w * v)

    def _desired_dates_bonus(self):
        """Reward shifts on employee's desired dates.

        Scaled by seniority_score so senior staff are more likely to get
        the specific dates they ask for.
        """
        for e, emp in enumerate(self.employees):
            dates = self.desired_dates.get(emp.name, [])
            if not dates:
                continue
            senior_bonus = emp.seniority_score // 2
            base = self.W["desired_date"]
            if not base:
                continue
            bonus = -(base + senior_bonus)
            date_set = set(dates)
            for d in self.config.days:
                if d not in date_set:
                    continue
                vs = self._all_vars_day(e, d)
                for v in vs:
                    self._penalties.append(bonus * v)

    def _soft_unavailable_penalty(self):
        """Штраф за работу в «мягко нежелательный» день (третья градация
        между жёстким «не могу» и «хочу»)."""
        w = self.W["soft_unavailable"]
        if not w:
            return
        for e, emp in enumerate(self.employees):
            days = self.soft_unavailable.get(emp.name, [])
            if not days:
                continue
            dayset = set(days)
            for d in self.config.days:
                if d not in dayset:
                    continue
                for v in self._all_vars_day(e, d):
                    self._penalties.append(w * v)

    def _pairing_penalty(self):
        """Парные пожелания на уровне ОДНОГО кабинета (поста).

        «Хочу вместе» / «не вместе» означает работать в одном кабинете в один
        день (а не просто где-то в большой больнице в один день — там люди
        друг друга и не видят). Поэтому учитываем совпадение по конкретному
        посту: оба работают на одном p в день d.
          avoidWith  → штраф за совместную работу в одном кабинете;
          preferWith → награда за неё.
        """
        name_idx = {emp.name: i for i, emp in enumerate(self.employees)}
        wa = self.W["avoid_with"]
        wp = self.W["prefer_with"]

        def _pairs(source: dict[str, list[str]]):
            seen: set[tuple[int, int]] = set()
            for e, emp in enumerate(self.employees):
                for other in source.get(emp.name, []) or []:
                    f = name_idx.get(other)
                    if f is None or f == e:
                        continue
                    key = (min(e, f), max(e, f))
                    if key in seen:
                        continue
                    seen.add(key)
                    yield key

        def _same_post_terms(e: int, f: int, weight: int, sign: int, tag: str):
            for d in self.config.days:
                for p in range(len(self.posts)):
                    a = self._post_day_var(e, d, p)
                    b = self._post_day_var(f, d, p)
                    if a is None or b is None:
                        continue
                    both = self.model.new_bool_var(f"{tag}_{e}_{f}_{d}_{p}")
                    self.model.add_min_equality(both, [a, b])
                    self._penalties.append(sign * weight * both)

        if wa:
            for (e, f) in _pairs(self.avoid_with):
                _same_post_terms(e, f, wa, 1, "avw")

        if wp:
            for (e, f) in _pairs(self.prefer_with):
                _same_post_terms(e, f, wp, -1, "prw")

    # ------------------------------------------------------------------
    #  Запуск
    # ------------------------------------------------------------------

    def solve(self, time_limit_seconds: int = 120) -> dict | None:
        if getattr(self, "_fixed_slot_errors", None):
            _log("\n✗ Фиксированные слоты:")
            for msg in self._fixed_slot_errors:
                _log(f"  • {msg}")
            return None

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = time_limit_seconds
        solver.parameters.num_workers = 8
        solver.parameters.log_search_progress = False

        status = solver.Solve(self.model)

        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            _log(
                f"\nРешение найдено "
                f"({'OPTIMAL' if status == cp_model.OPTIMAL else 'FEASIBLE'}), "
                f"obj={solver.objective_value:.0f}"
            )
            return self._extract(solver)

        _log("\n✗ Решение не найдено!")
        self._finalize_diagnostics()
        return None

    def _finalize_diagnostics(self):
        """Сводка причин нерешаемости (баланс часов + слабые места покрытия)."""
        # Баланс часов: суммарный спрос vs доступная ёмкость.
        demand = 0
        for d in self.config.days:
            for post in self.posts:
                if d not in self.config.post_active_days.get(post.id, []):
                    continue
                if post.shift_hours == 24:
                    s_day = post.staff_required_day or post.staff_required
                    s_night = post.staff_required_night or post.staff_required
                    demand += (s_day + s_night) * 12
                else:
                    demand += post.staff_required * post.shift_hours

        capacity = 0
        for emp in self.employees:
            cap = self.config.employee_max_hours.get(
                emp.name, self.config.norm_hours * emp.max_rate)
            capacity += int(cap)

        summary: list[str] = []
        if demand > capacity:
            summary.append(
                f"Суммарно нужно ~{demand} ч работы, а доступная ёмкость "
                f"сотрудников ~{capacity} ч. Спрос превышает ёмкость на "
                f"{demand - capacity} ч — снизьте требования к покрытию, "
                f"повысьте лимиты ставок или добавьте людей."
            )

        # Слабые места покрытия (уникальные, не более 15).
        seen: set[str] = set()
        unique_cov: list[str] = []
        for msg in self.diagnostics:
            if msg in seen:
                continue
            seen.add(msg)
            unique_cov.append(msg)

        self.diagnostics = summary + unique_cov[:15]
        if len(unique_cov) > 15:
            self.diagnostics.append(
                f"…и ещё {len(unique_cov) - 15} проблемных мест покрытия."
            )

    def _extract(self, solver: cp_model.CpSolver) -> dict:
        schedule: dict[int, dict[str, list[str]]] = {}
        employee_hours: dict[str, int] = {}

        def _add(d, pid, label, hours):
            schedule.setdefault(d, {}).setdefault(pid, [])
            schedule[d][pid].append(label)
            name = label.split("(")[0]
            employee_hours[name] = employee_hours.get(name, 0) + hours

        for (e, d, p), var in self.x.items():
            if solver.value(var):
                _add(d, self.posts[p].id, self.employees[e].name,
                     self.posts[p].shift_hours)

        for (e, d, p), var in self.xf.items():
            if solver.value(var):
                _add(d, self.posts[p].id,
                     f"{self.employees[e].name}(с)", 24)

        for (e, d, p), var in self.xd.items():
            if solver.value(var):
                _add(d, self.posts[p].id,
                     f"{self.employees[e].name}(д)", 12)

        for (e, d, p), var in self.xn.items():
            if solver.value(var):
                _add(d, self.posts[p].id,
                     f"{self.employees[e].name}(н)", 12)

        result = {"schedule": schedule, "employee_hours": employee_hours}

        if self.relax:
            unfilled: list[dict] = []
            total_missing = 0
            for post, d, kind, short in self.shortfalls:
                miss = int(solver.value(short))
                if miss <= 0:
                    continue
                total_missing += miss
                unfilled.append({
                    "postId": post.id,
                    "post": post.name,
                    "day": d,
                    "kind": kind,
                    "count": miss,
                })
            result["relaxed"] = True
            result["unfilled"] = unfilled
            result["unfilledCount"] = total_missing

        return result
