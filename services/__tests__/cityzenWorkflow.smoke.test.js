require('dotenv').config();
const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const axios = require('axios');
const { validateImageWithRoboflow, explainImageUrl } = require('../imageAnalysisService');

const hasRoboflowConfig = !!(
    process.env.ROBOFLOW_API_KEY &&
    process.env.ROBOFLOW_WORKSPACE &&
    process.env.ROBOFLOW_WORKFLOW
);
const describeOrSkip = hasRoboflowConfig ? describe : describe.skip;

// Integration smoke test against the real "CityZen SAM3 2" Roboflow workflow.
// Requires ROBOFLOW_API_KEY / ROBOFLOW_WORKSPACE / ROBOFLOW_WORKFLOW in .env;
// skipped automatically (not failed) when they're absent, e.g. in CI.
describeOrSkip('CityZen SAM3 workflow smoke test', () => {
    let sampleImageUrl;

    beforeAll(async () => {
        // Upload the repo's sample civic-issue image to Cloudinary (the same
        // unsigned upload the mobile/web apps perform) so the workflow is
        // exercised against a real https URL, exactly like production traffic.
        const imagePath = path.join(__dirname, '../../test_civic_issue.jpg');
        const form = new FormData();
        form.append('file', fs.createReadStream(imagePath));
        form.append('upload_preset', 'damage');

        const uploadRes = await axios.post(
            'https://api.cloudinary.com/v1_1/dsvc9y4rq/image/upload',
            form,
            { headers: form.getHeaders(), timeout: 20000 }
        );
        sampleImageUrl = uploadRes.data.secure_url;
    }, 60000);

    test('validateImageWithRoboflow returns the expected shape', async () => {
        const result = await validateImageWithRoboflow(sampleImageUrl);

        expect(result.success).toBe(true);
        expect(typeof result.confidence).toBe('number');
        expect(typeof result.allowUpload).toBe('boolean');
        expect(typeof result.message).toBe('string');
        expect(Array.isArray(result.detections)).toBe(true);
        for (const detection of result.detections) {
            expect(typeof detection.class).toBe('string');
            expect('confidence' in detection).toBe(true);
            expect('mask_area_px' in detection).toBe(true);
            expect('instance_count' in detection).toBe(true);
            // guardrail: no raw polygon points should ever leak through
            expect('points' in detection).toBe(false);
        }
    }, 60000);

    test('explainImageUrl returns an annotated image and detections', async () => {
        const result = await explainImageUrl(sampleImageUrl);

        expect(result.success).toBe(true);
        expect(typeof result.annotatedImageBase64).toBe('string');
        expect(result.annotatedImageBase64.length).toBeGreaterThan(1000);
        expect(Array.isArray(result.detections)).toBe(true);
        expect(typeof result.explanationText).toBe('string');
    }, 60000);
});
