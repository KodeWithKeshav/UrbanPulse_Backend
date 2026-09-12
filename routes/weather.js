const express = require('express');
const router = express.Router();
const weatherService = require('../services/weather_service');

// @route   GET /api/weather
// @desc    Get live weather and forecast (defaults to Chennai)
// @access  Public (or protected based on auth later)
router.get('/', async (req, res) => {
  try {
    // Optional: allow passing lat/lon via query params
    const lat = req.query.lat ? parseFloat(req.query.lat) : 13.0827; // Chennai Default
    const lon = req.query.lon ? parseFloat(req.query.lon) : 80.2707; // Chennai Default

    const weatherData = await weatherService.getWeather(lat, lon);
    
    res.status(200).json({
      success: true,
      data: weatherData
    });
  } catch (error) {
    console.error('Weather Route Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch weather data',
      error: error.message
    });
  }
});

module.exports = router;
