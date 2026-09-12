const axios = require('axios');
const sharp = require('sharp');

// Roboflow "CityZen SAM3 2" Workflow — SAM3 promptable segmentation + a
// Civic_Issue_Context_Filter_Report step that normalizes detections into a
// fixed set of civic-issue classes and strips raw polygon points, so the
// `detections` payload below is already small.
const ROBOFLOW_API_URL = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com';
const ROBOFLOW_WORKSPACE = process.env.ROBOFLOW_WORKSPACE;
const ROBOFLOW_WORKFLOW = process.env.ROBOFLOW_WORKFLOW;
const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY;
// Separate workflow (SAM3 + Depth Estimation + a custom geometry-extraction
// step) used only for pothole footprint/depth estimation -- see
// services/potholeGeometryService.js. Kept out of ROBOFLOW_WORKFLOW above so
// the existing validate/explain hot path never pays for a depth-model call.
const ROBOFLOW_GEOMETRY_WORKFLOW = process.env.ROBOFLOW_GEOMETRY_WORKFLOW;

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
/**
 * Low-level runner shared by every Roboflow workflow call in this file --
 * same request shape, retry policy, and error handling regardless of which
 * workflow slug is targeted.
 */
async function runWorkflow(workflowSlug, workflowLabel, image, parameters) {
    if (!ROBOFLOW_API_KEY || !ROBOFLOW_WORKSPACE || !workflowSlug) {
        throw new RoboflowWorkflowError(
            `Roboflow is not configured for ${workflowLabel} (missing ROBOFLOW_API_KEY / ROBOFLOW_WORKSPACE / workflow slug env var)`
        );
    }
    if (!image || !image.value || (image.type !== 'url' && image.type !== 'base64')) {
        throw new RoboflowWorkflowError('image must be { type: "url"|"base64", value: string }');
    }
    if (image.type === 'url' && !/^https:\/\//i.test(image.value)) {
        throw new RoboflowWorkflowError('Image URL inputs to Roboflow must be https');
    }

    const endpoint = `${ROBOFLOW_API_URL}/${ROBOFLOW_WORKSPACE}/workflows/${workflowSlug}`;
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
        lastError?.response?.data?.message || lastError?.message || `Roboflow ${workflowLabel} workflow request failed`,
        { status: lastError?.response?.status, cause: lastError }
    );
}

async function runCityZenWorkflow(image, parameters) {
    return runWorkflow(ROBOFLOW_WORKFLOW, 'CityZen SAM3', image, parameters);
}

/**
 * Run the pothole footprint/depth geometry workflow (SAM3 + Depth
 * Estimation + a custom Pothole_Geometry_Depth_Extractor step) on an
 * already-hosted image, and return its raw per-instance geometry data
 * (rim points, depth samples, ring/inside medians -- all in pixel space /
 * unitless depth, no camera assumptions applied). See
 * services/potholeGeometryMath.js for what turns this into real cm.
 *
 * @param {string} imageUrl - https URL of the image to analyze
 * @returns {Promise<Array<object>>} the workflow's `instances` output
 */
