const axios = require('axios');
require('dotenv').config();

/**
 * Location Priority Service for CivicStack
 * Calculates priority scores based on proximity to critical infrastructure
 */
class LocationPriorityService {
  constructor() {
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY;
    this.baseUrl = 'https://maps.googleapis.com/maps/api/place';
    
    if (!this.apiKey) {
      console.warn('⚠️ Google Places API key not found in environment variables');
    }
    
    // Critical facility types with weights and dynamic search radius
    this.facilityConfig = {
      hospital: { 
        weight: 0.9, 
        radius: 10000, // 10km search radius
        searchTypes: ['hospital', 'doctor'],
        excludeKeywords: ['store', 'shop', 'mart', 'pharmacy', 'medical_store', 'transport', 'logistics', 'cargo', 'travel', 'bus'],
        includeKeywords: ['hospital', 'clinic', 'medical', 'health', 'emergency'],
        description: 'Medical facilities'
      },
      school: { 
        weight: 0.8, 
        radius: 10000, // 10km search radius
        searchTypes: ['school', 'university', 'primary_school'],
        excludeKeywords: ['store', 'shop'],
        includeKeywords: ['school', 'college', 'university', 'education'],
        description: 'Educational institutions'
      },
      police: { 
        weight: 0.85, 
        radius: 10000, // 10km search radius
        searchTypes: ['police'],
        excludeKeywords: [],
        includeKeywords: ['police', 'station', 'law'],
        description: 'Law enforcement'
      },
      fire_station: { 
        weight: 0.9, 
        radius: 10000, // 10km search radius
        searchTypes: ['fire_station'],
        excludeKeywords: [],
        includeKeywords: ['fire', 'emergency'],
        description: 'Emergency services'
      },
      transit_station: { 
        weight: 0.7, 
        radius: 10000, // 10km search radius
        searchTypes: ['transit_station', 'bus_station', 'subway_station'],
        excludeKeywords: [],
        includeKeywords: ['station', 'bus', 'metro', 'transport'],
        description: 'Public transport'
      },
      government: { 
        weight: 0.75, 
        radius: 10000, // 10km search radius
        searchTypes: ['local_government_office', 'city_hall'],
        description: 'Government offices'
      },
      bank: { 
        weight: 0.6, 
        radius: 10000, // 10km search radius
        searchTypes: ['bank', 'atm'],
        description: 'Financial services'
      },
      pharmacy: { 
        weight: 0.7, 
        radius: 10000, // 10km search radius
        searchTypes: ['pharmacy', 'drugstore'],
        description: 'Medical supplies'
      }
    };
  }

  /**
   * Calculate comprehensive location priority score with privacy level support
   * @param {number} latitude - Complaint location latitude
   * @param {number} longitude - Complaint location longitude
   * @param {string} complaintType - Type of civic complaint (optional)
   * @param {Object} locationMeta - Location metadata including privacy level
   * @returns {Promise<Object>} Priority analysis results
   */
  async calculateLocationPriority(latitude, longitude, complaintType = 'general', locationMeta = {}) {
    try {
      console.log(`🔍 Analyzing location priority for: ${latitude}, ${longitude}`);
      console.log(`📊 Privacy Level: ${locationMeta.privacyLevel || 'not specified'}`);
      console.log(`📏 Location Accuracy: ±${locationMeta.radiusM || 'unknown'}m`);
      
      // Validate coordinates
      if (!this.isValidCoordinates(latitude, longitude)) {
        throw new Error('Invalid coordinates provided');
      }

      // Dynamic search radius based on area type detection
      const radiusInfo = await this.calculateSearchRadius(latitude, longitude, locationMeta);
      
      console.log(`🔍 Dynamic search radius calculated: ${radiusInfo.radius}m for area type: ${radiusInfo.areaType}`);
      console.log(`📊 Facility density probe found: ${radiusInfo.facilityDensity} facilities in 1km`);
      
      const facilityAnalysis = await this.analyzeFacilities(latitude, longitude, radiusInfo.radius);
      const densityBonus = this.calculateDensityBonus(facilityAnalysis);
      const proximityScore = this.calculateProximityScore(facilityAnalysis);
      const complaintMultiplier = this.getComplaintTypeMultiplier(complaintType, facilityAnalysis);
      const privacyAdjustment = this.getPrivacyLevelAdjustment(locationMeta.privacyLevel);
      
      const finalScore = Math.min(1.0, (proximityScore + densityBonus) * complaintMultiplier * privacyAdjustment);
      
      return {
        priorityScore: Math.round(finalScore * 100) / 100,
        priorityLevel: this.getPriorityLevel(finalScore),
        facilityAnalysis,
        densityBonus,
        proximityScore,
        complaintMultiplier,
        privacyAdjustment,
        searchRadius: radiusInfo.radius,
        areaType: radiusInfo.areaType,
        facilityDensity: radiusInfo.facilityDensity,
        locationMeta: {
          privacyLevel: locationMeta.privacyLevel || 'unknown',
          accuracy: locationMeta.radiusM || 'unknown',
          precision: locationMeta.precision || 'unknown'
        },
        criticalFacilities: this.extractCriticalFacilities(facilityAnalysis),
        recommendationReason: this.generateReasoningText(facilityAnalysis, finalScore, complaintType, locationMeta),
        coordinates: { latitude, longitude },
        complaintType
      };
    } catch (error) {
      console.error('❌ Location priority calculation failed:', error);
      return {
        priorityScore: 0.5,
        priorityLevel: 'MEDIUM',
        error: 'Unable to calculate location priority',
        fallbackReason: error.message || 'API service unavailable',
        coordinates: { latitude, longitude }
      };
    }
  }

