const express = require('express');
const router = express.Router();

// Import the knowledge base using CommonJS
const { CIVIC_KNOWLEDGE_BASE, ChatbotKnowledgeMatcher } = require('../services/ChatbotKnowledgeBase');

let knowledgeMatcher;

// Initialize the knowledge matcher
const initializeKnowledgeBase = () => {
  try {
    knowledgeMatcher = new ChatbotKnowledgeMatcher();
    console.log('✅ Chatbot Knowledge Base initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Chatbot Knowledge Base:', error);
    return false;
  }
};

// Initialize on module load
initializeKnowledgeBase();

// Store conversation sessions (in production, use Redis or database)
const conversationSessions = new Map();

/**
 * Process chatbot message and return intelligent response
 * POST /api/chatbot/message
 */
router.post('/message', async (req, res) => {
  try {
    const { message, conversationHistory = [], userId = 'anonymous' } = req.body;

    console.log('🤖 Chatbot query:', { message, userId });

    // Check if knowledge base is initialized
    if (!knowledgeMatcher) {
      console.log('⏳ Knowledge base not yet initialized, attempting to initialize...');
      await initializeKnowledgeBase();
      
      if (!knowledgeMatcher) {
        return res.status(503).json({
          success: false,
          error: 'Chatbot service is initializing, please try again in a moment'
        });
      }
    }

    // Validate input
    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message is required and must be a string'
      });
    }

    // Get or create conversation session
    let session = conversationSessions.get(userId) || {
      messages: [],
      context: {},
      startTime: new Date()
    };

    // Add user message to session
    session.messages.push({
      type: 'user',
      text: message,
      timestamp: new Date()
    });

    // Find best response using knowledge base
    const matchResult = knowledgeMatcher.findBestMatch(
      message, 
      session.messages.slice(-5) // Last 5 messages for context
    );

    // Generate contextual response
    const response = await generateChatbotResponse(message, matchResult, session);

    // Add bot response to session
    session.messages.push({
      type: 'bot',
      text: response.reply,
      confidence: response.confidence,
      category: response.category,
      timestamp: new Date()
    });

    // Update session
    conversationSessions.set(userId, session);

    // Clean up old sessions (keep last 100)
    if (conversationSessions.size > 100) {
      const oldestKey = conversationSessions.keys().next().value;
      conversationSessions.delete(oldestKey);
    }

    console.log('✅ Chatbot response generated:', {
      category: response.category,
      confidence: response.confidence
    });

    res.json({
      success: true,
      reply: response.reply,
      confidence: response.confidence,
      category: response.category,
      suggestedActions: response.suggestedActions || [],
      followUpSuggestions: knowledgeMatcher.getFollowUpSuggestions(
        response.category, 
        message
      ),
      sessionId: userId
    });

  } catch (error) {
    console.error('❌ Chatbot error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process chatbot message',
      details: error.message
    });
  }
});

/**
 * Get conversation history for a user
 * GET /api/chatbot/history/:userId
 */
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const session = conversationSessions.get(userId);

    if (!session) {
      return res.json({
        success: true,
        messages: [],
        sessionExists: false
      });
    }

    res.json({
      success: true,
      messages: session.messages.slice(-20), // Last 20 messages
      sessionExists: true,
      startTime: session.startTime
    });

  } catch (error) {
    console.error('❌ History retrieval error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve conversation history'
    });
  }
});

/**
 * Clear conversation history for a user
 * DELETE /api/chatbot/history/:userId
 */
router.delete('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    conversationSessions.delete(userId);

    res.json({
      success: true,
      message: 'Conversation history cleared'
    });

  } catch (error) {
    console.error('❌ History clearing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear conversation history'
    });
  }
});

/**
 * Get chatbot analytics and performance metrics
 * GET /api/chatbot/analytics
 */
