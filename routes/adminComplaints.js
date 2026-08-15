const express = require('express');
const router = express.Router();

/**
 * Update complaint status
 * PUT /api/admin/complaints/:id/status
 */
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, adminId } = req.body;
    
    console.log(`🔄 Admin updating complaint ${id} status to: ${status}`);
    
    // Validate input
    if (!id || !status) {
      return res.status(400).json({
        success: false,
        error: 'Complaint ID and status are required'
      });
    }
    
    // Validate status value
    const validStatuses = ['pending', 'in_progress', 'resolved', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid status value. Must be one of: pending, in_progress, resolved, rejected'
      });
    }
    
    const supabase = req.app.get('supabase');
    
    // Update complaint status
    const updateData = {
      status,
      updated_at: new Date().toISOString(),
      resolution_notes: notes,
      assigned_admin_id: adminId
    };
    
    // If status is resolved, add resolved_at timestamp
    if (status === 'resolved') {
      updateData.resolved_at = new Date().toISOString();
    }
    
    const { data, error } = await supabase
      .from('complaints')
      .update(updateData)
      .eq('id', id)
      .select();
    
    if (error) {
      console.error('❌ Error updating complaint status:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to update complaint status',
        details: error.message
      });
    }
    
    if (!data || data.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Complaint not found'
      });
    }
    
    console.log(`✅ Complaint ${id} status updated to ${status}`);
    
    // Return updated complaint
    res.json({
      success: true,
      message: `Complaint status updated to ${status}`,
      data: data[0]
    });
    
  } catch (error) {
    console.error('❌ Admin update complaint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update complaint status',
      details: error.message
    });
  }
});

/**
 * Get all complaints for admin dashboard
 * GET /api/admin/complaints
 */
router.get('/', async (req, res) => {
  try {
    console.log('📋 Admin fetching all complaints');
    
    // Query parameters for filtering
    const { status, priority, category, days } = req.query;
    
    const supabase = req.app.get('supabase');
    let query = supabase.from('complaints').select('*');
    
    // Apply filters if provided
    if (status) {
      query = query.eq('status', status);
    }
    
    if (priority) {
      // Convert priority level (LOW, MEDIUM, HIGH, CRITICAL) to score ranges
      // This assumes priority_score is a number between 0-100
      const priorityRanges = {
        LOW: [0, 40],
        MEDIUM: [41, 60],
        HIGH: [61, 80],
        CRITICAL: [81, 100]
      };
      
      const range = priorityRanges[priority.toUpperCase()];
      if (range) {
        query = query.gte('priority_score', range[0]).lte('priority_score', range[1]);
      }
    }
    
    if (category) {
      query = query.eq('category', category);
    }
    
    if (days) {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(days));
      query = query.gte('created_at', daysAgo.toISOString());
    }
    
    // Order by priority score (highest first) and created date (newest first)
    query = query.order('priority_score', { ascending: false }).order('created_at', { ascending: false });
    
    const { data, error } = await query;
    
    if (error) {
      console.error('❌ Error fetching complaints:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch complaints',
        details: error.message
      });
    }
    
    console.log(`✅ Fetched ${data?.length || 0} complaints for admin dashboard`);
    
    // Calculate statistics
    const statistics = calculateComplaintStatistics(data || []);
    
    res.json({
      success: true,
      data: data || [],
      count: data?.length || 0,
      statistics
    });
    
  } catch (error) {
    console.error('❌ Admin fetch complaints error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch complaints',
      details: error.message
    });
  }
});

/**
 * Calculate complaint statistics for admin dashboard
 */
function calculateComplaintStatistics(complaints) {
  const total = complaints.length;
  
  // Count by status
  const byStatus = complaints.reduce((acc, complaint) => {
    const status = complaint.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  
  // Calculate resolution rate
  const resolved = byStatus.resolved || 0;
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
  
  // Calculate average resolution time (in days)
  const resolvedComplaints = complaints.filter(c => c.status === 'resolved' && c.created_at && c.resolved_at);
  let avgResolutionDays = 0;
  
  if (resolvedComplaints.length > 0) {
    const totalDays = resolvedComplaints.reduce((total, complaint) => {
      const created = new Date(complaint.created_at);
      const resolved = new Date(complaint.resolved_at);
      const days = Math.round((resolved - created) / (1000 * 60 * 60 * 24));
      return total + days;
    }, 0);
    
    avgResolutionDays = Math.round(totalDays / resolvedComplaints.length);
  }
  
  // Count by category
  const byCategory = complaints.reduce((acc, complaint) => {
    const category = complaint.category || 'uncategorized';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});
  
  // Get top categories
  const topCategories = Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([category, count]) => ({ category, count }));
  
  return {
    total,
    byStatus,
    resolved,
    pending: byStatus.pending || 0,
    inProgress: byStatus.in_progress || 0,
    rejected: byStatus.rejected || 0,
    resolutionRate,
    avgResolutionDays,
    byCategory,
    topCategories
  };
}

/**
 * Get complaint details
 * GET /api/admin/complaints/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`📋 Admin fetching complaint details for ID: ${id}`);
    
    const supabase = req.app.get('supabase');
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
      console.error('❌ Error fetching complaint details:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch complaint details',
        details: error.message
      });
    }
    
    if (!data) {
      return res.status(404).json({
        success: false,
        error: 'Complaint not found'
      });
    }
    
    console.log(`✅ Fetched details for complaint ${id}`);
    
    res.json({
      success: true,
      data
    });
    
  } catch (error) {
    console.error('❌ Admin fetch complaint details error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch complaint details',
      details: error.message
    });
  }
});

module.exports = router;
