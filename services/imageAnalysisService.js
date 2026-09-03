const axios = require('axios');

// Roboflow "CityZen SAM3 2" Workflow — SAM3 promptable segmentation + a
// Civic_Issue_Context_Filter_Report step that normalizes detections into a
// fixed set of civic-issue classes and strips raw polygon points, so the
// `detections` payload below is already small.
const ROBOFLOW_API_URL = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com';
const ROBOFLOW_WORKSPACE = process.env.ROBOFLOW_WORKSPACE;
const ROBOFLOW_WORKFLOW = process.env.ROBOFLOW_WORKFLOW;
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;

const REQUEST_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2; // total attempts = 3
const RETRY_BASE_DELAY_MS = 500;

// Maps the workflow's normalized class names (see class_mapping in the
// workflow spec) to human-readable labels for messages shown to users.
const CIVIC_ISSUE_LABELS = {
    pothole: 'Pothole',
    fallen_tree: 'Fallen Tree',
    garbage_dumping: 'Garbage Dumping',
    stray_cattle: 'Stray Cattle on Road',
    fallen_electric_pole: 'Fallen Electric Pole / Line',
    concrete_structure_damage: 'Concrete Structure Damage',
    road_waterlogging: 'Road Waterlogging',
};

class RoboflowWorkflowError extends Error {
    constructor(message, { status, cause } = {}) {
        super(message);
        this.name = 'RoboflowWorkflowError';
        this.status = status;
        if (cause) this.cause = cause;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the CityZen SAM3 2 Roboflow Workflow on a single image.
 *
 * @param {{type: 'url'|'base64', value: string}} image
 * @param {object} [parameters] - optional workflow runtime parameters
 * @returns {Promise<{output_image?: {type: string, value: string}, detections: Array<{class: string, mask_area_px: number, confidence: number|null, instance_count: number}>}>}
 */
async function runCityZenWorkflow(image, parameters) {
    if (!ROBOFLOW_API_KEY || !ROBOFLOW_WORKSPACE || !ROBOFLOW_WORKFLOW) {
        throw new RoboflowWorkflowError(
            'Roboflow is not configured (missing ROBOFLOW_API_KEY / ROBOFLOW_WORKSPACE / ROBOFLOW_WORKFLOW env vars)'
        );
    }
    if (!image || !image.value || (image.type !== 'url' && image.type !== 'base64')) {
        throw new RoboflowWorkflowError('image must be { type: "url"|"base64", value: string }');
    }
    if (image.type === 'url' && !/^https:\/\//i.test(image.value)) {
        throw new RoboflowWorkflowError('Image URL inputs to Roboflow must be https');
    }

    const endpoint = `${ROBOFLOW_API_URL}/${ROBOFLOW_WORKSPACE}/workflows/${ROBOFLOW_WORKFLOW}`;
    const body = { inputs: { image }, ...(parameters ? { parameters } : {}) };

    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await axios.post(endpoint, body, {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ROBOFLOW_API_KEY}`,
                },
                timeout: REQUEST_TIMEOUT_MS,
            });

            const outputs = response.data?.outputs;
            if (!Array.isArray(outputs) || !outputs[0]) {
                throw new RoboflowWorkflowError('Roboflow workflow returned no outputs', { status: response.status });
            }
            return outputs[0];
        } catch (error) {
            lastError = error;
            if (error instanceof RoboflowWorkflowError) break; // not retryable
            const status = error.response?.status;
            const retryable = !status || status >= 500; // network errors or server-side failures only
            if (!retryable || attempt === MAX_RETRIES) break;
            await sleep(RETRY_BASE_DELAY_MS * 2 ** attempt);
        }
    }

    if (lastError instanceof RoboflowWorkflowError) throw lastError;
    throw new RoboflowWorkflowError(
        lastError?.response?.data?.message || lastError?.message || 'Roboflow workflow request failed',
        { status: lastError?.response?.status, cause: lastError }
    );
}

/**
 * Validate an already-hosted image (e.g. a Cloudinary URL) against the
 * CityZen SAM3 workflow and decide whether it shows a real civic issue —
 * and, when the citizen has already picked an issue category, whether the
 * photo actually shows *that* issue.
 *
 * The workflow itself applies per-class confidence thresholds and a
 * water-scene gate before returning any detection, so a non-empty
 * `detections` list is already a trustworthy "yes" — we don't re-threshold
 * on top of it.
 *
 * @param {string} imageUrl - https URL of the image to validate
 * @param {string} [expectedCategory] - the issue category the citizen
 *   already selected. When provided (and not "others"), the photo must
 *   contain a detection of this class or `allowUpload` is false.
 */
async function validateImageWithRoboflow(imageUrl, expectedCategory) {
    try {
        const result = await runCityZenWorkflow({ type: 'url', value: imageUrl });
        const detections = Array.isArray(result.detections) ? result.detections : [];

        if (detections.length === 0) {
            return {
                success: true,
                confidence: 0,
                modelConfidence: 0,
                allowUpload: false,
                categoryMatch: false,
                message: 'No valid civic issue detected in image.',
                detections: [],
                primaryClass: null,
            };
        }

        const primary = detections.reduce((best, d) =>
            (d.confidence ?? 0) > (best.confidence ?? 0) ? d : best
        );
        const label = CIVIC_ISSUE_LABELS[primary.class] || primary.class;

        const needsCategoryCheck = expectedCategory && expectedCategory !== 'others' && CIVIC_ISSUE_LABELS[expectedCategory];

        if (needsCategoryCheck) {
            const matchingDetection = detections.find((d) => d.class === expectedCategory);

            if (!matchingDetection) {
                const expectedLabel = CIVIC_ISSUE_LABELS[expectedCategory] || expectedCategory;
                return {
                    success: true,
                    confidence: primary.confidence ?? 0,
                    modelConfidence: primary.confidence ?? 0,
                    allowUpload: false,
                    categoryMatch: false,
                    message: `This photo looks like "${label}", but you selected "${expectedLabel}". Upload a photo that actually shows the selected issue, or go back and change the issue type.`,
                    detections,
                    primaryClass: primary.class,
                };
            }

            const matchConfidence = matchingDetection.confidence ?? 0;
            return {
                success: true,
                confidence: matchConfidence,
                modelConfidence: matchConfidence,
                allowUpload: true,
                categoryMatch: true,
                message: `Detected Issue: ${CIVIC_ISSUE_LABELS[expectedCategory]}`,
                detections,
                primaryClass: expectedCategory,
            };
        }

        return {
            success: true,
            confidence: primary.confidence ?? 0,
            modelConfidence: primary.confidence ?? 0,
            allowUpload: true,
            categoryMatch: null,
            message: `Detected Issue: ${label}`,
            detections,
            primaryClass: primary.class,
        };
    } catch (error) {
        console.error('Roboflow validation error:', error.message);
        return {
            success: false,
            confidence: 0,
            modelConfidence: 0,
            allowUpload: false,
            categoryMatch: null,
            message: error.message || 'Image validation failed',
            detections: [],
            primaryClass: null,
        };
    }
}

/**
 * Re-run the workflow against an already-submitted complaint's image and
 * return its annotated segmentation map (mask + label overlay) plus the
 * detection report — used by the admin "AI Explanation" view in place of
 * the old Grad-CAM heatmap.
 *
 * @param {string} imageUrl - https URL of the image to explain
 */
async function explainImageUrl(imageUrl) {
    const result = await runCityZenWorkflow({ type: 'url', value: imageUrl });
    const detections = Array.isArray(result.detections) ? result.detections : [];
    const outputImage = result.output_image;

    if (!outputImage || outputImage.type !== 'base64' || !outputImage.value) {
        throw new RoboflowWorkflowError('Roboflow workflow did not return an annotated image');
    }

    return {
        success: true,
        annotatedImageBase64: outputImage.value,
        detections,
        explanationText: buildExplanationText(detections),
    };
}

function buildExplanationText(detections) {
    if (!detections.length) {
        return 'The SAM3 segmentation model did not detect any recognized civic issue in this image.';
    }
    const seen = new Set();
    const parts = [];
    for (const d of detections) {
        if (seen.has(d.class)) continue;
        seen.add(d.class);
        const label = CIVIC_ISSUE_LABELS[d.class] || d.class;
        const count = d.instance_count || 1;
        parts.push(`${count} × ${label}`);
    }
    return `SAM3 segmentation detected: ${parts.join(', ')}. The highlighted regions in the image show exactly what the model segmented.`;
}

module.exports = {
    runCityZenWorkflow,
    validateImageWithRoboflow,
    explainImageUrl,
    RoboflowWorkflowError,
    CIVIC_ISSUE_LABELS,
};
