/** Общие настройки солвера (хранятся в Setting.solverConfig). */

export type SolverConfig = {
  /** Жёсткий потолок доли ночных смен у сотрудника, %. */
  nightShareCapPercent: number;
  /** Дефолтный лимит времени CP-SAT (сек) при генерации. */
  defaultTimeLimitSeconds: number;
};

export const DEFAULT_SOLVER_CONFIG: SolverConfig = {
  nightShareCapPercent: 50,
  defaultTimeLimitSeconds: 900,
};

export function mergeSolverConfig(
  saved: Partial<SolverConfig> | null | undefined,
): SolverConfig {
  const s = saved ?? {};
  const cap =
    typeof s.nightShareCapPercent === "number" &&
    Number.isFinite(s.nightShareCapPercent)
      ? Math.round(s.nightShareCapPercent)
      : DEFAULT_SOLVER_CONFIG.nightShareCapPercent;
  const tl =
    typeof s.defaultTimeLimitSeconds === "number" &&
    Number.isFinite(s.defaultTimeLimitSeconds)
      ? Math.round(s.defaultTimeLimitSeconds)
      : DEFAULT_SOLVER_CONFIG.defaultTimeLimitSeconds;
  return {
    nightShareCapPercent: Math.min(100, Math.max(1, cap)),
    defaultTimeLimitSeconds: Math.min(1800, Math.max(10, tl)),
  };
}
