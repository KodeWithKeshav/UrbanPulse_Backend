const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const gradCamService = require('../services/GradCamService');

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
        cb(null, `gradcam-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (req, file, cb) => {
        const allowedExtensions = /\.(jpeg|jpg|png|webp)$/i;
        const allowedMimes = /^image\/(jpeg|jpg|png|webp)$/i;
        
        if (allowedMimes.test(file.mimetype) || allowedExtensions.test(file.originalname)) {
            return cb(null, true);
        }
        cb(new Error('Only image files (JPEG, PNG, WebP) are allowed.'));
    }
});

// GET /health - Check if Grad-CAM service is running
router.get('/health', async (req, res) => {
    try {
        const health = await gradCamService.checkHealth();
        res.json({ success: health.status === 'ok', ...health });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /explain/file - Generate Grad-CAM from uploaded image
router.post('/explain/file', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No image file uploaded' });
        }

        const options = {
            architecture: req.body.architecture || 'resnet50',
            camMethod: req.body.cam_method || 'gradcam',
        };
        
        if (req.body.target_class) options.targetClass = parseInt(req.body.target_class);
        if (req.body.target_layer) options.targetLayer = req.body.target_layer;
        if (req.body.model_path) options.modelPath = req.body.model_path;

        const result = await gradCamService.explainImageFile(req.file.path, options);
        
        // Clean up uploaded file
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('Failed to delete temporary file:', err);
        });

        res.json(result);
    } catch (error) {
        // Ensure file is deleted even if error occurs
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /explain/url - Generate Grad-CAM from image URL
router.post('/explain/url', async (req, res) => {
    try {
        const { image_url, architecture, cam_method, target_class, target_layer, model_path } = req.body;

        if (!image_url) {
            return res.status(400).json({ success: false, error: 'image_url is required' });
        }

        const options = {
            architecture: architecture || 'resnet50',
            camMethod: cam_method || 'gradcam',
        };

        if (target_class !== undefined) options.targetClass = parseInt(target_class);
        if (target_layer) options.targetLayer = target_layer;
        if (model_path) options.modelPath = model_path;

        const result = await gradCamService.explainImageUrl(image_url, options);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
