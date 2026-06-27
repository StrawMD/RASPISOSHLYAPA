#!/usr/bin/env python3
"""
Bridge script: reads solver input as JSON from a file, runs the solver,
and writes the result as JSON to stdout.

Usage: python3 solve.py input.json
"""

import json
import sys
from data import Post, Employee, MonthConfig, generate_month_config
from solver import ScheduleSolver


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: solve.py <input.json>"}))
        sys.exit(1)

    with open(sys.argv[1], "r", encoding="utf-8") as f:
        input_data = json.load(f)

    posts = [
        Post(
            id=p["id"],
            name=p["name"],
            shift_hours=p["shiftHours"],
            staff_required=p["staffRequired"],
            weekday_active=p.get("weekdayActive", True),
            weekend_active=p.get("weekendActive", False),
            staff_required_day=p.get("staffRequiredDay"),
            staff_required_night=p.get("staffRequiredNight"),
        )
        for p in input_data["posts"]
    ]

    employees = [
        Employee(
            name=e["name"],
            rate=e["rate"],
            allowed_posts=e["allowedPosts"],
            max_rate=e.get("maxRate", 1.5),
            target_rate=e.get("targetRate", e.get("rate", 1.0)),
            seniority=e.get("seniority", 0),
            hospital_years=e.get("hospitalYears", e.get("seniority", 0) or 0),
            career_years=e.get(
                "careerYears",
                e.get("hospitalYears", e.get("seniority", 0) or 0),
            ),
            seniority_score=e.get("seniorityScore", 0),
            consecutive_pref=e.get("consecutivePref", "avoid") or "avoid",
            medical_restriction=e.get("medicalRestriction", "none") or "none",
            can_24h=bool(e.get("can24h", True)),
            max_nights=e.get("maxNights"),
            max_full=e.get("maxFull"),
            min_shifts=e.get("minShifts"),
            avoid_same_post=bool(e.get("avoidSamePost", False)),
            prefer_same_post=bool(e.get("preferSamePost", False)),
        )
        for e in input_data["employees"]
    ]

    cfg = input_data["config"]
    config = generate_month_config(
        year=cfg["year"],
        month=cfg["month"],
        norm_hours=cfg.get("normHours"),
        post_overrides=cfg.get("postOverrides"),
        absences=cfg.get("absences", {}),
        exclusions=cfg.get("exclusions", {}),
        employee_target_hours=cfg.get("employeeTargetHours", {}),
        employee_max_hours=cfg.get("employeeMaxHours", {}),
        employee_hard_max_hours=cfg.get("employeeHardMaxHours", {}),
        employee_floor_hours=cfg.get("employeeFloorHours", {}),
        employee_fair_hours=cfg.get("employeeFairHours", {}),
        posts=posts,
    )

    post_prefs = input_data.get("postPreferences", {})
    post_shift_prefs = input_data.get("postShiftPrefs", {})
    dow_shift_avoid = input_data.get("dowShiftAvoid", {})
    shift_prefs = input_data.get("shiftPreferences", {})
    shift_time_modes = input_data.get("shiftTimeModes", {})
    seniority_filter = input_data.get("seniorityFilter", False)
    time_limit = input_data.get("timeLimit", 900)
    night_share_cap_percent = input_data.get("nightShareCapPercent", 50)
    weekday_prefs = input_data.get("weekdayPrefs", {})
    weekend_prefs = input_data.get("weekendPrefs", {})
    dow_prefs = input_data.get("dowPrefs", {})
    desired_dates = input_data.get("desiredDates", {})
    soft_unavailable = input_data.get("softUnavailableDays", {})
    avoid_with = input_data.get("avoidWith", {})
    prefer_with = input_data.get("preferWith", {})
    weights = input_data.get("weights", {})

    raw_fixed = cfg.get("fixedSlots") or {}
    fixed_slots: dict[int, dict[str, list[str]]] = {}
    if isinstance(raw_fixed, dict):
        for dk, posts_dict in raw_fixed.items():
            try:
                d = int(dk)
            except (TypeError, ValueError):
                continue
            if not isinstance(posts_dict, dict):
                continue
            fixed_slots[d] = {}
            for pid, labels in posts_dict.items():
                if isinstance(labels, list):
                    fixed_slots[d][str(pid)] = [str(x) for x in labels]
                else:
                    fixed_slots[d][str(pid)] = []

    # relax=True → покрытие постов становится мягким: солвер всегда выдаёт
    # черновик с явным списком незакрытых слотов (см. ниже автo-fallback).
    relax_requested = bool(input_data.get("relax", False))

    def build_solver(relax: bool) -> ScheduleSolver:
        return ScheduleSolver(
            posts, employees, config,
            post_preferences=post_prefs,
            post_shift_prefs=post_shift_prefs,
            dow_shift_avoid=dow_shift_avoid,
            shift_preferences=shift_prefs,
            shift_time_modes=shift_time_modes,
            seniority_filter=seniority_filter,
            weekday_prefs=weekday_prefs,
            weekend_prefs=weekend_prefs,
            dow_prefs=dow_prefs,
            desired_dates=desired_dates,
            soft_unavailable=soft_unavailable,
            avoid_with=avoid_with,
            prefer_with=prefer_with,
            weights=weights,
            fixed_slots=fixed_slots if fixed_slots else None,
            relax=relax,
            night_share_cap_percent=night_share_cap_percent,
        )

    solver = build_solver(relax=relax_requested)
    result = solver.solve(time_limit_seconds=time_limit)

    if result is None:
        errs = getattr(solver, "_fixed_slot_errors", None)
        if errs:
            print(
                json.dumps(
                    {"error": "fixed_slots", "messages": errs},
                    ensure_ascii=False,
                )
            )
        else:
            diagnostics = getattr(solver, "diagnostics", None) or []
            print(
                json.dumps(
                    {"error": "No solution found", "diagnostics": diagnostics},
                    ensure_ascii=False,
                )
            )
        sys.exit(0)

    output = {
        "schedule": {str(k): v for k, v in result["schedule"].items()},
        "employeeHours": result["employee_hours"],
        "overtime": result.get("overtime", []),
        "emergencyOvertimeTotal": result.get("emergencyOvertimeTotal", 0),
    }
    if result.get("relaxed"):
        output["relaxed"] = True
        output["unfilled"] = result.get("unfilled", [])
        output["unfilledCount"] = result.get("unfilledCount", 0)

    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
