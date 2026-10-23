/**
 * Provider-agnostic speech-to-text entry point used by routes/transcribe.js.
 *
 * Currently only 'sarvam' is wired to a real backend. 'qwen' is a stub seam
 * so a second provider can be added later (selectable, or as an automatic
 * fallback) without touching the route or either frontend's calling code.
 */

const sarvamProvider = require('./providers/sarvamProvider');
const groqProvider = require('./providers/groqProvider');
const qwenProvider = require('./providers/qwenProvider');

const PROVIDERS = {
  groq: groqProvider,
  sarvam: sarvamProvider,
  qwen: qwenProvider,
};

const SUPPORTED_LANGUAGES = Object.keys(sarvamProvider.SARVAM_LANGUAGE_MAP);

/**
 * @param {object} params
 * @param {string} params.audioPath
 * @param {string} [params.language] - one of SUPPORTED_LANGUAGES, defaults to 'en'
 * @param {string} [params.provider] - 'groq', 'sarvam', or 'qwen'
 * @returns {Promise<{ transcript: string, languageUsed: string, provider: string }>}
 */
async function transcribe({ audioPath, language, provider }) {
  const safeLanguage = SUPPORTED_LANGUAGES.includes(language) ? language : 'en';

  // Sarvam is the default primary provider, followed by Groq as fallback
  const chosenProvider = provider || process.env.STT_PROVIDER || 'sarvam';
  const impl = PROVIDERS[chosenProvider];
  if (!impl) {
    throw new Error(`Unknown STT provider: ${chosenProvider}`);
  }

  try {
    return await impl.transcribe({ audioPath, language: safeLanguage });
  } catch (primaryError) {
    // If primary provider failed and was sarvam, automatically fall back to groq if available
    if (chosenProvider === 'sarvam' && process.env.GROQ_API_KEY && PROVIDERS.groq) {
      console.warn(`[STT] Sarvam provider failed (${primaryError.message}), falling back to Groq Whisper...`);
      try {
        return await PROVIDERS.groq.transcribe({ audioPath, language: safeLanguage });
      } catch (fallbackError) {
        console.error('[STT] Fallback provider (groq) also failed:', fallbackError.message);
        throw primaryError;
      }
    }
    throw primaryError;
  }
}

module.exports = { transcribe, SUPPORTED_LANGUAGES, PROVIDERS };

