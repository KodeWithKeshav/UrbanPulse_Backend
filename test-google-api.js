require('dotenv').config();
const axios = require('axios');

async function testGooglePlacesAPI() {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    
    console.log('🔑 Testing Google Places API...');
    console.log(`API Key present: ${apiKey ? 'YES' : 'NO'}`);
    
    if (!apiKey) {
        console.error('❌ No API key found!');
        return;
    }
    
    console.log(`API Key (first 20 chars): ${apiKey.substring(0, 20)}...`);
    
    // Test with Mumbai coordinates
    const testLocation = {
        latitude: 19.0760,
        longitude: 72.8777,
        name: 'Mumbai, India'
    };
    
    console.log(`\n📍 Testing location: ${testLocation.name} (${testLocation.latitude}, ${testLocation.longitude})`);
    
    try {
        console.log('\n🌐 Testing Places API (New) [places:searchNearby]...');
        const newApiRes = await axios.post(
            'https://places.googleapis.com/v1/places:searchNearby',
            {
                includedTypes: ['hospital'],
                maxResultCount: 5,
                locationRestriction: {
                    circle: {
                        center: { latitude: testLocation.latitude, longitude: testLocation.longitude },
                        radius: 1000.0
                    }
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.rating'
                },
                timeout: 10000
            }
        );
        console.log(`✅ Places API (New) Status: ${newApiRes.status}`);
        const places = newApiRes.data?.places || [];
        console.log(`📍 Places Found: ${places.length}`);
        if (places.length > 0) {
            console.log('\nTop hospitals found:');
            places.slice(0, 3).forEach((p, i) => {
                console.log(`${i + 1}. ${p.displayName?.text} (${p.formattedAddress})`);
            });
        }
        return;
    } catch (newErr) {
        console.warn('⚠️ Places API (New) failed:', newErr.response?.data?.error?.message || newErr.message);
        console.log('Falling back to testing legacy nearbysearch...');
    }

    try {
        const url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json';
        const params = {
            location: `${testLocation.latitude},${testLocation.longitude}`,
            radius: 1000,
            type: 'hospital',
            key: apiKey
        };
        
        console.log('\n🌐 Making API request to legacy nearbysearch...');
        const response = await axios.get(url, { params, timeout: 10000 });
        
        console.log(`\n✅ Status Code: ${response.status}`);
        console.log(`📊 API Status: ${response.data.status}`);
        console.log(`📍 Results Found: ${response.data.results?.length || 0}`);
        
        if (response.data.status === 'REQUEST_DENIED') {
            console.error(`\n❌ API REQUEST DENIED!`);
            console.error(`Error: ${response.data.error_message || 'No error message'}`);
            console.error(`\nPossible causes:`);
            console.error(`1. API key restrictions (check allowed IPs/referrers)`);
            console.error(`2. Places API not enabled in Google Cloud Console`);
            console.error(`3. Billing not set up`);
        } else if (response.data.status === 'OVER_QUERY_LIMIT') {
            console.error(`\n❌ OVER QUERY LIMIT!`);
            console.error(`Your API quota has been exceeded`);
        } else if (response.data.status === 'OK') {
            console.log(`\n✅ API is working correctly!`);
            if (response.data.results?.length > 0) {
                console.log(`\nTop 3 hospitals found:`);
                response.data.results.slice(0, 3).forEach((place, i) => {
                    console.log(`${i + 1}. ${place.name} (${place.vicinity})`);
                });
            }
        } else {
            console.warn(`\n⚠️ Unexpected status: ${response.data.status}`);
        }
        
    } catch (error) {
        console.error(`\n❌ Request failed:`, error.message);
        if (error.response) {
            console.error(`Response status: ${error.response.status}`);
            console.error(`Response data:`, error.response.data);
        }
    }
}

testGooglePlacesAPI();
