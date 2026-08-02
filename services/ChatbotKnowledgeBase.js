// CivicStack Chatbot Knowledge Base
// Comprehensive information about app features, civic issues, and user guidance

const CIVIC_KNOWLEDGE_BASE = {
  // App Features and Navigation
  app_features: {
    keywords: ['features', 'what can', 'how to use', 'navigate', 'app overview', 'main features'],
    responses: [
      {
        text: "**CivicStack Main Features:**\n\n**Submit Complaints** - Report civic issues with AI validation\n**Interactive Map** - View all complaints on a live map\n**Feed View** - Instagram-style feed of nearby issues\n**Voting System** - Upvote important complaints\n**Priority Scoring** - AI-powered urgency assessment\n**Voice Input** - Multi-language speech recognition\n**Smart Location** - Privacy-aware location capture\n**Image Validation** - AI verifies civic issues\n**Personal Reports** - Track your submissions\n**Transparency** - Public accountability features",
        confidence: 0.95,
        category: 'app_overview',
        suggestedActions: [
          { type: 'submit_complaint', label: 'Submit Complaint' },
          { type: 'view_map', label: 'View Map' },
          { type: 'view_feed', label: 'View Feed' }
        ]
      }
    ]
  },

  // Complaint Submission Process
  submit_complaint: {
    keywords: ['submit', 'report', 'complaint', 'how to submit', 'file complaint', 'report issue', 'pothole', 'pot hole', 'road damage', 'road issue', 'broken road'],
    responses: [
      {
        text: "**How to Submit a Complaint:**\n\n1. **Select Category** - Choose from Fire Hazard, Electrical Danger, Pothole, etc.\n2. **Auto Location** - We'll capture your location for priority assessment\n3. **Add Title & Description** - Use voice input in 11+ languages\n4. **Take Photo** - Our AI validates it's a real civic issue\n5. **AI Processing** - Get instant priority score and validation\n6. **Submit** - Your complaint is routed to authorities\n\n**Features:**\n• Voice input in Hindi, Tamil, Telugu, English, etc.\n• AI image validation\n• Priority scoring based on location\n• Privacy-protected location capture",
        confidence: 0.98,
        category: 'submission_guide',
        suggestedActions: [
          { type: 'submit_complaint', label: 'Start Submission' },
          { type: 'navigate', screen: 'PersonalReports', label: 'My Reports' }
        ]
      }
    ]
  },

  // Specific Pothole Reporting
  pothole_reporting: {
    keywords: ['pothole', 'pot hole', 'road hole', 'road damage', 'broken road', 'street damage', 'pavement damage'],
    responses: [
      {
        text: "**Reporting Potholes:**\n\n**Step-by-Step:**\n1. Open CivicStack app\n2. Tap 'Submit Complaint'\n3. Select 'Pothole' category\n4. Take clear photo showing the hole\n5. Add description (voice input available)\n6. Confirm location is accurate\n7. Submit - gets routed to road dept!\n\n**Pro Tips:**\n• Photo from multiple angles\n• Include size reference (coin, shoe)\n• Mention traffic impact\n• Use voice input in your language\n• Vote on similar nearby potholes\n\n**Priority Factors:**\n• Size and depth\n• Traffic volume\n• Near schools/hospitals\n• Community votes",
        confidence: 0.95,
        category: 'pothole_guide',
        suggestedActions: [
          { type: 'submit_complaint', label: 'Report Pothole Now' },
          { type: 'view_map', label: 'See Other Potholes' }
        ]
      }
    ]
  },

  // Civic Issues Categories
  civic_issues: {
    keywords: ['civic issues', 'categories', 'what can report', 'types of complaints', 'issue types'],
    responses: [
      {
        text: "🏛️ **Civic Issues You Can Report:**\n\n🚨 **Urgent Issues:**\n• Fire Hazard\n• Electrical Danger\n• Sewage Overflow\n\n⚠️ **Safety Issues:**\n• Broken Streetlight\n• Traffic Signal Problems\n• Road Damage\n\n📋 **General Issues:**\n• Potholes\n• Garbage Collection\n• Water Leakage\n• Tree Issues\n• Flooding\n• Others\n\n💡 Each category has different priority levels and response times. Urgent issues get immediate attention!",
        confidence: 0.92,
        category: 'civic_categories',
        suggestedActions: [
          { type: 'submit_complaint', label: '🚨 Report Urgent Issue' },
          { type: 'view_feed', label: '👀 See Examples' }
        ]
      }
    ]
  },

  // Voting System
  voting: {
    keywords: ['vote', 'voting', 'upvote', 'support', 'priority', 'how voting works'],
    responses: [
      {
        text: "👍 **How Voting Works:**\n\n📊 **Upvote Complaints** - Support issues that affect you\n🔢 **Vote Count** - Higher votes = higher priority\n🎯 **Smart Priority** - Combines votes + location + AI analysis\n📍 **Nearby Focus** - Vote on issues within 5km\n⚖️ **Fair System** - One vote per user per complaint\n📈 **Real Impact** - Your vote helps prioritize municipal response\n\n✨ **Benefits:**\n• Amplify community voice\n• Faster resolution for popular issues\n• Democratic prioritization\n• Transparency in civic engagement",
        confidence: 0.90,
        category: 'voting_system',
        suggestedActions: [
          { type: 'view_feed', label: '👍 Start Voting' },
          { type: 'view_map', label: '🗺️ Find Issues to Vote On' }
        ]
      }
    ]
  },

  // Voice Input and Language Support
  voice_input: {
    keywords: ['voice', 'speech', 'language', 'hindi', 'tamil', 'telugu', 'speak', 'microphone'],
    responses: [
      {
        text: "🎤 **Voice Input Features:**\n\n🌍 **Supported Languages:**\n• Hindi (हिंदी)\n• Tamil (தமிழ்)\n• Telugu (తెలుగు)\n• English\n• Kannada (ಕನ್ನಡ)\n• Marathi (मराठी)\n• Bengali (বাংলা)\n• Gujarati (ગુજરાતી)\n• Malayalam (മലയാളം)\n• Punjabi (ਪੰਜਾਬੀ)\n• Urdu (اردو)\n\n🔧 **How to Use:**\n1. Select your language\n2. Tap the microphone icon\n3. Speak clearly\n4. AI converts speech to text\n5. Review and submit\n\n💡 Perfect for users who prefer speaking over typing!",
        confidence: 0.88,
        category: 'voice_features',
        suggestedActions: [
          { type: 'submit_complaint', label: '🎤 Try Voice Input' }
        ]
      }
    ]
  },

  // Location and Privacy
  location_privacy: {
    keywords: ['location', 'privacy', 'gps', 'tracking', 'address', 'where', 'safety'],
    responses: [
      {
        text: "📍 **Location & Privacy:**\n\n🔒 **Privacy Levels:**\n• **Exact** - For urgent issues (Fire, Electrical)\n• **Street** - General issues (Road, Pothole)\n• **Area** - Sensitive locations\n• **City** - Maximum privacy\n\n✅ **How We Protect You:**\n• Automatic privacy level selection\n• No personal data stored\n• Location used only for routing\n• Street-level accuracy (±25m)\n• Option to recapture location\n\n🎯 **Why Location Matters:**\n• Routes to correct municipal office\n• Priority scoring near critical infrastructure\n• Emergency response coordination\n• Prevents duplicate reports",
        confidence: 0.94,
        category: 'location_privacy',
        suggestedActions: [
          { type: 'submit_complaint', label: '📍 Test Location Capture' }
        ]
      }
    ]
  },

  // Image Validation and AI
  image_validation: {
    keywords: ['image', 'photo', 'ai', 'validation', 'picture', 'camera', 'upload'],
    responses: [
      {
        text: "📸 **AI Image Validation:**\n\n🤖 **Smart Detection:**\n• Verifies real civic issues\n• Identifies problem types\n• Provides confidence scores\n• Prevents spam/irrelevant photos\n\n✅ **Validation Process:**\n1. Upload/take photo\n2. AI analyzes image content\n3. Detects civic issue type\n4. Shows confidence percentage\n5. Allows submission if valid\n\n🎯 **Supported Issues:**\n• Road damage, potholes\n• Garbage, sewage\n• Electrical hazards\n• Water leaks\n• Structural damage\n• Traffic problems\n\n💡 Even if validation fails, you can still submit for urgent issues!",
        confidence: 0.89,
        category: 'image_ai',
        suggestedActions: [
          { type: 'submit_complaint', label: '📸 Try Image Upload' }
        ]
      }
    ]
  },

  // Map Features
  map_features: {
    keywords: ['map', 'location view', 'see complaints', 'nearby issues', 'visual', 'markers'],
    responses: [
      {
        text: "🗺️ **Interactive Complaint Map:**\n\n📍 **Map Features:**\n• Real-time complaint markers\n• Color-coded by status (Pending/In Progress/Resolved)\n• Cluster view for dense areas\n• Click markers for details\n• Auto-fit to show all complaints\n• User location indicator\n\n🎨 **Status Colors:**\n• 🔴 Red - Pending\n• 🟡 Yellow - In Progress\n• 🟢 Green - Resolved\n• 🔵 Blue - Under Review\n\n✨ **Smart Features:**\n• Auto-zoom to your area\n• Filter by complaint type\n• Distance-based clustering\n• Smooth animations\n• Offline caching",
        confidence: 0.91,
        category: 'map_guide',
        suggestedActions: [
          { type: 'view_map', label: '🗺️ Open Map' },
          { type: 'submit_complaint', label: '📍 Add to Map' }
        ]
      }
    ]
  },

  // Feed and Social Features
  feed_features: {
    keywords: ['feed', 'social', 'instagram', 'scroll', 'posts', 'timeline', 'nearby'],
    responses: [
      {
        text: "📱 **Instagram-Style Feed:**\n\n📊 **Feed Features:**\n• Beautiful card-based layout\n• Nearby complaints (5km radius)\n• User profiles and avatars\n• Time stamps and status badges\n• Category icons and descriptions\n• Smooth scroll animations\n• Pull-to-refresh\n\n👥 **Social Elements:**\n• Upvote directly from feed\n• User information display\n• Location details\n• Priority indicators\n• Progress tracking\n• Engagement metrics\n\n✨ **Smart Sorting:**\n• Distance-based priority\n• Recent activity first\n• High-voted issues prominent\n• Emergency issues at top",
        confidence: 0.87,
        category: 'feed_guide',
        suggestedActions: [
          { type: 'view_feed', label: '📱 Open Feed' },
          { type: 'submit_complaint', label: '📝 Add to Feed' }
        ]
      }
    ]
  },

  // Admin and Transparency
  transparency: {
    keywords: ['admin', 'transparency', 'government', 'municipal', 'authority', 'response'],
    responses: [
      {
        text: "🏛️ **Transparency & Accountability:**\n\n👥 **Admin Features:**\n• Priority queue management\n• Real-time complaint tracking\n• Citizen communication tools\n• Progress reporting\n• Resource allocation\n• Performance analytics\n\n📊 **Public Transparency:**\n• Open complaint database\n• Response time tracking\n• Resolution statistics\n• Municipal performance metrics\n• Public voting influence\n• Community engagement data\n\n✅ **Accountability Measures:**\n• Automated routing to departments\n• SLA tracking\n• Public progress updates\n• Feedback collection\n• Performance reporting",
        confidence: 0.86,
        category: 'transparency',
        suggestedActions: [
          { type: 'view_feed', label: '📊 See Public Data' },
          { type: 'personal_reports', label: '📈 Track My Reports' }
        ]
      }
    ]
  },

  // Troubleshooting and Help
  troubleshooting: {
    keywords: ['help', 'problem', 'error', 'not working', 'bug', 'issue', 'fix', 'troubleshoot'],
    responses: [
      {
        text: "🔧 **Troubleshooting Guide:**\n\n📱 **Common Issues:**\n• **Location not working** - Enable GPS, check permissions\n• **Camera issues** - Grant camera permission\n• **Voice input failing** - Allow microphone access\n• **Image upload slow** - Check internet connection\n• **Map not loading** - Refresh app, check network\n\n🔄 **Quick Fixes:**\n• Restart the app\n• Check internet connection\n• Update app permissions\n• Clear app cache\n• Ensure latest version\n\n⚡ **Emergency Bypass:**\n• Submit without photo if urgent\n• Use manual location entry\n• Contact support via email\n• Call emergency services for critical issues",
        confidence: 0.92,
        category: 'troubleshooting',
        suggestedActions: [
          { type: 'submit_complaint', label: '🔄 Try Again' }
        ]
      }
    ]
  },

  // Emergency and Urgent Issues
  emergency: {
    keywords: ['emergency', 'urgent', 'fire', 'electrical', 'danger', 'safety', 'critical'],
    responses: [
      {
        text: "🚨 **Emergency Reporting:**\n\n⚡ **Urgent Categories:**\n• **Fire Hazard** - Immediate response\n• **Electrical Danger** - Safety priority\n• **Sewage Overflow** - Health emergency\n• **Gas Leak** - Critical safety\n• **Structural Collapse** - Immediate danger\n\n🚨 **Emergency Process:**\n1. Select urgent category\n2. Exact location capture\n3. Immediate photo upload\n4. Instant AI validation\n5. Direct routing to emergency services\n6. Real-time tracking\n\n⚠️ **Important:**\n• For life-threatening emergencies, call 112/911 first\n• Use app for infrastructure emergencies\n• Provides additional documentation\n• Ensures follow-up tracking",
        confidence: 0.96,
        category: 'emergency_guide',
        suggestedActions: [
          { type: 'submit_complaint', label: '🚨 Report Emergency' }
        ]
      }
    ]
  }
};

