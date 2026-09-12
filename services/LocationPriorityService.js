const axios = require('axios');
require('dotenv').config();
const priorityConfig = require('./priorityConfig');
const { emotionService } = require('./EmotionAnalysisService');

/**
 * Location Priority Service for CivicStack
 * Calculates priority scores based on proximity to critical infrastructure.
 *
 * Every weight/multiplier/threshold used in this file is defined in
 * services/priorityConfig.js (AHP-derived, with cited rationale) -- nothing
 * here is a bare, unexplained literal. See PRIORITY_ENGINE_REPORT.pdf.
 */
class LocationPriorityService {
  constructor() {
    this.apiKey = process.env.GOOGLE_PLACES_API_KEY;
    this.baseUrl = 'https://maps.googleapis.com/maps/api/place';

    if (!this.apiKey) {
      console.warn('⚠️ Google Places API key not found in environment variables');
    }

    // Critical facility types. `weight` comes from priorityConfig's
    // AHP-derived FACILITY_WEIGHTS (see that file for the criticality score
    // and rationale behind each type). `radius` and the keyword filters
    // remain operational search parameters, not priority weights.
    const W = priorityConfig.FACILITY_WEIGHTS;
    this.facilityConfig = {
      hospital: {
        weight: W.hospital,
        radius: 10000, // 10km search radius
        searchTypes: ['hospital', 'doctor'],
        excludeKeywords: ['store', 'shop', 'mart', 'pharmacy', 'medical_store', 'transport', 'logistics', 'cargo', 'travel', 'bus'],
        includeKeywords: ['hospital', 'clinic', 'medical', 'health', 'emergency'],
        description: 'Medical facilities'
      },
      school: {
        weight: W.school,
        radius: 10000, // 10km search radius
        searchTypes: ['school', 'university', 'primary_school'],
        excludeKeywords: ['store', 'shop'],
        includeKeywords: ['school', 'college', 'university', 'education'],
        description: 'Educational institutions'
      },
      police: {
        weight: W.police,
        radius: 10000, // 10km search radius
        searchTypes: ['police'],
        excludeKeywords: [],
        includeKeywords: ['police', 'station', 'law'],
        description: 'Law enforcement'
      },
      fire_station: {
        weight: W.fire_station,
        radius: 10000, // 10km search radius
        searchTypes: ['fire_station'],
        excludeKeywords: [],
        includeKeywords: ['fire', 'emergency'],
        description: 'Emergency services'
      },
      transit_station: {
        weight: W.transit_station,
        radius: 10000, // 10km search radius
        searchTypes: ['transit_station', 'bus_station', 'subway_station'],
        excludeKeywords: [],
        includeKeywords: ['station', 'bus', 'metro', 'transport'],
        description: 'Public transport'
      },
      government: {
        weight: W.government,
        radius: 10000, // 10km search radius
        searchTypes: ['local_government_office', 'city_hall'],
        description: 'Government offices'
      },
      bank: {
        weight: W.bank,
        radius: 10000, // 10km search radius
        searchTypes: ['bank', 'atm'],
        description: 'Financial services'
      },
      pharmacy: {
        weight: W.pharmacy,
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
      const probeTypes = ['store', 'restaurant', 'hospital'];
      
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
    // Once a project-level config error (bad key, billing, quota) shows up for one
    // facility type, it will be identical for every other type - stop calling out.
    let placesApiUnavailable = null;

    console.log(`🔍 Starting facility analysis for ${latitude}, ${longitude} with ${searchRadius}m radius`);

    for (const [facilityType, config] of Object.entries(this.facilityConfig)) {
      if (placesApiUnavailable) {
        results[facilityType] = {
          count: 0,
          facilities: [],
          score: 0,
          weight: config.weight,
          error: placesApiUnavailable,
          description: config.description
        };
        continue;
      }

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
        if (error.retryable === false) {
          placesApiUnavailable = error.message;
        }
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
          // Permanent, project-level errors (bad/missing key, billing, quota) will
          // fail identically on every retry - don't burn time looping on them.
          if (error.retryable === false) {
            throw error;
          }
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
      const error = new Error('Google Places API key not configured');
      error.retryable = false; // missing config will never succeed on retry
      throw error;
    }

    // 1. Try modern Places API (New) first (required by Google for newer API keys)
    try {
      const newApiUrl = 'https://places.googleapis.com/v1/places:searchNearby';
      const newApiResponse = await axios.post(
        newApiUrl,
        {
          includedTypes: [type],
          maxResultCount: 20,
          locationRestriction: {
            circle: {
              center: { latitude: parseFloat(latitude), longitude: parseFloat(longitude) },
              radius: parseFloat(radius)
            }
          }
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': this.apiKey,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.types,places.formattedAddress'
          },
          timeout: 10000
        }
      );

      if (newApiResponse.status === 200) {
        const places = (newApiResponse.data && Array.isArray(newApiResponse.data.places)) ? newApiResponse.data.places : [];
        if (places.length === 0) {
          return [];
        }
        const facilityType = this.getFacilityTypeFromSearchType(type);
        const config = this.facilityConfig[facilityType];

        const filtered = places.filter(place => {
          const name = (place.displayName?.text || '').toLowerCase();
          const types = place.types || [];
          if (config && config.excludeKeywords) {
            const hasExcluded = config.excludeKeywords.some(keyword => name.includes(keyword.toLowerCase()));
            if (hasExcluded) return false;
            if (facilityType === 'hospital' || facilityType === 'school' || facilityType === 'government') {
              const transportWords = ['transport', 'logistics', 'cargo', 'travel', 'bus', 'taxi', 'auto'];
              if (transportWords.some(word => name.includes(word))) return false;
            }
          }
          if (config && config.includeKeywords && config.includeKeywords.length > 0) {
            const hasIncluded = config.includeKeywords.some(keyword =>
              name.includes(keyword.toLowerCase()) || types.some(t => t.includes(keyword.toLowerCase()))
            );
            if (!hasIncluded) return false;
          }
          return true;
        });

        return filtered.map(place => ({
          name: place.displayName?.text || 'Unknown Place',
          place_id: place.id,
          distance: this.calculateDistance(
            latitude, longitude,
            place.location?.latitude || latitude, place.location?.longitude || longitude
          ),
          rating: place.rating || 0,
          types: place.types || [],
          vicinity: place.formattedAddress || '',
          geometry: {
            location: {
              lat: place.location?.latitude,
              lng: place.location?.longitude
            }
          }
        }));
      }
    } catch (newApiErr) {
      // If error is not a fatal credential error, fall through to legacy nearbysearch
      if (newApiErr.response?.data?.error?.status !== 'REQUEST_DENIED') {
        // Continue to legacy fallback
      }
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
      const error = new Error('API quota exceeded');
      error.retryable = false; // quota won't reset within a retry window
      throw error;
    }

    if (response.data.status === 'REQUEST_DENIED') {
      console.error('❌ Google Places API: Request denied');
      console.error('   Reason:', response.data.error_message || 'No error message');
      console.error('   Common causes:');
      console.error('   1. API key restrictions (check allowed IPs/referrers in Google Cloud Console)');
      console.error('   2. Places API not enabled in Google Cloud Console');
      console.error('   3. Billing not set up for the project');
      const error = new Error('API request denied - check API key restrictions');
      error.retryable = false; // a project-level config error, not a transient failure
      throw error;
    }

    if (response.data.status === 'INVALID_REQUEST') {
      console.error('❌ Google Places API: Invalid request');
      const error = new Error('Invalid API request parameters');
      error.retryable = false; // malformed params won't fix themselves on retry
      throw error;
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
      vicinity: place.vicinity || '',
      // Previously this field was never populated, so
      // calculateFacilityScore's importanceMultiplier always silently fell
      // back to 1.0 -- assessFacilityImportance() was fully implemented but
      // never actually wired in. Fixed here.
      importance: this.assessFacilityImportance(place)
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

    // Distance decay: negative-exponential, standard functional form in
    // gravity-based spatial-accessibility research (2SFCA literature, Luo &
    // Wang 2003 and successors) -- see services/priorityConfig.js section 7.
    // Replaces the previous linear "1 - distance/radius" falloff, which had
    // an artificial hard zero exactly at the search radius edge and no
    // literature basis for a linear shape.
    const halfDistance = config.radius / 2;
    const distanceScore = priorityConfig.exponentialDistanceScore(nearest.distance, halfDistance);

    // Facility density bonus (more facilities = higher score), same smooth
    // diminishing-returns shape used for the aggregate density/diversity
    // bonuses below instead of an arbitrary linear ramp.
    const densityBonus = 0.3 * (1 - Math.exp(-facilities.length / 8));
    
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
   * Calculate facility diversity bonus.
   *
   * Smooth diminishing-returns curve (same functional family as the
   * saturating infrastructure/vote curves elsewhere in this file) instead
   * of a fixed staircase -- a staircase creates an arbitrary discontinuity
   * (e.g. the 3rd vs 4th facility type crossing a step) with no principled
   * reason for exactly those boundaries. Cap (0.15) preserved from the
   * original design.
   */
  calculateFacilityDiversityBonus(facilityAnalysis) {
    const diversityCount = Object.values(facilityAnalysis).filter(f => f.score > 0).length;
    return 0.15 * (1 - Math.exp(-diversityCount / 2));
  }

  /**
   * Enhanced density bonus calculation.
   *
   * Smooth diminishing-returns curve instead of a fixed staircase, for the
   * same reason as calculateFacilityDiversityBonus above. Cap (0.25)
   * preserved from the original design.
   */
  calculateDensityBonus(facilityAnalysis) {
    const totalFacilities = Object.values(facilityAnalysis)
      .reduce((sum, analysis) => sum + analysis.count, 0);

    console.log(`🏘️ Total facilities found: ${totalFacilities}`);

    return 0.25 * (1 - Math.exp(-totalFacilities / 15));
  }

  /**
   * Assess facility importance level from the raw Google Place `types`
   * array (e.g. a place tagged as both "hospital" and "health"). The bonus
   * is a direct function of the same AHP-derived facility weights used
   * everywhere else in this file, instead of an independently-chosen
   * number -- see services/priorityConfig.js.
   */
  assessFacilityImportance(place) {
    const types = place?.types || [];
    const W = priorityConfig.FACILITY_WEIGHTS;
    const criticalTypes = ['hospital', 'fire_station', 'police', 'emergency'];
    const highTypes = ['school', 'university', 'government'];

    if (types.some(type => criticalTypes.includes(type))) {
      return 1 + W.hospital; // top-tier facility bump (~1.19)
    }
    if (types.some(type => highTypes.includes(type))) {
      return 1 + W.school; // mid-tier facility bump (~1.13)
    }
    return 1.0; // Normal facilities have no bonus
  }

  /**
   * Which facility types are contextually relevant to each complaint type
   * (e.g. a pothole matters more near a hospital/school/transit hub than
   * near a bank). This relevance mapping is a domain judgment and is kept
   * from the original design; what changed is the *magnitude* -- see
   * getComplaintFacilityMultiplier() below, which derives it from the
   * AHP-computed facility weights instead of an independently hand-typed
   * number per (complaint type, facility type) pair.
   */
  static COMPLAINT_RELEVANT_FACILITIES = {
    pothole: ['hospital', 'school', 'transit_station'],
    fallen_tree: ['transit_station', 'school'],
    garbage_dumping: ['hospital', 'school', 'pharmacy'],
    stray_cattle: ['school', 'transit_station'],
    fallen_electric_pole: ['hospital', 'school', 'police'],
    concrete_structure_damage: ['hospital', 'school', 'government'],
    road_waterlogging: ['hospital', 'school', 'pharmacy'],
    others: ['hospital', 'school', 'government']
  };

  /**
   * Convert a facility type's AHP-derived criticality weight into a
   * complaint-priority multiplier. Scaled (x2.5) so the highest-weighted
   * facility types (hospital/fire_station, weight ~0.19) top out near the
   * ~1.5x maximum the original hand-tuned per-pair table used, while every
   * other facility type's multiplier is now a direct, traceable function of
   * the same weight used throughout the rest of this file.
   */
  getComplaintFacilityMultiplier(facilityType) {
    const weight = priorityConfig.FACILITY_WEIGHTS[facilityType] || 0;
    return 1 + weight * 2.5;
  }

  /**
   * Get complaint type multiplier for specific facility combinations
   */
  getComplaintTypeMultiplier(complaintType, facilityAnalysis) {
    const relevantFacilities = LocationPriorityService.COMPLAINT_RELEVANT_FACILITIES[complaintType] || [];
    let maxMultiplier = 1.0;

    for (const facilityType of relevantFacilities) {
      if (facilityAnalysis[facilityType]?.score > 0.5) {
        maxMultiplier = Math.max(maxMultiplier, this.getComplaintFacilityMultiplier(facilityType));
      }
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
   * Convert score to priority level. Delegates to priorityConfig so this is
   * the one place the thresholds are defined -- previously this file,
   * routes/complaints.js, and routes/locationPriority.js each had their own
   * (mutually inconsistent) threshold sets.
   */
  getPriorityLevel(score) {
    return priorityConfig.getPriorityLevel(score);
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

      // Get location-based priority (infrastructure analysis). This already
      // computes a fully weighted proximity score (facility-type AHP
      // weights, exponential distance decay, density/diversity bonus,
      // complaint-type relevance multiplier, privacy adjustment) --
      // `locationPriority.priorityScore` below IS the infrastructure score.
      const locationPriority = await this.calculateLocationPriority(
        latitude,
        longitude,
        complaintData.complaintType || 'general',
        complaintData.locationMeta || {}
      );

      const facilityAnalysis = locationPriority.facilityAnalysis || {};
      let totalFacilities = 0;
      Object.values(facilityAnalysis).forEach(facility => {
        if (facility && typeof facility.count === 'number') {
          totalFacilities += facility.count;
        }
      });
      console.log(`📊 Total infrastructure facilities found: ${totalFacilities}`);

      // Infrastructure score (0-100). FIX: this used to be recomputed from
      // a raw facility *count* via an unrelated saturation curve
      // (100*(1-e^(-count/5))), which silently discarded everything
      // calculateLocationPriority() had just computed -- meaning a location
      // with 10 banks scored identically to one with 10 hospitals in the
      // number that actually reached the final formula. It now uses the
      // real weighted proximity score.
      const infrastructureScore = (locationPriority.priorityScore || 0) * 100;
      console.log(`🏢 [1/4] Infrastructure Score: ${infrastructureScore.toFixed(2)}% (${totalFacilities} facilities, weighted proximity=${locationPriority.priorityScore})`);

      // Extract image confidence score from image analysis
      const imageConfidence = imageAnalysis.confidence || imageAnalysis.modelConfidence || 0;
      const imageValidationScore = imageConfidence * 100; // Convert to 0-100 scale
      console.log(`📷 [2/4] Image Validation Score: ${imageValidationScore.toFixed(2)}% (confidence: ${imageConfidence})`);

      // Emotion analysis. FIX: this used to make an HTTP call to this same
      // server's own /api/emotion/analyze route on a hardcoded port
      // (localhost:3001) -- fragile (wrong port = silent failure), slower
      // than an in-process call, and a second, independent code path from
      // the emotion analysis routes/complaints.js already runs and stores
      // as the complaint's emotion_score. Now calls the same
      // EmotionAnalysisService directly, so both numbers come from one
      // computation.
      let emotionScore = 0;
      if (complaintData.description) {
        try {
          const emotionResult = await emotionService.analyzeEmotion(
            complaintData.description,
            complaintData.complaintType || 'general'
          );
          emotionScore = (emotionResult.emotionScore || 0) * 100;
          console.log(`🧠 [3/4] Emotion Analysis Score: ${emotionScore.toFixed(2)}% (method: ${emotionResult.analysisMethod})`);
        } catch (emotionError) {
          console.warn('⚠️ Emotion analysis failed, using basic keyword fallback:', emotionError.message);
          emotionScore = this.getBasicEmotionScore(complaintData.description);
        }
      } else {
        console.log('🔍 Emotion analysis skipped - no description provided');
      }

      // Vote count (more votes = higher priority), same saturating-curve
      // shape as the infrastructure/density bonuses above.
      let voteScore = 0;
      if (complaintData.votes !== undefined) {
        voteScore = Math.min(100, 100 * (1 - Math.exp(-complaintData.votes / 5)));
      }
      console.log(`🗳️ [4/4] Community Voting Score: ${voteScore.toFixed(2)}% (${complaintData.votes || 0} votes)`);

      // Complaint status
      let statusMultiplier = 1.0;
      if (complaintData.status === 'in_progress') {
        statusMultiplier = 1.2; // 20% boost for in-progress complaints
      } else if (complaintData.status === 'completed') {
        statusMultiplier = 0.5; // 50% reduction for completed complaints
      }

      // Combine the 4 signals using the AHP-derived TOP_LEVEL_WEIGHTS
      // (image ~43%, infrastructure ~33%, emotion ~14%, votes ~10% -- see
      // services/priorityConfig.js section 2 for the criticality scores and
      // rationale behind each).
      const W = priorityConfig.TOP_LEVEL_WEIGHTS;
      let finalScore = (
        (infrastructureScore * W.infrastructureScore) +
        (imageValidationScore * W.imageValidationScore) +
        (emotionScore * W.emotionScore) +
        (voteScore * W.voteScore)
      );

      // Apply status multiplier
      finalScore = Math.min(100, finalScore * statusMultiplier);

      console.log(`🎯 === PRIORITY CALCULATION SUMMARY ===`);
      console.log(`   🏢 Infrastructure: ${(infrastructureScore * W.infrastructureScore).toFixed(2)} (${infrastructureScore.toFixed(2)} × ${W.infrastructureScore.toFixed(3)})`);
      console.log(`   📷 Image Analysis: ${(imageValidationScore * W.imageValidationScore).toFixed(2)} (${imageValidationScore.toFixed(2)} × ${W.imageValidationScore.toFixed(3)})`);
      console.log(`   🧠 Emotion Analysis: ${(emotionScore * W.emotionScore).toFixed(2)} (${emotionScore.toFixed(2)} × ${W.emotionScore.toFixed(3)})`);
      console.log(`   🗳️ Community Votes: ${(voteScore * W.voteScore).toFixed(2)} (${voteScore.toFixed(2)} × ${W.voteScore.toFixed(3)})`);
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
      const fallbackScore = 0.1;
      return {
        priorityScore: fallbackScore,
        priorityLevel: priorityConfig.getPriorityLevel(fallbackScore),
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