  /**
   * Validate coordinates
   */
  isValidCoordinates(latitude, longitude) {
    return (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      latitude >= -90 && latitude <= 90 &&
      longitude >= -180 && longitude <= 180
    );
  }

  /**
   * Calculate search radius based on area type detection and location density
   */
  async calculateSearchRadius(latitude, longitude, locationMeta) {
    console.log('🔍 Detecting area type for dynamic radius calculation...');
    
    // Step 1: Detect area type using initial small radius probe
    const areaType = await this.detectAreaType(latitude, longitude);
    console.log(`📍 Area Type Detected: ${areaType.type} (${areaType.description})`);
    
    // Step 2: Base radius by area type
    const baseRadiusByArea = {
      'dense_urban': {
        base: 800,    // 0.8km - very dense cities
        max: 1500,    // 1.5km max
        description: 'Dense urban - shorter radius due to high facility density'
      },
      'urban': {
        base: 1200,   // 1.2km - regular cities  
        max: 2000,    // 2km max
        description: 'Urban - standard radius for city areas'
      },
      'suburban': {
        base: 2000,   // 2km - suburban areas
        max: 3500,    // 3.5km max
        description: 'Suburban - larger radius due to spread out facilities'
      },
      'rural': {
        base: 3500,   // 3.5km - rural areas
        max: 5000,    // 5km max
        description: 'Rural - maximum radius due to sparse facilities'
      },
      'unknown': {
        base: 1500,   // 1.5km - default
        max: 2500,    // 2.5km max
        description: 'Unknown area type - moderate radius'
      }
    };

    const config = baseRadiusByArea[areaType.type] || baseRadiusByArea.unknown;
    let radius = config.base;
    
    // Step 3: Adjust based on facility density
    if (areaType.facilityDensity < 10) {
      radius = Math.min(radius * 1.5, config.max); // Increase radius for low density
      console.log(`📈 Increased radius to ${radius}m due to low facility density (${areaType.facilityDensity} facilities)`);
    } else if (areaType.facilityDensity > 50) {
      radius = Math.max(radius * 0.7, 500); // Decrease radius for high density
      console.log(`📉 Decreased radius to ${radius}m due to high facility density (${areaType.facilityDensity} facilities)`);
    }
    
    // Step 4: Adjust based on location accuracy
    const privacyLevel = locationMeta.privacyLevel || 'unknown';
    const accuracy = locationMeta.radiusM || 0;
    
    if (accuracy > 100) {
      radius += Math.min(accuracy * 0.5, 500); // Add up to 500m for poor accuracy
    }
    
    console.log(`🎯 Final Search Radius: ${radius}m for ${areaType.type} area`);
    console.log(`   📊 Config: ${config.description}`);
    
    return {
      radius: Math.round(radius),
      areaType: areaType.type,
      facilityDensity: areaType.facilityDensity,
      config: config
    };
  }

  /**
   * Detect area type based on facility density probe
   */
  async detectAreaType(latitude, longitude) {
    try {
      console.log('🔍 Probing area with 1km radius to detect type...');
      
      // Use a small 1km radius to detect area characteristics
      const probeRadius = 1000;
      let totalFacilities = 0;
      let businessTypes = new Set();
      
      // Quick probe with key facility types
      const probeTypes = ['establishment', 'point_of_interest', 'store'];
      
      for (const type of probeTypes) {
        try {
          const facilities = await this.queryGooglePlaces(latitude, longitude, type, probeRadius);
          totalFacilities += facilities.length;
          
          // Analyze business types
          facilities.forEach(facility => {
            if (facility.types) {
              facility.types.forEach(t => businessTypes.add(t));
            }
          });
          
          await this.delay(300); // Rate limiting
        } catch (error) {
          console.warn(`⚠️ Probe error for ${type}:`, error.message);
        }
      }
      
      console.log(`📊 Probe Results: ${totalFacilities} facilities, ${businessTypes.size} business types`);
      
      // Classify area type based on facility density
      let areaType;
      if (totalFacilities >= 80) {
        areaType = 'dense_urban';
      } else if (totalFacilities >= 40) {
        areaType = 'urban';
      } else if (totalFacilities >= 15) {
        areaType = 'suburban';
      } else {
        areaType = 'rural';
      }
      
      // Additional classification based on business types
      const urbanIndicators = ['shopping_mall', 'bank', 'atm', 'hospital', 'school', 'government'];
      const urbanCount = urbanIndicators.filter(indicator => businessTypes.has(indicator)).length;
      
      if (urbanCount >= 4 && areaType === 'suburban') {
        areaType = 'urban'; // Upgrade to urban if many urban indicators
      }
      
      return {
        type: areaType,
        facilityDensity: totalFacilities,
        businessTypes: Array.from(businessTypes),
        description: this.getAreaDescription(areaType, totalFacilities)
      };
      
    } catch (error) {
      console.error('⚠️ Area type detection failed:', error.message);
      return {
        type: 'unknown',
        facilityDensity: 0,
        businessTypes: [],
        description: 'Area type detection failed - using default settings'
      };
    }
  }