router.get('/analytics', async (req, res) => {
  try {
    const totalSessions = conversationSessions.size;
    const categories = {};
    const avgConfidence = [];
    let totalMessages = 0;

    // Analyze all sessions
    for (const [userId, session] of conversationSessions) {
      totalMessages += session.messages.length;
      
      session.messages.forEach(msg => {
        if (msg.type === 'bot') {
          // Count categories
          categories[msg.category] = (categories[msg.category] || 0) + 1;
          
          // Collect confidence scores
          if (msg.confidence) {
            avgConfidence.push(msg.confidence);
          }
        }
      });
    }

    const averageConfidence = avgConfidence.length > 0 
      ? avgConfidence.reduce((a, b) => a + b, 0) / avgConfidence.length 
      : 0;

    res.json({
      success: true,
      analytics: {
        totalSessions,
        totalMessages,
        averageConfidence: Math.round(averageConfidence * 100) / 100,
        categoryDistribution: categories,
        popularCategories: Object.entries(categories)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 5)
          .map(([category, count]) => ({ category, count })),
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('❌ Analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate analytics'
    });
  }
});

/**
 * Generate intelligent chatbot response
 */
async function generateChatbotResponse(userMessage, matchResult, session) {
  const message = userMessage.toLowerCase();

  // Enhanced responses based on context and user patterns
  let enhancedResponse = matchResult.text;
  let confidence = matchResult.confidence || 0.5;

  // Check for follow-up questions
  if (session.messages.length > 1) {
    const lastBotMessage = session.messages
      .slice()
      .reverse()
      .find(msg => msg.type === 'bot');

    if (lastBotMessage && isFollowUpQuestion(message, lastBotMessage.category)) {
      enhancedResponse = generateFollowUpResponse(message, lastBotMessage.category);
      confidence = Math.min(confidence + 0.2, 1.0);
    }
  }

  // Add personalization based on conversation history
  if (session.messages.length > 5) {
    enhancedResponse += "\n\n💡 *I notice you're exploring the app - feel free to ask me anything else!*";
  }

  // Add time-based greetings
  const hour = new Date().getHours();
  if (message.includes('hello') || message.includes('hi')) {
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    enhancedResponse = `${greeting}! ` + enhancedResponse;
  }

  return {
    reply: enhancedResponse,
    confidence,
    category: matchResult.category,
    suggestedActions: matchResult.suggestedActions || []
  };
}

/**
 * Check if user message is a follow-up question
 */
function isFollowUpQuestion(message, lastCategory) {
  const followUpIndicators = ['what about', 'how about', 'what if', 'can i also', 'and', 'but'];
  const hasFollowUpIndicator = followUpIndicators.some(indicator => 
    message.includes(indicator)
  );

  // Check if asking for more details about the same topic
  const askingForMore = ['more', 'details', 'explain', 'tell me', 'how'].some(word => 
    message.includes(word)
  );

  return hasFollowUpIndicator || askingForMore;
}

/**
 * Generate follow-up response based on previous category
 */
function generateFollowUpResponse(message, previousCategory) {
  const followUpResponses = {
    submission_guide: "📋 **More about Complaint Submission:**\n\n• After submission, you get a unique complaint ID\n• Track progress in 'Personal Reports'\n• Updates sent via notifications\n• Average response time: 2-7 days\n• Urgent issues get priority handling\n• You can add follow-up comments",
    
    voting_system: "🗳️ **More about Voting:**\n\n• Each user gets one vote per complaint\n• You can change your vote anytime\n• Votes influence municipal priority\n• High-voted issues get faster response\n• Voting is anonymous and secure\n• Your vote helps the community voice",
    
    civic_categories: "🏛️ **More about Civic Issues:**\n\n• Issues are auto-categorized by AI\n• Each category has different SLAs\n• Urgent issues bypass normal queue\n• Regular issues follow priority order\n• Status updates sent automatically\n• Resolution confirmed by photo evidence",
    
    location_privacy: "🔐 **More about Privacy:**\n\n• Location data never shared with third parties\n• Used only for routing and priority\n• Automatically deleted after resolution\n• You control privacy level\n• Option to submit anonymously\n• Complies with data protection laws"
  };

  return followUpResponses[previousCategory] || 
    "I'd be happy to explain more! What specific aspect would you like to know about?";
}

module.exports = router;
