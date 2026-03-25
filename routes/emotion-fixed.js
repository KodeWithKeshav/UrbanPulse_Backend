const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * Enhanced Multilingual Emotion Analysis Service for UrbanPulse
 * AI-powered with Hugging Face API + Smart Keyword Fallback
 */

class EmotionAnalysisService {
  constructor() {
    this.config = {
      huggingFaceToken: process.env.HUGGINGFACE_API_TOKEN,
      // Use a more robust multilingual model
      apiUrl: 'https://api-inference.huggingface.co/models/cardiffnlp/twitter-xlm-roberta-base-sentiment-multilingual'
    };
    
    // Enhanced multilingual keywords with extensive Tamil support
    this.emotionKeywords = {
      hi: { // Hindi
        anger: ['à¤—à¥à¤¸à¥à¤¸à¤¾', 'à¤•à¥à¤°à¥‹à¤§', 'à¤¨à¤¾à¤°à¤¾à¤œà¤¼', 'à¤ªà¤°à¥‡à¤¶à¤¾à¤¨', 'à¤šà¤¿à¤¢à¤¼', 'à¤–à¤«à¤¾'],
        urgency: ['à¤¤à¥à¤°à¤‚à¤¤', 'à¤œà¤²à¥à¤¦à¥€', 'à¤†à¤ªà¤¾à¤¤à¤•à¤¾à¤²', 'à¤–à¤¤à¤°à¤¨à¤¾à¤•', 'à¤…à¤­à¥€', 'à¤¦à¥à¤°à¥à¤˜à¤Ÿà¤¨à¤¾', 'à¤¦à¥à¤°à¥à¤˜à¤Ÿà¤¨à¤¾à¤à¤‚', 'à¤®à¥Œà¤¤', 'à¤®à¥Œà¤¤à¥‡à¤‚', 'à¤®à¥ƒà¤¤à¥à¤¯à¥'],
        frustration: ['à¤ªà¤°à¥‡à¤¶à¤¾à¤¨', 'à¤¤à¤‚à¤—', 'à¤¦à¥à¤–à¥€', 'à¤šà¤¿à¤‚à¤¤à¤¿à¤¤', 'à¤¹à¥ˆà¤°à¤¾à¤¨', 'à¤¨à¤¿à¤°à¤¾à¤¶'],
        concern: ['à¤šà¤¿à¤‚à¤¤à¤¾', 'à¤¡à¤°', 'à¤«à¤¿à¤•à¥à¤°', 'à¤˜à¤¬à¤°à¤¾à¤¹à¤Ÿ', 'à¤¬à¥‡à¤šà¥ˆà¤¨à¥€', 'à¤šà¤¿à¤‚à¤¤à¤¿à¤¤']
      },
      en: { // English
        anger: ['angry', 'furious', 'mad', 'irritated', 'annoyed', 'frustrated'],
        urgency: ['urgent', 'emergency', 'immediate', 'dangerous', 'critical', 'accident', 'accidents', 'death', 'deaths', 'fatal'],
        frustration: ['frustrated', 'fed up', 'tired', 'disappointed'],
        concern: ['worried', 'concerned', 'scared', 'afraid', 'anxious']
      },
      ta: { // Tamil - Comprehensive keywords
        anger: ['à®•à¯‹à®ªà®®à¯', 'à®Žà®°à®¿à®šà¯à®šà®²à¯', 'à®šà¯€à®±à¯à®±à®®à¯', 'à®µà¯†à®±à¯à®ªà¯à®ªà¯', 'à®•à¯‹à®ªà®®à®¾à®•', 'à®Žà®°à®¿à®šà¯à®šà®²à®¾à®•', 'à®•à¯‹à®ªà®ªà¯à®ªà®Ÿà¯à®•à®¿à®±à¯‡à®©à¯', 'à®µà¯†à®±à¯à®•à¯à®•à®¿à®±à¯‡à®©à¯'],
        urgency: ['à®…à®µà®šà®°à®®à¯', 'à®‰à®Ÿà®©à®Ÿà®¿', 'à®†à®ªà®¤à¯à®¤à¯', 'à®®à¯à®•à¯à®•à®¿à®¯à®®à¯', 'à®…à®µà®šà®°à®®à®¾à®•', 'à®‰à®Ÿà®©à®Ÿà®¿à®¯à®¾à®•', 'à®†à®ªà®¤à¯à®¤à®¾à®©', 'à®…à®µà®šà®°', 'à®®à®°à®£à®®à¯', 'à®µà®¿à®ªà®¤à¯à®¤à¯', 'à®‰à®¯à®¿à®°à¯à®•à¯à®•à¯ à®†à®ªà®¤à¯à®¤à¯'],
        frustration: ['à®µà®°à¯à®¤à¯à®¤à®®à¯', 'à®à®®à®¾à®±à¯à®±à®®à¯', 'à®µà®°à¯à®¤à¯à®¤à®®à®¾à®•', 'à®à®®à®¾à®±à¯à®±à®®à®¾à®•', 'à®•à®·à¯à®Ÿà®®à¯', 'à®¤à¯à®©à¯à®ªà®®à¯', 'à®µà¯‡à®¤à®©à¯ˆ', 'à®šà¯‹à®•à®®à¯'],
        concern: ['à®•à®µà®²à¯ˆ', 'à®ªà®¯à®®à¯', 'à®•à®µà®²à¯ˆà®¯à®¾à®•', 'à®ªà®¯à®®à®¾à®•', 'à®µà¯‡à®µà®²à¯ˆ', 'à®šà®¿à®¨à¯à®¤à®©à¯ˆ', 'à®ªà®°à®¿à®µà¯', 'à®•à®µà®©à®®à¯', 'à®‰à®³à¯ˆà®šà¯à®šà®²à¯', 'à®¨à¯†à®°à¯à®•à¯à®•à®Ÿà®¿']
      }
    };
  }

