/**
 * Grades run from F to A+ in thirds of a letter. New contacts sit at D, the
 * same baseline Pardot uses, so a profile that matches nothing is neither
 * endorsed nor penalised.
 */
export const GRADE_LETTERS = [
  "F",
  "D-",
  "D",
  "D+",
  "C-",
  "C",
  "C+",
  "B-",
  "B",
  "B+",
  "A-",
  "A",
  "A+",
] as const;
export type GradeLetter = (typeof GRADE_LETTERS)[number];

const BASELINE_INDEX = GRADE_LETTERS.indexOf("D");

export const MIN_GRADE_POINTS = -BASELINE_INDEX;
export const MAX_GRADE_POINTS = GRADE_LETTERS.length - 1 - BASELINE_INDEX;

/** Clamps to the printable range so an extreme criteria set cannot fall off the scale. */
export function clampGradePoints(points: number): number {
  return Math.max(MIN_GRADE_POINTS, Math.min(MAX_GRADE_POINTS, Math.trunc(points)));
}

export function gradeLetter(points: number): GradeLetter {
  return GRADE_LETTERS[BASELINE_INDEX + clampGradePoints(points)] ?? "D";
}
