/**
 * ============================================================================
 * PRIORITY ENGINE CONFIGURATION -- single source of truth
 * ============================================================================
 * Every weight, threshold, and multiplier used anywhere in the priority
 * engine (services/LocationPriorityService.js, services/
 * EmotionAnalysisService.js, services/TextAuthenticityService.js,
 * routes/complaints.js, routes/locationPriority.js) is defined ONCE, here.
 *
 * Nothing in this file is a bare literal presented as fact. Every weight is
 * computed from a documented 1-9 criticality judgment via services/ahp.js
 * (the Analytic Hierarchy Process -- Saaty, 1980/2000), with the rationale
 * for each judgment written next to it. Where a parameter is a plain
 * engineering default rather than an AHP output (e.g. the distance
 * half-value convention), that is stated explicitly so it is never confused
 * with a cited, derived value.
 *
 * Full writeup with source links: PRIORITY_ENGINE_REPORT.pdf (generated
 * from this file -- see scripts/generate-priority-report.js).
 * ============================================================================
 */

const { ahpFromScores } = require('./ahp');

// ---------------------------------------------------------------------------
// 1. FACILITY-TYPE CRITICALITY
//    Weights how much proximity to each facility type contributes to a
//    location's infrastructure-priority score.
//
//    Criterion used for every score below: "If a reported civic
//    infrastructure hazard (pothole, downed line, flooding, structural
//    damage, etc.) occurs near this facility and municipal response is
//    delayed, how much does that increase risk to life or disruption of
//    essential/emergency services?" -- scored 1-9 on Saaty's intensity scale.
// ---------------------------------------------------------------------------
const FACILITY_CRITICALITY_SCORES = {
  hospital: 9,
  // Concentrates the most immobile/vulnerable population on the network.
  // NFPA 1710 sets an 8-minute target for ALS EMS arrival; any obstruction
  // on the access route (the exact hazard classes this app tracks) directly
  // threatens that target. [NFPA 1710]
  fire_station: 9,
  // NFPA 1710 sets a 240-second (4 min) engine travel-time target to 90% of
  // incidents. Fire/rescue is also the primary responder to several of this
  // app's own hazard classes (fallen_electric_pole, concrete_structure_
  // damage, road_waterlogging). [NFPA 1710]
  police: 7,
  // First responder for scene control on many reported hazards (downed
  // wires, road-defect accidents); important, but secondary to fire/EMS for
  // the physical-hazard classes this app tracks.
  school: 6,
  // Children are a low-autonomy, vulnerable population, but schools are
  // supervised and the hazard classes tracked here are less immediately
  // life-critical than a hospital/fire/police access route.
  transit_station: 5,
  // High pedestrian/vehicle throughput means a hazard here (pothole,
  // waterlogging) affects large numbers of people and can itself cause
  // accidents.
  pharmacy: 5,
  // Medicine access for the sick/elderly -- comparable criticality to
  // transit, through a different mechanism (essential-goods access).
  government: 4,
  // Public-service continuity; not life-safety-critical.
  bank: 2,
  // Financial-service continuity only; no direct life-safety link to civic
  // infrastructure hazards.
};

const FACILITY_AHP = ahpFromScores(FACILITY_CRITICALITY_SCORES);
const FACILITY_WEIGHTS = FACILITY_AHP.weights;

// ---------------------------------------------------------------------------
// 2. TOP-LEVEL SIGNAL WEIGHTS
//    infrastructure proximity / image evidence / text emotion / community
//    votes -- combined into the final complaint priority score.
//
//    Criterion: "How reliable is this signal as evidence of real, severe
//    civic infrastructure risk requiring prioritized response?" No
//    historical resolution-outcome data exists yet in this system to fit
//    these weights by regression (recommended in the report as the next
//    step); AHP is used here as the rigorous, documented substitute.
// ---------------------------------------------------------------------------
const SIGNAL_CRITICALITY_SCORES = {
  imageEvidence: 9,
  // A vision-model detection (Roboflow "CityZen SAM3" workflow) is the most
  // direct, hardest-to-fabricate evidence that the reported hazard
  // physically exists and how visually severe it looks.
  infrastructureProximity: 7,
  // Objective and geodata-verifiable, and tied to consequence-of-delay (see
  // facility scores above) -- but does not by itself confirm the complaint
  // is genuine or severe.
  textEmotion: 3,
  // Self-reported and comparatively easy to inflate ("URGENT EMERGENCY").
  // Still carries information the other two signals cannot (e.g. a
  // witnessed injury), so it is kept, only weighted low.
  communityVotes: 2,
  // The most game-able signal (coordinated voting) and a lagging one (a
  // hazard reported minutes ago has had no time to accumulate votes
  // regardless of severity) -- lowest reliability as a *priority* signal.
};

