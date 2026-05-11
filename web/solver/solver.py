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
        fixed_slots: dict[int, dict[str, list[str]]] | None = None,
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
        self.fixed_slots = fixed_slots or {}
        self.model = cp_model.CpModel()

        self.x: dict[tuple[int, int, int], cp_model.IntVar] = {}
        self.xf: dict[tuple[int, int, int], cp_model.IntVar] = {}
        self.xd: dict[tuple[int, int, int], cp_model.IntVar] = {}
        self.xn: dict[tuple[int, int, int], cp_model.IntVar] = {}

        self._24h_pidxs = frozenset(
            i for i, p in enumerate(self.posts) if p.shift_hours == 24
        )
        self._penalties: list = []
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
        self._hour_target_penalty()
        self._no_consecutive_shifts()
        self._prefer_2day_rest()
        self._prefer_full_shifts()
        self._post_preference_penalty()
        self._shift_type_penalty()
        self._shift_time_mode_penalty()
        self._weekend_fairness()
        self._weekday_weekend_penalty()
        self._day_of_week_penalty()
        self._desired_dates_bonus()

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

            for d in self.config.days:
                if d in emp_blocked:
                    continue
                for p, post in enumerate(self.posts):
                    if post.id not in emp.allowed_posts:
                        continue
                    if d not in self.config.post_active_days.get(post.id, []):
                        continue

                    if p in self._24h_pidxs:
                        # Full-shift eligibility: seniority filter or legacy
                        # `avoid` flag.  "only_full" keeps xf — it's other
                        # shifts that are blocked in that mode.
                        can_full = True
                        if self.seniority_filter and emp.hospital_years < 5:
                            can_full = False
                        if sp.get("pref_24h_full") is False:
                            can_full = False

                        # Hard blocks only for legacy "avoid" flags and the
                        # aggregate "only_full" mode.  Soft modes
                        # ("prefer_full", "prefer_day") bias via penalties in
                        # `_shift_time_mode_penalty`.
                        block_day = (
                            sp.get("pref_24h_day") is False
                            or mode == "only_full"
                        )
                        block_night = (
                            sp.get("pref_24h_night") is False
                            or mode == "only_full"
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
                    if len(night_emps) < S_night:
                        _log(f"  ⚠  {post.name} день {d}: "
                             f"ночное покрытие {len(night_emps)}/{S_night}")

                    all_day = f_vars + d_vars
                    all_night = f_vars + n_vars
                    if all_day:
                        self.model.add(
                            sum(all_day) == min(S_day, len(day_emps)))
                    if all_night:
                        self.model.add(
                            sum(all_night) == min(S_night, len(night_emps)))
                else:
                    S = post.staff_required
                    assigned = [self.x[e, d, p]
                                for e in range(len(self.employees))
                                if (e, d, p) in self.x]
                    n = len(assigned)
                    if n < S:
                        _log(f"  ⚠  {post.name} день {d}: "
                             f"доступно {n}, нужно {S}")
                    if n == 0:
                        continue
                    self.model.add(sum(assigned) == min(S, n))

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
            self._penalties.append(500 * under)
            self._penalties.append(200 * over)

    def _no_consecutive_shifts(self):
        days = self.config.days
        for e in range(len(self.employees)):
            for i in range(len(days) - 1):
                d, dn = days[i], days[i + 1]
                today = self._all_vars_day(e, d)
                tomorrow = self._all_vars_day(e, dn)
                if not today or not tomorrow:
                    continue
                wt = self.model.new_bool_var(f"wd_{e}_{d}")
                wn = self.model.new_bool_var(f"wt_{e}_{d}")
                self.model.add_max_equality(wt, today)
                self.model.add_max_equality(wn, tomorrow)
                c = self.model.new_bool_var(f"consec_{e}_{d}")
                self.model.add(wt + wn <= 1 + c)
                self._penalties.append(1000 * c)

    def _prefer_2day_rest(self):
        """2 days rest after full 24h or night shift (soft)."""
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
                        self._penalties.append(80 * v)
                    if (e, d, p) in self.xn:
                        v = self.model.new_bool_var(f"r2n_{e}_{d}_{p}")
                        self.model.add(self.xn[e, d, p] + wd2 <= 1 + v)
                        self._penalties.append(80 * v)

    def _prefer_full_shifts(self):
        """Prefer monolithic 24h shifts (с) over two separate 12h (д)+(н).

        Monolith reward (strong) plus a per-partial-shift penalty so that the
        solver only falls back to split day/night when hour balance truly
        requires it.
        """
        FULL_REWARD = 500
        PARTIAL_PENALTY = 200
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

            for d in self.config.days:
                for p, post in enumerate(self.posts):
                    level = prefs.get(post.id, "neutral")
                    if level == "neutral":
                        continue
                    if level == "prefer":
                        w = -(30 + senior_bonus)
                    else:  # avoid
                        w = 50 + senior_bonus
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
        PREFER_REWARD = 120
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
        BIAS = 600
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
        self._penalties.append(30 * sp)

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

            for d in self.config.days:
                is_wknd = self.config.is_weekend(d)
                vs = self._all_vars_day(e, d)
                if not vs:
                    continue

                pref = we_pref if is_wknd else wd_pref
                if not pref:
                    continue
                if pref == "prefer":
                    w = -(10 + senior_bonus)
                elif pref == "avoid":
                    w = 30 + senior_bonus
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
            for d in self.config.days:
                dow_str = str(self.config.day_of_week(d) + 1)
                level = prefs.get(dow_str)
                if not level:
                    continue
                if level == "prefer":
                    w = -(10 + senior_bonus)
                elif level == "avoid":
                    w = 25 + senior_bonus
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
            bonus = -(20 + senior_bonus)
            date_set = set(dates)
            for d in self.config.days:
                if d not in date_set:
                    continue
                vs = self._all_vars_day(e, d)
                for v in vs:
                    self._penalties.append(bonus * v)

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
        return None

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

        return {"schedule": schedule, "employee_hours": employee_hours}
