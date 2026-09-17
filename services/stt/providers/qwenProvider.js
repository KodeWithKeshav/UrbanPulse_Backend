/**
 * Qwen STT provider — not configured yet.
 *
 * Placeholder seam so a Qwen-based speech-to-text provider (e.g. Qwen2-Audio
 * via DashScope) can be dropped in later without reworking
 * SttProviderService or either frontend's calling code. Until a real
 * implementation + API key exist, this intentionally throws.
 */

async function transcribe() {
  throw new Error('Qwen STT provider is not configured yet');
}

module.exports = { transcribe };
