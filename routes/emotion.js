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
      // Try multiple working models in order
      models: [
        'https://api-inference.huggingface.co/models/distilbert-base-uncased-finetuned-sst-2-english',
        'https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest',
        'https://api-inference.huggingface.co/models/nlptown/bert-base-multilingual-uncased-sentiment',
        'https://api-inference.huggingface.co/models/cardiffnlp/twitter-xlm-roberta-base-sentiment'
      ]
    };
    
    // Enhanced multilingual keywords
    this.emotionKeywords = {
      hi: { // Hindi
        anger: ['', '', '', '', '', ''],
        urgency: ['', '', '', '', '', '', '', '', '', ''],
        frustration: ['', '', '', '', '', ''],
        concern: ['', '', '', '', '', '']
      },
      en: { // English
        anger: ['angry', 'furious', 'mad', 'irritated', 'annoyed', 'frustrated'],
        urgency: ['urgent', 'emergency', 'immediate', 'dangerous', 'critical', 'accident', 'accidents', 'death', 'deaths', 'fatal'],
        frustration: ['frustrated', 'fed up', 'tired', 'disappointed'],
        concern: ['worried', 'concerned', 'scared', 'afraid', 'anxious']
      },
      ta: { // Tamil - Comprehensive keywords
        anger: ['', '', '', '', '', '', '', ''],
        urgency: ['', '', '', '', '', '', '', '', '', '', ' ', '', '', ''],
        frustration: ['', '', '', '', '', '', '', ''],
        concern: ['', '', '', '', '', '', '', '', '', '', '', '']
      }
    };
  }

  /**
   * Detect language from text
   */
  async detectLanguage(text) {
    // Simple language detection based on script
    if (/[\u0900-\u097F]/.test(text)) return 'hi'; // Hindi
    if (/[\u0B80-\u0BFF]/.test(text)) return 'ta'; // Tamil  
    if (/[\u0C00-\u0C7F]/.test(text)) return 'te'; // Telugu
    return 'en'; // Default to English
  }

  /**
   * AI-powered emotion analysis using Hugging Face with multiple model fallbacks
   */
  async analyzeWithAI(text) {
    if (!this.config.huggingFaceToken) {
      throw new Error('No Hugging Face API token');
    }

    console.log(' Starting AI analysis for text:', text.substring(0, 50));
    
    // Try each model until one works
    for (let i = 0; i < this.config.models.length; i++) {
      const modelUrl = this.config.models[i];
      console.log(` Trying model ${i + 1}/${this.config.models.length}: ${modelUrl.split('/').pop()}`);
      
      try {
        const response = await axios.post(
          modelUrl,
          { inputs: text },
          {
            headers: {
              'Authorization': `Bearer ${this.config.huggingFaceToken}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          }
        );
        
        console.log(' AI Model succeeded! Response:', response.data);
        return this.convertSentimentToEmotions(response.data, text);
        
      } catch (error) {
        console.log(` Model ${i + 1} failed:`, error.response?.status || error.message);
        
        // If this is the last model, throw the error
        if (i === this.config.models.length - 1) {
          throw new Error(`All AI models failed. Last error: ${error.message}`);
        }
        
        // Otherwise, continue to next model
        continue;
      }
    }
  }

  /**
   * Convert sentiment analysis to civic emotion format
   */
  convertSentimentToEmotions(sentimentData, text) {
    console.log(' Converting sentiment data:', sentimentData);
    
    const emotions = { anger: 0, urgency: 0, frustration: 0, concern: 0 };
    
    // Handle different API response formats
    let sentiment = null;
    
    // Handle nested array format: [[{label, score}, ...]]
    if (Array.isArray(sentimentData) && Array.isArray(sentimentData[0]) && sentimentData[0].length > 0) {
      // Find the highest scoring sentiment from nested array
      sentiment = sentimentData[0][0]; // First item has highest score
    }
    // Handle simple array format: [{label, score}, ...]
    else if (Array.isArray(sentimentData) && sentimentData.length > 0 && sentimentData[0].label) {
      sentiment = sentimentData[0];
    }
    // Handle direct object format: {label, score}
    else if (sentimentData && sentimentData.label) {
      sentiment = sentimentData;
    }
    
    if (sentiment && sentiment.label) {
      const label = sentiment.label.toLowerCase();
      const score = sentiment.score;
      
      console.log(` AI Sentiment: ${label} (${score.toFixed(3)})`);
      
      // Map sentiment to civic emotions
      if (label.includes('negative') || label === '1 star' || label === '2 stars') {
        emotions.concern = score * 0.9;
        emotions.frustration = score * 0.7;
        
        // Check for urgency indicators in text
        const urgencyBoost = this.detectUrgencyFromText(text);
        emotions.urgency = Math.min(score * 0.6 + urgencyBoost, 1.0);
        
        // If very negative sentiment, add some anger
        if (score > 0.7) {
          emotions.anger = score * 0.5;
        }
      } else if (label.includes('positive') || label === '4 stars' || label === '5 stars') {
        // Even positive text can have urgency for civic issues
        const urgencyBoost = this.detectUrgencyFromText(text);
        emotions.urgency = urgencyBoost;
        
        // For non-English languages (Tamil, Hindi), AI often misclassifies complaints as positive
        // Set baseline concerns for civic complaints in these languages
        const language = this.detectLanguage(text);
        if (language === 'ta' || language === 'hi') {
          console.log(` Adjusting positive sentiment for ${language} civic complaint`);
          emotions.concern = Math.max(0.3, urgencyBoost); // Minimum 30% concern
          emotions.urgency = Math.max(0.2, urgencyBoost); // Minimum 20% urgency
          
          // Check for specific issue indicators
          const keywordEmotions = this.analyzeWithKeywords(text, language);
          Object.keys(emotions).forEach(emotion => {
            emotions[emotion] = Math.max(emotions[emotion], keywordEmotions[emotion]);
          });
        }
      } else if (label.includes('neutral') || label === '3 stars') {
        // Neutral sentiment - still check for urgency
        const urgencyBoost = this.detectUrgencyFromText(text);
        emotions.urgency = urgencyBoost;
        emotions.concern = urgencyBoost * 0.5;
      }
    } else {
      console.log(' Unknown sentiment format, using text analysis only');
      // Fallback to pure text analysis
      const urgencyBoost = this.detectUrgencyFromText(text);
      emotions.urgency = urgencyBoost;
      emotions.concern = urgencyBoost * 0.8;
    }
    
    console.log(' Final AI emotions:', emotions);
    return emotions;
  }

  /**
   * Detect urgency from text content (comprehensive civic issues detection)
   */
  detectUrgencyFromText(text) {
    const urgencyWords = [
      // CRITICAL HEALTH TERMS
      // English
      'death', 'deaths', 'died', 'accident', 'accidents', 'emergency', 'urgent', 'critical', 'dangerous',
      'disease', 'illness', 'sick', 'health', 'contamination', 'pollution', 'toxic', 'suffocating',
      'stench', 'smell', 'dirty', 'filthy', 'overflow', 'leakage', 'burst',
      
      // Hindi - Health & Sanitation
      '', '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '',
      '', ' ', '', '', ' ', '', '', '',
      '', '', '', '', '',
      
      // SAFETY TERMS
      // Hindi - Safety & Security  
      '', '', '', '', '', '',
      '', '', '', '', '', '', '',
      
      // Tamil
      '', '', '', '', '', '', '', '', ''
    ];

    let urgencyScore = 0;
    const textLower = text.toLowerCase();
    
    urgencyWords.forEach(word => {
      if (textLower.includes(word.toLowerCase())) {
        urgencyScore += 0.15; // Moderate boost per keyword
      }
    });

    // Special high-impact health phrases get higher scores
    const criticalHealthPhrases = [
      // Hindi
      '  ', ' ', ' ', ' ', ' ', '  ', ' ',
      '   ', '  ', '  ', '   ',
      
      // English  
      'suffocating in', 'health emergency', 'disease outbreak', 'contaminated water',
      'breathing difficulty', 'stomach illness', 'mosquito breeding', 'health hazard'
    ];
    
    criticalHealthPhrases.forEach(phrase => {
      if (textLower.includes(phrase.toLowerCase())) {
        urgencyScore += 0.3; // High boost for critical health phrases
      }
    });

    // Safety phrases (from previous implementation)
    const safetyPhrases = [
      '  ', '  ', '  ', ' ',
      'women safety', 'girls safety', 'night time', 'walking difficult'
    ];
    
    safetyPhrases.forEach(phrase => {
      if (textLower.includes(phrase.toLowerCase())) {
        urgencyScore += 0.25; // Safety boost
      }
    });

    return Math.min(urgencyScore, 1.0);
  }

  /**
   * Detect safety concerns and return boost score
   */
  detectSafetyConcerns(text) {
    const textLower = text.toLowerCase();
    let safetyBoost = 0;
    
    // High-priority safety phrases
    const criticalSafetyPhrases = [
      // Hindi
      '  ', '  ', '  ', 
      '  ', ' ', ' ', '  ',
      // English
      'women safety', 'girls safety', 'ladies safety', 'night time safety',
      'walking difficult', 'afraid to walk', 'security concern', 'safety issue'
    ];
    
    // Check for critical safety phrases
    criticalSafetyPhrases.forEach(phrase => {
      if (textLower.includes(phrase)) {
        safetyBoost += 0.08; // 8% boost per phrase (reduced from 25%)
      }
    });
    
    // Check for vulnerable groups mentions
    const vulnerableGroups = [
      '', '', '', '', '',
      'girls', 'women', 'ladies', 'children', 'elderly'
    ];
    
    vulnerableGroups.forEach(group => {
      if (textLower.includes(group)) {
        safetyBoost += 0.05; // 5% boost for vulnerable groups (reduced from 15%)
      }
    });
    
    // Check for time-based vulnerability (night, dark)
    const timeVulnerability = ['', '', 'night', 'dark', 'evening'];
    timeVulnerability.forEach(time => {
      if (textLower.includes(time)) {
        safetyBoost += 0.03; // 3% boost for time vulnerability (reduced from 10%)
      }
    });
    
    return Math.min(safetyBoost, 0.15); // Cap at 15% boost (reduced from 40%)
  }

  /**
   * Keyword-based emotion analysis (fallback)
   */
  analyzeWithKeywords(text, language) {
    console.log(` Keyword analysis for language: ${language}`);
    const keywords = this.emotionKeywords[language] || this.emotionKeywords.en;
    const emotions = { anger: 0, urgency: 0, frustration: 0, concern: 0 };
    const textLower = text.toLowerCase();
    
    Object.keys(emotions).forEach(emotion => {
      const emotionKeywords = keywords[emotion] || [];
      let score = 0;
      let matchCount = 0;
      
      emotionKeywords.forEach(keyword => {
        if (textLower.includes(keyword.toLowerCase())) {
          score += 0.25;
          matchCount++;
          console.log(` Found ${emotion} keyword: "${keyword}"`);
        }
      });
      
      emotions[emotion] = Math.min(score, 1.0);
    });

    // For Tamil, if no keywords matched but text exists, set a minimum baseline
    if (language === 'ta') {
      const hasContent = text.trim().length > 10;
      if (hasContent && Object.values(emotions).every(v => v === 0)) {
        console.log(' No Tamil keywords matched, setting baseline concern for civic complaint');
        emotions.concern = 0.3; // Set minimum concern for Tamil complaints
        emotions.urgency = 0.2; // Set minimum urgency
      }
    }

    console.log(` Keyword analysis result:`, emotions);
    return emotions;
  }

  /**
   * Calculate final emotion score with enhanced safety detection
   */
  calculateEmotionScore(emotions) {
    const weights = { urgency: 0.4, anger: 0.3, concern: 0.2, frustration: 0.1 };
    
    let baseScore = Object.keys(emotions).reduce((score, emotion) => {
      return score + (emotions[emotion] * (weights[emotion] || 0));
    }, 0);
    
    // Safety multiplier - if concern is high, boost the score moderately
    if (emotions.concern > 0.3) {
      baseScore = Math.min(baseScore * 1.2, 1.0); // Reduced from 1.5x to 1.2x
    }
    
    return baseScore;
  }

  /**
   * Apply category adjustments with comprehensive civic issue priorities
   */
  applyCategoryAdjustments(score, category) {
    const categoryMultipliers = {
      // CRITICAL HEALTH HAZARDS (High Priority) - 1.7-1.9x
      'sewage_overflow': 1.8,     // Health emergency - disease spread
      'water_contamination': 1.8, // Disease outbreak
      'gas_leak': 1.9,           // Life threatening
      'fire_hazard': 1.8,        // Life threatening  
      'electrical_danger': 1.7,   // Electrocution risk
      'health_emergency': 1.8,    // Medical emergencies
      'disease_outbreak': 1.9,    // Public health crisis
      
      // PUBLIC SAFETY ISSUES (High Priority) - 1.5-1.8x
      'women_safety': 1.7,        // Gender safety concerns
      'night_safety': 1.6,        // Evening/night security
      'broken_streetlight': 1.6,  // Crime prevention
      'road_safety': 1.7,         // Accident prevention
      'public_safety': 1.8,       // General safety
      'traffic_signal': 1.5,      // Accident risk
      'child_safety': 1.7,        // Vulnerable group protection
      
      // INFRASTRUCTURE FAILURES (Medium-High Priority) - 1.3-1.5x
      'pothole': 1.4,             // Vehicle damage, accidents
      'road_damage': 1.4,         // Traffic disruption
      'water_logging': 1.5,       // Mobility, health
      'drain_blockage': 1.4,      // Flooding risk
      'bridge_damage': 1.5,       // Public infrastructure
      'building_collapse': 1.8,    // Life threatening
      
      // BASIC SERVICES (Medium Priority) - 1.3-1.5x
      'garbage_collection': 1.3,   // Health, hygiene
      'water_supply': 1.5,        // Basic necessity
      'power_outage': 1.3,        // Daily life impact
      'sanitation': 1.4,          // Public health
      'public_transport': 1.3,    // Mobility
      
      // ENVIRONMENTAL ISSUES (Medium Priority) - 1.2-1.4x
      'air_pollution': 1.4,       // Health impact
      'noise_pollution': 1.2,     // Quality of life
      'water_pollution': 1.5,     // Health critical
      'illegal_dumping': 1.3,     // Environmental health
      'tree_cutting': 1.2,        // Environmental concern
      
      // CIVIC AMENITIES (Lower Priority) - 1.1-1.2x
      'park_maintenance': 1.1,    // Quality of life
      'street_cleaning': 1.2,     // Aesthetics, hygiene
      'public_toilet': 1.3,       // Basic facility
      'sports_facility': 1.1,     // Recreation
      
      // ADMINISTRATIVE (Lowest Priority) - 1.0-1.1x
      'document_issue': 1.0,      // Bureaucratic
      'tax_related': 1.0,         // Administrative
      'information_request': 1.0, // Query
      'general': 1.0              // Default
    };

    const multiplier = categoryMultipliers[category] || 1.0;
    console.log(` Category "${category}" multiplier: ${multiplier}x`);
    return Math.min(score * multiplier, 1.0);
  }

  /**
   * Auto-detect civic issue category from text content
   */
  detectIssueCategory(text) {
    const textLower = text.toLowerCase();
    
    const categoryPatterns = {
      // CRITICAL HEALTH HAZARDS - Health & Sanitation Keywords
      'sewage_overflow': ['', '', ' ', '', ' ', '', '', 'sewage', 'drain overflow', 'dirty water', 'waste water', 'burst pipe', '', ''],
      
      'water_contamination': ['  ', ' ', '  ', ' ', 'water quality', 'contaminated water', 'drinking water', 'dirty water', ' ', ' '],
      
      'health_emergency': ['', '', '', '', '', '', '', 'disease', 'illness', 'health emergency', 'contamination', 'stench', 'toxic', 'suffocating', '', ''],
      
      // PUBLIC SAFETY ISSUES
      'women_safety': ['  ', '  ', 'women safety', 'girls safety', 'ladies safety', ' '],
      
      'night_safety': ['  ', '', ' ', 'night time', 'street light', 'lighting', 'dark', ' ', ' '],
      
      'broken_streetlight': [' ', 'street light', 'lighting', 'light', 'lamp post', ' ', 'broken light'],
      
      // INFRASTRUCTURE FAILURES  
      'pothole': ['', '  ', 'potholes', 'road holes', ' '],
      
      'road_damage': ['', ' ', ' ', 'road damage', 'broken road', 'damaged road', ' '],
      
      'water_logging': [' ', ' ', 'water logging', 'flooded road', 'standing water'],
      
      'drain_blockage': [' ', 'drain blocked', 'drainage problem', 'clogged drain'],
      
      // BASIC SERVICES
      'garbage_collection': ['', '', '', 'garbage', 'waste', 'trash', 'cleaning', ''],
      
      'water_supply': ['  ', 'water supply', 'no water', ' ', ' '],
      
      'power_outage': ['', 'electricity', 'power cut', '', ''],
      
      'sanitation': ['-', 'sanitation', 'hygiene', 'cleanliness'],
      
      // ENVIRONMENTAL ISSUES
      'air_pollution': ['', '  ', 'air pollution', 'smoke', 'dust', ' '],
      
      'noise_pollution': ['', '', 'noise', 'sound pollution', 'loud', ' '],
      
      'water_pollution': ['  ', 'water pollution', 'river pollution', ' '],
      
      'illegal_dumping': [' ', 'illegal dumping', 'waste dumping', 'garbage dumping']
    };

    let detectedCategory = 'general';
    let maxMatches = 0;
    
    // Find category with most keyword matches
    for (const [category, keywords] of Object.entries(categoryPatterns)) {
      let matches = 0;
      keywords.forEach(keyword => {
        if (textLower.includes(keyword.toLowerCase())) {
          matches++;
        }
      });
      
      if (matches > maxMatches) {
        maxMatches = matches;
        detectedCategory = category;
      }
    }
    
    console.log(` Auto-detected category: "${detectedCategory}" (${maxMatches} keyword matches)`);
    return detectedCategory;
  }

  /**
   * Main emotion analysis function with robust fallback
   */
  async analyzeEmotion(text, category = null) {
    try {
      console.log(' Starting emotion analysis:', text.substring(0, 50));
      
      const language = await this.detectLanguage(text);
      console.log(` Detected language: ${language}`);

      // Auto-detect category if not provided
      if (!category) {
        category = this.detectIssueCategory(text);
      }

      let emotions = {};
      let analysisMethod = '';

      // For Tamil text, prefer enhanced keyword analysis as it's more accurate
      if (language === 'ta') {
        console.log(' Tamil text detected - using enhanced keyword analysis for better accuracy');
        emotions = this.analyzeWithEnhancedKeywords(text, language);
        analysisMethod = 'enhanced-keywords-tamil';
      } 
      // Try AI analysis first for other languages (if token is valid)
      else if (this.config.huggingFaceToken && this.config.huggingFaceToken.startsWith('hf_') && this.config.huggingFaceToken.length > 20) {
        try {
          console.log(' Attempting AI analysis...');
          emotions = await this.analyzeWithAI(text);
          analysisMethod = 'ai-powered';
          console.log(' AI analysis successful');
        } catch (error) {
          console.log(' AI failed, using enhanced keyword analysis');
          emotions = this.analyzeWithEnhancedKeywords(text, language);
          analysisMethod = 'enhanced-keywords';
        }
      } else {
        console.log(' Invalid or missing Hugging Face token, using enhanced keyword analysis');
        emotions = this.analyzeWithEnhancedKeywords(text, language);
        analysisMethod = 'enhanced-keywords';
      }

      const emotionScore = this.calculateEmotionScore(emotions);
      let adjustedScore = this.applyCategoryAdjustments(emotionScore, category);
      
      // Additional safety concern boost
      const safetyBoost = this.detectSafetyConcerns(text);
      if (safetyBoost > 0) {
        adjustedScore = Math.min(adjustedScore + safetyBoost, 1.0);
        console.log(` Safety concern detected, boosting score by ${(safetyBoost * 100).toFixed(1)}%`);
      }

      console.log(' Analysis result:', { emotions, baseScore: emotionScore, finalScore: adjustedScore, method: analysisMethod, category });

      return {
        success: true,
        emotionScore: adjustedScore,
        emotions,
        language,
        analysisMethod,
        category
      };
    } catch (error) {
      console.error(' Analysis failed:', error);
      
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

  /**
   * Enhanced keyword analysis with better detection
   */
  analyzeWithEnhancedKeywords(text, language) {
    // Start with basic keyword analysis
    let emotions = this.analyzeWithKeywords(text, language);
    
    // Enhanced urgency detection from content
    const urgencyBoost = this.detectUrgencyFromText(text);
    emotions.urgency = Math.max(emotions.urgency, urgencyBoost);
    
    // Enhanced concern detection
    const concernBoost = this.detectConcernFromText(text);
    emotions.concern = Math.max(emotions.concern, concernBoost);
    
    // Enhanced anger detection  
    const angerBoost = this.detectAngerFromText(text);
    emotions.anger = Math.max(emotions.anger, angerBoost);
    
    console.log(' Enhanced keyword analysis complete:', emotions);
    return emotions;
  }

  /**
   * Enhanced concern detection
   */
  detectConcernFromText(text) {
    const concernIndicators = [
      // English
      'worried', 'concerned', 'afraid', 'scared', 'nervous', 'anxious', 'trouble', 'problem',
      // Hindi
      '', '', '', '', '', '',
      // Tamil  
      '', '', ''
    ];

    return this.calculateTextScore(text, concernIndicators, 0.3);
  }

  /**
   * Enhanced anger detection
   */
  detectAngerFromText(text) {
    const angerIndicators = [
      // English
      'angry', 'furious', 'outraged', 'mad', 'frustrated', 'fed up', 'enough',
      // Hindi
      '', '', '', ' ',
      // Tamil
      '', ''
    ];

    return this.calculateTextScore(text, angerIndicators, 0.4);
  }

  /**
   * Helper function to calculate emotion score from text indicators
   */
  calculateTextScore(text, indicators, baseScore) {
    let score = 0;
    const textLower = text.toLowerCase();
    
    indicators.forEach(indicator => {
      if (textLower.includes(indicator.toLowerCase())) {
        score += baseScore;
      }
    });

    return Math.min(score, 1.0);
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
    console.error(' API Error:', error);
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
    { text: "             ", category: "pothole", language: "hi" },
    { text: "   .    .", category: "pothole", language: "ta" }
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


