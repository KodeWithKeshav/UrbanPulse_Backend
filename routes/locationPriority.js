const express = require('express');
const router = express.Router();
const LocationPriorityService = require('../services/LocationPriorityService');

// Initialize the location priority service
const locationPriorityService = new LocationPriorityService();

/**
 * Calculate location-based priority score for a complaint
 * POST /api/location-priority/calculate
 * 
 * Request Body:
 * {
 *   "latitude": number,
 *   "longitude": number, 
 *   "complaintType": string,
 *   "locationMeta": {
 *     "privacyLevel": "exact" | "street" | "area",
 *     "radiusM": number,
 *     "precision": string,
 *     "description": string
 *   }
 * }
 */
router.post('/calculate', async (req, res) => {
  try {
    console.log('🔍 Location priority calculation request:', req.body);
    
    const { latitude, longitude, complaintType, locationMeta } = req.body;
    
    // Input validation
    const validationResult = validateCalculationInput(req.body);
    if (!validationResult.isValid) {
      console.log('❌ Validation failed:', validationResult.error);
      return res.status(400).json({
        success: false,
        error: validationResult.error,
        code: validationResult.code,
        timestamp: new Date().toISOString()
      });
    }
    console.log('✅ Validation passed for complaint type:', complaintType);
    
    // Calculate location priority score
    const startTime = Date.now();
    let priorityResult;
    let processingTime;
    try {
      priorityResult = await locationPriorityService.calculateLocationPriority(
        latitude,
        longitude,
        complaintType,
        locationMeta
      );
      processingTime = Date.now() - startTime;
      console.log(`✅ Priority calculation completed in ${processingTime}ms`);
    } catch (calculationError) {
      console.error('❌ Priority calculation error:', calculationError);
      return res.status(400).json({
        success: false,
        error: 'Priority calculation failed: ' + calculationError.message,
        code: 'CALCULATION_ERROR',
        timestamp: new Date().toISOString()
      });
    }
    
    // Determine priority level based on score
    const priorityLevel = determinePriorityLevel(priorityResult.priorityScore);
    
    // Format comprehensive response with corrected facility mapping
    const response = {
      success: true,
      priorityScore: priorityResult.priorityScore,
      priorityLevel: priorityLevel,
      reasoning: priorityResult.recommendationReason || 'Priority calculated based on facility analysis',
      facilitiesNearby: {
        total: priorityResult.facilityAnalysis ? 
          Object.values(priorityResult.facilityAnalysis).reduce((sum, f) => sum + (f.count || 0), 0) : 0,
        breakdown: priorityResult.facilityAnalysis || {},
        topFacilities: priorityResult.criticalFacilities?.slice(0, 5) || [],
        densityBonus: priorityResult.densityBonus || 0,
        proximityScore: priorityResult.proximityScore || 0
      },
      locationDetails: {
        coordinates: { 
          latitude: parseFloat(latitude), 
          longitude: parseFloat(longitude) 
        },
        privacyLevel: priorityResult.locationMeta?.privacyLevel || locationMeta?.privacyLevel || 'unknown',
        accuracy: priorityResult.locationMeta?.accuracy || locationMeta?.radiusM || 'unknown',
        precision: priorityResult.locationMeta?.precision || locationMeta?.precision || 'unknown',
        complaintType: complaintType,
        description: locationMeta?.description || 'No description provided'
      },
      scoring: {
        baseScore: 0, // Will be calculated from facility analysis
        facilityMultiplier: priorityResult.facilityMultiplier || 1,
        complaintMultiplier: priorityResult.complaintMultiplier || 1,
        privacyAdjustment: priorityResult.privacyAdjustment || 1,
        finalScore: priorityResult.priorityScore
      },
      metadata: {
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString(),
        version: '2.1.0',
        apiVersion: 'v1',
        serviceStatus: 'operational'
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Location priority calculation error:', error);
    handleCalculationError(error, res);
  }
});

/**
 * Bulk calculate priority scores for multiple locations
 * POST /api/location-priority/calculate-bulk
 */
router.post('/calculate-bulk', async (req, res) => {
  try {
    const { locations } = req.body;
    
    if (!Array.isArray(locations) || locations.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Locations array is required',
        code: 'MISSING_LOCATIONS'
      });
    }
    
    if (locations.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 10 locations allowed per request',
        code: 'TOO_MANY_LOCATIONS'
      });
    }
    
    const results = [];
    const startTime = Date.now();
    
    for (let i = 0; i < locations.length; i++) {
      const location = locations[i];
      
      try {
        const priorityResult = await locationPriorityService.calculateLocationPriority(
          location.latitude,
          location.longitude,
          location.complaintType,
          location.locationMeta
        );
        
        results.push({
          index: i,
          success: true,
          priorityScore: priorityResult.priorityScore,
          priorityLevel: determinePriorityLevel(priorityResult.priorityScore),
          locationId: location.id || `location_${i}`,
          coordinates: {
            latitude: location.latitude,
            longitude: location.longitude
          }
        });
        
        // Rate limiting - wait 1 second between requests
        if (i < locations.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
      } catch (error) {
        results.push({
          index: i,
          success: false,
          error: error.message,
          locationId: location.id || `location_${i}`
        });
      }
    }
    
    const processingTime = Date.now() - startTime;
    
    res.json({
      success: true,
      totalLocations: locations.length,
      successfulCalculations: results.filter(r => r.success).length,
      failedCalculations: results.filter(r => !r.success).length,
      results: results,
      metadata: {
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    console.error('❌ Bulk calculation error:', error);
    res.status(500).json({
      success: false,
      error: 'Bulk calculation failed',
      details: error.message
    });
  }
});

/**
 * Get location priority information and service capabilities
 * GET /api/location-priority/info
 */
router.get('/info', (req, res) => {
  res.json({
    service: {
      name: 'CivicStack Location Priority Assessment',
      version: '2.1.0',
      description: 'AI-powered location analysis for civic complaint prioritization',
      status: 'operational'
    },
    features: [
      'Privacy-aware location analysis with configurable accuracy levels',
      'Google Places API integration for infrastructure mapping',
      'Dynamic priority scoring based on nearby critical facilities',
      'Emergency response optimization for urgent complaint types',
      'Multi-level privacy protection (exact/street/area)',
      'Real-time facility density analysis',
      'Complaint type-specific priority multipliers'
    ],
    privacyLevels: {
      exact: {
        description: 'Level 1: Exact coordinates (±5-10m) for urgent infrastructure issues',
        accuracy: '5-10 meters',
        useCases: ['Emergency gas leaks', 'Electrical hazards', 'Fire safety', 'Medical emergencies'],
        recommended: ['fire_hazard', 'electrical_danger', 'sewage_overflow']
      },
      street: {
        description: 'Level 2: Street-level accuracy (±25m) for general civic complaints',
        accuracy: '20-30 meters', 
        useCases: ['Road maintenance', 'Streetlight issues', 'General infrastructure'],
        recommended: ['pothole', 'broken_streetlight', 'traffic_signal', 'garbage_collection']
      },
      area: {
        description: 'Level 3: Neighborhood-level (±150m) for privacy-conscious reporting',
        accuracy: '100-200 meters',
        useCases: ['General area complaints', 'Privacy-sensitive reports'],
        recommended: ['noise_complaint', 'general_maintenance']
      }
    },
    complaintTypes: {
      urgent: {
        types: ['fire_hazard', 'electrical_danger', 'sewage_overflow', 'water_main_break'],
        multiplier: 1.5,
        recommendedPrivacy: 'exact',
        description: 'Critical infrastructure issues requiring immediate response'
      },
      safety: {
        types: ['pothole', 'broken_streetlight', 'traffic_signal', 'road_damage'],
        multiplier: 1.2,
        recommendedPrivacy: 'street',
        description: 'Safety-related issues affecting public welfare'
      },
      general: {
        types: ['garbage_collection', 'water_leakage', 'noise_complaint', 'illegal_parking', 'others'],
        multiplier: 1.0,
        recommendedPrivacy: 'street',
        description: 'General civic maintenance and quality of life issues'
      }
    },
    priorityLevels: {
      CRITICAL: {
        range: '0.8-1.0',
        description: 'Immediate attention required - Emergency response',
        responseTime: '< 2 hours',
        color: '#FF4444'
      },
      HIGH: {
        range: '0.6-0.8', 
        description: 'High priority response needed',
        responseTime: '< 24 hours',
        color: '#FF8800'
      },
      MEDIUM: {
        range: '0.4-0.6',
        description: 'Standard priority handling',
        responseTime: '< 72 hours', 
        color: '#FFAA00'
      },
      LOW: {
        range: '0.0-0.4',
        description: 'Lower priority - routine maintenance',
        responseTime: '< 1 week',
        color: '#888888'
      }
    },
    apiLimits: {
      maxBulkLocations: 10,
      rateLimitPerMinute: 60,
      maxRetries: 3
    },
    integration: {
      supportedRegions: ['India'],
      dataProviders: ['Google Places API'],
      facilityTypes: ['hospital', 'school', 'police', 'fire_station', 'government', 'bank', 'pharmacy', 'transit_station'],
      coordinates: {
        format: 'decimal degrees',
        datum: 'WGS84'
      }
    }
  });
});

/**
 * Health check endpoint with comprehensive diagnostics
 * GET /api/location-priority/health
 */
router.get('/health', async (req, res) => {
  const healthData = {
    status: 'unknown',
    service: 'Location Priority Service',
    timestamp: new Date().toISOString(),
    version: '2.1.0',
    checks: {}
  };
  
  try {
    // Test Google Places API connectivity
    console.log('🏥 Running health check...');
    const testStartTime = Date.now();
    
    const testResult = await locationPriorityService.calculateLocationPriority(
      28.6139, // New Delhi coordinates
      77.2090,
      'pothole',
      { privacyLevel: 'street', radiusM: 25, precision: 'street' }
    );
    
    const testDuration = Date.now() - testStartTime;
    
    healthData.status = 'healthy';
    healthData.checks = {
      googlePlacesApi: {
        status: 'connected',
        responseTime: `${testDuration}ms`,
        lastTestScore: testResult.priorityScore,
        facilitiesFound: testResult.totalFacilities || 0
      },
      locationService: {
        status: 'operational',
        version: '2.1.0'
      },
      database: {
        status: 'not_applicable',
        note: 'Service uses external APIs only'
      }
    };
    
    res.status(200).json(healthData);
    
  } catch (error) {
    console.error('❌ Health check failed:', error);
    
    healthData.status = 'unhealthy';
    healthData.checks = {
      googlePlacesApi: {
        status: 'error',
        error: error.message,
        lastChecked: new Date().toISOString()
      },
      locationService: {
        status: 'degraded',
        error: 'API connectivity issues'
      }
    };
    
    res.status(503).json(healthData);
  }
});

/**
 * Get service metrics and statistics
 * GET /api/location-priority/metrics
 */
router.get('/metrics', (req, res) => {
  // In production, this would pull from actual metrics storage
  res.json({
    service: 'Location Priority Metrics',
    period: '24h',
    metrics: {
      totalRequests: 0,
      averageResponseTime: '2.5s',
      successRate: '98.5%',
      criticalPriorityCount: 0,
      highPriorityCount: 0,
      mediumPriorityCount: 0,
      lowPriorityCount: 0
    },
    performance: {
      p50ResponseTime: '2.1s',
      p95ResponseTime: '4.8s',
      p99ResponseTime: '8.2s',
      errorRate: '1.5%'
    },
    usage: {
      topComplaintTypes: [
        { type: 'pothole', count: 0 },
        { type: 'broken_streetlight', count: 0 },
        { type: 'garbage_collection', count: 0 }
      ],
      privacyLevelDistribution: {
        exact: '15%',
        street: '70%', 
        area: '15%'
      }
    },
    timestamp: new Date().toISOString()
  });
});

// Helper Functions

/**
 * Validate input for location priority calculation
 */
function validateCalculationInput(input) {
  console.log('🔍 Validating input:', JSON.stringify(input, null, 2));
  const { latitude, longitude, complaintType, locationMeta } = input;
  
  // Required fields validation
  if (!latitude || !longitude) {
    console.log('❌ Missing coordinates validation failed');
    return {
      isValid: false,
      error: 'Latitude and longitude are required',
      code: 'MISSING_COORDINATES'
    };
  }
  
  if (!complaintType) {
    console.log('❌ Missing complaint type validation failed');
    return {
      isValid: false,
      error: 'Complaint type is required',
      code: 'MISSING_COMPLAINT_TYPE'
    };
  }
  
  // Coordinate validation
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return {
      isValid: false,
      error: 'Coordinates must be numeric values',
      code: 'INVALID_COORDINATE_TYPE'
    };
  }
  
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return {
      isValid: false,
      error: 'Coordinates are outside valid range',
      code: 'INVALID_COORDINATE_RANGE'
    };
  }
  
  // India service area validation
  const indiaBounds = { north: 37.6, south: 6.4, east: 97.25, west: 68.1 };
  if (latitude < indiaBounds.south || latitude > indiaBounds.north ||
      longitude < indiaBounds.west || longitude > indiaBounds.east) {
    return {
      isValid: false,
      error: 'Location is outside service area (India)',
      code: 'OUTSIDE_SERVICE_AREA'
    };
  }
  
  // Complaint type validation
  const validComplaintTypes = [
    'fire_hazard', 'electrical_danger', 'sewage_overflow',
    'pothole', 'broken_streetlight', 'traffic_signal', 'garbage_collection',
    'water_leakage', 'road_damage', 'noise_complaint', 'illegal_parking',
    'others'
  ];
  
  console.log('🔍 Checking complaint type:', complaintType, 'in valid types:', validComplaintTypes);
  if (!validComplaintTypes.includes(complaintType)) {
    console.log('❌ Invalid complaint type validation failed');
    return {
      isValid: false,
      error: `Invalid complaint type. Supported types: ${validComplaintTypes.join(', ')}`,
      code: 'INVALID_COMPLAINT_TYPE'
    };
  }
  
  // Location metadata validation
  if (locationMeta) {
    const validPrivacyLevels = ['exact', 'street', 'area'];
    if (locationMeta.privacyLevel && !validPrivacyLevels.includes(locationMeta.privacyLevel)) {
      return {
        isValid: false,
        error: `Invalid privacy level. Supported levels: ${validPrivacyLevels.join(', ')}`,
        code: 'INVALID_PRIVACY_LEVEL'
      };
    }
    
    if (locationMeta.radiusM && (typeof locationMeta.radiusM !== 'number' || locationMeta.radiusM < 0)) {
      return {
        isValid: false,
        error: 'Radius must be a positive number',
        code: 'INVALID_RADIUS'
      };
    }
  }
  
  return { isValid: true };
}

