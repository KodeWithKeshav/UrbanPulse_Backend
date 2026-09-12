const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `audio-${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Accept audio files only
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed!'), false);
    }
  }
});

// Helper function to use Web Speech API compatible language codes
function getLanguageCode(langCode) {
  const languageMappings = {
    'en': 'en-US',
    'hi': 'hi-IN',
    'te': 'te-IN',
    'ta': 'ta-IN',
    'kn': 'kn-IN',
    'mr': 'mr-IN',
    'bn': 'bn-IN',
    'gu': 'gu-IN',
    'ml': 'ml-IN',
    'pa': 'pa-IN'
  };
  return languageMappings[langCode] || 'en-US';
}

// Endpoint for audio transcription using Google Cloud Speech API
router.post('/audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No audio file uploaded' });
    }

    const language = req.body.language || 'en'; // Default to English if no language specified
    console.log(`Processing audio transcription in language: ${language}`);
    const languageCode = getLanguageCode(language);

    // Since we don't have a real API integration yet, we're using a fallback
    // that processes the audio file in the browser (client-side)
    
    // In a real implementation, we would send the audio to a service like:
    // - Google Cloud Speech-to-Text
    // - Microsoft Azure Speech Services
    // - Amazon Transcribe
    // - AssemblyAI
    
    // For now, we'll send back a response that tells the client to do local processing
    const audioFilePath = req.file.path;
    
    // Read file as base64 to send to client for processing
    const audioBuffer = fs.readFileSync(audioFilePath);
    const base64Audio = audioBuffer.toString('base64');
    
    // Delete the temporary file
    fs.unlink(audioFilePath, (err) => {
      if (err) console.error('Error deleting temporary file:', err);
    });
    
    return res.status(200).json({
      success: true,
      message: 'Audio received for client-side processing',
      languageCode,
      audioData: `data:audio/wav;base64,${base64Audio}`,
      useClientProcessing: true
    });
    
  } catch (error) {
    console.error('Transcription error:', error);
    
    // Cleanup: delete the temporary file if it exists
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting temporary file:', err);
      });
    }
    
    return res.status(500).json({
      success: false,
      message: error.message || 'Audio transcription failed'
    });
  }
});

module.exports = router;
