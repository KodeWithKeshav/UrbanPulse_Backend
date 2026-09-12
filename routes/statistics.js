const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

/**
 * Get detailed statistics breakdown for debugging
 * GET /api/statistics/debug
 */
router.get('/debug', async (req, res) => {
  try {
    console.log('🔍 Debug statistics request');
    
    const { data, error } = await supabase
      .from('complaints')
      .select('id, status, title')
      .order('created_at', { ascending: false });
    
    if (error) {
      throw new Error(error.message);
    }
    
    // Count status occurrences
    const statusCounts = {};
    const statusDetails = {};
    
    data.forEach(complaint => {
      const status = complaint.status || 'null';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      
      if (!statusDetails[status]) {
        statusDetails[status] = [];
      }
      statusDetails[status].push({
        id: complaint.id?.substring(0, 8),
        title: complaint.title?.substring(0, 30)
      });
    });
    
    console.log('📊 Status breakdown:', statusCounts);
    
    res.json({
      success: true,
      total: data.length,
      statusCounts,
      statusDetails,
      frontendFiltering: {
        pending: data.filter(c => c.status?.toLowerCase() === 'pending').length,
        inProgress: data.filter(c => c.status?.toLowerCase() === 'in_progress').length,
        resolved: data.filter(c => c.status?.toLowerCase() === 'completed' || c.status?.toLowerCase() === 'resolved').length
      }
    });
  } catch (error) {
    console.error('Debug statistics error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get basic statistics summary
 * GET /api/statistics/summary
 */
router.get('/summary', async (req, res) => {
  try {
    console.log('📊 Getting statistics summary');
    
    const { data, error } = await supabase
      .from('complaints')
      .select('status')
      .order('created_at', { ascending: false });
    
    if (error) {
      throw new Error(error.message);
    }
    
    const pending = data.filter(c => c.status?.toLowerCase() === 'pending').length;
    const inProgress = data.filter(c => c.status?.toLowerCase() === 'in_progress').length;
    const resolved = data.filter(c => c.status?.toLowerCase() === 'completed' || c.status?.toLowerCase() === 'resolved').length;
    
    res.json({
      success: true,
      total: data.length,
      pending,
      inProgress,
      resolved
    });
  } catch (error) {
    console.error('Statistics summary error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

module.exports = router;
