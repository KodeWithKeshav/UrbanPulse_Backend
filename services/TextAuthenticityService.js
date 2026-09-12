/**
 * TextAuthenticityService
 *
 * Checks whether a complaint's free-text description is actually about the
 * civic issue it's filed under (the CityZen SAM3 image workflow's classes —
 * see services/imageAnalysisService.js CIVIC_ISSUE_LABELS) and whether the
 * text itself looks like a genuine, substantive complaint rather than
 * spam/gibberish/copy-paste filler.
 *
 * This is deliberately keyword + heuristic based (same approach as
 * EmotionAnalysisService's fallback path) since the project has no NLP/ML
 * text-classification service deployed. It runs synchronously and cheaply
 * enough to call on every keystroke-debounce from the client as well as on
 * final submission server-side.
 *
 * The category-match/text-quality blend weight is defined in
 * services/priorityConfig.js (AHP-derived, with cited rationale).
 */

const priorityConfig = require('./priorityConfig');

// Keyword sets per CityZen SAM3 civic-issue class (English + common Hindi/
// Tamil terms). "others" is intentionally left empty — free-form issues
// can't be keyword-matched, so they only go through the quality checks.
const CATEGORY_KEYWORDS = {
  pothole: [
    'pothole', 'potholes', 'pot hole', 'hole', 'holes', 'crater', 'craters',
    'road damage', 'damaged road', 'broken road', 'tar', 'asphalt', 'bitumen',
    'crack', 'cracks', 'sunken', 'depression', 'tyre', 'tire', 'wheel',
    'vehicle damage', 'bump', 'bumpy', 'uneven road', 'sinkhole',
    'गड्ढा', 'गड्ढे', 'सड़क के गड्ढे', 'सड़क क्षतिग्रस्त',
    'குழி', 'குழிகள்', 'சாலை குழி', 'சாலை சேதம்'
  ],
  fallen_tree: [
    'tree', 'trees', 'fallen tree', 'fallen trees', 'branch', 'branches',
    'trunk', 'uprooted', 'blocking road', 'blocking the road', 'storm',
    'windstorm', 'leaves', 'fell down', 'toppled', 'timber',
    'पेड़', 'पेड़ गिरा', 'पेड़ गिर गया', 'डाली', 'शाखा',
    'மரம்', 'மரங்கள்', 'விழுந்த மரம்', 'கிளை'
  ],
  garbage_dumping: [
    'garbage', 'trash', 'waste', 'dump', 'dumping', 'litter', 'rubbish',
    'smell', 'stink', 'stench', 'plastic', 'landfill', 'debris', 'junk',
    'illegal dumping', 'piling up', 'heap', 'pile of garbage',
    'कचरा', 'गंदगी', 'कूड़ा', 'बदबू', 'कचरे का ढेर',
    'குப்பை', 'கழிவு', 'குப்பை கொட்டுதல்', 'நாற்றம்'
  ],
  stray_cattle: [
    'cattle', 'cow', 'cows', 'bull', 'bulls', 'stray animal', 'stray animals',
    'livestock', 'buffalo', 'ox', 'oxen', 'herd', 'blocking traffic',
    'animals on road', 'animal menace',
    'गाय', 'बैल', 'मवेशी', 'आवारा पशु',
    'மாடு', 'மாடுகள்', 'கால்நடை', 'விலங்கு'
  ],
  fallen_electric_pole: [
    'electric pole', 'electricity pole', 'power line', 'power lines', 'cable',
    'wire', 'wires', 'transformer', 'electricity', 'electrical', 'shock',
    'spark', 'sparks', 'downed line', 'downed wire', 'pole fallen',
    'fallen pole', 'live wire', 'short circuit', 'electrocution',
    'बिजली का खंभा', 'बिजली के तार', 'खंभा गिरा', 'करंट',
    'மின் கம்பம்', 'மின்சார கம்பம்', 'கம்பி', 'மின்சாரம்'
  ],
  concrete_structure_damage: [
    'concrete', 'structure', 'structural', 'building', 'wall', 'crack',
    'cracks', 'collapse', 'collapsed', 'collapsing', 'bridge', 'pillar',
    'beam', 'damaged structure', 'cracked wall', 'ceiling', 'roof',
    'crumbling', 'debris falling', 'unsafe building',
    'इमारत', 'दीवार', 'ढांचा', 'दरार', 'ढह गया',
    'கட்டிடம்', 'சுவர்', 'கட்டமைப்பு', 'விரிசல்', 'இடிந்து விழுந்தது'
  ],
  road_waterlogging: [
    'water logging', 'waterlogged', 'water-logging', 'flood', 'flooding',
    'flooded', 'standing water', 'rain water', 'drain', 'drainage',
    'submerged', 'knee deep', 'knee-deep', 'overflowing drain', 'stagnant water',
    'जल जमाव', 'पानी भरा', 'बाढ़', 'जलभराव', 'नाली',
    'வெள்ளம்', 'தண்ணீர் தேங்குதல்', 'சாலையில் தண்ணீர்', 'வடிகால்'
  ],
  others: []
};