const SIGNAL_AHP = ahpFromScores(SIGNAL_CRITICALITY_SCORES);
const TOP_LEVEL_WEIGHTS = {
  infrastructureScore: SIGNAL_AHP.weights.infrastructureProximity,
  imageValidationScore: SIGNAL_AHP.weights.imageEvidence,
  emotionScore: SIGNAL_AHP.weights.textEmotion,
  voteScore: SIGNAL_AHP.weights.communityVotes,
};

// ---------------------------------------------------------------------------
// 3. EMOTION SUB-WEIGHTS
//    How urgency/concern/anger/frustration combine into one text-emotion
//    score in EmotionAnalysisService.
//
//    Criterion: "How strongly does this emotion correlate with genuine
//    physical urgency, as opposed to general venting or dissatisfaction
//    with municipal service?"
// ---------------------------------------------------------------------------
const EMOTION_CRITICALITY_SCORES = {
  urgency: 9,
  // Keywords/content directly describing danger, injury, or emergency -- the
  // most direct textual signal of physical severity.
  concern: 5,
  // Worry about safety / vulnerable groups -- meaningfully risk-relevant but
  // less direct than explicit urgency language.
  anger: 3,
  // Mostly reflects dissatisfaction with municipal response; weakly
  // correlated with the physical severity of the hazard itself.
  frustration: 2,
  // Reflects an unresolved backlog / repeated complaints -- a real signal,
  // but one that describes service quality over time, not the current
  // physical severity of the hazard.
};

const EMOTION_AHP = ahpFromScores(EMOTION_CRITICALITY_SCORES);
const EMOTION_WEIGHTS = EMOTION_AHP.weights;

// ---------------------------------------------------------------------------
// 4. TEXT-AUTHENTICITY BLEND
//    How category-match strength and text-quality heuristics combine into
//    one authenticity score in TextAuthenticityService.
// ---------------------------------------------------------------------------
const AUTHENTICITY_CRITICALITY_SCORES = {
  categoryMatch: 7,
  // Directly detects whether the description is about a different issue
  // than the one declared/detected -- the strongest available signal of a
  // mismatched or fabricated report.
  textQuality: 4,
  // Detects spam / gibberish / repeated-character text, but does not by
  // itself confirm topical relevance.
};

const AUTHENTICITY_AHP = ahpFromScores(AUTHENTICITY_CRITICALITY_SCORES);
const AUTHENTICITY_WEIGHTS = AUTHENTICITY_AHP.weights;
// Note: this independently-elicited AHP blend (~0.64 / ~0.36) lands very
// close to the pre-existing hand-picked 0.65 / 0.35 split -- so that split
// is being kept, now with a documented rationale, rather than changed for
// its own sake.

// ---------------------------------------------------------------------------
// 5. COMPLAINT-CATEGORY URGENCY TIERS
//    Replaces ~30 independently hand-picked per-category multipliers
//    (previously 1.0x-1.9x, scattered across EmotionAnalysisService and
//    routes/complaints.js, with several category names that could not
//    actually occur because they aren't in the app's own 8-class taxonomy)
//    with 6 documented tiers on the same 1-9 scale used above, converted to
//    a multiplier by one linear formula.
// ---------------------------------------------------------------------------
function tierMultiplier(tierScore) {
  // Range [1.10, 1.90], matching the span of the multipliers it replaces.
  return 1.0 + (tierScore / 9) * 0.9;
}

const CATEGORY_TIER_SCORES = {
  lifeThreatening: 9,        // immediate danger to life if unresolved
  publicSafety: 7,           // safety of people, not immediately life-threatening
  infrastructureIntegrity: 6, // structural/road/drainage failure
  basicServices: 4,          // essential municipal services
  environmental: 3,          // environmental quality of life
  civicAdministrative: 1,    // amenities and administrative matters
};

