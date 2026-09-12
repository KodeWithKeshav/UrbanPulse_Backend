const axios = require('axios');

// Simple in-memory cache
const weatherCache = {
  data: null,
  timestamp: null,
  CACHE_DURATION: 15 * 60 * 1000 // 15 minutes
};

const mapWeatherCodeToDescription = (code) => {
  const codes = {
    0: 'Clear sky',
    1: 'Mainly clear',
    2: 'Partly cloudy',
    3: 'Overcast',
    45: 'Fog',
    48: 'Depositing rime fog',
    51: 'Light drizzle',
    53: 'Moderate drizzle',
    55: 'Dense drizzle',
    56: 'Light freezing drizzle',
    57: 'Dense freezing drizzle',
    61: 'Slight rain',
    63: 'Moderate rain',
    65: 'Heavy rain',
    66: 'Light freezing rain',
    67: 'Heavy freezing rain',
    71: 'Slight snow fall',
    73: 'Moderate snow fall',
    75: 'Heavy snow fall',
    77: 'Snow grains',
    80: 'Slight rain showers',
    81: 'Moderate rain showers',
    82: 'Violent rain showers',
    85: 'Slight snow showers',
    86: 'Heavy snow showers',
    95: 'Thunderstorm',
    96: 'Thunderstorm with slight hail',
    99: 'Thunderstorm with heavy hail',
  };
  return codes[code] || 'Unknown';
};

const isHeavyRainCode = (code) => {
  const heavyCodes = [63, 65, 67, 81, 82, 95, 96, 99];
  return heavyCodes.includes(code);
};

const getWeather = async (lat = 13.0827, lon = 80.2707) => {
  const cacheKey = `${lat},${lon}`;
  
  if (weatherCache.data && weatherCache.timestamp) {
    const now = new Date().getTime();
    if (now - weatherCache.timestamp < weatherCache.CACHE_DURATION) {
      console.log('Returning cached weather data');
      return weatherCache.data;
    }
  }

  try {
    console.log(`Fetching live weather data for lat=${lat}, lon=${lon}...`);
    // Using Open-Meteo free API as requested
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Asia%2FKolkata`;
    
    const response = await axios.get(url);
    const data = response.data;

    // Sanitize dry thunderstorms (Open-Meteo often predicts WMO 95 but with 0% rain in tropical areas)
    const sanitizeCode = (code, rainProb, precipitation = 0) => {
      if ((code === 95 || code === 96 || code === 99) && rainProb < 20 && precipitation === 0) {
        return 1; // Return 'Mainly clear' instead of Thunderstorm
      }
      return code;
    };

    const todayRainProb = data.daily.precipitation_probability_max[0] || 0;
    const sanitizedCurrentCode = sanitizeCode(data.current.weather_code, todayRainProb, data.current.precipitation);

    // Process current weather
    const current = {
      temp: data.current.temperature_2m,
      feelsLike: data.current.apparent_temperature,
      humidity: data.current.relative_humidity_2m,
      windSpeed: data.current.wind_speed_10m,
      condition: mapWeatherCodeToDescription(sanitizedCurrentCode),
      weatherCode: sanitizedCurrentCode,
      isDay: data.current.is_day,
      precipitation: data.current.precipitation
    };

    // Process 7-day forecast
    const forecast = data.daily.time.map((time, index) => {
      const rainProb = data.daily.precipitation_probability_max[index] || 0;
      const rawCode = data.daily.weather_code[index];
      const safeCode = sanitizeCode(rawCode, rainProb, 0);

      return {
        date: time,
        minTemp: data.daily.temperature_2m_min[index],
        maxTemp: data.daily.temperature_2m_max[index],
        condition: mapWeatherCodeToDescription(safeCode),
        weatherCode: safeCode,
        rainProbability: rainProb
      };
    });

    // Check if heavy rain is expected in the next 48 hours (today or tomorrow)
    const todayCode = forecast[0].weatherCode;
    const tomorrowCode = forecast[1].weatherCode;
    const tomorrowRainProb = data.daily.precipitation_probability_max[1];

    // Smarter logic: Don't just rely on WMO code (sometimes it predicts dry thunderstorms).
    // Require a significant chance of rain (>40%) alongside the code, or a very high probability (>70%).
    const isHeavyRainExpected = 
      (isHeavyRainCode(todayCode) && todayRainProb > 40) || 
      (isHeavyRainCode(tomorrowCode) && tomorrowRainProb > 40) || 
      todayRainProb > 70 || 
      tomorrowRainProb > 70;

    let alertMessage = null;
    if (isHeavyRainExpected) {
      alertMessage = "Heavy rainfall expected. Higher chance of waterlogging and drain complaints. Stay safe!";
    }

    const processedData = {
      current,
      forecast,
      isHeavyRainExpected,
      alertMessage,
      location: "Chennai" // Defaulting to Chennai as requested
    };

    // Cache the data
    weatherCache.data = processedData;
    weatherCache.timestamp = new Date().getTime();

    return processedData;
  } catch (error) {
    console.error('Error fetching weather data:', error.message);
    // If API fails, return cached data even if stale, or null
    if (weatherCache.data) {
      return weatherCache.data;
    }
    throw new Error('Failed to fetch weather data');
  }
};

module.exports = {
  getWeather,
  mapWeatherCodeToDescription
};
