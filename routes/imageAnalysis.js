const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ImageAnalysisService = require('../services/imageAnalysisService');
const { validateImageWithRoboflow } = require('../services/imageAnalysisService');
const router = express.Router();

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads/images';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, `civic-image-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        console.log('🔍 File filter check:', {
            originalname: file.originalname,
            mimetype: file.mimetype,
            size: file.size
        });
        
        const allowedExtensions = /\.(jpeg|jpg|png|webp)$/i;
        const allowedMimes = /^image\/(jpeg|jpg|png|webp)$/i;
        
        const hasValidExtension = allowedExtensions.test(file.originalname);
        const hasValidMime = allowedMimes.test(file.mimetype);
        
        // Special handling for WebP files that might be detected as octet-stream
        const isWebpFile = file.originalname.toLowerCase().endsWith('.webp');
        const isWebpOctetStream = file.mimetype === 'application/octet-stream' && isWebpFile;

        console.log('🔍 Validation results:', {
            hasValidExtension: hasValidExtension,
            hasValidMime: hasValidMime,
            isWebpFile: isWebpFile,
            isWebpOctetStream: isWebpOctetStream,
            extension: file.originalname.toLowerCase(),
            detectedMime: file.mimetype
        });

        if (hasValidMime && hasValidExtension) {
            console.log('✅ File accepted (standard image type)');
            return cb(null, true);
        } else if (isWebpOctetStream) {
            console.log('✅ File accepted (WebP with octet-stream mime)');
            return cb(null, true);
        } else {
            console.log('❌ File rejected');
            cb(new Error(`Only image files (JPEG, PNG, WebP) are allowed. Got: ${file.mimetype}`));
        }
    }
});

// Route to validate and analyze civic issue image


// Route to get supported civic issue categories
router.get('/categories', (req, res) => {
    try {
        const categories = {
            infrastructure: [
                { name: 'Pothole', description: 'Road damage and safety hazards' },
                { name: 'Damaged Road', description: 'General road infrastructure issues' }
            ],
            sanitation: [
                { name: 'Sewage Overflow', description: 'Sewage blockage and overflow issues' },
                { name: 'Garbage Dump', description: 'Improper waste disposal' },
                { name: 'Unclean Toilet', description: 'Public toilet cleanliness issues' }
            ],
            utilities: [
                { name: 'Broken Streetlight', description: 'Street lighting failures' },
                { name: 'Water Leakage', description: 'Water supply infrastructure damage' }
            ],
            environment: [
                { name: 'Illegal Dumping', description: 'Environmental violations and illegal waste disposal' }
            ]
        };

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

// Route to test Roboflow connection
router.get('/test-connection', async (req, res) => {
    try {
        console.log('🔧 Testing Roboflow connection...');
        
        const config = {
            apiKey: process.env.ROBOFLOW_API_KEY ? 'Present' : 'Missing',
            projectId: process.env.ROBOFLOW_PROJECT_ID,
            modelVersion: process.env.ROBOFLOW_MODEL_VERSION
        };

        // Create a simple test (you can upload a test image to fully test)
        const testResult = {
            configurationStatus: 'OK',
            config: config,
            message: 'Roboflow service is configured. Upload an image to test full functionality.'
        };

        res.json({
            success: true,
            data: testResult
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Roboflow connection test failed',
            error: error.message
        });
    }
});

module.exports = router;

/**
 * POST /validate-image
 * Body: { image: base64 string }
 * Returns: { confidence, raw }
 */
router.post('/validate-image', async (req, res) => {
    try {
        const { image } = req.body;
        if (!image) {
            const { imageUrl } = req.body;
            if (!imageUrl) {
                return res.status(400).json({
                    success: false,
                    message: 'No image URL provided',
                    allowUpload: false,
                    stage: 'url_missing'
                });
            }
            // Validate image using Roboflow workflow API
            const result = await validateImageWithRoboflow(imageUrl);
            return res.json({
                success: true,
                confidence: result.confidence,
                allowUpload: result.allowUpload,
                message: result.message,
                modelConfidence: result.modelConfidence,
                openaiConfidence: result.openaiConfidence,
                raw: result.raw
            });
        }
        // If image is provided, you can add validation logic here if needed
        // For now, just return a placeholder response
        return res.status(400).json({
            success: false,
            message: 'Base64 image validation not implemented',
            allowUpload: false,
            stage: 'not_implemented'
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
