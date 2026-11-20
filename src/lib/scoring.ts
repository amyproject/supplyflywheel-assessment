/**
 * Scoring (PRD §6). Pure functions, no I/O.
 *
 * category_score = average(answer_scores_in_category) / 5 * category_weight
 * final_score    = sum(category_scores), defined only when every question is scored.
 * Provisional    = scored categories only, renormalized to 100; unscored answers are never treated as zero.
 * With several reviewers, a question's score is the mean of its reviewers' scores.
 */

export interface ScoringQuestion {
  code: string;
  category: string;
}
export interface ScoringCategory {
  code: string;
  weight: number;
}
export interface ReviewScore {
  question_code: string;
  score: number;
  reviewer_id?: string;
}

export interface CategoryBreakdown {
  code: string;
  weight: number;
  scored: number;
  total: number;
  /** Mean of question scores (1–5), null when nothing is scored. */
  average: number | null;
  /** Weighted points contributed (0..weight), null when nothing is scored. */
  points: number | null;
}

export interface ScoreSummary {
  categories: CategoryBreakdown[];
  scoredQuestions: number;
  totalQuestions: number;
  /** Final weighted score on 20–100; null until every question is scored. */
  final: number | null;
  /** Renormalized score over scored categories; null when nothing is scored. */
  provisional: number | null;
  complete: boolean;
}

export type Band = "finalist" | "interview" | "conditional" | "not_recommended";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Mean score per question across reviewers; invalid scores are ignored. */
export function questionScores(reviews: ReviewScore[]): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const r of reviews) {
    if (!Number.isInteger(r.score) || r.score < 1 || r.score > 5) continue;
    const s = sums.get(r.question_code) ?? { sum: 0, n: 0 };
    s.sum += r.score;
    s.n += 1;
    sums.set(r.question_code, s);
  }
  const out = new Map<string, number>();
  for (const [k, v] of sums) out.set(k, v.sum / v.n);
  return out;
}

export function summarize(questions: ScoringQuestion[], categories: ScoringCategory[], reviews: ReviewScore[]): ScoreSummary {
  const scores = questionScores(reviews);
  const breakdown: CategoryBreakdown[] = categories.map((c) => {
    const qs = questions.filter((q) => q.category === c.code);
    const vals = qs.map((q) => scores.get(q.code)).filter((v): v is number => v !== undefined);
    const average = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return {
      code: c.code,
      weight: c.weight,
      scored: vals.length,
      total: qs.length,
      average: average === null ? null : Math.round(average * 100) / 100,
      points: average === null ? null : round1((average / 5) * c.weight),
    };
  });

  const totalQuestions = questions.length;
  const scoredQuestions = questions.filter((q) => scores.has(q.code)).length;
  const complete = totalQuestions > 0 && scoredQuestions === totalQuestions;

  // Use unrounded values for the totals so rounding happens once.
  const exact = categories.map((c) => {
    const qs = questions.filter((q) => q.category === c.code);
    const vals = qs.map((q) => scores.get(q.code)).filter((v): v is number => v !== undefined);
    return { weight: c.weight, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null };
  });
  const final = complete ? round1(exact.reduce((acc, c) => acc + ((c.avg ?? 0) / 5) * c.weight, 0)) : null;
  const scoredCats = exact.filter((c) => c.avg !== null);
  const scoredWeight = scoredCats.reduce((a, c) => a + c.weight, 0);
  const provisional = scoredWeight > 0 ? round1((scoredCats.reduce((a, c) => a + ((c.avg as number) / 5) * c.weight, 0) / scoredWeight) * 100) : null;

  return { categories: breakdown, scoredQuestions, totalQuestions, final, provisional, complete };
}

/** Heuristic bands from the PRD; not validated psychometric cutoffs. */
export function band(score: number | null): Band | null {
  if (score === null) return null;
  if (score >= 85) return "finalist";
  if (score >= 70) return "interview";
  if (score >= 55) return "conditional";
  return "not_recommended";
}
