const axios = require('axios');

/**
 * Fallback Location Service using OpenStreetMap/Nominatim
 * Free alternative for testing when Google API is not available
 */
class FallbackLocationService {
  constructor() {
    this.nominatimUrl = 'https://nominatim.openstreetmap.org';
    this.overpassUrl = 'https://overpass-api.de/api/interpreter';
  }

  /**
   * Calculate location priority using OpenStreetMap data
   */
  async calculateLocationPriority(latitude, longitude, complaintType = 'general') {
    try {
      console.log(`🔍 Analyzing location priority (Fallback OSM): ${latitude}, ${longitude}`);
      
      // Get nearby amenities using Overpass API
      const facilities = await this.getNearbyFacilities(latitude, longitude);
      
      // Calculate scores based on facilities found
      const facilityScores = this.calculateFacilityScores(facilities, latitude, longitude);
      const densityBonus = this.calculateDensityBonus(facilities);
      const finalScore = Math.min(1.0, facilityScores.maxScore + densityBonus);
      
      return {
        priorityScore: Math.round(finalScore * 100) / 100,
        priorityLevel: this.getPriorityLevel(finalScore),
        facilitiesFound: facilities.length,
        facilityBreakdown: facilityScores.breakdown,
        densityBonus,
        source: 'OpenStreetMap',
        coordinates: { latitude, longitude },
        complaintType
      };
      
    } catch (error) {
      console.error('❌ Fallback location service failed:', error);
      return {
        priorityScore: 0.5,
        priorityLevel: 'MEDIUM',
        error: 'Location service unavailable',
        source: 'fallback',
        coordinates: { latitude, longitude }
      };
    }
  }

  /**
   * Get nearby facilities using Overpass API
   */
  async getNearbyFacilities(latitude, longitude, radiusKm = 1) {
    const overpassQuery = `
      [out:json][timeout:25];
      (
        node["amenity"~"^(hospital|clinic|school|university|police|fire_station|government|bank|pharmacy)$"](around:${radiusKm * 1000},${latitude},${longitude});
        way["amenity"~"^(hospital|clinic|school|university|police|fire_station|government|bank|pharmacy)$"](around:${radiusKm * 1000},${latitude},${longitude});
        relation["amenity"~"^(hospital|clinic|school|university|police|fire_station|government|bank|pharmacy)$"](around:${radiusKm * 1000},${latitude},${longitude});
      );
      out center meta;
    `;

    try {
      const response = await axios.post(this.overpassUrl, overpassQuery, {
        headers: { 'Content-Type': 'text/plain' },
        timeout: 30000
      });

      const elements = response.data.elements || [];
      
      return elements.map(element => {
        const lat = element.lat || element.center?.lat;
        const lon = element.lon || element.center?.lon;
        const distance = this.calculateDistance(latitude, longitude, lat, lon);
        
        return {
          name: element.tags?.name || `${element.tags?.amenity} facility`,
          type: element.tags?.amenity,
          distance: Math.round(distance),
          latitude: lat,
          longitude: lon,
          source: 'OpenStreetMap'
        };
      }).filter(f => f.latitude && f.longitude);
      
    } catch (error) {
      console.error('Overpass API error:', error.message);
      return [];
    }
  }

  /**
   * Calculate facility scores
   */
  calculateFacilityScores(facilities, userLat, userLng) {
    const facilityWeights = {
      hospital: 0.9,
      clinic: 0.8,
      school: 0.8,
      university: 0.7,
      police: 0.85,
      fire_station: 0.9,
      government: 0.75,
      bank: 0.6,
      pharmacy: 0.7
    };

    const breakdown = {};
    let maxScore = 0;

    // Group facilities by type
    Object.keys(facilityWeights).forEach(type => {
      const typeFacilities = facilities.filter(f => f.type === type);
      if (typeFacilities.length > 0) {
        const nearest = typeFacilities.sort((a, b) => a.distance - b.distance)[0];
        const weight = facilityWeights[type];
        const distanceScore = Math.max(0, 1 - (nearest.distance / 1000)); // 1km max range
        const score = distanceScore * weight;
        
        breakdown[type] = {
          count: typeFacilities.length,
          nearest: nearest.name,
          distance: nearest.distance,
          score: score
        };
        
        maxScore = Math.max(maxScore, score);
      }
    });

    return { breakdown, maxScore };
  }

  /**
   * Calculate density bonus
   */
  calculateDensityBonus(facilities) {
    const count = facilities.length;
    if (count >= 15) return 0.25;
    if (count >= 10) return 0.20;
    if (count >= 5) return 0.15;
    if (count >= 3) return 0.10;
    if (count >= 1) return 0.05;
    return 0;
  }

  /**
   * Calculate distance between two points
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
   * Convert score to priority level
   */
  getPriorityLevel(score) {
    if (score >= 0.8) return 'CRITICAL';
    if (score >= 0.6) return 'HIGH';
    if (score >= 0.4) return 'MEDIUM';
    if (score >= 0.2) return 'LOW';
    return 'MINIMAL';
  }
}

// Test the fallback service
async function testFallbackService() {
  const fallbackService = new FallbackLocationService();
  
  console.log('🧪 Testing Fallback Location Service (OpenStreetMap)');
  console.log('=' .repeat(60));
  
  const testLocations = [
    { name: 'AIIMS Delhi', lat: 28.5672, lng: 77.2100 },
    { name: 'Connaught Place', lat: 28.6315, lng: 77.2167 }
  ];

  for (const location of testLocations) {
    console.log(`\n📍 Testing: ${location.name}`);
    console.log(`Coordinates: ${location.lat}, ${location.lng}`);
    console.log('-'.repeat(40));
    
    try {
      const result = await fallbackService.calculateLocationPriority(location.lat, location.lng);
      
      console.log(`🎯 Priority Score: ${result.priorityScore}/1.0 (${result.priorityLevel})`);
      console.log(`🏢 Facilities Found: ${result.facilitiesFound}`);
      console.log(`🌐 Data Source: ${result.source}`);
      
      if (result.facilityBreakdown) {
        console.log('\n📊 Facility Breakdown:');
        Object.entries(result.facilityBreakdown).forEach(([type, data]) => {
          console.log(`  ${type}: ${data.count} facilities (nearest: ${data.distance}m)`);
        });
      }
      
      // Wait between requests to be respectful to OSM servers
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.error(`❌ Error testing ${location.name}:`, error.message);
    }
  }
}

module.exports = FallbackLocationService;

// Run test if this file is executed directly
if (require.main === module) {
  testFallbackService().catch(console.error);
}