const CATEGORY_LABELS = {
  pothole: 'Pothole',
  fallen_tree: 'Fallen Tree',
  garbage_dumping: 'Garbage Dumping',
  stray_cattle: 'Stray Cattle',
  fallen_electric_pole: 'Fallen Electric Pole',
  concrete_structure_damage: 'Structural Damage',
  road_waterlogging: 'Road Waterlogging',
  others: 'Other',
};

const MIN_SUBSTANTIVE_LENGTH = 10;

function countKeywordHits(textLower, keywords) {
  let hits = 0;
  const matched = [];
  for (const kw of keywords) {
    if (textLower.includes(kw.toLowerCase())) {
      hits++;
      matched.push(kw);
    }
  }
  return { hits, matched };
}

/**
 * Score how well the text matches every known category, so we can tell
 * "doesn't mention pothole terms" apart from "clearly describes a
 * different issue" (e.g. garbage_dumping keywords showing up strongly in a
 * complaint filed as pothole).
 */
function scoreAllCategories(text) {
  const textLower = text.toLowerCase();
  const scores = {};
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (!keywords.length) continue;
    const { hits, matched } = countKeywordHits(textLower, keywords);
    scores[category] = { hits, matched, ratio: hits / keywords.length };
  }
  return scores;
}

/**
 * Heuristic text-quality checks: gibberish, keyboard-mashing, repeated
 * characters/words, or text far too short/generic to be a real report.
 */
function assessTextQuality(text) {
  const issues = [];
  const trimmed = text.trim();
  let qualityScore = 1.0;

  if (trimmed.length < MIN_SUBSTANTIVE_LENGTH) {
    issues.push('Description is too short to convey a real issue.');
    qualityScore -= 0.5;
  }

  // Repeated-character spam, e.g. "aaaaaaa" or "!!!!!!!!"
  if (/(.)\1{5,}/.test(trimmed)) {
    issues.push('Description contains long runs of repeated characters.');
    qualityScore -= 0.4;
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 4) {
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    const diversity = uniqueWords.size / words.length;
    if (diversity < 0.35) {
      issues.push('Description repeats the same word(s) excessively.');
      qualityScore -= 0.3;
    }
  }

  // Keyboard-mash / gibberish heuristic for latin-script text: very low
  // vowel ratio, or a total absence of common English function words over a
  // reasonably long stretch of text, usually means random keypresses rather
  // than real sentences. Skip for non-Latin scripts (Hindi/Tamil/Telugu
  // etc.) where this heuristic doesn't apply.
  const isLatinScript = /^[\x00-\x7F\s]*$/.test(trimmed);
  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  if (isLatinScript && letters.length >= 15) {
    const vowels = (letters.match(/[aeiouAEIOU]/g) || []).length;
    const vowelRatio = vowels / letters.length;

    const COMMON_WORDS = new Set([
      'the', 'is', 'a', 'an', 'to', 'and', 'of', 'in', 'on', 'at', 'this',
      'that', 'near', 'road', 'please', 'help', 'has', 'have', 'been',
      'there', 'it', 'is', 'are', 'for', 'with', 'my', 'our', 'we', 'i',
      'not', 'no', 'very', 'be', 'was', 'were', 'here', 'they', 'due',
      'from', 'because', 'since', 'over', 'near', 'area', 'street',
    ]);
    const tokens = trimmed.toLowerCase().match(/[a-z]+/g) || [];
    const hasCommonWord = tokens.some(t => COMMON_WORDS.has(t));

    if (vowelRatio < 0.15 || (tokens.length >= 4 && !hasCommonWord)) {
      issues.push('Description does not read like real words (possible gibberish).');
      qualityScore -= 0.5;
    }
  }

  return { qualityScore: Math.max(0, qualityScore), issues };
}

/**
 * Main entry point. Combines category-relevance matching with text-quality
 * heuristics to produce an authenticity verdict for a complaint's
 * description.
 *
 * @param {object} params
 * @param {string} params.text - the complaint description
 * @param {string} params.category - the declared/selected category
 * @param {string} [params.imagePrimaryClass] - class detected by the image
 *   validation step (Roboflow CityZen workflow), if any
 * @returns {{
 *   authenticityScore: number,
 *   flagged: boolean,
 *   mismatchDetected: boolean,
 *   suggestedCategory: string|null,
 *   reasons: string[],
 *   qualityIssues: string[],
 *   categoryMatch: { hits: number, matched: string[] } | null
 * }}
 */
