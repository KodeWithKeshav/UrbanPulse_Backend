/**
 * Provider-agnostic speech-to-text entry point used by routes/transcribe.js.
 *
 * Currently only 'sarvam' is wired to a real backend. 'qwen' is a stub seam
 * so a second provider can be added later (selectable, or as an automatic
 * fallback) without touching the route or either frontend's calling code.
 */

const sarvamProvider = require('./providers/sarvamProvider');
const qwenProvider = require('./providers/qwenProvider');

const PROVIDERS = {
  sarvam: sarvamProvider,
  qwen: qwenProvider,
};

const SUPPORTED_LANGUAGES = Object.keys(sarvamProvider.SARVAM_LANGUAGE_MAP);

/**
 * @param {object} params
 * @param {string} params.audioPath
 * @param {string} [params.language] - one of SUPPORTED_LANGUAGES, defaults to 'en'
 * @param {string} [params.provider] - 'sarvam' (default) or 'qwen'
 * @returns {Promise<{ transcript: string, languageUsed: string, provider: string }>}
 */
async function transcribe({ audioPath, language, provider = 'sarvam' }) {
  const impl = PROVIDERS[provider];
  if (!impl) {
    throw new Error(`Unknown STT provider: ${provider}`);
  }

  const safeLanguage = SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
  return impl.transcribe({ audioPath, language: safeLanguage });
}

module.exports = { transcribe, SUPPORTED_LANGUAGES };
