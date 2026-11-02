/**
 * Security score. Higher is safer: 100 and grade A means no risky AI access.
 *
 * The control plane's current risk points (boppii apps/control-plane
 * lib/risk-score.ts) add 40 for each critical finding, 25 high, 10 medium,
 * and 4 low, then cap the sum at 100. Three criticals already saturate that
 * sum, and the control plane is revising the formula. This function is the
 * only place the scanner turns findings into a score, so the weights can be
 * replaced without touching the report.
 *
 *   riskPoints = min(100, 40*critical + 25*high + 10*medium + 4*low)
 *   score      = 100 - riskPoints
 *
 * Grades are the control plane's risk bands, flipped onto that score:
 *   A = 100      (0 risk points)
 *   B = 76–99    (1–24 risk points)
 *   C = 51–75    (25–49)
 *   D = 26–50    (50–74)
 *   F = 0–25     (75–100)
 */
'use strict';

const RISK_WEIGHTS = Object.freeze({ critical: 40, high: 25, medium: 10, low: 4 });

function securityScore(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings || []) {
    if (Object.prototype.hasOwnProperty.call(counts, finding && finding.severity)) counts[finding.severity] += 1;
  }
  const raw = counts.critical * RISK_WEIGHTS.critical
    + counts.high * RISK_WEIGHTS.high
    + counts.medium * RISK_WEIGHTS.medium
    + counts.low * RISK_WEIGHTS.low;
  const riskPoints = Math.min(100, raw);
  const score = 100 - riskPoints;
  const grade = score === 100 ? 'A'
    : score >= 76 ? 'B'
      : score >= 51 ? 'C'
        : score >= 26 ? 'D'
          : 'F';
  return { score, grade, riskPoints, counts, higherIsSafer: true };
}

module.exports = { RISK_WEIGHTS, securityScore };
