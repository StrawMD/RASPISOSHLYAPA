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
            seniority=e.get("seniority", 0),
            hospital_years=e.get("hospitalYears", e.get("seniority", 0) or 0),
            career_years=e.get(
                "careerYears",
                e.get("hospitalYears", e.get("seniority", 0) or 0),
            ),
            seniority_score=e.get("seniorityScore", 0),
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
    )

    post_prefs = input_data.get("postPreferences", {})
    shift_prefs = input_data.get("shiftPreferences", {})
    seniority_filter = input_data.get("seniorityFilter", False)
    time_limit = input_data.get("timeLimit", 120)
    weekday_prefs = input_data.get("weekdayPrefs", {})
    weekend_prefs = input_data.get("weekendPrefs", {})
    dow_prefs = input_data.get("dowPrefs", {})
    desired_dates = input_data.get("desiredDates", {})

    solver = ScheduleSolver(
        posts, employees, config,
        post_preferences=post_prefs,
        shift_preferences=shift_prefs,
        seniority_filter=seniority_filter,
        weekday_prefs=weekday_prefs,
        weekend_prefs=weekend_prefs,
        dow_prefs=dow_prefs,
        desired_dates=desired_dates,
    )

    result = solver.solve(time_limit_seconds=time_limit)

    if result is None:
        print(json.dumps({"error": "No solution found"}))
        sys.exit(0)

    output = {
        "schedule": {str(k): v for k, v in result["schedule"].items()},
        "employeeHours": result["employee_hours"],
    }

    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()