async function runPotholeGeometryWorkflow(imageUrl) {
    const result = await runWorkflow(
        ROBOFLOW_GEOMETRY_WORKFLOW,
        'pothole geometry',
        { type: 'url', value: imageUrl }
    );
    return Array.isArray(result.instances) ? result.instances : [];
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
/**
 * Render a crisp SVG polygon mask and label for pothole instances only,
 * compositing it onto the original image so secondary classes (such as
 * road pavement damage or puddles) are omitted.
 */
async function renderPotholeMaskOverlay(imageBuffer, instances) {
    const metadata = await sharp(imageBuffer).metadata();
    const width = metadata.width;
    const height = metadata.height;

    let svgPaths = '';
    for (const inst of instances) {
        const points = inst.rim_points_px;
        if (!points || points.length < 3) continue;
        const pointsStr = points.map((p) => `${p[0]},${p[1]}`).join(' ');

        svgPaths += `<polygon points="${pointsStr}" fill="rgba(147, 51, 234, 0.45)" stroke="#9333ea" stroke-width="4" stroke-linejoin="round" />`;

        const confText = `pothole ${Math.round((inst.confidence || 0) * 100)}%`;
        const [minX, minY] = inst.bbox_xyxy ? [inst.bbox_xyxy[0], inst.bbox_xyxy[1]] : (inst.centroid_px || [points[0][0], points[0][1]]);
        const tagX = Math.max(10, minX);
        const tagY = Math.max(25, minY - 10);
        const textWidth = confText.length * 9 + 16;

        svgPaths += `
            <rect x="${tagX}" y="${tagY - 18}" width="${textWidth}" height="24" rx="4" fill="#9333ea" />
            <text x="${tagX + 8}" y="${tagY - 1}" font-family="sans-serif" font-size="14" font-weight="bold" fill="#ffffff">${confText}</text>
        `;
    }

    const svgOverlay = `
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
            ${svgPaths}
        </svg>
    `;

    return sharp(imageBuffer)
        .composite([{ input: Buffer.from(svgOverlay), top: 0, left: 0 }])
        .jpeg({ quality: 90 })
        .toBuffer();
}

async function explainImageUrl(imageUrl, expectedCategory = null) {
    const isPotholeCategory = expectedCategory?.toLowerCase() === 'pothole';

    // If the issue is a pothole, isolate the pothole instance and only show its mask
    if (isPotholeCategory) {
        try {
            const instances = await runPotholeGeometryWorkflow(imageUrl);
            if (Array.isArray(instances) && instances.length > 0) {
                const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
                const annotatedBuffer = await renderPotholeMaskOverlay(Buffer.from(imgRes.data), instances);
                const detections = instances.map((inst) => ({
                    class: 'pothole',
                    confidence: inst.confidence ?? 0.85,
                    mask_area_px: inst.mask_area_px ?? 0,
                    instance_count: 1,
                }));

                const bestConfidence = Math.round((instances[0].confidence || 0.85) * 100);
                return {
                    success: true,
                    annotatedImageBase64: annotatedBuffer.toString('base64'),
                    detections,
                    explanationText: `Primary issue "Pothole" confirmed (${bestConfidence}% confidence). SAM3 segmentation detected ${instances.length} × Pothole. Only the pothole mask is highlighted.`,
                };
            }
        } catch (geomError) {
            console.warn('Pothole-specific mask generation fallback:', geomError.message);
        }
    }

    const result = await runCityZenWorkflow({ type: 'url', value: imageUrl });
    let detections = Array.isArray(result.detections) ? result.detections : [];
    const outputImage = result.output_image;

    if (!outputImage || outputImage.type !== 'base64' || !outputImage.value) {
        throw new RoboflowWorkflowError('Roboflow workflow did not return an annotated image');
    }

    // If pothole was expected, filter out secondary detections from the report
    if (isPotholeCategory) {
        const potholeOnly = detections.filter(d => d.class === 'pothole');
        if (potholeOnly.length > 0) {
            detections = potholeOnly;
        }
    }

    return {
        success: true,
        annotatedImageBase64: outputImage.value,
        detections,
        explanationText: buildExplanationText(detections, expectedCategory),
    };
}

function buildExplanationText(detections, expectedCategory = null) {
    if (!detections.length) {
        return 'The SAM3 segmentation model did not detect any recognized civic issue in this image.';
    }
    const seen = new Set();
    const uniqueDetections = [];
    for (const d of detections) {
        if (!seen.has(d.class)) {
            seen.add(d.class);
            uniqueDetections.push(d);
        }
    }

    const classNames = uniqueDetections.map((d) => d.class);
    const hasPothole = classNames.includes('pothole');
    const hasWaterlogging = classNames.includes('road_waterlogging');
    const hasConcreteDamage = classNames.includes('concrete_structure_damage');

    const summaryParts = uniqueDetections.map((d) => {
        const label = CIVIC_ISSUE_LABELS[d.class] || d.class;
        const count = d.instance_count || 1;
        const conf = d.confidence != null ? ` (${Math.round(d.confidence * 100)}%)` : '';
        return `${count} × ${label}${conf}`;
    });

    let contextNotes = [];
    if (hasPothole && hasWaterlogging) {
        contextNotes.push('Standing puddle/water inside the pothole depression was detected as Road Waterlogging.');
    }
    if (hasPothole && hasConcreteDamage) {
        contextNotes.push('Cracked/broken pavement around the pothole was segmented as Concrete Structure Damage.');
    }

    let header = '';
    const normCategory = expectedCategory?.toLowerCase();
    if (normCategory && CIVIC_ISSUE_LABELS[normCategory]) {
        const expectedLabel = CIVIC_ISSUE_LABELS[normCategory];
        if (classNames.includes(normCategory)) {
            header = `Primary issue "${expectedLabel}" confirmed. `;
        }
    }

    const detectionSummary = `SAM3 segmentation detected: ${summaryParts.join(', ')}.`;
    const explanation = contextNotes.length > 0 ? ` ${contextNotes.join(' ')}` : ' The highlighted regions in the image show what the model segmented.';

    return `${header}${detectionSummary}${explanation}`;
}

module.exports = {
    runCityZenWorkflow,
    runPotholeGeometryWorkflow,
    validateImageWithRoboflow,
    explainImageUrl,
    RoboflowWorkflowError,
    CIVIC_ISSUE_LABELS,
};