  /**
   * Get human-readable area description
   */
  getAreaDescription(areaType, facilityCount) {
    const descriptions = {
      'dense_urban': `Dense urban area with ${facilityCount} facilities nearby - likely city center`,
      'urban': `Urban area with ${facilityCount} facilities - regular city district`,
      'suburban': `Suburban area with ${facilityCount} facilities - residential/commercial mix`,
      'rural': `Rural area with ${facilityCount} facilities - sparse infrastructure`,
      'unknown': `Unknown area type with ${facilityCount} facilities detected`
    };
    
    return descriptions[areaType] || descriptions.unknown;
  }

  /**
   * Legacy method - now calls the new dynamic method
   */
  calculateSearchRadius(locationMeta) {
    // This is now handled by the async version above
    // Keeping for backward compatibility
    const baseRadius = {
      exact: 1000,    // Exact coordinates - 1km search radius
      street: 1500,   // Street level - 1.5km search radius  
      area: 2000,     // Area level - 2km search radius
      unknown: 1500   // Default to street level (1.5km)
    };

    const privacyLevel = locationMeta.privacyLevel || 'unknown';
    return baseRadius[privacyLevel] || baseRadius.unknown;
  }

  /**
   * Get privacy level adjustment factor for scoring
   */
  getPrivacyLevelAdjustment(privacyLevel) {
    const adjustments = {
      exact: 1.0,     // No adjustment for exact coordinates
      street: 0.95,   // Slight reduction for street-level
      area: 0.90,     // Moderate reduction for area-level
      unknown: 0.95   // Default to street-level adjustment
    };

    return adjustments[privacyLevel] || adjustments.unknown;
  }

  /**
   * Analyze all facility types around the complaint location with dynamic radius
   */
  async analyzeFacilities(latitude, longitude, searchRadius = 1500) {
    const results = {};
    
    console.log(`🔍 Starting facility analysis for ${latitude}, ${longitude} with ${searchRadius}m radius`);
    
    for (const [facilityType, config] of Object.entries(this.facilityConfig)) {
      try {
        // Use dynamic search radius, but respect facility-specific limits
        let effectiveRadius = Math.min(searchRadius, config.radius);
        
        console.log(`   🏢 Searching for ${facilityType} within ${effectiveRadius}m...`);
        
        let facilities = await this.searchFacilitiesWithRetry(
          latitude, 
          longitude, 
          config.searchTypes, 
          effectiveRadius
        );
        
        // If no facilities found and we're in a potentially rural area, expand search
        if (facilities.length === 0 && effectiveRadius < 10000) {
          const expandedRadius = 10000;
          console.log(`   🔄 No facilities found, expanding search to ${expandedRadius}m...`);
          
          facilities = await this.searchFacilitiesWithRetry(
            latitude, 
            longitude, 
            config.searchTypes, 
            expandedRadius
          );
          
          if (facilities.length > 0) {
            effectiveRadius = expandedRadius;
            console.log(`   ✅ Found ${facilities.length} ${facilityType} facilities in expanded search`);
          }
        }
        
        console.log(`   ✅ Found ${facilities.length} ${facilityType} facilities`);
        if (facilities.length > 0) {
          console.log(`      Nearest: ${facilities[0].name} at ${facilities[0].distance}m`);
        }
        
        results[facilityType] = {
          count: facilities.length,
          facilities: facilities.slice(0, 5), // Keep top 5 nearest
          nearestDistance: facilities[0]?.distance || Infinity,
          weight: config.weight,
          score: this.calculateFacilityScore(facilities, config),
          description: config.description,
          searchRadius: effectiveRadius
        };
        
        // Add delay to respect API rate limits
        await this.delay(200);
        
      } catch (error) {
        console.error(`⚠️ Error analyzing ${facilityType}:`, error.message);
        results[facilityType] = { 
          count: 0, 
          facilities: [], 
          score: 0, 
          weight: config.weight,
          error: error.message,
          description: config.description
        };
      }
    }
    
    const totalFacilitiesFound = Object.values(results).reduce((sum, r) => sum + r.count, 0);
    console.log(`📊 Facility analysis complete. Found ${totalFacilitiesFound} total facilities across ${Object.keys(results).length} categories`);
    
    return results;
  }