// AI Response Matching Algorithm
class ChatbotKnowledgeMatcher {
  constructor() {
    this.knowledgeBase = CIVIC_KNOWLEDGE_BASE;
  }

  // Find best matching response for user query
  findBestMatch(userMessage, conversationHistory = []) {
    const message = userMessage.toLowerCase();
    let bestMatch = null;
    let highestScore = 0;

    // Check each knowledge category
    for (const [category, data] of Object.entries(this.knowledgeBase)) {
      const score = this.calculateMatchScore(message, data.keywords);
      
      if (score > highestScore) {
        highestScore = score;
        bestMatch = {
          category,
          ...data.responses[0], // Use first response for now
          matchScore: score
        };
      }
    }

    // If no good match found, return generic help
    if (highestScore < 0.3) {
      return this.getGenericHelp(message);
    }

    return bestMatch;
  }

  // Calculate similarity score between user message and keywords
  calculateMatchScore(message, keywords) {
    let totalScore = 0;
    let matchCount = 0;

    keywords.forEach(keyword => {
      if (message.includes(keyword.toLowerCase())) {
        totalScore += keyword.length / message.length;
        matchCount++;
      }
    });

    // Boost score if multiple keywords match
    const matchBonus = matchCount > 1 ? 0.2 : 0;
    return Math.min(totalScore + matchBonus, 1.0);
  }

