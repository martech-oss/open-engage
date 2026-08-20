export interface ScoringRuleMatch {
  id: string;
  name: string;
  matchType: string;
  matchValue: string | null;
  points: number;
  categoryId: string | null;
  tagId: string | null;
}

export interface GradingContactRow {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  stage: string;
  score: number;
  gradePoints: number;
  customFields: string;
}