  /**
   * Detect language from text
   */
  async detectLanguage(text) {
    // Enhanced language detection based on Unicode ranges and common words
    const cleanText = text.trim();
    
    // Tamil detection (Unicode range: U+0B80â€“U+0BFF)
    const tamilChars = (cleanText.match(/[\u0B80-\u0BFF]/g) || []).length;
    if (tamilChars > 0) {
      console.log(`ðŸ” Tamil characters detected: ${tamilChars} characters`);
      return 'ta';
    }
    
    // Hindi detection (Unicode range: U+0900â€“U+097F) 
    const hindiChars = (cleanText.match(/[\u0900-\u097F]/g) || []).length;
    if (hindiChars > 0) {
      console.log(`ðŸ” Hindi characters detected: ${hindiChars} characters`);
      return 'hi';
    }
    
    // Telugu detection (Unicode range: U+0C00â€“U+0C7F)
    const teluguChars = (cleanText.match(/[\u0C00-\u0C7F]/g) || []).length;
    if (teluguChars > 0) {
      console.log(`ðŸ” Telugu characters detected: ${teluguChars} characters`);
      return 'te';
    }
    
    // Default to English
    console.log(`ðŸ” No Indic scripts detected, defaulting to English`);
    return 'en';
  }

  /**
   * AI-powered emotion analysis using Hugging Face
   */
  async analyzeWithAI(text, language = 'en') {
    try {
      if (!this.config.huggingFaceToken) {
        throw new Error('No Hugging Face API token');
      }

      console.log('ðŸ¤– Calling Hugging Face multilingual sentiment API...');
      
      const response = await axios.post(
        this.config.apiUrl,
        { inputs: text },
        {
          headers: {
            'Authorization': `Bearer ${this.config.huggingFaceToken}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      console.log('âœ… AI Response:', response.data);
      return this.convertSentimentToEmotions(response.data, text, language);
    } catch (error) {
      console.error('âŒ AI Analysis failed:', error.message);
      throw error;
    }
  }

  /**
   * Convert sentiment analysis to civic emotion format
   */
  convertSentimentToEmotions(sentimentData, text, language = 'en') {
    const emotions = { anger: 0, urgency: 0, frustration: 0, concern: 0 };
    
    if (Array.isArray(sentimentData) && sentimentData[0]) {
      const sentiment = sentimentData[0];
      
      console.log(`ðŸŽ­ AI Sentiment result: ${sentiment.label} (${sentiment.score.toFixed(3)})`);
      
      // If confidence is too low (especially for Tamil), boost with keyword analysis
      if (sentiment.score < 0.3 && language === 'ta') {
        console.log('âš ï¸ Low confidence AI result for Tamil, boosting with keywords');
        const keywordBoost = this.analyzeWithKeywords(text, language);
        
        // Merge AI and keyword results
        Object.keys(emotions).forEach(emotion => {
          emotions[emotion] = Math.max(keywordBoost[emotion], sentiment.score * 0.3);
        });
      } else if (sentiment.label === 'NEGATIVE' || sentiment.label === 'negative') {
        // Standard negative sentiment mapping
        emotions.concern = sentiment.score * 0.8;
        emotions.frustration = sentiment.score * 0.6;
        
        // Check for urgency indicators
        const urgencyBoost = this.detectUrgencyFromText(text);
        emotions.urgency = Math.min(sentiment.score * 0.5 + urgencyBoost, 1.0);
        
        // Check for anger indicators
        const angerBoost = this.detectAngerFromText(text, language);
        emotions.anger = Math.min(sentiment.score * 0.4 + angerBoost, 1.0);
      } else if (sentiment.label === 'POSITIVE' || sentiment.label === 'positive') {
        // Positive sentiment might still indicate urgency (e.g., "please help urgently")
        const urgencyBoost = this.detectUrgencyFromText(text);
        emotions.urgency = urgencyBoost;
        emotions.concern = urgencyBoost * 0.5;
      }
    }
    
    return emotions;
  }

  /**
   * Detect urgency from text content (multilingual)
   */
  detectUrgencyFromText(text) {
    const urgencyWords = [
      // English
      'death', 'deaths', 'died', 'accident', 'accidents', 'emergency', 'urgent', 'critical', 'dangerous',
      // Hindi  
      'à¤®à¥Œà¤¤', 'à¤®à¥Œà¤¤à¥‡à¤‚', 'à¤®à¥ƒà¤¤à¥à¤¯à¥', 'à¤¦à¥à¤°à¥à¤˜à¤Ÿà¤¨à¤¾', 'à¤¦à¥à¤°à¥à¤˜à¤Ÿà¤¨à¤¾à¤à¤‚', 'à¤†à¤ªà¤¾à¤¤à¤•à¤¾à¤²', 'à¤–à¤¤à¤°à¤¨à¤¾à¤•', 'à¤—à¤‚à¤­à¥€à¤°',
      // Tamil - Enhanced
      'à®®à®°à®£à®®à¯', 'à®µà®¿à®ªà®¤à¯à®¤à¯', 'à®†à®ªà®¤à¯à®¤à¯', 'à®…à®µà®šà®°à®®à¯', 'à®‰à®Ÿà®©à®Ÿà®¿', 'à®…à®µà®šà®°à®®à®¾à®•', 'à®‰à®Ÿà®©à®Ÿà®¿à®¯à®¾à®•', 'à®†à®ªà®¤à¯à®¤à®¾à®©', 'à®‰à®¯à®¿à®°à¯à®•à¯à®•à¯ à®†à®ªà®¤à¯à®¤à¯'
    ];

    let urgencyScore = 0;
    const textLower = text.toLowerCase();
    
    urgencyWords.forEach(word => {
      if (textLower.includes(word.toLowerCase())) {
        urgencyScore += 0.3;
      }
    });

    return Math.min(urgencyScore, 0.9);
  }

  /**
   * Detect anger from text content (multilingual)
   */
  detectAngerFromText(text, language = 'en') {
    const angerWords = this.emotionKeywords[language]?.anger || this.emotionKeywords.en.anger;
    
    let angerScore = 0;
    const textLower = text.toLowerCase();
    
    angerWords.forEach(word => {
      if (textLower.includes(word.toLowerCase())) {
        angerScore += 0.25;
      }
    });

    return Math.min(angerScore, 0.8);
  }

  /**
   * Keyword-based emotion analysis (fallback)
   */
  analyzeWithKeywords(text, language) {
    const keywords = this.emotionKeywords[language] || this.emotionKeywords.en;
    const emotions = { anger: 0, urgency: 0, frustration: 0, concern: 0 };
    const textLower = text.toLowerCase();
    
    console.log(`ðŸ” Keyword analysis for language: ${language}`);
    
    Object.keys(emotions).forEach(emotion => {
      const emotionKeywords = keywords[emotion] || [];
      let score = 0;
      let matchCount = 0;
      
      emotionKeywords.forEach(keyword => {
        if (textLower.includes(keyword.toLowerCase())) {
          score += 0.25;
          matchCount++;
          console.log(`âœ… Found ${emotion} keyword: "${keyword}"`);
        }
      });
      
      emotions[emotion] = Math.min(score, 1.0);
    });

    // For Tamil, if no keywords matched but text exists, set a minimum baseline
    if (language === 'ta') {
      const hasContent = text.trim().length > 10;
      if (hasContent && Object.values(emotions).every(v => v === 0)) {
        console.log('ðŸ”§ No Tamil keywords matched, setting baseline concern');
        emotions.concern = 0.3; // Set minimum concern for Tamil complaints
        emotions.urgency = 0.2; // Set minimum urgency
      }
    }

    console.log(`ðŸ“Š Keyword analysis result:`, emotions);
    return emotions;
  }

  /**
   * Calculate final emotion score
   */
  calculateEmotionScore(emotions) {
    const weights = { urgency: 0.4, anger: 0.3, concern: 0.2, frustration: 0.1 };
    
    return Object.keys(emotions).reduce((score, emotion) => {
      return score + (emotions[emotion] * (weights[emotion] || 0));
    }, 0);
  }

  /**
   * Apply category adjustments
   */
  applyCategoryAdjustments(score, category) {
    const categoryMultipliers = {
      'fire_hazard': 1.5,
      'electrical_danger': 1.4,
      'sewage_overflow': 1.3,
      'gas_leak': 1.5,
      'pothole': 1.1
    };

    const multiplier = categoryMultipliers[category] || 1.0;
    return Math.min(score * multiplier, 1.0);
  }

  /**
   * Main emotion analysis function
   */
  async analyzeEmotion(text, category = null) {
    try {
      console.log('ðŸ§  Starting emotion analysis:', text.substring(0, 50));
      
      const language = await this.detectLanguage(text);
      console.log(`ðŸ“Š Detected language: ${language}`);

      let emotions = {};
      let analysisMethod = '';

      // Try AI analysis first
      if (this.config.huggingFaceToken) {
        try {
          emotions = await this.analyzeWithAI(text, language);
          analysisMethod = 'ai-powered';
          console.log('âœ… AI analysis successful');
        } catch (error) {
          console.log('âš ï¸ AI failed, using keywords');
          emotions = this.analyzeWithKeywords(text, language);
          analysisMethod = 'keyword-fallback';
        }
      } else {
        emotions = this.analyzeWithKeywords(text, language);
        analysisMethod = 'keyword-only';
      }

      const emotionScore = this.calculateEmotionScore(emotions);
      const adjustedScore = this.applyCategoryAdjustments(emotionScore, category);

      console.log('ðŸŽ¯ Analysis result:', { emotions, score: adjustedScore, method: analysisMethod });

      return {
        success: true,
        emotionScore: adjustedScore,
        emotions,
        language,
        analysisMethod
      };
    } catch (error) {
      console.error('âŒ Analysis failed:', error);
      
      return {
        success: false,
        emotionScore: 0.5,
        emotions: { anger: 0, urgency: 0, frustration: 0, concern: 0 },
        language: 'unknown',
        analysisMethod: 'emergency-fallback',
        error: error.message
      };
    }
  }
}

// Initialize service
const emotionService = new EmotionAnalysisService();

// API Routes
router.post('/analyze', async (req, res) => {
  try {
    const { text, category } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Text is required for emotion analysis'
      });
    }

    const result = await emotionService.analyzeEmotion(text, category);
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('âŒ API Error:', error);
    res.status(500).json({
      success: false,
      message: 'Emotion analysis failed',
      error: error.message
    });
  }
});

router.get('/test', async (req, res) => {
  const testCases = [
    { text: "The road has dangerous potholes and children fall down. Very worried about safety.", category: "pothole", language: "en" },
    { text: "à¤‡à¤¸ à¤—à¤¡à¥à¤¢à¥‡ à¤•à¥‡ à¤•à¤¾à¤°à¤£ à¤•à¤ˆ à¤¦à¥à¤°à¥à¤˜à¤Ÿà¤¨à¤¾à¤à¤‚ à¤”à¤° à¤®à¥Œà¤¤à¥‡à¤‚ à¤¹à¥à¤ˆ à¤¹à¥ˆà¤‚ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤‡à¤¸à¥‡ à¤ à¥€à¤• à¤•à¤°à¥‡à¤‚", category: "pothole", language: "hi" },
    { text: "à®šà®¾à®²à¯ˆà®¯à®¿à®²à¯ à®†à®ªà®¤à¯à®¤à®¾à®© à®•à¯à®´à®¿à®•à®³à¯ à®‰à®³à¯à®³à®©. à®¨à®¾à®©à¯ à®®à®¿à®•à®µà¯à®®à¯ à®•à®µà®²à¯ˆà®¯à®¾à®• à®‡à®°à¯à®•à¯à®•à®¿à®±à¯‡à®©à¯.", category: "pothole", language: "ta" }
  ];

  const results = [];
  for (const testCase of testCases) {
    try {
      const result = await emotionService.analyzeEmotion(testCase.text, testCase.category);
      results.push({ input: testCase, output: result, status: 'success' });
    } catch (error) {
      results.push({ input: testCase, error: error.message, status: 'failed' });
    }
  }

  res.json({
    success: true,
    testResults: results,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

