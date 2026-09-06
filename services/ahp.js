/**
 * Minimal Analytic Hierarchy Process (AHP) utility.
 *
 * Every weight used by the priority engine (services/priorityConfig.js) is
 * computed by this module from a documented 1-9 criticality judgment,
 * instead of being a hand-picked literal. This file implements the actual
 * math (not just the label "AHP") so the derivation is re-runnable and the
 * consistency of the underlying judgments is checked, not just asserted.
 *
 * References:
 * - Saaty, T.L. (1980). The Analytic Hierarchy Process. McGraw-Hill.
 * - Saaty, T.L. (2000). Fundamentals of Decision Making and Priority Theory.
 *   RWS Publications. Establishes the Consistency Ratio (CR) <= 0.10
 *   acceptability threshold used below.
 * - The Random Index (RI) table is Saaty's published average Consistency
 *   Index of large samples of randomly generated reciprocal matrices, by
 *   matrix size (widely reproduced, e.g. https://doi.org/10.1023/A:1004953014736).
 */

// Saaty's Random Index (RI) for matrix sizes 1-10.
const RANDOM_INDEX = [0, 0, 0, 0.58, 0.90, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49];

/**
 * Build a pairwise comparison matrix from directly-elicited 1-9 criticality
 * scores using Saaty's "ratio estimation" variant: a_ij = score_i / score_j.
 *
 * This construction is guaranteed perfectly consistent (CR = 0) because it
 * is a rank-1 matrix by definition -- that is expected, and is NOT evidence
 * that the underlying scores are "correct". It only proves the scores were
 * combined without arithmetic self-contradiction (no A > B > C > A cycles).
 * The judgment actually being made is the 1-9 score assigned to each item,
 * and that score's rationale is documented at its call site in
 * priorityConfig.js, not here.
 */
function buildRatioMatrix(scores) {
  const keys = Object.keys(scores);
  const n = keys.length;
  const matrix = [];
  for (let i = 0; i < n; i++) {
    matrix.push(new Array(n));
    for (let j = 0; j < n; j++) {
      matrix[i][j] = scores[keys[i]] / scores[keys[j]];
    }
  }
  return { keys, matrix };
}

/**
 * Derive normalized priority weights from an n x n reciprocal comparison
 * matrix using the normalized-column-average method -- a standard,
 * widely-used closed-form approximation to Saaty's principal-eigenvector
 * method -- then compute lambda_max, the Consistency Index (CI) and the
 * Consistency Ratio (CR = CI / RI).
 */
function computeAHPWeights(keys, matrix) {
  const n = matrix.length;

  const colSums = new Array(n).fill(0);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) colSums[j] += matrix[i][j];
  }

  const weights = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    for (let j = 0; j < n; j++) rowSum += matrix[i][j] / colSums[j];
    weights[i] = rowSum / n;
  }

  const Aw = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) Aw[i] += matrix[i][j] * weights[j];
  }
  const lambdaMax = Aw.reduce((sum, val, i) => sum + val / weights[i], 0) / n;

  const CI = n > 2 ? (lambdaMax - n) / (n - 1) : 0;
  const RI = RANDOM_INDEX[n] ?? RANDOM_INDEX[RANDOM_INDEX.length - 1];
  const CR = RI > 0 ? CI / RI : 0;

  const weightMap = {};
  keys.forEach((k, i) => { weightMap[k] = weights[i]; });

  return {
    weights: weightMap,
    lambdaMax,
    consistencyIndex: CI,
    consistencyRatio: CR,
    consistent: CR <= 0.10, // Saaty (2000) acceptability threshold
  };
}

/**
 * Convenience: go straight from documented 1-9 criticality scores to
 * normalized AHP weights plus the consistency proof.
 */
function ahpFromScores(scores) {
  const { keys, matrix } = buildRatioMatrix(scores);
  return { ...computeAHPWeights(keys, matrix), keys, matrix, scores };
}

module.exports = { buildRatioMatrix, computeAHPWeights, ahpFromScores, RANDOM_INDEX };
