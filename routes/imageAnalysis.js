const express = require('express');
const {
    validateImageWithRoboflow,
    explainImageUrl,
    CIVIC_ISSUE_LABELS,
} = require('../services/imageAnalysisService');
const { estimateAndPersistGeometry } = require('../services/potholeGeometryService');
const { geometryColumnsAvailable, GEOMETRY_PLACEHOLDER } = require('../services/schemaAvailability');
const { supabase } = require('../config/supabase');
const router = express.Router();

// Route to get the civic issue categories the CityZen SAM3 workflow can detect
router.get('/categories', (req, res) => {
    try {
        const categories = Object.entries(CIVIC_ISSUE_LABELS).map(([id, name]) => ({ id, name }));

        res.json({
            success: true,
            data: categories,
            message: 'Supported civic issue categories retrieved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve categories',
            error: error.message
        });
    }
});

// Route to test Roboflow configuration
router.get('/test-connection', async (req, res) => {
    try {
        const config = {
            apiKey: process.env.ROBOFLOW_API_KEY ? 'Present' : 'Missing',
            workspace: process.env.ROBOFLOW_WORKSPACE || 'Missing',
            workflow: process.env.ROBOFLOW_WORKFLOW || 'Missing',
            apiUrl: process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com',
        };

        res.json({
            success: true,
            data: {
                configurationStatus: config.apiKey === 'Present' && config.workspace !== 'Missing' && config.workflow !== 'Missing' ? 'OK' : 'INCOMPLETE',
                config,
                message: 'Roboflow service is configured. POST an imageUrl to /validate-image to test full functionality.'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Roboflow connection test failed',
            error: error.message
        });
    }
});

/**
 * POST /validate-image
 * Body: { imageUrl: string, category?: string }
 * Runs the CityZen SAM3 workflow and returns whether the image shows a
 * recognized civic issue. When `category` (the issue type the citizen
 * already selected) is provided, the photo must actually show that issue —
 * a photo of a different civic issue is rejected (allowUpload: false,
 * categoryMatch: false) rather than silently accepted.
 */
router.post('/validate-image', async (req, res) => {
    try {
        const { image, imageUrl, category } = req.body;

        if (!imageUrl) {
            if (image) {
                return res.status(400).json({
                    success: false,
                    message: 'Base64 image validation not implemented - upload the image and pass its URL instead',
                    allowUpload: false,
                    stage: 'not_implemented'
                });
            }
            return res.status(400).json({
                success: false,
                message: 'No image URL provided',
                allowUpload: false,
                stage: 'url_missing'
            });
        }

        const result = await validateImageWithRoboflow(imageUrl, category);
        return res.json({
            success: result.success,
            confidence: result.confidence,
            modelConfidence: result.modelConfidence,
            allowUpload: result.allowUpload,
            categoryMatch: result.categoryMatch,
            message: result.message,
            detections: result.detections,
            primaryClass: result.primaryClass,
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: 'Image validation failed',
            error: err.message,
            allowUpload: false,
            stage: 'server_error'
        });
    }
});

/**
 * POST /explain
 * Body: { imageUrl: string }
 * Re-runs the CityZen SAM3 workflow against an already-submitted complaint
 * image and returns its annotated segmentation map + detection report.
 * Replaces the old Grad-CAM explainability endpoint.
 */
router.post('/explain', async (req, res) => {
    try {
        const { imageUrl, category, complaintId } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ success: false, error: 'imageUrl is required' });
        }

        let effectiveCategory = category;
        if (!effectiveCategory && complaintId) {
            try {
                const { data } = await supabase
                    .from('complaints')
                    .select('category')
                    .eq('id', complaintId)
                    .single();
                if (data?.category) effectiveCategory = data.category;
            } catch (err) {
                console.warn('Category lookup failed:', err.message);
            }
        }

        const result = await explainImageUrl(imageUrl, effectiveCategory);
        res.json({
            success: true,
            annotatedImage: { type: 'base64', value: result.annotatedImageBase64 },
            detections: result.detections,
            explanationText: result.explanationText,
        });
    } catch (error) {
        console.error('Image explanation error:', error.message);
        res.status(error.status && error.status < 500 ? error.status : 500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /estimate-geometry
 * Body: { complaintId: string, imageUrl: string, category?: string, primaryClass?: string, deviceTilt?: number }
 * (Re-)runs pothole footprint/depth estimation for a complaint and persists
 * the result. Used by the admin UI to retry after a `geometry_status:
 * 'failed'` result, or to re-estimate once a real device tilt is
 * available. See services/potholeGeometryService.js.
 */
router.post('/estimate-geometry', async (req, res) => {
    try {
        const { complaintId, imageUrl, category, primaryClass, deviceTilt } = req.body;
        if (!complaintId || !imageUrl) {
            return res.status(400).json({ success: false, error: 'complaintId and imageUrl are required' });
        }

        // The geometry columns (database/add_pothole_geometry_columns.sql)
        // may not be migrated onto this Supabase project yet - there's
        // nowhere to persist a result, so skip the (Roboflow-calling, non-
        // free) estimation work entirely and say so plainly rather than
        // failing on the SELECT below with a raw Postgres error.
        if (!(await geometryColumnsAvailable(supabase))) {
            return res.json({
                success: true,
                geometry: { id: complaintId, ...GEOMETRY_PLACEHOLDER },
                message: 'Pothole geometry columns are not migrated on this database yet - see database/add_pothole_geometry_columns.sql. Estimation was skipped.',
            });
        }

        await estimateAndPersistGeometry({ complaintId, imageUrl, category, primaryClass, deviceTilt });

        const { data, error } = await supabase
            .from('complaints')
            .select('id, estimated_width_cm, estimated_length_cm, estimated_area_cm2, estimated_depth_cm, geometry_confidence, geometry_method, geometry_assumptions, geometry_status, geometry_error, geometry_computed_at')
            .eq('id', complaintId)
            .single();

        if (error) {
            return res.status(500).json({ success: false, error: error.message });
        }

        res.json({ success: true, geometry: data });
    } catch (error) {
        console.error('Geometry estimation endpoint error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