/**
 * Determine priority level based on numerical score
 */
function determinePriorityLevel(score) {
  if (score >= 0.8) return 'CRITICAL';
  if (score >= 0.6) return 'HIGH';
  if (score >= 0.4) return 'MEDIUM';
  return 'LOW';
}

/**
 * Handle calculation errors with appropriate responses
 */
function handleCalculationError(error, res) {
  // API key or authentication errors
  if (error.message.includes('API key') || error.message.includes('authentication')) {
    return res.status(503).json({
      success: false,
      error: 'Location service temporarily unavailable',
      code: 'SERVICE_UNAVAILABLE',
      details: 'External API configuration issue',
      retryAfter: 300 // 5 minutes
    });
  }
  
  // Rate limiting errors
  if (error.message.includes('rate limit') || error.message.includes('quota') || 
      error.message.includes('OVER_QUERY_LIMIT')) {
    return res.status(429).json({
      success: false,
      error: 'Service rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      details: 'Please try again in a few moments',
      retryAfter: 60 // 1 minute
    });
  }
  
  // Network connectivity errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
    return res.status(503).json({
      success: false,
      error: 'External service connectivity issue',
      code: 'CONNECTIVITY_ERROR',
      details: 'Unable to reach location data provider',
      retryAfter: 120 // 2 minutes
    });
  }
  
  // Generic server errors
  res.status(500).json({
    success: false,
    error: 'Location priority calculation failed',
    code: 'CALCULATION_ERROR',
    details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    timestamp: new Date().toISOString()
  });
}

