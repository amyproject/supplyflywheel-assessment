import { describe, expect, it } from "vitest";
import { band, summarize } from "@/lib/scoring";
import { CATEGORIES, QUESTIONS } from "@/lib/questions";

const all = (score: number) => QUESTIONS.map((q) => ({ question_code: q.code, score }));

describe("scoring", () => {
  it("weights sum to 100; 19 questions (E4 removed): 4 per category except E with 3", () => {
    expect(CATEGORIES.reduce((a, c) => a + c.weight, 0)).toBe(100);
    expect(QUESTIONS).toHaveLength(19);
    expect(QUESTIONS.some((q) => q.code === "E4")).toBe(false);
    for (const c of CATEGORIES) expect(QUESTIONS.filter((q) => q.category === c.code)).toHaveLength(c.code === "E" ? 3 : 4);
  });

  it("all 1s → 20, all 5s → 100, all 3s → 60", () => {
    expect(summarize(QUESTIONS, CATEGORIES, all(1)).final).toBe(20);
    expect(summarize(QUESTIONS, CATEGORIES, all(5)).final).toBe(100);
    expect(summarize(QUESTIONS, CATEGORIES, all(3)).final).toBe(60);
  });

  it("computes category_score = avg/5*weight and sums", () => {
    // A all 5 (30), B all 4 (16), C all 3 (12), D all 2 (8), E all 1 (2) = 68
    const scores: Record<string, number> = { A: 5, B: 4, C: 3, D: 2, E: 1 };
    const s = summarize(QUESTIONS, CATEGORIES, QUESTIONS.map((q) => ({ question_code: q.code, score: scores[q.category] })));
    expect(s.categories.map((c) => c.points)).toEqual([30, 16, 12, 8, 2]);
    expect(s.final).toBe(68);
    expect(band(s.final)).toBe("conditional");
  });

  it("final is null until every question is scored; provisional ignores unscored answers", () => {
    const s = summarize(QUESTIONS, CATEGORIES, [{ question_code: "A1", score: 4 }, { question_code: "B1", score: 2 }]);
    expect(s.final).toBeNull();
    expect(s.complete).toBe(false);
    // A avg 4 → 24/30, B avg 2 → 8/20 ; (24+8)/50*100 = 64
    expect(s.provisional).toBe(64);
    expect(s.categories.find((c) => c.code === "C")!.points).toBeNull();
  });

  it("averages multiple reviewers per question and ignores invalid scores", () => {
    const reviews = [...all(4), { question_code: "A1", score: 2 }, { question_code: "A1", score: 9 }];
    const s = summarize(QUESTIONS, CATEGORIES, reviews);
    // A: (3 + 4 + 4 + 4)/4 = 3.75 → 22.5 ; others avg 4 → 16*3 + 8 = 56 → 78.5
    expect(s.final).toBe(78.5);
  });

  it("bands", () => {
    expect(band(85)).toBe("finalist");
    expect(band(84.9)).toBe("interview");
    expect(band(70)).toBe("interview");
    expect(band(55)).toBe("conditional");
    expect(band(54.9)).toBe("not_recommended");
    expect(band(null)).toBeNull();
  });
});
