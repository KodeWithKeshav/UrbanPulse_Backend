const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ override: true });

const SttProviderService = require('../services/stt/SttProviderService');

const uploadsDir = path.join(__dirname, '..', 'uploads');
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

/**
 * POST /api/transcribe/audio
 * Transcribes an uploaded audio clip in the requested language and returns
 * the transcript as spoken (no translation step — the rest of the app
 * renders/stores content in the citizen's chosen language directly).
 */
router.post('/audio', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No audio file uploaded' });
  }

  const language = req.body.language || 'en';
  const audioFilePath = req.file.path;

  try {
    const { transcript, languageUsed } = await SttProviderService.transcribe({
      audioPath: audioFilePath,
      language,
    });

    return res.json({
      success: true,
      transcript,
      language: languageUsed,
    });
  } catch (error) {
    console.error('Transcription error:', error.message);
    return res.status(502).json({
      success: false,
      message: 'Speech recognition failed. Please try again or type your complaint.',
      error: error.message,
    });
  } finally {
    try {
      if (fs.existsSync(audioFilePath)) {
        fs.unlinkSync(audioFilePath);
      }
    } catch (cleanupErr) {
      console.error('Error cleaning up uploaded audio file:', cleanupErr);
    }
  }
});

module.exports = router;