// Maps every complaint-category name actually used anywhere in this
// codebase to a tier. Before this file existed there were THREE separate,
// mutually-inconsistent category tables: this app's own canonical 8-class
// taxonomy (the CityZen SAM3 image workflow's classes -- see
// services/imageAnalysisService.js CIVIC_ISSUE_LABELS and
// routes/locationPriority.js validComplaintTypes), EmotionAnalysisService's
// ~30-category auto-detect table (detectIssueCategory / applyCategory
// Adjustments), and routes/complaints.js's own ~15-category fallback
// tables (getFallbackPriority / getCategoryImportance) -- with different
// names for overlapping concepts (e.g. "flooding" vs "road_waterlogging",
// "garbage" vs "garbage_dumping") and no shared source of truth. This map
// now covers the union of all of them so every caller gets a consistent
// tier regardless of which naming convention it happens to use.
const CATEGORY_TIER_MAP = {
  // --- Life-threatening: immediate danger to life if unresolved ---
  fallen_electric_pole: 'lifeThreatening',
  gas_leak: 'lifeThreatening',
  fire_hazard: 'lifeThreatening',
  electrical_danger: 'lifeThreatening',
  disease_outbreak: 'lifeThreatening',
  health_emergency: 'lifeThreatening',
  building_collapse: 'lifeThreatening',

  // --- Public safety: risk to people, not immediately life-threatening ---
  women_safety: 'publicSafety',
  night_safety: 'publicSafety',
  broken_streetlight: 'publicSafety',
  streetlight: 'publicSafety',
  road_safety: 'publicSafety',
  public_safety: 'publicSafety',
  traffic_signal: 'publicSafety',
  child_safety: 'publicSafety',

  // --- Infrastructure integrity: structural/road/drainage failure ---
  road_waterlogging: 'infrastructureIntegrity',
  water_logging: 'infrastructureIntegrity',
  flooding: 'infrastructureIntegrity',
  concrete_structure_damage: 'infrastructureIntegrity',
  bridge_damage: 'infrastructureIntegrity',
  building_damage: 'infrastructureIntegrity',
  public_property_damage: 'infrastructureIntegrity',
  pothole: 'infrastructureIntegrity',
  road_damage: 'infrastructureIntegrity',
  fallen_tree: 'infrastructureIntegrity',
  tree_issue: 'infrastructureIntegrity',
  drain_blockage: 'infrastructureIntegrity',
  water_issue: 'infrastructureIntegrity',

  // --- Basic services: essential municipal services ---
  garbage_dumping: 'basicServices',
  garbage_collection: 'basicServices',
  garbage: 'basicServices',
  stray_cattle: 'basicServices',
  stray_animals: 'basicServices',
  water_supply: 'basicServices',
  power_outage: 'basicServices',
  electricity: 'basicServices', // generic power issue -- distinct from
                                 // fallen_electric_pole (downed live wire)
  sanitation: 'basicServices',
  public_transport: 'basicServices',

  // --- Environmental: environmental quality of life ---
  air_pollution: 'environmental',
  noise_pollution: 'environmental',
  water_pollution: 'environmental',
  water_contamination: 'environmental',
  sewage_overflow: 'environmental',
  illegal_dumping: 'environmental',
  tree_cutting: 'environmental',

  // --- Civic / administrative: amenities and administrative matters ---
  others: 'civicAdministrative',
  other: 'civicAdministrative',
  general: 'civicAdministrative',
  park_maintenance: 'civicAdministrative',
  street_cleaning: 'civicAdministrative',
  public_toilet: 'civicAdministrative',
  sports_facility: 'civicAdministrative',
  document_issue: 'civicAdministrative',
  tax_related: 'civicAdministrative',
  information_request: 'civicAdministrative',
};

function getCategoryTier(category) {
  return CATEGORY_TIER_MAP[category] || 'civicAdministrative';
}

function getCategoryMultiplier(category) {
  return tierMultiplier(CATEGORY_TIER_SCORES[getCategoryTier(category)]);
}