  /**
   * Search for facilities with retry mechanism
   */
  async searchFacilitiesWithRetry(latitude, longitude, types, radius, maxRetries = 2) {
    let lastError;
    
    for (const searchType of types) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const facilities = await this.queryGooglePlaces(latitude, longitude, searchType, radius);
          if (facilities.length > 0) {
            return facilities;
          }
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries) {
            await this.delay(1000 * (attempt + 1)); // Exponential backoff
          }
        }
      }
    }
    
    if (lastError) throw lastError;
    return [];
  }

  /**
   * Query Google Places API with enhanced filtering
   */
  async queryGooglePlaces(latitude, longitude, type, radius) {
    if (!this.apiKey) {
      throw new Error('Google Places API key not configured');
    }

    const response = await axios.get(`${this.baseUrl}/nearbysearch/json`, {
      params: {
        location: `${latitude},${longitude}`,
        radius: radius,
        type: type,
        key: this.apiKey
      },
      timeout: 10000
    });

    if (response.data.status === 'OVER_QUERY_LIMIT') {
      console.error('❌ Google Places API: Quota exceeded');
      throw new Error('API quota exceeded');
    }
    
    if (response.data.status === 'REQUEST_DENIED') {
      console.error('❌ Google Places API: Request denied');
      console.error('   Reason:', response.data.error_message || 'No error message');
      console.error('   Common causes:');
      console.error('   1. API key restrictions (check allowed IPs/referrers in Google Cloud Console)');
      console.error('   2. Places API not enabled in Google Cloud Console');
      console.error('   3. Billing not set up for the project');
      throw new Error('API request denied - check API key restrictions');
    }

    if (response.data.status === 'INVALID_REQUEST') {
      console.error('❌ Google Places API: Invalid request');
      throw new Error('Invalid API request parameters');
    }

    if (!response.data.results) {
      console.warn(`⚠️ No results returned for type: ${type} at ${latitude},${longitude} (radius: ${radius}m)`);
      return [];
    }

    // Enhanced filtering based on facility type
    const facilityType = this.getFacilityTypeFromSearchType(type);
    const config = this.facilityConfig[facilityType];
    
    const filteredResults = response.data.results.filter(place => {
      const name = place.name.toLowerCase();
      const types = place.types || [];
      
      // Apply exclude keywords if configured
      if (config && config.excludeKeywords) {
        // Check for explicitly excluded terms in the name
        const hasExcluded = config.excludeKeywords.some(keyword => 
          name.includes(keyword.toLowerCase())
        );
        if (hasExcluded) {
          const excludedKeyword = config.excludeKeywords.find(k => name.includes(k.toLowerCase()));
          console.log(`❌ Excluded ${place.name} (contains excluded keyword: ${excludedKeyword})`);
          return false;
        }
        
        // Additional check for misclassified transportation services
        if (facilityType === 'hospital' || facilityType === 'school' || facilityType === 'government') {
          const transportWords = ['transport', 'logistics', 'cargo', 'travel', 'bus', 'taxi', 'auto'];
          if (transportWords.some(word => name.includes(word))) {
            console.log(`❌ Excluded ${place.name} (likely a transportation service, not a ${facilityType})`);
            return false;
          }
        }
      }
      
      // Apply include keywords if configured
      if (config && config.includeKeywords && config.includeKeywords.length > 0) {
        const hasIncluded = config.includeKeywords.some(keyword => 
          name.includes(keyword.toLowerCase()) || 
          types.some(t => t.includes(keyword.toLowerCase()))
        );
        if (!hasIncluded) {
          console.log(`❌ Excluded ${place.name} (missing required keywords)`);
          return false;
        }
      }
      
      return true;
    });

    return filteredResults.map(place => ({
      name: place.name,
      place_id: place.place_id,
      distance: this.calculateDistance(
        latitude, longitude,
        place.geometry.location.lat, place.geometry.location.lng
      ),
      rating: place.rating || 0,
      types: place.types || [],
      vicinity: place.vicinity || ''
    })).sort((a, b) => a.distance - b.distance);
  }

  /**
   * Get facility type from Google Places search type
   */
  getFacilityTypeFromSearchType(searchType) {
    const typeMapping = {
      'hospital': 'hospital',
      'doctor': 'hospital',
      'health': 'hospital',
      'school': 'school',
      'university': 'school',
      'primary_school': 'school',
      'police': 'police',
      'fire_station': 'fire_station',
      'transit_station': 'transit_station',
      'bus_station': 'transit_station',
      'subway_station': 'transit_station',
      'local_government_office': 'government',
      'city_hall': 'government'
    };
    
    return typeMapping[searchType] || 'unknown';
  }

  /**
   * Calculate distance using Haversine formula
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    
    return R * c;
  }

  /**
   * Calculate comprehensive facility-specific score based on real data
   */
  calculateFacilityScore(facilities, config) {
    if (facilities.length === 0) return 0;

    const nearest = facilities[0];
    const maxDistance = config.radius;
    
    // Base distance score (closer = higher score)
    const distanceScore = Math.max(0, 1 - (nearest.distance / maxDistance));
    
    // Facility density bonus (more facilities = higher score)
    const densityBonus = Math.min(0.3, facilities.length * 0.05);
    
    // Facility importance multiplier (based on ratings, size, etc.)
    const importanceMultiplier = (typeof nearest.importance === 'number' && nearest.importance > 0) ? nearest.importance : 1.0;
    
    // Operational status bonus (if facility is currently open)
    const operationalBonus = nearest.isOpen === true ? 0.1 : 0;
    
    const baseScore = distanceScore + densityBonus + operationalBonus;
    const finalScore = baseScore * importanceMultiplier;
    
    // Debug logging for troubleshooting
    if (isNaN(finalScore)) {
      console.error(`🚨 NaN score detected for facility:`, {
        nearestName: nearest.name,
        distance: nearest.distance,
        maxDistance,
        distanceScore,
        densityBonus,
        importance: nearest.importance,
        importanceMultiplier,
        operationalBonus,
        baseScore,
        finalScore
      });
      return 0; // Return 0 instead of NaN
    }
    
    return Math.min(1.0, finalScore);
  }

  /**
   * Enhanced proximity score calculation with real facility analysis
   */
  calculateProximityScore(facilityAnalysis) {
    let totalScore = 0;
    let weightSum = 0;
    const facilityTypes = Object.keys(facilityAnalysis);
    
    console.log('📊 Calculating proximity score from facility analysis...');
    
    for (const [facilityType, analysis] of Object.entries(facilityAnalysis)) {
      if (analysis.score > 0) {
        const weightedScore = analysis.score * analysis.weight;
        totalScore += weightedScore;
        weightSum += analysis.weight;
        
        console.log(`   ${facilityType}: ${analysis.count} facilities, score: ${analysis.score.toFixed(3)}, nearest: ${analysis.nearestDistance}m`);
      }
    }
    
    // Calculate weighted average, but ensure some base score even with limited facilities
    const averageScore = weightSum > 0 ? totalScore / weightSum : 0;
    
    // Apply facility diversity bonus (having multiple types of critical facilities nearby)
    const diversityBonus = this.calculateFacilityDiversityBonus(facilityAnalysis);
    
    const finalProximityScore = Math.min(1.0, averageScore + diversityBonus);
    
    console.log(`📏 Total proximity score: ${finalProximityScore.toFixed(3)} (base: ${averageScore.toFixed(3)}, diversity bonus: ${diversityBonus.toFixed(3)})`);
    
    return finalProximityScore;
  }

  /**
   * Calculate facility diversity bonus
   */
  calculateFacilityDiversityBonus(facilityAnalysis) {
    const facilitiesWithScore = Object.values(facilityAnalysis).filter(f => f.score > 0);
    const diversityCount = facilitiesWithScore.length;
    
    // Bonus for having multiple types of critical facilities
    if (diversityCount >= 4) return 0.15;      // Many facility types
    if (diversityCount >= 3) return 0.10;      // Good variety
    if (diversityCount >= 2) return 0.05;      // Some variety
    return 0;                                  // Limited variety
  }

  /**
   * Enhanced density bonus calculation
   */
  calculateDensityBonus(facilityAnalysis) {
    const totalFacilities = Object.values(facilityAnalysis)
      .reduce((sum, analysis) => sum + analysis.count, 0);
    
    console.log(`🏘️ Total facilities found: ${totalFacilities}`);
    
    // Progressive density bonus thresholds
    if (totalFacilities >= 50) return 0.25;      // Very high density
    if (totalFacilities >= 30) return 0.20;      // High density  
    if (totalFacilities >= 20) return 0.15;      // Good density
    if (totalFacilities >= 10) return 0.10;      // Moderate density
    if (totalFacilities >= 5) return 0.05;       // Low density
    return 0;                                     // Very low density
  }

  /**
   * Assess facility importance level
   */
  assessFacilityImportance(place) {
    const criticalTypes = ['hospital', 'fire_station', 'police', 'emergency'];
    const highTypes = ['school', 'university', 'government'];
    
    if (place.types.some(type => criticalTypes.includes(type))) {
      return 1.3; // Critical facilities get 30% importance bonus
    }
    if (place.types.some(type => highTypes.includes(type))) {
      return 1.1; // High importance facilities get 10% bonus
    }
    return 1.0; // Normal facilities have no bonus
  }

  /**
   * Get complaint type multiplier for specific facility combinations
   */
  getComplaintTypeMultiplier(complaintType, facilityAnalysis) {
    const multipliers = {
      'pothole': {
        hospital: 1.3,
        school: 1.2,
        transit_station: 1.4
      },
      'sewage_overflow': {
        hospital: 1.5,
        school: 1.4,
        pharmacy: 1.3
      },
      'streetlight': {
        school: 1.2,
        police: 1.3,
        transit_station: 1.2
      },
      'water_leakage': {
        hospital: 1.3,
        government: 1.2
      },
      'garbage_dump': {
        hospital: 1.4,
        school: 1.3,
        pharmacy: 1.2
      },
      'others': {
        hospital: 1.1,
        school: 1.1,
        government: 1.1
      }
    };

    let maxMultiplier = 1.0;
    
    if (multipliers[complaintType]) {
      Object.entries(multipliers[complaintType]).forEach(([facilityType, multiplier]) => {
        if (facilityAnalysis[facilityType]?.score > 0.5) {
          maxMultiplier = Math.max(maxMultiplier, multiplier);
        }
      });
    }

    return maxMultiplier;
  }

  /**
   * Extract critical facilities for reporting
   */
  extractCriticalFacilities(facilityAnalysis) {
    const critical = [];
    
    Object.entries(facilityAnalysis).forEach(([type, analysis]) => {
      if (analysis.facilities && analysis.facilities.length > 0) {
        const nearest = analysis.facilities[0];
        critical.push({
          type,
          name: nearest.name,
          distance: nearest.distance,
          importance: analysis.weight,
          description: analysis.description
        });
      }
    });
    
    return critical
      .sort((a, b) => b.importance - a.importance)
      .slice(0, 5);
  }

  /**
   * Generate human-readable reasoning with privacy level context
   */
  generateReasoningText(facilityAnalysis, finalScore, complaintType, locationMeta = {}) {
    const nearbyFacilities = Object.entries(facilityAnalysis)
      .filter(([_, analysis]) => analysis.count > 0)
      .sort((a, b) => b[1].score - a[1].score);
    
    if (nearbyFacilities.length === 0) {
      // More helpful message for remote locations
      return "This appears to be a remote or rural area with limited infrastructure nearby. Your complaint has been registered and will be processed. Note: Infrastructure detection uses a search radius of up to 10km.";
    }
    
    const topFacility = nearbyFacilities[0];
    const [facilityType, analysis] = topFacility;
    const nearest = analysis.facilities[0];
    
    let reason = `Located ${nearest.distance}m from ${analysis.description.toLowerCase()} (${nearest.name})`;
    
    if (nearbyFacilities.length > 1) {
      reason += ` and ${nearbyFacilities.length - 1} other facility type(s)`;
    }

    // Add complaint-specific reasoning
    if (complaintType !== 'general') {
      reason += `. ${complaintType} issue near critical infrastructure`;
    }

    // Add privacy level context
    if (locationMeta.privacyLevel) {
      const privacyContext = {
        exact: 'Exact location provided for precise emergency response',
        street: 'Street-level accuracy sufficient for municipal routing',
        area: 'Area-level location used while protecting privacy'
      };
      reason += `. ${privacyContext[locationMeta.privacyLevel] || ''}`;
    }
    
    if (finalScore >= 0.8) {
      reason += ". HIGH PRIORITY due to proximity to critical infrastructure.";
    } else if (finalScore >= 0.6) {
      reason += ". Medium-high priority due to important nearby facilities.";
    } else if (finalScore >= 0.4) {
      reason += ". Medium priority with moderate infrastructure proximity.";
    } else {
      reason += ". Lower priority in area with limited infrastructure.";
    }
    
    return reason;
  }

  /**
   * Convert score to priority level
   */
  getPriorityLevel(score) {
    if (score >= 0.8) return 'CRITICAL';
    if (score >= 0.6) return 'HIGH';
    if (score >= 0.4) return 'MEDIUM';
    if (score >= 0.2) return 'LOW';
    return 'MINIMAL';
  }

  /**
   * Calculate comprehensive priority score that combines:
   * - 50% based on infrastructure proximity
   * - 50% based on image validation confidence
   * - Additional factors like complaint age and votes
   * 
   * @param {number} latitude - Complaint location latitude
   * @param {number} longitude - Complaint location longitude
   * @param {Object} imageAnalysis - Results from image analysis service
   * @param {Object} complaintData - Additional complaint metadata
   * @returns {Promise<Object>} Comprehensive priority analysis
   */
  async calculateComprehensivePriority(latitude, longitude, imageAnalysis = {}, complaintData = {}) {
    try {
      console.log(`🧠 Calculating comprehensive priority score for: ${latitude}, ${longitude}`);
      console.log(`🔍 DEBUG: complaintData object received:`, JSON.stringify(complaintData, null, 2));
      
      // Get location-based priority (infrastructure analysis)
      const locationPriority = await this.calculateLocationPriority(
        latitude, 
        longitude, 
        complaintData.complaintType || 'general',
        complaintData.locationMeta || {}
      );
      
      // Extract facility counts for infrastructure score calculation
      const facilityAnalysis = locationPriority.facilityAnalysis || {};
      let totalFacilities = 0;
      
      // Calculate total facilities nearby
      Object.values(facilityAnalysis).forEach(facility => {
        if (facility && typeof facility.count === 'number') {
          totalFacilities += facility.count;
        }
      });
      
      console.log(`📊 Total infrastructure facilities found: ${totalFacilities}`);
      
      // Calculate infrastructure score (0-100)
      // More facilities = higher priority
      let infrastructureScore = 0;
      if (totalFacilities > 0) {
        // Normalize to a 0-100 scale with diminishing returns
        // 10 facilities will give almost max score (95)
        infrastructureScore = Math.min(100, 100 * (1 - Math.exp(-totalFacilities / 5)));
      }
      
      console.log(`🏢 [ALGORITHM 1/4] Infrastructure Score: ${infrastructureScore.toFixed(2)}% (${totalFacilities} facilities)`);
      
      // Extract image confidence score from image analysis
      const imageConfidence = imageAnalysis.confidence || imageAnalysis.modelConfidence || 0;
      const imageValidationScore = imageConfidence * 100; // Convert to 0-100 scale
      
      console.log(`� [ALGORITHM 2/4] Image Validation Score: ${imageValidationScore.toFixed(2)}% (confidence: ${imageConfidence})`);
      
      // Additional factors
      
      // 1. Emotion Analysis (AI-powered sentiment analysis of complaint text)
      let emotionScore = 0;
      console.log(`🔍 DEBUG: Checking emotion analysis conditions...`);
      console.log(`🔍 DEBUG: complaintData.description = "${complaintData.description}"`);
      console.log(`🔍 DEBUG: typeof complaintData.description = ${typeof complaintData.description}`);
      console.log(`🔍 DEBUG: Boolean check = ${Boolean(complaintData.description)}`);
      
      if (complaintData.description) {
        try {
          console.log('🧠 Analyzing emotion for complaint text...');
          
          // Call our emotion analysis API directly
          const emotionResponse = await axios.post('http://localhost:3001/api/emotion/analyze', {
            text: complaintData.description,
            category: complaintData.complaintType || 'general'
          });
          
          // Extract the emotion score from the response
          const emotionResult = emotionResponse.data;
          console.log(`🔥 Raw emotion result:`, emotionResult);
          
          // The emotion API returns nested data structure: { success: true, data: { emotionScore: 0.561, ... } }
          const emotionData = emotionResult.data || emotionResult;
          const rawEmotionScore = emotionData.emotionScore || 0;
          emotionScore = rawEmotionScore * 100; // Convert from 0-1 range to 0-100 percentage
          
          console.log(`🧠 [ALGORITHM 3/4] Emotion Analysis Score: ${emotionScore.toFixed(2)}% (raw: ${rawEmotionScore.toFixed(4)}, method: ${emotionData.analysisMethod})`);
        } catch (emotionError) {
          console.warn('⚠️ Emotion analysis failed:', emotionError.message);
          // Fallback to basic keyword analysis
          emotionScore = this.getBasicEmotionScore(complaintData.description);
        }
      } else {
        console.log('🔍 DEBUG: Emotion analysis skipped - no description provided');
      }
      
      // 2. Vote count (more votes = higher priority)
      let voteScore = 0;
      if (complaintData.votes !== undefined) {
        // Normalize votes: 10 votes gives ~90 score
        voteScore = Math.min(100, 100 * (1 - Math.exp(-complaintData.votes / 5)));
      }
      
      console.log(`🗳️ [ALGORITHM 4/4] Community Voting Score: ${voteScore.toFixed(2)}% (${complaintData.votes || 0} votes)`);
      
      // 3. Complaint status
      let statusMultiplier = 1.0;
      if (complaintData.status === 'in_progress') {
        statusMultiplier = 1.2; // 20% boost for in-progress complaints
      } else if (complaintData.status === 'completed') {
        statusMultiplier = 0.5; // 50% reduction for completed complaints
      }
      
      // Calculate final score with the new 4-factor weights (excluding age)
      // Infrastructure (40%), Image (30%), Emotion (20%), Votes (10%)
      const infrastructureWeight = 0.4;
      const imageValidationWeight = 0.3;
      const emotionWeight = 0.2;
      const voteWeight = 0.1;
      
      let finalScore = (
        (infrastructureScore * infrastructureWeight) +
        (imageValidationScore * imageValidationWeight) +
        (emotionScore * emotionWeight) +
        (voteScore * voteWeight)
      );
      
      // Apply status multiplier
      finalScore = Math.min(100, finalScore * statusMultiplier);
      
      console.log(`🎯 === 4-ALGORITHM PRIORITY CALCULATION SUMMARY ===`);
      console.log(`📊 Weighted Contributions:`);
      console.log(`   🏢 Infrastructure: ${(infrastructureScore * infrastructureWeight).toFixed(2)} (${infrastructureScore.toFixed(2)} × ${infrastructureWeight})`);
      console.log(`   📷 Image Analysis: ${(imageValidationScore * imageValidationWeight).toFixed(2)} (${imageValidationScore.toFixed(2)} × ${imageValidationWeight})`);
      console.log(`   🧠 Emotion Analysis: ${(emotionScore * emotionWeight).toFixed(2)} (${emotionScore.toFixed(2)} × ${emotionWeight})`);
      console.log(`   🗳️ Community Votes: ${(voteScore * voteWeight).toFixed(2)} (${voteScore.toFixed(2)} × ${voteWeight})`);
      console.log(`📈 Raw Combined Score: ${(finalScore / statusMultiplier).toFixed(2)}%`);
      console.log(`⚡ Status Multiplier: ${statusMultiplier}x (${complaintData.status})`);
      console.log(`🎯 FINAL PRIORITY SCORE: ${finalScore.toFixed(2)}% → ${this.getPriorityLevel(finalScore / 100)}`);
      console.log(`================================================`);
      
      // Generate explanation for the priority
      let priorityReason = this.generatePriorityExplanation(
        totalFacilities, 
        infrastructureScore, 
        imageValidationScore, 
        emotionScore,
        finalScore,
        facilityAnalysis
      );
      
      // Convert to 0-1 scale for consistency with existing methods
      const normalizedScore = finalScore / 100;
      
      return {
        priorityScore: normalizedScore,
        priorityLevel: this.getPriorityLevel(normalizedScore),
        reasoning: priorityReason,
        breakdown: {
          infrastructureScore: infrastructureScore / 100,
          imageValidationScore: imageValidationScore / 100,
          emotionScore: emotionScore / 100,
          voteScore: voteScore / 100,
          statusMultiplier
        },
        facilityAnalysis,
        totalFacilities,
        infrastructureDetails: locationPriority,
        imageConfidence: imageConfidence
      };
    } catch (error) {
      console.error('Error calculating comprehensive priority:', error);
      // Return a default minimal score on error
      return {
        priorityScore: 0.1,
        priorityLevel: 'LOW',
        reasoning: 'Error calculating priority: ' + error.message,
        breakdown: {
          infrastructureScore: 0,
          imageValidationScore: 0,
          emotionScore: 0,
          voteScore: 0,
          statusMultiplier: 1.0
        },
        error: error.message
      };
    }
  }
  
  /**
   * Basic keyword-based emotion scoring fallback
   */
  getBasicEmotionScore(text) {
    if (!text) return 0;
    
    const urgentKeywords = ['emergency', 'urgent', 'dangerous', 'unsafe', 'accident', 'death', 'injury', 'critical'];
    const frustrationKeywords = ['frustrated', 'angry', 'disappointed', 'fed up', 'terrible', 'awful', 'horrible'];
    const concernKeywords = ['worried', 'concerned', 'unsafe', 'problem', 'issue', 'trouble', 'damage'];
    
    const lowerText = text.toLowerCase();
    let score = 0;
    
    // Check for urgent keywords (high weight)
    urgentKeywords.forEach(keyword => {
      if (lowerText.includes(keyword)) score += 30;
    });
    
    // Check for frustration keywords (medium weight)
    frustrationKeywords.forEach(keyword => {
      if (lowerText.includes(keyword)) score += 20;
    });
    
    // Check for concern keywords (low weight)
    concernKeywords.forEach(keyword => {
      if (lowerText.includes(keyword)) score += 10;
    });
    
    // Normalize to 0-100 scale
    return Math.min(100, score);
  }
  
  /**
   * Generate human-readable explanation for priority score
   */
  generatePriorityExplanation(totalFacilities, infrastructureScore, imageValidationScore, emotionScore, finalScore, facilityAnalysis) {
    let reasons = [];
    
    // Infrastructure explanation
    if (totalFacilities > 10) {
      reasons.push(`High concentration of critical infrastructure nearby (${totalFacilities} facilities)`);
    } else if (totalFacilities > 5) {
      reasons.push(`Moderate concentration of infrastructure nearby (${totalFacilities} facilities)`);
    } else if (totalFacilities > 0) {
      reasons.push(`Limited infrastructure in the area (${totalFacilities} facilities)`);
    } else {
      reasons.push('No critical infrastructure detected nearby');
    }
    
    // Key facilities
    const keyFacilities = [];
    for (const [type, data] of Object.entries(facilityAnalysis)) {
      if (data && data.count > 0) {
        keyFacilities.push(`${data.count} ${this.facilityConfig[type]?.description || type}`);
      }
    }
    
    if (keyFacilities.length > 0) {
      reasons.push(`Key facilities include: ${keyFacilities.slice(0, 3).join(', ')}${keyFacilities.length > 3 ? ' and more' : ''}`);
    }
    
    // Image validation explanation
    if (imageValidationScore > 80) {
      reasons.push('Image analysis confirms issue with high confidence');
    } else if (imageValidationScore > 60) {
      reasons.push('Image analysis supports complaint with moderate confidence');
    } else if (imageValidationScore > 40) {
      reasons.push('Image validation shows limited evidence of reported issue');
    } else {
      reasons.push('Image validation could not strongly confirm the reported issue');
    }
    
    // Emotion analysis explanation
    if (emotionScore > 70) {
      reasons.push('AI emotion analysis detected high urgency and emotional intensity');
    } else if (emotionScore > 50) {
      reasons.push('AI emotion analysis shows moderate concern and urgency');
    } else if (emotionScore > 30) {
      reasons.push('AI emotion analysis indicates mild concern in complaint');
    } else if (emotionScore > 0) {
      reasons.push('AI emotion analysis shows low emotional intensity');
    } else {
      reasons.push('Emotion analysis unavailable for this complaint');
    }
    
    // Overall priority
    if (finalScore > 80) {
      reasons.push('CRITICAL PRIORITY: Immediate attention recommended');
    } else if (finalScore > 60) {
      reasons.push('HIGH PRIORITY: Prompt response needed');
    } else if (finalScore > 40) {
      reasons.push('MEDIUM PRIORITY: Schedule for assessment');
    } else {
      reasons.push('LOW PRIORITY: Attention as resources permit');
    }
    
    return reasons.join('. ');
  }

  /**
   * Utility delay function
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = LocationPriorityService;
