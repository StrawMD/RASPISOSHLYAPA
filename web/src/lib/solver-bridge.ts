import { exec } from "child_process";
import { writeFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

export interface SolverInput {
  posts: {
    id: string;
    name: string;
    shiftHours: number;
    staffRequired: number;
    staffRequiredDay?: number | null;
    staffRequiredNight?: number | null;
    weekdayActive: boolean;
    weekendActive: boolean;
  }[];
  employees: {
    name: string;
    rate: number;
    allowedPosts: string[];
    maxRate: number;
    targetRate?: number;
    seniority: number;
    hospitalYears: number;
    careerYears: number;
    seniorityScore: number;
    consecutivePref?: string;
    medicalRestriction?: string;
    can24h?: boolean;
    maxNights?: number | null;
    maxFull?: number | null;
    minShifts?: number | null;
    avoidSamePost?: boolean;
  }[];
  config: {
    year: number;
    month: number;
    normHours?: number;
    postOverrides?: Record<string, number[]>;
    absences?: Record<string, number[]>;
    exclusions?: Record<string, number[]>;
    employeeTargetHours?: Record<string, number>;
    employeeMaxHours?: Record<string, number>;
    /** Аварийный потолок часов (maxRate + буфер, ≤ 2.0). Жёсткий предел. */
    employeeHardMaxHours?: Record<string, number>;
    /** «Пол» базовой ставки (rate × норма × доступность) — заполняется почти жёстко. */
    employeeFloorHours?: Record<string, number>;
    /** День (строка 1..31) → postId → список ячеек — жёстко заданные смены */
    fixedSlots?: Record<string, Record<string, string[]>>;
  };
  postPreferences?: Record<string, Record<string, string>>;
  /** name → postId → { full|day|night: "prefer"|"avoid" } (только суточные посты) */
  postShiftPrefs?: Record<string, Record<string, Record<string, string>>>;
  /** name → dow("1".."7") → { full?|night?|day?: true } — не ставить тип смены в этот день недели */
  dowShiftAvoid?: Record<string, Record<string, Record<string, boolean>>>;
  shiftPreferences?: Record<string, Record<string, boolean | null>>;
  shiftTimeModes?: Record<string, string>;
  seniorityFilter?: boolean;
  timeLimit?: number;
  weekdayPrefs?: Record<string, string>;
  weekendPrefs?: Record<string, string>;
  dowPrefs?: Record<string, Record<string, string>>;
  desiredDates?: Record<string, number[]>;
  softUnavailableDays?: Record<string, number[]>;
  avoidWith?: Record<string, string[]>;
  preferWith?: Record<string, string[]>;
  /** Конфигурируемые веса целевой функции (любой 0 = выключить фактор). */
  weights?: Record<string, number>;
  /** Режим релаксации: разрешить незакрытые слоты (мягкое покрытие). */
  relax?: boolean;
}

export interface SolverOutput {
  schedule: Record<string, Record<string, string[]>>;
  employeeHours: Record<string, number>;
  /** true, если расписание составлено в режиме релаксации (с пропусками). */
  relaxed?: boolean;
  /** Структурированный список незакрытых слотов. */
  unfilled?: UnfilledSlot[];
  /** Суммарное число незакрытых позиций. */
  unfilledCount?: number;
  /** Переработки по людям: над целью и (отдельно) над желаемым потолком. */
  overtime?: OvertimeRow[];
  /** Суммарная аварийная переработка (часы сверх желаемых потолков). */
  emergencyOvertimeTotal?: number;
}

export interface OvertimeRow {
  name: string;
  /** Часы сверх целевых. */
  overTarget: number;
  /** Часы сверх желаемого потолка (аварийная переработка). */
  overCeiling: number;
}

export interface UnfilledSlot {
  postId: string;
  post: string;
  day: number;
  /** «день» | «ночь» | «смена» */
  kind: string;
  count: number;
}

/** Ошибка нерешаемости с человекочитаемыми причинами. */
export class SolverInfeasibleError extends Error {
  diagnostics: string[];
  constructor(diagnostics: string[]) {
    const head =
      "Расписание не удалось составить с текущими ограничениями.";
    super(
      diagnostics.length
        ? `${head}\nВозможные причины:\n• ${diagnostics.join("\n• ")}`
        : head,
    );
    this.name = "SolverInfeasibleError";
    this.diagnostics = diagnostics;
  }
}

export async function runSolver(input: SolverInput): Promise<SolverOutput> {
  const inputPath = join(tmpdir(), `solver_${randomUUID()}.json`);
  const solverDir = join(process.cwd(), "solver");

  await writeFile(inputPath, JSON.stringify(input), "utf-8");

  try {
    const result = await new Promise<string>((resolve, reject) => {
      exec(
        `python3 solve.py "${inputPath}"`,
        {
          cwd: solverDir,
          timeout: (input.timeLimit ?? 120) * 1000 + 30000,
          maxBuffer: 10 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            reject(new Error(`Solver failed: ${stderr || error.message}`));
            return;
          }
          resolve(stdout);
        }
      );
    });

    const jsonLine = result
      .split("\n")
      .reverse()
      .find((l) => l.trimStart().startsWith("{"));
    if (!jsonLine) {
      throw new Error(`Solver returned no JSON. Output: ${result.slice(0, 500)}`);
    }
    const parsed = JSON.parse(jsonLine) as {
      error?: string;
      messages?: string[];
      diagnostics?: string[];
      schedule?: SolverOutput["schedule"];
      employeeHours?: SolverOutput["employeeHours"];
      relaxed?: boolean;
      unfilled?: UnfilledSlot[];
      unfilledCount?: number;
      overtime?: OvertimeRow[];
      emergencyOvertimeTotal?: number;
    };
    if (parsed.error === "fixed_slots" && Array.isArray(parsed.messages)) {
      throw new Error(parsed.messages.join("; "));
    }
    if (parsed.error === "No solution found") {
      throw new SolverInfeasibleError(parsed.diagnostics ?? []);
    }
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    return parsed as SolverOutput;
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}
