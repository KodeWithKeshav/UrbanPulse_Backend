/**
 * ModelAuthenticityService
 *
 * Multilingual, model-based half of the complaint-authenticity check. Calls
 * a Hugging Face zero-shot-classification model twice -- once to score how
 * well the description matches the declared/detected civic category, once
 * to score genuine-complaint vs spam/gibberish -- so authenticity checking
 * works directly on text in any of the app's 6 supported languages, not
 * just the English/Hindi/Tamil terms TextAuthenticityService's keyword
 * lists happen to cover.
 *
 * Never throws: on any failure (missing key, timeout, HF cold-start 503,
 * network error) this resolves to `{ available: false }` so callers
 * (TextAuthenticityService.analyzeTextAuthenticityBlended) can fall back to
 * the rule-based score alone. Submission must never hang or fail because an
 * external API is slow or down.
 */

const axios = require('axios');
// Shared with TextAuthenticityService.js (both ultimately describe the same
// 7 CityZen SAM3 civic-issue classes), sourced from imageAnalysisService.js
// rather than from TextAuthenticityService.js directly to avoid a circular
// require (TextAuthenticityService.js requires this module back for the
// blended check).
const { CIVIC_ISSUE_LABELS: CATEGORY_LABELS } = require('./imageAnalysisService');

const HF_MODEL = process.env.HF_AUTHENTICITY_MODEL || 'MoritzLaurer/mDeBERTa-v3-base-xnli-multilingual-nli-2mil7';
const HF_API_URL = `https://api-inference.huggingface.co/models/${HF_MODEL}`;
const CALL_TIMEOUT_MS = 7000;
const OUTER_TIMEOUT_MS = 8000;

const GENUINENESS_LABELS = [
  'a genuine civic infrastructure complaint',
  'spam or irrelevant text',
  'gibberish or nonsensical text',
];

async function callZeroShot(text, candidateLabels) {
  const response = await axios.post(
    HF_API_URL,
    { inputs: text, parameters: { candidate_labels: candidateLabels, multi_label: false } },
    {
      headers: { Authorization: `Bearer ${process.env.HUGGING_FACE_API_KEY}` },
      timeout: CALL_TIMEOUT_MS,
    }
  );
  return response.data;
}

function scoreForLabel(result, label) {
  if (!result || !Array.isArray(result.labels) || !Array.isArray(result.scores)) return 0;
  const idx = result.labels.indexOf(label);
  return idx === -1 ? 0 : result.scores[idx];
}

/**
 * Rank-aware confidence for a single candidate label out of many.
 *
 * HF's zero-shot-classification with multi_label:false runs a softmax
 * across ALL candidate_labels, so with 8 competing civic categories a
 * correctly-matched label can still land at a modest raw probability
 * (e.g. 0.2-0.35) purely because the model split its mass across several
 * plausible-sounding categories -- not because the match is actually weak.
 * Using that raw probability directly as "how well does this match"
 * punishes short/noisy/code-switched text (exactly the kind of input real
 * citizens send) far more than it should.
 *
 * Instead: if the declared category is the model's #1 pick, treat it as
 * high-confidence regardless of how diffuse the absolute probability looks.
 * If it's not the top pick, scale down by how far behind the leader it is
 * (a close second is a near-miss / genuine ambiguity, not a mismatch).
 */
function rankAwareConfidence(result, label) {
  if (!result || !Array.isArray(result.labels) || !Array.isArray(result.scores) || result.labels.length === 0) {
    return 0;
  }
  const idx = result.labels.indexOf(label);
  if (idx === -1) return 0;

  const score = result.scores[idx];
  const topLabel = result.labels[0];
  const topScore = result.scores[0];

  if (topLabel === label) {
    return Math.max(score, 0.75);
  }

  const gap = topScore - score;
  return Math.max(0, score - gap * 0.3);
}

/**
 * @param {object} params
 * @param {string} params.text - the complaint description
 * @param {string} params.category - the declared/detected category key
 *   (one of TextAuthenticityService.CATEGORY_LABELS' keys)
 * @returns {Promise<{ available: boolean, categoryScore?: number, spamScore?: number, rawLabels?: object }>}
 */
async function analyzeWithModel({ text, category }) {
  if (!process.env.HUGGING_FACE_API_KEY || !text || !text.trim()) {
    return { available: false };
  }

  const categoryLabel = CATEGORY_LABELS[category];
  const candidateCategoryLabels = [
    ...Object.values(CATEGORY_LABELS).filter(Boolean),
    'none of these',
  ];

  const work = (async () => {
    const [categoryResult, genuinenessResult] = await Promise.all([
      categoryLabel ? callZeroShot(text, candidateCategoryLabels) : Promise.resolve(null),
      callZeroShot(text, GENUINENESS_LABELS),
    ]);

    // categoryScore: how strongly the text was classified as the declared
    // category specifically (0 if "none of these" clearly won, or if
    // there's no declared category to check against, e.g. "others").
    // Rank-aware, not a bare softmax probability -- see rankAwareConfidence.
    const categoryScore = categoryLabel ? rankAwareConfidence(categoryResult, categoryLabel) : 1;
    const spamScore = scoreForLabel(genuinenessResult, GENUINENESS_LABELS[0]);

    return {
      available: true,
      categoryScore,
      spamScore,
      rawLabels: { categoryResult, genuinenessResult },
    };
  })();

  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve({ available: false, reason: 'timeout' }), OUTER_TIMEOUT_MS);
  });

  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    console.error('ModelAuthenticityService: HF call failed:', error.message);
    return { available: false, reason: error.message };
  }
}

module.exports = { analyzeWithModel };
