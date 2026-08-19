import { describe, expect, it } from "vitest";

import { clampGradePoints, gradeLetter, MAX_GRADE_POINTS, MIN_GRADE_POINTS } from "./grade.js";

describe("gradeLetter", () => {
  it("starts a fresh contact at the D baseline", () => {
    expect(gradeLetter(0)).toBe("D");
  });

  it("moves a whole letter every three steps", () => {
    expect(gradeLetter(3)).toBe("C");
    expect(gradeLetter(6)).toBe("B");
    expect(gradeLetter(9)).toBe("A");
  });

  it("renders the thirds between letters", () => {
    expect(gradeLetter(1)).toBe("D+");
    expect(gradeLetter(2)).toBe("C-");
    expect(gradeLetter(-1)).toBe("D-");
  });

  it("clamps beyond the printable scale instead of falling off it", () => {
    expect(gradeLetter(999)).toBe("A+");
    expect(gradeLetter(-999)).toBe("F");
    expect(clampGradePoints(999)).toBe(MAX_GRADE_POINTS);
    expect(clampGradePoints(-999)).toBe(MIN_GRADE_POINTS);
  });
});
