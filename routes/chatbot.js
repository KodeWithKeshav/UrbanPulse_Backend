const express = require('express');
const router = express.Router();
const Groq = require('groq-sdk');

const { ChatbotKnowledgeMatcher } = require('../services/ChatbotKnowledgeBase');

// ─── Init ─────────────────────────────────────────────────────────────────────
let knowledgeMatcher;
const initKB = () => {
  try {
    knowledgeMatcher = new ChatbotKnowledgeMatcher();
    console.log('✅ Chatbot Knowledge Base initialised');
    return true;
  } catch (e) {
    console.error('❌ KB init failed:', e);
    return false;
  }
};
initKB();

// GROQ client (lazy — only if key present)
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

const GROQ_MODEL = 'qwen/qwen3.8-27b';
const KB_CONFIDENCE_THRESHOLD = 0.55;

// In-memory sessions
const sessions = new Map();

// ─── Navigation Tool Definitions ──────────────────────────────────────────────
const NAV_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'navigate_to_page',
      description:
        'Navigate the user to a specific page/section of the CityZen app. ' +
        'Call this when the user asks how to reach a feature, or says they want to go somewhere.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['feed', 'dashboard', 'submit', 'map', 'reports', 'chatbot', 'feedback', 'transparency'],
            description: 'The target page slug',
          },
          reason: {
            type: 'string',
            description: 'Brief explanation shown to the user before navigating',
          },
        },
        required: ['page', 'reason'],
      },
    },
  },
];

const PAGE_LABELS = {
  feed:         'Complaint Feed',
  dashboard:    'Dashboard',
  submit:       'Submit Complaint',
  map:          'Complaint Map',
  reports:      'Personal Reports',
  chatbot:      'AI Assistant',
  feedback:     'Feedback',
  transparency: 'Transparency',
};

// ─── System prompt ────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the AI assistant embedded in **CityZen**, a civic complaint-management platform.
Your job is to help citizens report issues (potholes, broken streetlights, sewage, etc.), navigate the app, and understand how their complaints are processed.

Pages available in the app:
- **feed** – Complaint Feed (Instagram-style view of nearby civic issues)
- **dashboard** – Citizen Dashboard (your stats, recent activity)
- **submit** – Submit a Complaint (report a new civic issue with AI image validation)
- **map** – Complaint Map (live heat-map of all complaints)
- **reports** – Personal Reports (track your own submissions)
- **chatbot** – AI Assistant (this page)
- **feedback** – Feedback (rate the app experience)
- **transparency** – Transparency Dashboard (public accountability metrics)

When the user asks to go somewhere, or asks how to reach a feature, use the **navigate_to_page** tool.
Always respond in a helpful, concise, friendly tone. Use markdown formatting (bold, bullet points) where it helps.
Keep responses short unless the user asks for more detail. Never make up data.`;

// ─── GROQ call with tool support ─────────────────────────────────────────────
async function callGroq(userMessage, history = []) {
  if (!groq) throw new Error('GROQ client not initialised — check GROQ_API_KEY');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map(m => ({ role: m.type === 'bot' ? 'assistant' : 'user', content: m.text })),
    { role: 'user', content: userMessage },
  ];

  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages,
    tools: NAV_TOOLS,
    tool_choice: 'auto',
    temperature: 0.6,
    max_tokens: 1024,
  });

  const choice = response.choices[0];
  const msg = choice.message;

  // ── Tool call: navigation ──
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    const call = msg.tool_calls[0];
    const args = JSON.parse(call.function.arguments);
    const pageName = PAGE_LABELS[args.page] || args.page;

    const followUpMessages = [
      ...messages,
      msg,
      {
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({ success: true, navigatedTo: args.page }),
      },
    ];

    const followUp = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: followUpMessages,
      temperature: 0.5,
      max_tokens: 512,
    });

    return {
      reply:      followUp.choices[0].message.content,
      action:     { type: 'navigate', page: args.page, label: pageName },
      source:     'groq_tool',
      confidence: 0.9,
    };
  }

  return {
    reply:      msg.content,
    action:     null,
    source:     'groq',
    confidence: 0.85,
  };
}

// ─── POST /api/chatbot/message ────────────────────────────────────────────────
router.post('/message', async (req, res) => {
  try {
    const { message, conversationHistory = [], userId = 'anonymous' } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, error: 'Message is required' });
    }

    if (!knowledgeMatcher) {
      initKB();
      if (!knowledgeMatcher) {
        return res.status(503).json({ success: false, error: 'Chatbot initialising, try again shortly' });
      }
    }

    let session = sessions.get(userId) || { messages: [], startTime: new Date() };
    session.messages.push({ type: 'user', text: message, timestamp: new Date() });
    const recentHistory = session.messages.slice(-8);

    // ── 1. Rule-based match ──
    const match = knowledgeMatcher.findBestMatch(message, recentHistory);
    console.log(`🤖 KB match: category=${match.category}, confidence=${match.confidence}`);

    let reply, action = null, source, confidence;

    if (match.confidence >= KB_CONFIDENCE_THRESHOLD) {
      reply      = match.text;
      confidence = match.confidence;
      source     = 'knowledge_base';
      if (session.messages.length > 5) {
        reply += '\n\n💡 *Feel free to ask me anything else about CityZen!*';
      }
    } else {
      console.log('⚡ KB confidence low — calling GROQ');
      try {
        const groqResult = await callGroq(message, recentHistory);
        reply      = groqResult.reply;
        action     = groqResult.action;
        source     = groqResult.source;
        confidence = groqResult.confidence;
      } catch (groqErr) {
        console.error('❌ GROQ error:', groqErr.message);
        reply      = match.text || "I'm not sure about that. Could you rephrase your question?";
        source     = 'knowledge_base_fallback';
        confidence = match.confidence || 0.3;
      }
    }

    session.messages.push({ type: 'bot', text: reply, action, source, confidence, timestamp: new Date() });
    sessions.set(userId, session);
    if (sessions.size > 200) sessions.delete(sessions.keys().next().value);

    const followUpSuggestions = knowledgeMatcher.getFollowUpSuggestions(match.category, message);

    res.json({
      success: true,
      reply,
      confidence,
      category:            match.category,
      source,
      action,
      suggestedActions:    match.suggestedActions || [],
      followUpSuggestions,
      sessionId:           userId,
    });

  } catch (err) {
    console.error('❌ Chatbot error:', err);
    res.status(500).json({ success: false, error: 'Failed to process message', details: err.message });
  }
});

// ─── GET /api/chatbot/history/:userId ────────────────────────────────────────
router.get('/history/:userId', (req, res) => {
  const session = sessions.get(req.params.userId);
  res.json({
    success:       true,
    messages:      session ? session.messages.slice(-30) : [],
    sessionExists: !!session,
    startTime:     session?.startTime,
  });
});

// ─── DELETE /api/chatbot/history/:userId ─────────────────────────────────────
router.delete('/history/:userId', (req, res) => {
  sessions.delete(req.params.userId);
  res.json({ success: true, message: 'History cleared' });
});

module.exports = router;
