const express = require('express');
const router = express.Router();
const axios = require('axios');

/**
 * Enhanced Multilingual Emotion Analysis Service for CivicStack
 * AI-powered with Hugging Face API + Smart Keyword Fallback
 */

class EmotionAnalysisService {
  constructor() {
    this.config = {
      huggingFaceToken: process.env.HUGGINGFACE_API_TOKEN,
      // Local DistilBERT Python service (preferred — no API key needed)
      localModelUrl: process.env.DISTILBERT_SERVICE_URL || 'http://127.0.0.1:5001',
      // Remote HF API fallback models
      models: [
        'https://api-inference.huggingface.co/models/distilbert-base-uncased-finetuned-sst-2-english',
        'https://api-inference.huggingface.co/models/cardiffnlp/twitter-roberta-base-sentiment-latest',
        'https://api-inference.huggingface.co/models/nlptown/bert-base-multilingual-uncased-sentiment',
        'https://api-inference.huggingface.co/models/cardiffnlp/twitter-xlm-roberta-base-sentiment'
      ]
    };
    this.localModelAvailable = null; // will be checked on first call

    // Enhanced multilingual keywords
    this.emotionKeywords = {
      hi: { // Hindi
        anger: ['गुस्सा', 'क्रोध', 'नाराज़', 'परेशान', 'चिढ़', 'खफा'],
        urgency: ['तुरंत', 'जल्दी', 'आपातकाल', 'खतरनाक', 'अभी', 'दुर्घटना', 'दुर्घटनाएं', 'मौत', 'मौतें', 'मृत्यु'],
        frustration: ['परेशान', 'तंग', 'दुखी', 'चिंतित', 'हैरान', 'निराश'],
        concern: ['चिंता', 'डर', 'फिक्र', 'घबराहट', 'बेचैनी', 'चिंतित']
      },
      en: { // English - Comprehensive civic complaint vocabulary
        anger: ['angry', 'furious', 'mad', 'irritated', 'annoyed', 'frustrated', 'outraged', 'unacceptable',
          'ridiculous', 'terrible', 'horrible', 'disgraceful', 'shameful', 'negligence', 'incompetent',
          'useless', 'pathetic', 'worst', 'appalling', 'intolerable', 'infuriating'],
        urgency: ['urgent', 'emergency', 'immediate', 'dangerous', 'critical', 'accident', 'accidents',
          'death', 'deaths', 'fatal', 'unsafe', 'hazard', 'hazardous', 'risk', 'threat', 'harm',
          'injury', 'injured', 'hurt', 'broken', 'damaged', 'collapsed', 'flooding', 'blocked',
          'overflowing', 'children', 'school', 'hospital', 'life-threatening', 'asap', 'pothole',
          'potholes', 'crack', 'cracks', 'sinkhole', 'danger', 'deadly', 'severe', 'major',
          'collapsing', 'fallen', 'leaking', 'burst', 'electrocution', 'fire'],
        frustration: ['frustrated', 'fed up', 'tired', 'disappointed', 'ignored', 'neglected',
          'no action', 'nothing done', 'repeated', 'again', 'still', 'months', 'years',
          'long time', 'complaint', 'waiting', 'delay', 'delayed', 'pending', 'unanswered',
          'no response', 'waste of time', 'hopeless', 'given up', 'losing patience'],
        concern: ['worried', 'concerned', 'scared', 'afraid', 'anxious', 'safety', 'risk',
          'danger', 'dangerous', 'hazardous', 'children', 'elderly', 'school', 'hospital',
          'health', 'disease', 'pollution', 'unsafe', 'vulnerable', 'fear', 'threatening',
          'risky', 'unstable', 'damaged', 'broken', 'exposed', 'open', 'unprotected',
          'residents', 'pedestrians', 'commuters', 'public', 'community', 'neighbourhood']
      },
      ta: { // Tamil - Comprehensive civic complaint keywords (includes alternate spellings)
        anger: ['கோபம்', 'எரிச்சல்', 'சீற்றம்', 'வெறுப்பு', 'கோபமாக', 'எரிச்சலாக', 'கோபப்படுகிறேன்', 'வெறுக்கிறேன்',
          'மோசமான', 'அலட்சியம்', 'கேவலம்', 'அசிங்கம்', 'மிக மோசம்', 'பொறுப்பற்ற', 'தரக்குறைவான'],
        urgency: ['அவசரம்', 'உடனடி', 'ஆபத்து', 'முக்கியம்', 'அவசரமாக', 'உடனடியாக', 'ஆபத்தான', 'அவசர',
          'மரணம்', 'விபத்து', 'உயிருக்கு ஆபத்து', 'பெரிய', 'மிகப்பெரிய',
          'பிரச்சனை', 'பிரச்சினை', 'பிரச்னை', 'பிரச்சனைகள்', 'பிரச்சினைகள்',
          'நிறைய', 'அதிகம்', 'மிகவும்', 'தீவிர', 'கடுமையான', 'மோசமான',
          'குழி', 'குழிகள்', 'சாலை', 'சேதம்', 'உடைந்த', 'விரிசல்',
          'வெள்ளம்', 'மின்சாரம்', 'கசிவு', 'தண்ணீர்', 'குப்பை'],
        frustration: ['வருத்தம்', 'ஏமாற்றம்', 'வருத்தமாக', 'ஏமாற்றமாக', 'கஷ்டம்', 'துன்பம்', 'வேதனை', 'சோகம்',
          'எத்தனை முறை', 'பல நாட்கள்', 'நடவடிக்கை இல்லை', 'காத்திருக்கிறோம்', 'தாமதம்',
          'யாரும் கவனிக்கவில்லை', 'மீண்டும்', 'திரும்ப திரும்ப', 'சரியாகவில்லை'],
        concern: ['கவலை', 'பயம்', 'கவலையாக', 'பயமாக', 'வேவலை', 'சிந்தனை', 'பரிவு', 'கவனம்',
          'உளைச்சல்', 'நெருக்கடி', 'தேவை', 'சிக்கல்',
          'பிரச்சனை', 'பிரச்சினை', 'பிரச்னை', 'பிரச்சனைகள்', 'பிரச்சினைகள்',
          'பாதுகாப்பு', 'ஆபத்து', 'ஆபத்தான', 'நோய்', 'அசுத்தம்', 'தூய்மை',
          'குழந்தைகள்', 'முதியவர்கள்', 'பள்ளி', 'மருத்துவமனை',
          'நிறைய', 'அதிகம்', 'மிகவும்', 'ஏரியா', 'பகுதி', 'பகுதியில்']
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
   * AI-powered emotion analysis using LOCAL DistilBERT model
   */
  async analyzeWithLocalModel(text) {
    const url = `${this.config.localModelUrl}/predict`;
    console.log('🧠 Calling local DistilBERT service:', url);

    const response = await axios.post(
      url,
      { text },
      { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
    );

    console.log('✅ Local model response:', JSON.stringify(response.data));
    return this.convertSentimentToEmotions(response.data, text);
  }

  /**
   * Check if local DistilBERT service is running
   */
  async checkLocalModel() {
    if (this.localModelAvailable !== null) return this.localModelAvailable;
    try {
      await axios.get(`${this.config.localModelUrl}/health`, { timeout: 3000 });
      this.localModelAvailable = true;
      console.log('✅ Local DistilBERT service is available');
    } catch {
      this.localModelAvailable = false;
      console.log('⚠️ Local DistilBERT service not available, will use fallbacks');
    }
    // Re-check every 60s in case the service comes up later
    setTimeout(() => { this.localModelAvailable = null; }, 60000);
    return this.localModelAvailable;
  }

  /**
   * AI-powered emotion analysis using Hugging Face with multiple model fallbacks
   */
  async analyzeWithAI(text) {
    if (!this.config.huggingFaceToken) {
      throw new Error('No Hugging Face API token');
    }

    console.log('🤖 Starting AI analysis for text:', text.substring(0, 50));

    // Try each model until one works
    for (let i = 0; i < this.config.models.length; i++) {
      const modelUrl = this.config.models[i];
      console.log(`🔄 Trying model ${i + 1}/${this.config.models.length}: ${modelUrl.split('/').pop()}`);

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

        console.log('✅ AI Model succeeded! Response:', response.data);
        return this.convertSentimentToEmotions(response.data, text);

      } catch (error) {
        console.log(`❌ Model ${i + 1} failed:`, error.response?.status || error.message);

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
    console.log('🔄 Converting sentiment data:', sentimentData);

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

      console.log(`📊 AI Sentiment: ${label} (${score.toFixed(3)})`);

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
          console.log(`🔧 Adjusting positive sentiment for ${language} civic complaint`);
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
      console.log('⚠️ Unknown sentiment format, using text analysis only');
      // Fallback to pure text analysis
      const urgencyBoost = this.detectUrgencyFromText(text);
      emotions.urgency = urgencyBoost;
      emotions.concern = urgencyBoost * 0.8;
    }

    console.log('✅ Final AI emotions:', emotions);
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
      'मौत', 'मौतें', 'मृत्यु', 'दुर्घटना', 'दुर्घटनाएं', 'आपातकाल', 'खतरनाक', 'गंभीर',
      'बीमारी', 'रोग', 'स्वास्थ्य', 'प्रदूषण', 'गंदगी', 'बदबू', 'दुर्गंध', 'सड़न',
      'घुटन', 'घुट रहे', 'सीवेज', 'नाली', 'गंदा पानी', 'रिसाव', 'फूटना', 'बहना',
      'मुश्किल', 'कठिनाई', 'परेशानी', 'दिक्कत', 'समस्या',

      // SAFETY TERMS
      // Hindi - Safety & Security  
      'सुरक्षा', 'सुरक्षित', 'असुरक्षित', 'खतरा', 'डर', 'चिंता',
      'लड़कियों', 'महिलाओं', 'बच्चों', 'रात', 'अंधेरा', 'सुनिश्चित', 'नहीं',

      // Tamil
      'மரணம்', 'விபத்து', 'ஆபத்து', 'அவசரம்', 'பாதுகாப்பு', 'பயம்', 'கவலை', 'நோய்', 'அசுத்தம்'
    ];

    let urgencyScore = 0;
    const textLower = text.toLowerCase();

    urgencyWords.forEach(word => {
      if (textLower.includes(word.toLowerCase())) {
        urgencyScore += 0.20; // Good boost per keyword
      }
    });

    // Special high-impact health phrases get higher scores
    const criticalHealthPhrases = [
      // Hindi
      'घुट रहे हैं', 'बदबू में', 'गंदगी में', 'सीवेज का', 'गंदा पानी', 'बीमार हो रहे', 'स्वास्थ्य खराब',
      'सांस लेने में दिक्कत', 'पेट की बीमारी', 'डेंगू का खतरा', 'मच्छर पैदा हो रहे',

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
      'सुरक्षा सुनिश्चित नहीं', 'लड़कियों की सुरक्षा', 'रात के समय', 'चलना मुश्किल',
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
      'सुरक्षा सुनिश्चित नहीं', 'लड़कियों की सुरक्षा', 'महिलाओं की सुरक्षा',
      'रात के समय', 'अंधेरे में', 'चलना मुश्किल', 'डर लगता है',
      // English
      'women safety', 'girls safety', 'ladies safety', 'night time safety',
      'walking difficult', 'afraid to walk', 'security concern', 'safety issue'
    ];

    // Check for critical safety phrases
    criticalSafetyPhrases.forEach(phrase => {
      if (textLower.includes(phrase)) {
        safetyBoost += 0.12; // 12% boost per critical safety phrase
      }
    });

    // Check for vulnerable groups mentions
    const vulnerableGroups = [
      'लड़कियों', 'लड़कियां', 'महिलाओं', 'बच्चों', 'बुजुर्गों',
      'girls', 'women', 'ladies', 'children', 'elderly'
    ];

    vulnerableGroups.forEach(group => {
      if (textLower.includes(group)) {
        safetyBoost += 0.08; // 8% boost for vulnerable groups
      }
    });

    // Check for time-based vulnerability (night, dark)
    const timeVulnerability = ['रात', 'अंधेरा', 'night', 'dark', 'evening'];
    timeVulnerability.forEach(time => {
      if (textLower.includes(time)) {
        safetyBoost += 0.05; // 5% boost for time vulnerability
      }
    });

    return Math.min(safetyBoost, 0.30); // Cap at 30% boost
  }

  /**
   * Keyword-based emotion analysis (fallback)
   */
  analyzeWithKeywords(text, language) {
    console.log(`🔍 Keyword analysis for language: ${language}`);
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
          console.log(`✅ Found ${emotion} keyword: "${keyword}"`);
        }
      });

      emotions[emotion] = Math.min(score, 1.0);
    });

    // For non-English, if no keywords matched but text exists, set a minimum baseline
    if (language === 'ta' || language === 'hi' || language === 'te') {
      const hasContent = text.trim().length > 10;
      if (hasContent && Object.values(emotions).every(v => v === 0)) {
        console.log(`🔧 No ${language} keywords matched, setting baseline for civic complaint`);
        emotions.concern = 0.40;
        emotions.urgency = 0.35;
        emotions.frustration = 0.15;
      }
    }

    console.log(`📊 Keyword analysis result:`, emotions);
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
    console.log(`🏷️ Category "${category}" multiplier: ${multiplier}x`);
    return Math.min(score * multiplier, 1.0);
  }

  /**
   * Auto-detect civic issue category from text content
   */
  detectIssueCategory(text) {
    const textLower = text.toLowerCase();

    const categoryPatterns = {
      // CRITICAL HEALTH HAZARDS - Health & Sanitation Keywords
      'sewage_overflow': ['सीवेज', 'नाली', 'गंदा पानी', 'रिसाव', 'घुट रहे', 'बहना', 'फूटना', 'sewage', 'drain overflow', 'dirty water', 'waste water', 'burst pipe', 'கழிவுநீர்', 'வடிகால்'],

      'water_contamination': ['पानी की गुणवत्ता', 'दूषित पानी', 'पीने का पानी', 'गंदा पानी', 'water quality', 'contaminated water', 'drinking water', 'dirty water', 'தண்ணீர் தரம்', 'அசுத்த நீர்'],

      'health_emergency': ['बीमारी', 'रोग', 'स्वास्थ्य', 'बदबू', 'दुर्गंध', 'सड़न', 'घुटन', 'disease', 'illness', 'health emergency', 'contamination', 'stench', 'toxic', 'suffocating', 'நோய்', 'அசுத்தம்'],

      // PUBLIC SAFETY ISSUES
      'women_safety': ['लड़कियों की सुरक्षा', 'महिलाओं की सुरक्षा', 'women safety', 'girls safety', 'ladies safety', 'பெண்கள் பாதுகாப்பு'],

      'night_safety': ['रात के समय', 'अंधेरा', 'स्ट्रीट लाइट', 'night time', 'street light', 'lighting', 'dark', 'இரவு நேரம்', 'தெரு விளக்கு'],

      'broken_streetlight': ['स्ट्रीट लाइट', 'street light', 'lighting', 'light', 'lamp post', 'तार फूटे', 'broken light'],

      // INFRASTRUCTURE FAILURES  
      'pothole': ['गड्ढे', 'सड़क के गड्ढे', 'potholes', 'road holes', 'சாலை குழி'],

      'road_damage': ['सड़क', 'खराब सड़क', 'टूटी सड़क', 'road damage', 'broken road', 'damaged road', 'சாலை உடைவு'],

      'water_logging': ['पानी भरा', 'जल जमाव', 'water logging', 'flooded road', 'standing water'],

      'drain_blockage': ['नाली बंद', 'drain blocked', 'drainage problem', 'clogged drain'],

      // BASIC SERVICES
      'garbage_collection': ['कचरा', 'गंदगी', 'सफाई', 'garbage', 'waste', 'trash', 'cleaning', 'குப்பை'],

      'water_supply': ['पानी की आपूर्ति', 'water supply', 'no water', 'पानी नहीं', 'தண்ணீர் வராது'],

      'power_outage': ['बिजली', 'electricity', 'power cut', 'विद्युत', 'மின்சாரம்'],

      'sanitation': ['साफ-सफाई', 'sanitation', 'hygiene', 'cleanliness'],

      // ENVIRONMENTAL ISSUES
      'air_pollution': ['प्रदूषण', 'हवा की गुणवत्ता', 'air pollution', 'smoke', 'dust', 'காற்று மாசு'],

      'noise_pollution': ['शोर', 'आवाज', 'noise', 'sound pollution', 'loud', 'ஒலி மாசு'],

      'water_pollution': ['पानी का प्रदूषण', 'water pollution', 'river pollution', 'நீர் மாசு'],

      'illegal_dumping': ['अवैध कचरा', 'illegal dumping', 'waste dumping', 'garbage dumping']
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

    console.log(`🎯 Auto-detected category: "${detectedCategory}" (${maxMatches} keyword matches)`);
    return detectedCategory;
  }

  /**
   * Main emotion analysis function with robust fallback
   */
  async analyzeEmotion(text, category = null, translation = null) {
    try {
      console.log('🧠 Starting emotion analysis:', text.substring(0, 50));
      if (translation) console.log('🌐 English translation available:', translation.substring(0, 50));

      const language = await this.detectLanguage(text);
      console.log(`📊 Detected language: ${language}`);

      // Auto-detect category if not provided
      if (!category) {
        category = this.detectIssueCategory(text);
      }

      let emotions = {};
      let analysisMethod = '';

      // For Tamil/Hindi text, use enhanced keyword analysis + English translation if available
      if (language === 'ta' || language === 'hi') {
        console.log(`🌟 ${language === 'ta' ? 'Tamil' : 'Hindi'} text detected - using enhanced keyword analysis`);
        emotions = this.analyzeWithEnhancedKeywords(text, language);
        analysisMethod = `enhanced-keywords-${language === 'ta' ? 'tamil' : 'hindi'}`;

        // If English translation is available, also analyze it and merge (take max per emotion)
        if (translation && translation.trim().length > 0) {
          console.log('🌐 Also analyzing English translation for better accuracy');
          const translationEmotions = this.analyzeWithEnhancedKeywords(translation, 'en');
          console.log('🌐 Translation emotion scores:', translationEmotions);
          Object.keys(emotions).forEach(emotion => {
            if (translationEmotions[emotion] > emotions[emotion]) {
              console.log(`🌐 Boosting ${emotion}: ${emotions[emotion].toFixed(2)} → ${translationEmotions[emotion].toFixed(2)} (from translation)`);
              emotions[emotion] = translationEmotions[emotion];
            }
          });
          analysisMethod += '+translation';
        }
      }
      // 1) Try LOCAL DistilBERT model first (no API key needed)
      else if (await this.checkLocalModel()) {
        try {
          console.log('🧠 Using local DistilBERT model...');
          emotions = await this.analyzeWithLocalModel(text);
          analysisMethod = 'local-distilbert';
          console.log('✅ Local model analysis successful');
        } catch (error) {
          console.log('⚠️ Local model failed:', error.message);
          // Mark unavailable so we don't keep trying a broken service
          this.localModelAvailable = false;
          // Fall through to HF API or keywords
          emotions = null;
        }
      }
      // 2) Try remote Hugging Face API (needs token)
      if (!emotions && this.config.huggingFaceToken && this.config.huggingFaceToken.startsWith('hf_') && this.config.huggingFaceToken.length > 20) {
        try {
          console.log('🤖 Attempting HF API analysis...');
          emotions = await this.analyzeWithAI(text);
          analysisMethod = 'ai-powered';
          console.log('✅ HF API analysis successful');
        } catch (error) {
          console.log('⚠️ HF API failed, using enhanced keyword analysis');
          emotions = null;
        }
      }
      // 3) Fallback to enhanced keywords
      if (!emotions) {
        console.log('📝 Using enhanced keyword analysis');
        emotions = this.analyzeWithEnhancedKeywords(text, language);
        analysisMethod = analysisMethod || 'enhanced-keywords';
      }

      const emotionScore = this.calculateEmotionScore(emotions);
      let adjustedScore = this.applyCategoryAdjustments(emotionScore, category);

      // Additional safety concern boost
      const safetyBoost = this.detectSafetyConcerns(text);
      if (safetyBoost > 0) {
        adjustedScore = Math.min(adjustedScore + safetyBoost, 1.0);
        console.log(`🚨 Safety concern detected, boosting score by ${(safetyBoost * 100).toFixed(1)}%`);
      }

      console.log('🎯 Analysis result:', { emotions, baseScore: emotionScore, finalScore: adjustedScore, method: analysisMethod, category });

      return {
        success: true,
        emotionScore: adjustedScore,
        emotions,
        language,
        analysisMethod,
        category
      };
    } catch (error) {
      console.error('❌ Analysis failed:', error);

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

    // Enhanced frustration detection
    const frustrationBoost = this.detectFrustrationFromText(text);
    emotions.frustration = Math.max(emotions.frustration, frustrationBoost);

    // Civic complaint minimum floor: any substantive text describing an issue
    // should get at least a baseline score
    const textLen = text.trim().length;
    if (textLen > 15) {
      const totalScore = emotions.urgency + emotions.concern + emotions.anger + emotions.frustration;
      if (totalScore < 0.6) {
        // For non-English languages, keyword coverage is spotty so apply a stronger floor
        if (language === 'ta' || language === 'hi' || language === 'te') {
          emotions.concern = Math.max(emotions.concern, 0.40);
          emotions.urgency = Math.max(emotions.urgency, 0.35);
          emotions.frustration = Math.max(emotions.frustration, 0.20);
          console.log('🔧 Applied non-English civic complaint minimum floor');
        } else if (totalScore < 0.3) {
          // English text with very low score
          emotions.concern = Math.max(emotions.concern, 0.25);
          emotions.urgency = Math.max(emotions.urgency, 0.15);
          console.log('🔧 Applied civic complaint minimum floor');
        }
      }
    }

    console.log('🔍 Enhanced keyword analysis complete:', emotions);
    return emotions;
  }

  /**
   * Enhanced concern detection
   */
  detectConcernFromText(text) {
    const concernIndicators = [
      // English - civic concerns
      'worried', 'concerned', 'afraid', 'scared', 'nervous', 'anxious', 'trouble', 'problem',
      'safety', 'risk', 'danger', 'dangerous', 'hazard', 'hazardous', 'unsafe', 'threat',
      'children', 'school', 'hospital', 'elderly', 'pedestrians', 'residents', 'commuters',
      'health', 'disease', 'pollution', 'contamination', 'broken', 'damaged', 'exposed',
      'vulnerable', 'unprotected', 'unstable', 'collapsing', 'falling', 'leaking',
      'potholes', 'pothole', 'crack', 'cracks', 'flooded', 'blocked', 'overflowing',
      'accident', 'injury', 'hurt', 'harm', 'public', 'community', 'neighbourhood',
      // Hindi
      'चिंतित', 'परेशान', 'डरा', 'घबराया', 'समस्या', 'मुसीबत', 'खतरा', 'सुरक्षा',
      'बच्चों', 'स्कूल', 'अस्पताल', 'बुजुर्ग', 'स्वास्थ्य',
      // Tamil
      'கவலை', 'பயம்', 'பிரச்சினை', 'ஆபத்து', 'பாதுகாப்பு'
    ];

    return this.calculateTextScore(text, concernIndicators, 0.2);
  }

  /**
   * Enhanced anger detection
   */
  detectAngerFromText(text) {
    const angerIndicators = [
      // English - civic complaint anger
      'angry', 'furious', 'outraged', 'mad', 'frustrated', 'fed up', 'enough',
      'unacceptable', 'ridiculous', 'terrible', 'horrible', 'disgraceful', 'shameful',
      'negligence', 'incompetent', 'useless', 'pathetic', 'worst', 'appalling',
      'intolerable', 'infuriating', 'disgusting', 'deplorable', 'inexcusable',
      'irresponsible', 'careless', 'reckless', 'corrupt', 'waste',
      // Hindi
      'गुस्सा', 'क्रोध', 'नाराज़', 'बहुत परेशान', 'घटिया', 'बदतर', 'लापरवाही',
      // Tamil
      'கோபம்', 'எரிச்சல்', 'மோசமான', 'அலட்சியம்'
    ];

    return this.calculateTextScore(text, angerIndicators, 0.3);
  }

  /**
   * Enhanced frustration detection
   */
  detectFrustrationFromText(text) {
    const frustrationIndicators = [
      // English - civic frustration
      'frustrated', 'fed up', 'tired', 'disappointed', 'ignored', 'neglected',
      'no action', 'nothing done', 'repeated', 'again', 'still not fixed',
      'months', 'years', 'long time', 'waiting', 'delay', 'delayed', 'pending',
      'unanswered', 'no response', 'waste of time', 'hopeless', 'given up',
      'losing patience', 'how many times', 'multiple complaints', 'no improvement',
      'same problem', 'getting worse', 'deteriorating', 'nobody cares',
      // Hindi
      'निराश', 'ऊबा', 'तंग', 'इंतजार', 'कई बार', 'कोई कार्रवाई नहीं',
      // Tamil
      'ஏமாற்றம்', 'வருத்தம்', 'காத்திருக்கிறோம்'
    ];

    return this.calculateTextScore(text, frustrationIndicators, 0.25);
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
    const { text, category, translation } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Text is required for emotion analysis'
      });
    }

    if (translation) {
      console.log('🌐 Received English translation for emotion analysis:', translation.substring(0, 80));
    }

    const result = await emotionService.analyzeEmotion(text, category, translation);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ API Error:', error);
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
    { text: "इस गड्ढे के कारण कई दुर्घटनाएं और मौतें हुई हैं कृपया इसे ठीक करें", category: "pothole", language: "hi" },
    { text: "சாலையில் ஆபத்தான குழிகள் உள்ளன. நான் மிகவும் கவலையாக இருக்கிறேன்.", category: "pothole", language: "ta" }
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