  // Generate generic help response
  getGenericHelp(message) {
    const isQuestion = message.includes('?');
    const isGreeting = ['hi', 'hello', 'hey', 'namaste'].some(g => message.includes(g));

    if (isGreeting) {
      return {
        text: "👋 Hello! I'm your CivicStack Assistant. I can help you with:\n\n📝 Submitting complaints\n🗺️ Using the map\n👍 Voting system\n🎤 Voice input\n📸 Image validation\n🔧 Troubleshooting\n\nWhat would you like to know?",
        confidence: 0.8,
        category: 'greeting',
        suggestedActions: [
          { type: 'submit_complaint', label: '📝 Submit Complaint' },
          { type: 'view_feed', label: '📱 View Feed' }
        ]
      };
    }

    return {
      text: "🤔 I'm not sure about that specific question, but I can help with:\n\n📱 **App Features** - Navigation and functionality\n📝 **Complaint Submission** - Step-by-step guide\n🏛️ **Civic Issues** - What you can report\n👍 **Voting** - How the system works\n🎤 **Voice Input** - Multi-language support\n🔧 **Troubleshooting** - Fixing common issues\n\nTry asking about any of these topics!",
      confidence: 0.5,
      category: 'generic_help',
      suggestedActions: [
        { type: 'submit_complaint', label: '📝 How to Submit?' },
        { type: 'view_feed', label: '📱 App Features?' }
      ]
    };
  }

  // Get contextual follow-up suggestions
  getFollowUpSuggestions(category, userMessage) {
    const followUps = {
      app_overview: [
        "How do I submit my first complaint?",
        "What civic issues can I report?",
        "How does the voting system work?"
      ],
      submission_guide: [
        "What happens after I submit?",
        "How is priority calculated?",
        "Can I track my complaint status?"
      ],
      civic_categories: [
        "Which issues are most urgent?",
        "How long does resolution take?",
        "Can I report multiple issues?"
      ],
      voting_system: [
        "How many votes make a difference?",
        "Can I change my vote?",
        "Do votes affect response time?"
      ]
    };

    return followUps[category] || [];
  }
}

module.exports = { CIVIC_KNOWLEDGE_BASE, ChatbotKnowledgeMatcher };
