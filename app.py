#!/usr/bin/env python3
"""
Веб-интерфейс для системы расписания (Streamlit).

Запуск:
    streamlit run app.py
"""

from __future__ import annotations

import calendar
import json
from datetime import date, timedelta
from io import BytesIO
from pathlib import Path

import pandas as pd
import streamlit as st
import streamlit.components.v1 as components
from streamlit_sortables import sort_items

from schedule.data import Employee, MonthConfig, Post, compute_norm_hours
from schedule.export import export_to_excel
from schedule.solver import ScheduleSolver
from schedule.storage import Storage

DAY_NAMES = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

# ── Custom component ─────────────────────────────────────────────────
_calendar_component = components.declare_component(
    "calendar_select",
    path=str(Path(__file__).resolve().parent / "components" / "calendar_select"),
)


def calendar_select(
    year: int,
    month: int,
    mode: str,
    *,
    ranges: list | None = None,
    select_type: str = "vacation",
    selected_days: list | None = None,
    forced_days: list | None = None,
    key: str | None = None,
):
    return _calendar_component(
        year=year,
        month=month,
        mode=mode,
        ranges=ranges or [],
        selectType=select_type,
        selectedDays=selected_days or [],
        forcedDays=forced_days or [],
        key=key,
        default=None,
    )


# ── Helpers ───────────────────────────────────────────────────────────

MONTH_NAMES_RU = [
    "", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
    "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
]


def _month_label(y: int, m: int) -> str:
    return f"{MONTH_NAMES_RU[m]} {y}"


def get_storage() -> Storage:
    if "storage" not in st.session_state:
        st.session_state.storage = Storage()
    return st.session_state.storage


def _invalidate_solution():
    for k in ("last_solution", "last_config", "last_posts", "last_employees"):
        st.session_state.pop(k, None)


def _all_dates_in_year(year: int) -> list[date]:
    d = date(year, 1, 1)
    end = date(year, 12, 31)
    r: list[date] = []
    while d <= end:
        r.append(d)
        d += timedelta(days=1)
    return r


# ══════════════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════════════

def main():
    st.set_page_config(page_title="Расписание ЛД", page_icon="🏥", layout="wide")
    st.markdown(
        "<h1 style='text-align:center;margin-bottom:0'>🏥 График смен — Лучевая диагностика</h1>",
        unsafe_allow_html=True,
    )
    storage = get_storage()

    c1, c2, _, c_toggle = st.columns([1, 1, 2, 2])
    with c1:
        year = st.selectbox("Год", [2025, 2026, 2027], index=1)
    with c2:
        mn = [
            "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
            "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
        ]
        month = st.selectbox("Месяц", range(1, 13), index=5,
                             format_func=lambda m: mn[m - 1])
    with c_toggle:
        st.markdown("<br>", unsafe_allow_html=True)
        _mr = storage.load_month_raw(year, month)
        sen_filter = st.toggle(
            "Суточные (с) только стаж ≥ 5 лет",
            value=_mr.get("seniority_filter_24h", False),
            key="sen_filter")
        if sen_filter != _mr.get("seniority_filter_24h", False):
            _mr["seniority_filter_24h"] = sen_filter
            storage.save_month_raw(year, month, _mr)
    st.divider()

    tabs = st.tabs([
        "📋 Генерация графика",
        "👥 Сотрудники",
        "🖥️ Аппараты",
        "🏖️ Отпуска и больничные",
        "📅 Праздники",
    ])
    with tabs[0]:
        tab_schedule(storage, year, month)
    with tabs[1]:
        tab_employees(storage, year, month)
    with tabs[2]:
        tab_posts(storage, year, month)
    with tabs[3]:
        tab_absences(storage, year, month)
    with tabs[4]:
        tab_holidays(storage, year)


# ══════════════════════════════════════════════════════════════════════
#  ГЕНЕРАЦИЯ ГРАФИКА
# ══════════════════════════════════════════════════════════════════════

