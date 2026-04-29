/**
 * Seniority / tenure helpers.
 *
 * Employee tenure is stored as two starting years:
 *   - hospitalStartYear — год начала работы именно в больнице
 *   - careerStartYear   — год начала карьеры в профессии (включая другие места)
 *
 * `seniority` (legacy Int) is kept as a fallback when the new fields are null
 * (migrated rows, or ручной ввод до миграции).
 *
 * Solver weight:
 *   score = HOSPITAL_WEIGHT * hospitalYears
 *         + EXTERNAL_WEIGHT * max(0, careerYears - hospitalYears)
 */

export const HOSPITAL_WEIGHT = 3;
export const EXTERNAL_WEIGHT = 1;
export const MAX_SCORE = 60;

export interface TenureInput {
  hospitalStartYear: number | null | undefined;
  careerStartYear: number | null | undefined;
  seniority?: number | null;
}

export interface TenureResult {
  hospitalYears: number;
  careerYears: number;
  externalYears: number;
  score: number;
}

export function computeTenure(
  input: TenureInput,
  referenceYear: number = new Date().getFullYear()
): TenureResult {
  const legacy = Math.max(0, input.seniority ?? 0);

  const hospitalRaw =
    input.hospitalStartYear != null
      ? referenceYear - input.hospitalStartYear
      : null;
  const careerRaw =
    input.careerStartYear != null
      ? referenceYear - input.careerStartYear
      : null;

  const hospitalYears =
    hospitalRaw != null && hospitalRaw >= 0
      ? hospitalRaw
      : legacy;

  // If only hospital year is set, assume career >= hospital.
  const careerYears =
    careerRaw != null && careerRaw >= 0
      ? Math.max(careerRaw, hospitalYears)
      : Math.max(legacy, hospitalYears);

  const externalYears = Math.max(0, careerYears - hospitalYears);

  const rawScore =
    HOSPITAL_WEIGHT * hospitalYears + EXTERNAL_WEIGHT * externalYears;
  const score = Math.min(rawScore, MAX_SCORE);

  return { hospitalYears, careerYears, externalYears, score };
}

/** Russian word form for "год/года/лет". */
export function yearsWord(n: number): string {
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return "лет";
  if (mod10 === 1) return "год";
  if (mod10 >= 2 && mod10 <= 4) return "года";
  return "лет";
}
