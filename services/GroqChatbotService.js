/**
 * GroqChatbotService
 *
 * Generates a grounded, multilingual chatbot reply using Groq's
 * OpenAI-compatible chat-completions API (fast LPU-hosted inference over
 * open models like Llama). The existing keyword-based
 * ChatbotKnowledgeBase.findBestMatch() retrieval step still runs first (see
 * routes/chatbot.js) - its matched category's knowledge text and keywords
 * are fed in here as grounding context, so Groq answers from the app's own
 * documented knowledge rather than making things up, and can phrase that
 * answer naturally in whatever language the citizen is using.
 *
 * Never throws: on a missing key, timeout, or any API/network error this
 * resolves to `{ available: false }` so routes/chatbot.js can fall back to
 * today's plain keyword-matched reply untouched. The chatbot must never
 * hard-fail just because Groq is unconfigured or unreachable.
 */

const axios = require('axios');
const { CIVIC_KNOWLEDGE_BASE } = require('./ChatbotKnowledgeBase');

const GROQ_API_BASE = process.env.GROQ_API_BASE || 'https://api.groq.com/openai/v1';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const REQUEST_TIMEOUT_MS = 8000;

const LANGUAGE_NAMES = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
};

// A condensed, one-line-per-topic summary of the ENTIRE knowledge base
// (every category, not just the keyword-matched one) given as general
// context on every call. The keyword matcher (findBestMatch) is a cheap,
// imperfect retrieval step - a citizen's actual phrasing often doesn't hit
// its keyword list even when the app clearly has an answer. Without this
// full-app summary, the model only ever saw one narrow topic's text and
// would say "I'm not sure" far too often for perfectly ordinary
// "how do I ..." questions about features the matcher just didn't surface.
function buildFullKnowledgeSummary() {
  return Object.entries(CIVIC_KNOWLEDGE_BASE)
    .map(([topic, entry]) => {
      const firstLine = (entry.responses?.[0]?.text || '').split('\n')[0].replace(/\*\*/g, '');
      return `- ${topic}: ${firstLine}`;
    })
    .join('\n');
}

function buildSystemPrompt({ matchResult, language }) {
  const knowledgeBaseEntry = CIVIC_KNOWLEDGE_BASE[matchResult?.category];
  const groundingText = matchResult?.text || 'No specific guidance matched this question.';
  const keywords = knowledgeBaseEntry?.keywords?.join(', ') || '';
  const languageName = LANGUAGE_NAMES[language] || 'English';

  return [
    'You are the Urban Pulse civic-complaints app assistant. You help citizens use the app and understand how civic issue reporting works: submitting complaints (with photo/voice/AI validation), tracking reports, voting on issues, viewing the map/feed, privacy controls, and transparency features.',
    'You are knowledgeable about the ENTIRE app, not just one topic. Use the full feature summary below for general questions, and the specific reference guidance for the topic that most closely matches this question for a deeper answer. If a question is about using this app and is reasonably covered by the summary, answer it confidently and helpfully even if the reference guidance below is about a slightly different topic - use your judgment to connect related features.',
    'Only say you are unsure and suggest contacting support if the question is about something this app genuinely does not do, or is unrelated to civic complaints/the app entirely.',
    `Reply in ${languageName}, in a helpful, concise tone. Keep it under 120 words unless the question genuinely needs more detail (e.g. step-by-step instructions).`,
    '',
    '--- Full app feature summary ---',
    buildFullKnowledgeSummary(),
    '',
    '--- Closest-matching topic (for a deeper answer, if relevant) ---',
    `Topic: ${matchResult?.category || 'general'}`,
    `Related keywords: ${keywords}`,
    `Reference guidance: ${groundingText}`,
  ].join('\n');
}

/**
 * @param {object} params
 * @param {string} params.userMessage
 * @param {object} params.matchResult - output of ChatbotKnowledgeMatcher.findBestMatch()
 * @param {Array<{type: 'user'|'bot', text: string}>} [params.conversationHistory]
 * @param {string} [params.language] - one of the 6 supported language codes
 * @returns {Promise<{ available: boolean, reply?: string }>}
 */
async function generateGroundedReply({ userMessage, matchResult, conversationHistory = [], language = 'en' }) {
  if (!process.env.GROQ_API_KEY) {
    return { available: false };
  }

  try {
    const historyMessages = conversationHistory.slice(-5).map((m) => ({
      role: m.type === 'bot' ? 'assistant' : 'user',
      content: m.text,
    }));

    const response = await axios.post(
      `${GROQ_API_BASE}/chat/completions`,
      {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt({ matchResult, language }) },
          ...historyMessages,
          { role: 'user', content: userMessage },
        ],
        temperature: 0.4,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
      }
    );

    const reply = response.data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      return { available: false };
    }

    return { available: true, reply };
  } catch (error) {
    console.error('GroqChatbotService: request failed:', error.message);
    return { available: false };
  }
}

module.exports = { generateGroundedReply };