def tab_schedule(storage: Storage, year: int, month: int):
    month_raw = storage.load_month_raw(year, month)
    default_norm = compute_norm_hours(year, month)
    employees = storage.load_employees()
    posts = storage.load_posts()

    c1, c2, c3, c4 = st.columns([2, 1, 1, 1])
    with c1:
        norm = st.number_input(
            "Норма часов на ставку (месяц)",
            min_value=20.0, max_value=400.0, step=1.0,
            value=float(month_raw.get("norm_hours", default_norm)),
            key=f"norm_h_{year}_{month}",
            help=f"Авто-расчёт: {default_norm:.0f} ч (рабочие дни × 6ч)")
        if abs(norm - month_raw.get("norm_hours", default_norm)) > 0.01:
            month_raw["norm_hours"] = norm
            storage.save_month_raw(year, month, month_raw)
            _invalidate_solution()
    c2.metric("Норма", f"{norm:.0f} ч")
    c3.metric("Сотрудников", len(employees))
    c4.metric("Постов",
              sum(1 for p in posts if p.weekday_active or p.weekend_active))

    st.markdown("---")
    col_btn, col_time = st.columns([1, 2])
    with col_time:
        time_limit = st.slider("Лимит солвера (сек)", 10, 300, 120)
    with col_btn:
        st.markdown("<br>", unsafe_allow_html=True)
        run = st.button("🚀 Сгенерировать расписание", type="primary",
                        use_container_width=True)

    if run:
        with st.spinner("Солвер работает…"):
            config = storage.build_month_config(year, month)
            emps_raw = storage.load_employees_raw()
            post_prefs = {
                e["name"]: e.get("post_preferences", e.get("allowed_posts", []))
                for e in emps_raw
            }
            shift_prefs = {
                e["name"]: {
                    "pref_24h_full": e.get("pref_24h_full"),
                    "pref_24h_day": e.get("pref_24h_day"),
                    "pref_24h_night": e.get("pref_24h_night"),
                }
                for e in emps_raw
            }
            solver = ScheduleSolver(
                posts, employees, config,
                post_preferences=post_prefs,
                shift_preferences=shift_prefs,
                seniority_filter=st.session_state.get("sen_filter", False),
            )
            solution = solver.solve(time_limit_seconds=time_limit)

        if solution is None:
            st.error("Не удалось найти расписание. Попробуйте ослабить ограничения.")
            return

        st.session_state["last_solution"] = solution
        st.session_state["last_config"] = config
        st.session_state["last_posts"] = posts
        st.session_state["last_employees"] = employees
        st.success("Расписание сгенерировано!")

    if "last_solution" in st.session_state:
        _show_solution(
            st.session_state["last_solution"],
            st.session_state["last_posts"],
            st.session_state["last_employees"],
            st.session_state["last_config"],
        )
    elif not run:
        st.info("Нажмите «Сгенерировать расписание» для расчёта.")


