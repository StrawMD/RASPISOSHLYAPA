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
    seniority: number;
    hospitalYears: number;
    careerYears: number;
    seniorityScore: number;
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
  };
  postPreferences?: Record<string, Record<string, string>>;
  shiftPreferences?: Record<string, Record<string, boolean | null>>;
  shiftTimeModes?: Record<string, string>;
  seniorityFilter?: boolean;
  timeLimit?: number;
  weekdayPrefs?: Record<string, string>;
  weekendPrefs?: Record<string, string>;
  dowPrefs?: Record<string, Record<string, string>>;
  desiredDates?: Record<string, number[]>;
}

export interface SolverOutput {
  schedule: Record<string, Record<string, string[]>>;
  employeeHours: Record<string, number>;
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
    const parsed = JSON.parse(jsonLine);
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    return parsed as SolverOutput;
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}