/**
 * Calculate comprehensive priority score combining infrastructure and image validation
 * POST /api/location-priority/comprehensive
 * 
 * Request Body:
 * {
 *   "latitude": number,
 *   "longitude": number,
 *   "complaintType": string,
 *   "locationMeta": {
 *     "privacyLevel": string,
 *     "radiusM": number
 *   },
 *   "imageAnalysis": {
 *     "confidence": number,
 *     "modelConfidence": number
 *   },
 *   "complaintData": {
 *     "created_at": string,
 *     "votes": number,
 *     "status": string
 *   }
 * }
 */
router.post('/comprehensive', async (req, res) => {
  try {
    console.log('🧠 Comprehensive priority calculation request:', req.body);
    
    const { 
      latitude, 
      longitude, 
      imageAnalysis, 
      complaintData = {}, 
      complaintType, 
      locationMeta,
      description,
      imageUrl,
      votes,
      status
    } = req.body;
    
    // Input validation for latitude and longitude
    if (!latitude || !longitude || isNaN(parseFloat(latitude)) || isNaN(parseFloat(longitude))) {
      return res.status(400).json({
        success: false,
        error: 'Invalid coordinates',
        code: 'INVALID_COORDINATES',
        timestamp: new Date().toISOString()
      });
    }
    
    // Calculate comprehensive priority score
    const startTime = Date.now();
    const priorityResult = await locationPriorityService.calculateComprehensivePriority(
      parseFloat(latitude),
      parseFloat(longitude),
      imageAnalysis || {},
      {
        ...complaintData,
        complaintType,
        locationMeta,
        description,
        imageUrl,
        votes,
        status
      }
    );
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ Comprehensive priority calculation completed in ${processingTime}ms`);
    
    // Format response
    const response = {
      success: true,
      priorityScore: priorityResult.priorityScore,
      priorityLevel: priorityResult.priorityLevel,
      reasoning: priorityResult.reasoning,
      
      // Breakdown of score components
      breakdown: {
        infrastructureScore: priorityResult.breakdown.infrastructureScore,
        imageValidationScore: priorityResult.breakdown.imageValidationScore,
        emotionScore: priorityResult.breakdown.emotionScore,
        voteScore: priorityResult.breakdown.voteScore,
        statusMultiplier: priorityResult.breakdown.statusMultiplier
      },
      
      // Infrastructure details
      infrastructure: {
        totalFacilities: priorityResult.totalFacilities,
        facilityAnalysis: priorityResult.facilityAnalysis
      },
      
      // Location and image details
      details: {
        coordinates: { 
          latitude: parseFloat(latitude), 
          longitude: parseFloat(longitude) 
        },
        imageConfidence: priorityResult.imageConfidence,
        complaintAge: complaintData.created_at ? 
          Math.round((Date.now() - new Date(complaintData.created_at).getTime()) / (1000 * 60 * 60 * 24)) : null,
        votes: complaintData.votes || 0,
        status: complaintData.status || 'pending'
      },
      
      metadata: {
        processingTimeMs: processingTime,
        timestamp: new Date().toISOString(),
        version: '3.0.0',
        apiVersion: 'v2'
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Error in comprehensive priority calculation:', error);
    
    // Generic server errors
    res.status(500).json({
      success: false,
      error: 'Comprehensive priority calculation failed',
      code: 'CALCULATION_ERROR',
      details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
