/**
 * Security score. Higher is safer, and 100 means no risky exposure paths.
 *
 * This is the control plane formula (boppii lib/risk-score.ts on
 * cursor/beta-hardening). Rule-engine findings do not change the score.
 * Only exposure paths do. Within one severity the nth path adds weight/n:
 *
 *   critical 28/n, high 16/n, medium 6/n, low 2/n
 *
 * The penalty is that sum, rounded once (half away from zero, as
 * Math.round), then capped at 100. score = 100 - penalty.
 * Order inside a severity does not matter; the sum is the same.
 *
 * Grades: A is 100, B is 75–99, C is 50–74, D is 25–49, F is 0–24.
 *
 * The cases in test/fixtures/security-score-vector.json are the shared
 * vector. Keep them in step with the control plane.
 */
'use strict';

const PENALTY_WEIGHTS = Object.freeze({ critical: 28, high: 16, medium: 6, low: 2 });

function harmonicPenalty(weight, count) {
  let sum = 0;
  for (let n = 1; n <= count; n += 1) sum += weight / n;
  return sum;
}

function securityScore(paths) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const path of paths || []) {
    if (path && Object.prototype.hasOwnProperty.call(counts, path.severity)) counts[path.severity] += 1;
  }
  const rawPenalty = harmonicPenalty(PENALTY_WEIGHTS.critical, counts.critical)
    + harmonicPenalty(PENALTY_WEIGHTS.high, counts.high)
    + harmonicPenalty(PENALTY_WEIGHTS.medium, counts.medium)
    + harmonicPenalty(PENALTY_WEIGHTS.low, counts.low);
  const penalty = Math.min(100, Math.round(rawPenalty));
  const score = 100 - penalty;
  const grade = score === 100 ? 'A'
    : score >= 75 ? 'B'
      : score >= 50 ? 'C'
        : score >= 25 ? 'D'
          : 'F';
  return { score, grade, penalty, rawPenalty, counts, higherIsSafer: true };
}

module.exports = { PENALTY_WEIGHTS, securityScore };
