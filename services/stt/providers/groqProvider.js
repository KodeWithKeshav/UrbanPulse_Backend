/**
 * Groq Whisper STT Provider
 * 
 * Uses Groq's high-speed Whisper Large v3 Turbo model for speech-to-text.
 * Supports multiple languages including English, Hindi, Tamil, Telugu, Malayalam, Kannada.
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const GROQ_LANGUAGE_MAP = {
  en: 'en',
  hi: 'hi',
  ta: 'ta',
  te: 'te',
  ml: 'ml',
  kn: 'kn',
};

/**
 * @param {object} params
 * @param {string} params.audioPath - path to uploaded audio file
 * @param {string} [params.language] - language code ('en', 'hi', etc.)
 * @returns {Promise<{ transcript: string, languageUsed: string, provider: string }>}
 */
async function transcribe({ audioPath, language = 'en' }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured in backend environment.');
  }

  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found at path: ${audioPath}`);
  }

  const ext = path.extname(audioPath) || '.webm';
  const filename = path.basename(audioPath) || `audio${ext}`;

  // Map MIME type based on file extension
  let contentType = 'audio/webm';
  if (ext === '.wav') contentType = 'audio/wav';
  else if (ext === '.mp3') contentType = 'audio/mpeg';
  else if (ext === '.m4a' || ext === '.mp4') contentType = 'audio/mp4';
  else if (ext === '.ogg') contentType = 'audio/ogg';

  const formData = new FormData();
  formData.append('file', fs.createReadStream(audioPath), {
    filename,
    contentType,
  });
  formData.append('model', 'whisper-large-v3-turbo');

  const groqLang = GROQ_LANGUAGE_MAP[language];
  if (groqLang) {
    formData.append('language', groqLang);
  }

  try {
    const response = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 30000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const transcript = response.data?.text || '';
    if (!transcript || !transcript.trim()) {
      throw new Error('Groq Whisper returned an empty transcript. Please speak louder or closer to the microphone.');
    }

    return {
      transcript: transcript.trim(),
      languageUsed: language,
      provider: 'groq',
    };
  } catch (error) {
    if (error.response) {
      const errMsg = error.response.data?.error?.message || error.response.statusText;
      throw new Error(`Groq Whisper error (${error.response.status}): ${errMsg}`);
    }
    throw error;
  }
}

module.exports = {
  transcribe,
  GROQ_LANGUAGE_MAP,
};