def _show_solution(solution, posts, employees, config):
    schedule = solution["schedule"]
    hours = solution.get("employee_hours", {})

    # Pre-compute first shift after vacation for bold styling
    first_after_vac: dict[str, int] = {}
    for emp_name, absent_days in config.absences.items():
        if not absent_days:
            continue
        last_absent = max(absent_days)
        for d in config.days:
            if d <= last_absent:
                continue
            for p in posts:
                if any(emp_name in person
                       for person in schedule.get(d, {}).get(p.id, [])):
                    first_after_vac[emp_name] = d
                    break
            if emp_name in first_after_vac:
                break

    st.subheader("Расписание")
    post_cols = [p.name for p in posts]
    cols = ["Дата", "ДН"] + post_cols
    rows = []
    for d in config.days:
        dt = date(config.year, config.month, d)
        dow = DAY_NAMES[dt.weekday()]
        row = [f"{d:02d}.{config.month:02d}", dow]
        for p in posts:
            people = schedule.get(d, {}).get(p.id, [])
            if d not in config.post_active_days.get(p.id, []):
                row.append("—")
            else:
                row.append(", ".join(sorted(people)) if people else "⚠ пусто")
        rows.append(row)

    df = pd.DataFrame(rows, columns=cols)

    def style_table(df_s):
        styles = pd.DataFrame("", index=df_s.index, columns=df_s.columns)
        for row_idx, d in enumerate(config.days):
            dt = date(config.year, config.month, d)
            if dt.weekday() >= 5:
                for ci in range(len(df_s.columns)):
                    styles.iloc[row_idx, ci] = "background-color: #fce4ec"
            for ci, p in enumerate(posts):
                cell = str(df_s.iloc[row_idx][p.name])
                for emp_name, fav_day in first_after_vac.items():
                    if d == fav_day and emp_name in cell:
                        cur = styles.iloc[row_idx, ci + 2]
                        styles.iloc[row_idx, ci + 2] = (
                            (cur + "; " if cur else "") + "font-weight: bold"
                        )
                        break
        return styles

    st.dataframe(df.style.apply(style_table, axis=None),
                 use_container_width=True,
                 height=min(len(rows) * 35 + 40, 800))

    if first_after_vac:
        st.caption("**Жирным** выделена первая смена после отпуска/больничного.")

    st.subheader("Сводка часов")
    norm = config.norm_hours
    _, num_days = calendar.monthrange(config.year, config.month)
    srows = []
    for emp in sorted(employees, key=lambda e: e.name):
        actual = hours.get(emp.name, 0)
        eff_target = config.employee_target_hours.get(
            emp.name, norm * emp.rate)
        full_target = norm * emp.rate
        absent_count = len(config.absences.get(emp.name, []))
        delta = actual - eff_target
        status = "✅" if abs(delta) <= 12 else ("⚠️" if delta > 0 else "🔻")
        row_data = {
            "": status, "Сотрудник": emp.name, "Ставка": emp.rate,
            "Цель (полн.)": round(full_target),
        }
        if absent_count:
            row_data["Отсутств. дн."] = absent_count
            row_data["Цель (эфф.)"] = round(eff_target)
        else:
            row_data["Отсутств. дн."] = ""
            row_data["Цель (эфф.)"] = ""
        row_data["Факт"] = actual
        row_data["Δ"] = round(delta)
        srows.append(row_data)
    st.dataframe(pd.DataFrame(srows), use_container_width=True, hide_index=True)

    buf = BytesIO()
    export_to_excel(solution, posts, employees, config, buf)
    buf.seek(0)
    st.download_button(
        "📥 Скачать Excel", data=buf,
        file_name=f"schedule_{config.year}_{config.month:02d}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


# ══════════════════════════════════════════════════════════════════════
#  СОТРУДНИКИ
# ══════════════════════════════════════════════════════════════════════

def tab_employees(storage: Storage, year: int, month: int):
    st.subheader("Управление сотрудниками")

    emps = storage.load_employees_raw()
    posts_raw = storage.load_posts_raw()
    post_ids = [p["id"] for p in posts_raw]
    post_names = {p["id"]: p["name"] for p in posts_raw}
    month_raw = storage.load_month_raw(year, month)
    emp_day_cfgs: dict = month_raw.get("employee_day_config", {})

    to_delete = None

    for i, emp in enumerate(emps):
        with st.expander(
            f"👤 {emp['name']}  —  ставка {emp.get('rate', 1.0)}",
            expanded=False,
        ):
            # ── Basic info ──
            c1, c2, c3 = st.columns(3)
            with c1:
                emp["name"] = st.text_input("Имя", emp["name"], key=f"en_{i}")
                emp["rate"] = st.select_slider(
                    "Ставка", [0.25, 0.5, 0.75, 1.0],
                    value=emp.get("rate", 1.0), key=f"er_{i}")
            with c2:
                emp["max_rate"] = st.number_input(
                    "Макс. ставки", 0.5, 2.0,
                    emp.get("max_rate", 1.5), 0.25, key=f"emr_{i}")
                emp["seniority"] = st.number_input(
                    "Стаж (лет)", 0, 40, emp.get("seniority", 0), key=f"es_{i}")
            with c3:
                pref_map = {None: "Нейтрально", True: "Хочет больше",
                            False: "Только ставку"}
                pref_options = [None, True, False]
                pref_val = emp.get("prefers_overtime")
                pref_idx = (pref_options.index(pref_val)
                            if pref_val in pref_options else 0)
                emp["prefers_overtime"] = st.selectbox(
                    "Переработки", pref_options, index=pref_idx,
                    format_func=lambda v, m=pref_map: m[v], key=f"ep_{i}")

            # ── Добавление аппаратов (inline checkboxes) ──
            st.markdown("**Добавление аппаратов:**")
            current_posts = emp.get("allowed_posts", [])
            n_cols = min(len(post_ids), 6)
            cols = st.columns(n_cols)
            selected_posts: list[str] = []
            for j, pid in enumerate(post_ids):
                with cols[j % n_cols]:
                    if st.checkbox(
                        post_names.get(pid, pid),
                        value=pid in current_posts,
                        key=f"chip_{i}_{pid}",
                    ):
                        selected_posts.append(pid)
            emp["allowed_posts"] = selected_posts

            # ── Приоритет аппаратов (drag-and-drop) ──
            if len(selected_posts) > 1:
                st.markdown("**Приоритет аппаратов** _(перетащите для изменения)_:")
                stored_prefs = emp.get("post_preferences", [])
                prefs = [p for p in stored_prefs if p in selected_posts]
                for p in selected_posts:
                    if p not in prefs:
                        prefs.append(p)
                display = [post_names.get(pid, pid) for pid in prefs]
                sorted_display = sort_items(display, key=f"sortposts_{i}")
                display_set = set(display)
                result_set = set(sorted_display)
                for name in display:
                    if name not in result_set:
                        sorted_display.append(name)
                sorted_display = [n for n in sorted_display
                                  if n in display_set]
                name_to_id = {post_names.get(pid, pid): pid
                              for pid in selected_posts}
                emp["post_preferences"] = [
                    name_to_id[n] for n in sorted_display if n in name_to_id
                ]
            else:
                emp["post_preferences"] = list(selected_posts)

            # ── Preferences for 24h shift types ──
            _24h_ids = {p["id"] for p in posts_raw
                        if p.get("shift_hours", 12) == 24}
            if selected_posts and _24h_ids & set(selected_posts):
                st.markdown("**Предпочтения по суточным сменам:**")
                _so = [None, True, False]
                _sl = {None: "Нейтрально", True: "Предпочитаю",
                       False: "Не ставить"}
                sc1, sc2, sc3 = st.columns(3)
                with sc1:
                    v = emp.get("pref_24h_full")
                    emp["pref_24h_full"] = st.selectbox(
                        "Полные сутки (с)", _so,
                        index=_so.index(v) if v in _so else 0,
                        format_func=lambda x, m=_sl: m[x], key=f"p24f_{i}")
                with sc2:
                    v = emp.get("pref_24h_day")
                    emp["pref_24h_day"] = st.selectbox(
                        "Дневные (д)", _so,
                        index=_so.index(v) if v in _so else 0,
                        format_func=lambda x, m=_sl: m[x], key=f"p24d_{i}")
                with sc3:
                    v = emp.get("pref_24h_night")
                    emp["pref_24h_night"] = st.selectbox(
                        "Ночные (н)", _so,
                        index=_so.index(v) if v in _so else 0,
                        format_func=lambda x, m=_sl: m[x], key=f"p24n_{i}")

            # ── Доступность (day config) ──
            st.markdown("---")
            st.markdown(f"**Доступность — {_month_label(year, month)}:**")
            cfg = emp_day_cfgs.get(emp["name"],
                                   {"mode": "default", "weekdays": [],
                                    "specific_days": [], "forced_days": [],
                                    "work_weekdays": True,
                                    "work_weekends": True,
                                    "excluded_days": []})
            mode_opts = ["Будни/Выходные", "Дни недели", "Конкретные дни"]
            mode_map = {"default": 0, "weekdays": 1, "specific": 2}
            day_mode = st.radio(
                "Режим", mode_opts,
                index=mode_map.get(cfg.get("mode", "default"), 0),
                key=f"emp_dm_{i}", horizontal=True)

            if day_mode == "Будни/Выходные":
                cfg["mode"] = "default"
                wc1, wc2, _ = st.columns([1, 1, 5])
                with wc1:
                    cfg["work_weekdays"] = st.checkbox(
                        "Будни", value=cfg.get("work_weekdays", True),
                        key=f"emp_wwd_{i}")
                with wc2:
                    cfg["work_weekends"] = st.checkbox(
                        "Выходные", value=cfg.get("work_weekends", True),
                        key=f"emp_wwe_{i}")
            elif day_mode == "Дни недели":
                cfg["mode"] = "weekdays"
                cur_wd = cfg.get("weekdays", [0, 1, 2, 3, 4])
                wd_cols = st.columns(7)
                new_wd: list[int] = []
                for wi, wn in enumerate(DAY_NAMES):
                    with wd_cols[wi]:
                        if st.checkbox(wn, value=wi in cur_wd,
                                       key=f"emp_wd_{i}_{wi}"):
                            new_wd.append(wi)
                cfg["weekdays"] = new_wd
            else:
                cfg["mode"] = "specific"
                res = calendar_select(
                    year, month, "days",
                    selected_days=cfg.get("specific_days", []),
                    forced_days=cfg.get("forced_days", []),
                    key=f"cal_ed_{i}_{year}_{month}")
                if res is not None:
                    cfg["specific_days"] = res.get("selectedDays", [])
                    cfg["forced_days"] = res.get("forcedDays", [])

            # ── Negative days (exclusions) ──
            has_excl = st.checkbox(
                "Есть дни, когда ТОЧНО не может выйти",
                value=bool(cfg.get("excluded_days")),
                key=f"emp_excl_{i}")
            if has_excl:
                excl_res = calendar_select(
                    year, month, "toggle",
                    selected_days=cfg.get("excluded_days", []),
                    key=f"cal_excl_{i}_{year}_{month}")
                if excl_res is not None:
                    cfg["excluded_days"] = excl_res.get("selectedDays", [])
            else:
                cfg["excluded_days"] = []

            emp_day_cfgs[emp["name"]] = cfg

            # ── Delete (with confirmation) ──
            st.markdown("---")
            confirm_key = f"confirm_del_{i}"
            if st.session_state.get(confirm_key, False):
                st.warning(f"Удалить **{emp['name']}**? Это действие необратимо.")
                dc1, dc2, _ = st.columns([1, 1, 4])
                with dc1:
                    if st.button("Да, удалить", key=f"cfy_{i}",
                                 type="primary"):
                        to_delete = i
                        st.session_state[confirm_key] = False
                with dc2:
                    if st.button("Отмена", key=f"cfn_{i}"):
                        st.session_state[confirm_key] = False
                        st.rerun()
            else:
                if st.button("🗑️ Удалить сотрудника", key=f"del_{i}"):
                    st.session_state[confirm_key] = True
                    st.rerun()

    if to_delete is not None:
        emps.pop(to_delete)
        storage.save_employees_raw(emps)
        _invalidate_solution()
        st.rerun()

    st.divider()
    c_add, c_save = st.columns(2)
    with c_add:
        if st.button("➕ Добавить сотрудника"):
            emps.append({
                "name": "Новый сотрудник", "rate": 1.0, "allowed_posts": [],
                "post_preferences": [], "max_rate": 1.5, "seniority": 0,
                "prefers_overtime": None, "avoid_weekends": False,
            })
            storage.save_employees_raw(emps)
            _invalidate_solution()
            st.rerun()
    with c_save:
        if st.button("💾 Сохранить изменения", type="primary"):
            storage.save_employees_raw(emps)
            month_raw["employee_day_config"] = emp_day_cfgs
            storage.save_month_raw(year, month, month_raw)
            _invalidate_solution()
            st.success("Сохранено!")


# ══════════════════════════════════════════════════════════════════════
#  АППАРАТЫ
# ══════════════════════════════════════════════════════════════════════

def tab_posts(storage: Storage, year: int, month: int):
    st.subheader("Аппараты / Посты")

    posts_raw = storage.load_posts_raw()
    month_raw = storage.load_month_raw(year, month)
    post_day_cfgs: dict = month_raw.get("post_day_config", {})

    for i, post in enumerate(posts_raw):
        with st.expander(
            f"🖥️ {post['name']}  ({post.get('shift_hours', 12)}ч, "
            f"{post.get('staff_required', 1)} чел)",
            expanded=False,
        ):
            c1, c2, c3 = st.columns(3)
            with c1:
                post["name"] = st.text_input("Название", post["name"],
                                             key=f"pn_{i}")
                post["id"] = st.text_input("ID", post["id"], key=f"pi_{i}")
            with c2:
                post["shift_hours"] = st.selectbox(
                    "Смена (ч)", [12, 24],
                    index=0 if post.get("shift_hours", 12) == 12 else 1,
                    key=f"ps_{i}")
                post["staff_required"] = st.number_input(
                    "Людей", 1, 5, post.get("staff_required", 1), key=f"pr_{i}")
            with c3:
                post["weekday_active"] = st.checkbox(
                    "Будни", post.get("weekday_active", True), key=f"pw_{i}")
                post["weekend_active"] = st.checkbox(
                    "Выходные", post.get("weekend_active", False), key=f"pe_{i}")

            # ── Day config ──
            st.markdown("---")
            st.markdown(f"**Доступность — {_month_label(year, month)}:**")
            pid = post["id"]
            cfg = post_day_cfgs.get(
                pid,
                {"mode": "default", "weekdays": [],
                 "specific_days": [], "forced_days": []})

            mode_opts = ["Будни/Выходные", "Дни недели", "Конкретные дни"]
            mode_map = {"default": 0, "weekdays": 1, "specific": 2}
            day_mode = st.radio(
                "Режим", mode_opts,
                index=mode_map.get(cfg.get("mode", "default"), 0),
                key=f"post_dm_{i}", horizontal=True)

            if day_mode == "Будни/Выходные":
                cfg["mode"] = "default"
            elif day_mode == "Дни недели":
                cfg["mode"] = "weekdays"
                default_wd = list(range(5)) if post.get("weekday_active") else []
                if post.get("weekend_active"):
                    default_wd += [5, 6]
                cur_wd = cfg.get("weekdays", default_wd)
                wd_cols = st.columns(7)
                new_wd: list[int] = []
                for wi, wn in enumerate(DAY_NAMES):
                    with wd_cols[wi]:
                        if st.checkbox(wn, value=wi in cur_wd,
                                       key=f"post_wd_{i}_{wi}"):
                            new_wd.append(wi)
                cfg["weekdays"] = new_wd
            else:
                cfg["mode"] = "specific"
                res = calendar_select(
                    year, month, "toggle",
                    selected_days=cfg.get("specific_days", []),
                    key=f"cal_pd_{i}_{year}_{month}")
                if res is not None:
                    cfg["specific_days"] = res.get("selectedDays", [])

            post_day_cfgs[pid] = cfg

    if st.button("💾 Сохранить аппараты", type="primary"):
        storage.save_posts_raw(posts_raw)
        month_raw["post_day_config"] = post_day_cfgs
        storage.save_month_raw(year, month, month_raw)
        _invalidate_solution()
        st.success("Сохранено!")


# ══════════════════════════════════════════════════════════════════════
#  ОТПУСКА И БОЛЬНИЧНЫЕ
# ══════════════════════════════════════════════════════════════════════

def tab_absences(storage: Storage, year: int, month: int):
    st.subheader(f"Отпуска и больничные — {_month_label(year, month)}")

    emps_raw = storage.load_employees_raw()
    month_raw = storage.load_month_raw(year, month)
    absence_periods: dict = month_raw.get("absence_periods", {})

    all_names = [e["name"] for e in emps_raw]
    in_view = sorted(absence_periods.keys())
    available = [n for n in all_names if n not in in_view]

    # ── Add employee (auto-add on select) ──
    if available:
        new_emp = st.selectbox(
            "Добавить сотрудника",
            [""] + available,
            key="add_abs_emp",
            format_func=lambda x: x if x else "Выберите сотрудника…")
        if new_emp and new_emp not in absence_periods:
            absence_periods[new_emp] = []
            month_raw["absence_periods"] = absence_periods
            storage.save_month_raw(year, month, month_raw)
            st.rerun()

    if not in_view:
        st.info("Добавьте сотрудника через поле выше.")
        return

    # ── Per-employee cards ──
    for name in in_view:
        emp_periods = absence_periods.get(name, [])
        total = sum(p["end"] - p["start"] + 1 for p in emp_periods)
        summary = f"  ·  {total} дн." if total else ""
        cal_key = f"cal_abs_{name}_{year}_{month}"

        with st.expander(f"👤 {name}{summary}", expanded=False):
            tc, rc = st.columns([5, 1])
            with tc:
                stype = st.radio(
                    "Тип", ["🏖️ Отпуск", "🏥 Больничный"],
                    key=f"abs_t_{name}", horizontal=True,
                    label_visibility="collapsed")
                sel_type = "vacation" if "Отпуск" in stype else "sick"
            with rc:
                if st.button("✕ Убрать", key=f"rem_abs_{name}"):
                    del absence_periods[name]
                    month_raw["absence_periods"] = absence_periods
                    storage.save_month_raw(year, month, month_raw)
                    _invalidate_solution()
                    st.session_state.pop(cal_key, None)
                    st.rerun()

            result = calendar_select(
                year, month, "range",
                ranges=emp_periods,
                select_type=sel_type,
                key=cal_key)

            if result is not None:
                new_r = result.get("ranges", [])
                if json.dumps(new_r, sort_keys=True) != json.dumps(
                        emp_periods, sort_keys=True):
                    emp_periods = new_r
                    absence_periods[name] = emp_periods
                    month_raw["absence_periods"] = absence_periods
                    storage.save_month_raw(year, month, month_raw)
                    _invalidate_solution()
                    st.rerun()

            if emp_periods:
                st.markdown("**Периоды:**")
                for idx, p in enumerate(emp_periods):
                    pc1, pc2 = st.columns([8, 1])
                    emoji = "🏖️" if p.get("type") == "vacation" else "🏥"
                    tname = ("Отпуск" if p.get("type") == "vacation"
                             else "Больничный")
                    if p["start"] == p["end"]:
                        lbl = (f"{emoji} {p['start']:02d}.{month:02d}"
                               f" — {tname}")
                    else:
                        lbl = (f"{emoji} {p['start']:02d}–{p['end']:02d}"
                               f".{month:02d} — {tname}")
                    pc1.markdown(lbl)
                    if pc2.button("✕", key=f"dp_{name}_{idx}"):
                        emp_periods.pop(idx)
                        absence_periods[name] = emp_periods
                        month_raw["absence_periods"] = absence_periods
                        storage.save_month_raw(year, month, month_raw)
                        _invalidate_solution()
                        st.session_state.pop(cal_key, None)
                        st.rerun()


# ══════════════════════════════════════════════════════════════════════
#  ПРАЗДНИКИ
# ══════════════════════════════════════════════════════════════════════

def tab_holidays(storage: Storage, year: int):
    st.subheader(f"Производственный календарь — {year}")
    st.caption("Праздничные дни, в которые 12-часовые посты по умолчанию не работают.")

    existing = storage.load_holidays(year)
    existing_dates = []
    for d_str in existing:
        try:
            existing_dates.append(date.fromisoformat(d_str))
        except ValueError:
            pass

    new_dates = st.multiselect(
        "Праздничные дни",
        _all_dates_in_year(year),
        default=existing_dates,
        format_func=lambda d: f"{d.strftime('%d.%m')} ({DAY_NAMES[d.weekday()]})",
    )

    if st.button("💾 Сохранить праздники", type="primary"):
        storage.save_holidays(year, [d.isoformat() for d in new_dates])
        _invalidate_solution()
        st.success("Сохранено!")

    if existing_dates:
        st.markdown("**Текущий список:**")
        for d in sorted(existing_dates):
            st.text(f"  {d.strftime('%d.%m.%Y')} — {DAY_NAMES[d.weekday()]}")


if __name__ == "__main__":
    main()