// Human-readable label for reasoning/explanation text (replaces the
// separate, disjoint getCategoryImportance() table that used to live in
// routes/complaints.js).
const TIER_LABELS = {
  lifeThreatening: 'life-threatening / critical',
  publicSafety: 'public-safety',
  infrastructureIntegrity: 'high-priority infrastructure',
  basicServices: 'medium-priority',
  environmental: 'environmental',
  civicAdministrative: 'standard',
};

function getCategoryImportanceLabel(category) {
  return TIER_LABELS[getCategoryTier(category)];
}

// A category-only fallback priority score (0-1), used ONLY when location
// and/or image data are unavailable and no infrastructure/image signal can
// be computed at all. Derived from the same tier score as the multiplier
// above (previously an independent hand-typed table in routes/
// complaints.js), so a fallback score is never a fifth, disconnected weight
// scheme.
function getFallbackPriorityScore(category) {
  const tierScore = CATEGORY_TIER_SCORES[getCategoryTier(category)];
  return 0.2 + (tierScore / 9) * 0.7; // range [0.278, 0.9]
}

// ---------------------------------------------------------------------------
// 6. PRIORITY LEVEL THRESHOLDS
//    Equal-interval classification (a standard, named data-classification
//    method -- see e.g. Esri/ArcGIS "Data classification methods"
//    documentation) over the full [0,1] score range, applied consistently
//    everywhere a score becomes a label. This replaces three previously
//    *inconsistent* threshold sets in this codebase (a 5-band one in
//    LocationPriorityService, and two different 4-band ones in
//    routes/complaints.js and routes/locationPriority.js).
//
//    This is an explicit interim convention: once enough resolved-complaint
//    history exists, it should be replaced by quantile or Jenks
//    natural-breaks thresholds fit to the real score distribution (see
//    report) instead of evenly-spaced bands.
// ---------------------------------------------------------------------------
const PRIORITY_LEVELS = [
  { level: 'CRITICAL', min: 0.8 },
  { level: 'HIGH', min: 0.6 },
  { level: 'MEDIUM', min: 0.4 },
  { level: 'LOW', min: 0.2 },
  { level: 'MINIMAL', min: 0 },
];

function getPriorityLevel(score) {
  for (const { level, min } of PRIORITY_LEVELS) {
    if (score >= min) return level;
  }
  return 'MINIMAL';
}

// ---------------------------------------------------------------------------
// 7. DISTANCE DECAY
//    Facility proximity is scored with a negative-exponential decay
//    function instead of the previous linear "1 - distance/maxRadius"
//    falloff. Negative-exponential (and the closely related Gaussian) decay
//    is the standard functional form in gravity-based spatial-accessibility
//    research (the Two-Step Floating Catchment Area literature -- Luo &
//    Wang 2003 and successors); unlike a linear ramp it has no artificial
//    hard zero exactly at the search-radius edge, and its decay rate is an
//    explicit, tunable parameter rather than an implicit side effect of
//    whatever radius happened to be configured.
//
//    halfDistance (score = 0.5) defaults to each facility type's configured
//    search radius / 2. This specific numeric default is a transparent,
//    documented convention chosen to preserve the existing radius
//    parameters' practical meaning -- it is NOT itself derived from
//    external data, and should be the first thing recalibrated once real
//    response-time or resolution-time data exists (see report).
// ---------------------------------------------------------------------------
function exponentialDistanceScore(distance, halfDistance) {
  if (!(halfDistance > 0) || !(distance >= 0)) return 0;
  return Math.exp(-Math.LN2 * (distance / halfDistance));
}

module.exports = {
  FACILITY_CRITICALITY_SCORES,
  FACILITY_AHP,
  FACILITY_WEIGHTS,

  SIGNAL_CRITICALITY_SCORES,
  SIGNAL_AHP,
  TOP_LEVEL_WEIGHTS,

  EMOTION_CRITICALITY_SCORES,
  EMOTION_AHP,
  EMOTION_WEIGHTS,

  AUTHENTICITY_CRITICALITY_SCORES,
  AUTHENTICITY_AHP,
  AUTHENTICITY_WEIGHTS,

  CATEGORY_TIER_SCORES,
  CATEGORY_TIER_MAP,
  tierMultiplier,
  getCategoryTier,
  getCategoryMultiplier,
  getCategoryImportanceLabel,
  getFallbackPriorityScore,

  PRIORITY_LEVELS,
  getPriorityLevel,

  exponentialDistanceScore,
};
