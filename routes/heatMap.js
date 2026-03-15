const express = require('express');
const router = express.Router();
const HeatMapService = require('../services/HeatMapService');

const heatMapService = new HeatMapService();

/**
 * GET /api/heat-map/data
 * Get heat map data for visualization
 */
router.get('/data', async (req, res) => {
  try {
    console.log(' Heat map data requested');
    
    const filters = {
      dateRange: parseInt(req.query.days) || 30, // Last 30 days by default
      status: req.query.status,
      complaintType: req.query.type
    };

    console.log(' Filters applied:', filters);

    const heatMapData = await heatMapService.getComplaintHeatMapData(filters);
    
    console.log(` Returning ${heatMapData.points.length} complaint points`);
    
    res.json({
      success: true,
      data: heatMapData,
      filters: filters,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(' Heat map data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch heat map data',
      message: error.message
    });
  }
});

/**
 * GET /api/heat-map/statistics
 * Get complaint statistics for dashboard
 */
router.get('/statistics', async (req, res) => {
  try {
    console.log(' Statistics requested');
    
    const timeRange = parseInt(req.query.days) || 30;
    const statistics = await heatMapService.getComplaintStatistics(timeRange);
    
    console.log(' Statistics calculated:', {
      total: statistics.total,
      resolved: statistics.resolved,
      resolutionRate: statistics.resolutionRate
    });
    
    res.json({
      success: true,
      data: statistics,
      timeRange: timeRange,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(' Statistics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
      message: error.message
    });
  }
});

/**
 * GET /api/heat-map/filtered
 * Get filtered heat map data
 */
router.get('/filtered', async (req, res) => {
  try {
    console.log(' Filtered heat map data requested');
    
    const filters = {
      dateRange: parseInt(req.query.days) || 30,
      status: req.query.status,
      complaintType: req.query.type,
      priorityLevel: req.query.priority,
      minLat: parseFloat(req.query.minLat),
      maxLat: parseFloat(req.query.maxLat),
      minLng: parseFloat(req.query.minLng),
      maxLng: parseFloat(req.query.maxLng)
    };

    // Remove undefined values
    Object.keys(filters).forEach(key => {
      if (filters[key] === undefined || isNaN(filters[key])) {
        delete filters[key];
      }
    });

    console.log(' Applied filters:', filters);

    const heatMapData = await heatMapService.getFilteredHeatMapData(filters);
    
    console.log(` Returning ${heatMapData.points.length} filtered points`);
    
    res.json({
      success: true,
      data: heatMapData,
      filters: filters,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(' Filtered heat map error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch filtered heat map data',
      message: error.message
    });
  }
});

/**
 * POST /api/heat-map/refresh
 * Refresh heat map data (force database update)
 */
router.post('/refresh', async (req, res) => {
  try {
    console.log(' Heat map refresh requested');
    
    // Force refresh by fetching fresh data
    const heatMapData = await heatMapService.getComplaintHeatMapData({ 
      dateRange: 30,
      forceRefresh: true 
    });
    
    console.log(` Heat map refreshed with ${heatMapData.points.length} points`);
    
    res.json({
      success: true,
      message: 'Heat map data refreshed successfully',
      data: heatMapData,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(' Heat map refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to refresh heat map data',
      message: error.message
    });
  }
});

/**
 * GET /api/heat-map/complaint/:id
 * Get specific complaint details for popup
 */
router.get('/complaint/:id', async (req, res) => {
  try {
    const complaintId = req.params.id;
    console.log(` Complaint details requested for ID: ${complaintId}`);
    
    // This would fetch detailed complaint info from database
    // For now, return basic info
    res.json({
      success: true,
      data: {
        id: complaintId,
        message: 'Detailed complaint view not yet implemented',
        // TODO: Implement detailed complaint fetching
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(' Complaint details error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch complaint details',
      message: error.message
    });
  }
});

module.exports = router;