function analyzeTextAuthenticity({ text, category, imagePrimaryClass } = {}) {
  const safeText = typeof text === 'string' ? text : '';
  const reasons = [];

  const { qualityScore, issues: qualityIssues } = assessTextQuality(safeText);
  reasons.push(...qualityIssues);

  const categoryScores = scoreAllCategories(safeText);
  const declaredCategory = CATEGORY_KEYWORDS[category] ? category : null;
  const declaredScore = declaredCategory ? categoryScores[declaredCategory] : null;

  // Find the best-matching category other than the declared one.
  let bestAlt = null;
  for (const [cat, s] of Object.entries(categoryScores)) {
    if (cat === declaredCategory) continue;
    if (s.hits === 0) continue;
    if (!bestAlt || s.hits > bestAlt.hits) {
      bestAlt = { category: cat, ...s };
    }
  }

  let mismatchDetected = false;
  let suggestedCategory = null;
  let categoryMatchScore = 1.0; // default: no restriction (e.g. "others" or unknown category)

  if (declaredCategory && CATEGORY_KEYWORDS[declaredCategory].length > 0) {
    const declaredHits = declaredScore ? declaredScore.hits : 0;
    const altHits = bestAlt ? bestAlt.hits : 0;

    if (declaredHits === 0 && altHits >= 2) {
      // Text clearly talks about a different, recognizable civic issue.
      mismatchDetected = true;
      suggestedCategory = bestAlt.category;
      categoryMatchScore = 0.1;
      reasons.push(
        `Description doesn't mention anything about "${CATEGORY_LABELS[declaredCategory]}", but strongly matches ` +
        `"${CATEGORY_LABELS[bestAlt.category]}" instead.`
      );
    } else if (declaredHits === 0 && safeText.trim().length >= MIN_SUBSTANTIVE_LENGTH) {
      // No match for the declared category and no clear alternative either —
      // softer flag, could just be phrased unusually.
      mismatchDetected = true;
      categoryMatchScore = 0.4;
      reasons.push(
        `Description doesn't mention typical "${CATEGORY_LABELS[declaredCategory]}" terms — please confirm it matches the selected issue type.`
      );
    } else if (declaredHits > 0 && altHits > declaredHits) {
      // Some overlap with declared category, but another category matches
      // even more strongly.
      mismatchDetected = true;
      suggestedCategory = bestAlt.category;
      categoryMatchScore = 0.5;
      reasons.push(
        `Description matches "${CATEGORY_LABELS[bestAlt.category]}" more closely than the selected ` +
        `"${CATEGORY_LABELS[declaredCategory]}" category.`
      );
    } else {
      categoryMatchScore = Math.min(1, 0.6 + declaredHits * 0.15);
    }
  }

  // Cross-check against what the image itself detected, if available and
  // different from the declared category — this catches the case where a
  // photo of a pothole was uploaded but the typed-out category/description
  // is about something else entirely.
  if (
    imagePrimaryClass &&
    CATEGORY_KEYWORDS[imagePrimaryClass] &&
    imagePrimaryClass !== declaredCategory
  ) {
    reasons.push(
      `The uploaded photo was detected as "${CATEGORY_LABELS[imagePrimaryClass] || imagePrimaryClass}", ` +
      `which differs from the selected category "${declaredCategory ? CATEGORY_LABELS[declaredCategory] : category}".`
    );
    mismatchDetected = true;
    suggestedCategory = suggestedCategory || imagePrimaryClass;
    categoryMatchScore = Math.min(categoryMatchScore, 0.3);
  }

  // Blend weights are AHP-derived (services/priorityConfig.js
  // AUTHENTICITY_WEIGHTS: categoryMatch ~0.636, textQuality ~0.364) from a
  // documented criticality judgment -- category mismatch is the stronger
  // signal of a fabricated/misfiled report, text quality a weaker one. This
  // independently-elicited split landed within 0.01 of the original
  // hand-picked 0.65/0.35, which is why it is effectively unchanged here,
  // now with a citable rationale instead of none.
  const authenticityScore = Math.max(0, Math.min(1,
    (categoryMatchScore * priorityConfig.AUTHENTICITY_WEIGHTS.categoryMatch) +
    (qualityScore * priorityConfig.AUTHENTICITY_WEIGHTS.textQuality)
  ));

  // Flag for admin review when the combined score is low enough that this
  // is unlikely to be a genuine, on-topic report.
  const flagged = authenticityScore < 0.45;

  return {
    authenticityScore: parseFloat(authenticityScore.toFixed(2)),
    flagged,
    mismatchDetected,
    suggestedCategory,
    reasons,
    qualityIssues,
    categoryMatch: declaredScore,
  };
}

module.exports = {
  analyzeTextAuthenticity,
  CATEGORY_KEYWORDS,
  CATEGORY_LABELS,
};
