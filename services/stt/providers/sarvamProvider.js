/**
 * Sarvam STT provider.
 *
 * Converts the uploaded audio to 16kHz mono WAV (Sarvam's required format),
 * calls Sarvam's speech-to-text endpoint (saarika:v2.5), and returns the
 * transcript in the language it was spoken in.
 *
 * On any failure (API error, empty transcript) this throws instead of
 * returning fabricated placeholder text — callers must treat a thrown error
 * as "transcription failed", not silently substitute fake content.
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');

ffmpeg.setFfmpegPath(ffmpegStatic);

// The 6 languages the app's UI/STT picker exposes (English + the 5 Indian
// languages the product supports end-to-end). Sarvam itself supports more,
// but we intentionally don't expose codes the rest of the app can't render.
const SARVAM_LANGUAGE_MAP = {
  en: 'en-IN',
  hi: 'hi-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  ml: 'ml-IN',
  kn: 'kn-IN',
};

function convertToWav(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('wav')
      .audioCodec('pcm_s16le')
      .audioChannels(1)
      .audioFrequency(16000)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

function detectFormat(fileBuffer) {
  const isWAV = fileBuffer.slice(0, 4).toString('ascii') === 'RIFF' &&
    fileBuffer.slice(8, 12).toString('ascii') === 'WAVE';
  const isM4A = fileBuffer.slice(4, 8).toString('ascii') === 'ftyp';
  const mp3Hex = fileBuffer.slice(0, 2).toString('hex');
  const isMP3 = mp3Hex.startsWith('ffe') || mp3Hex.startsWith('fff') ||
    fileBuffer.slice(0, 3).toString('ascii') === 'ID3';
  return { isWAV, isM4A, isMP3 };
}

/**
 * @param {object} params
 * @param {string} params.audioPath - path to the uploaded audio file on disk
 * @param {string} params.language - one of SARVAM_LANGUAGE_MAP's keys
 * @returns {Promise<{ transcript: string, languageUsed: string, provider: string }>}
 */
async function transcribe({ audioPath, language }) {
  const sarvamLanguage = SARVAM_LANGUAGE_MAP[language] || SARVAM_LANGUAGE_MAP.en;

  const fileBuffer = fs.readFileSync(audioPath);
  const { isWAV, isM4A, isMP3 } = detectFormat(fileBuffer);

  let finalAudioPath = audioPath;
  let convertedPath = null;

  if (!isWAV) {
    const wavFileName = path.basename(audioPath, path.extname(audioPath)) + '_converted.wav';
    convertedPath = path.join(path.dirname(audioPath), wavFileName);
    try {
      await convertToWav(audioPath, convertedPath);
      finalAudioPath = convertedPath;
    } catch (conversionError) {
      throw new Error(`Audio conversion failed (detected ${isM4A ? 'M4A' : isMP3 ? 'MP3' : 'unknown'} format): ${conversionError.message}`);
    }
  }

  try {
    const formData = new FormData();
    formData.append('file', fs.createReadStream(finalAudioPath), {
      filename: path.basename(finalAudioPath),
      contentType: 'audio/wav',
    });
    formData.append('model', 'saarika:v2.5');
    formData.append('language', sarvamLanguage);

    const response = await axios.post(
      'https://api.sarvam.ai/speech-to-text',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'api-subscription-key': process.env.SARVAM_API_KEY,
        },
        timeout: 45000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    let transcript = '';
    const data = response.data;
    if (data && typeof data === 'object') {
      if ('transcript' in data) transcript = data.transcript || '';
      else if ('text' in data) transcript = data.text || '';
      else if ('transcription' in data) transcript = data.transcription || '';
      else if (Array.isArray(data.results) && data.results.length > 0) {
        transcript = data.results[0].transcript || data.results[0].text || '';
      }
    } else if (typeof data === 'string') {
      transcript = data;
    }

    if (!transcript || !transcript.trim()) {
      throw new Error('Sarvam API returned an empty transcript');
    }

    return { transcript: transcript.trim(), languageUsed: language, provider: 'sarvam' };
  } finally {
    if (convertedPath && fs.existsSync(convertedPath)) {
      fs.unlinkSync(convertedPath);
    }
  }
}

module.exports = { transcribe, SARVAM_LANGUAGE_MAP };
