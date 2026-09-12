const express = require('express');
const router = express.Router();

// Import admin complaint routes
const adminComplaintsRouter = require('./adminComplaints');

// Mount admin complaint routes
router.use('/complaints', adminComplaintsRouter);

// Admin dashboard route
router.get('/dashboard', async (req, res) => {
  try {
    console.log('📊 Admin dashboard data requested');
    const supabase = req.app.get('supabase');
    
    // Get complaint statistics
    const { data: complaints, error: complaintsError } = await supabase
      .from('complaints')
      .select('id, status, priority_score, created_at, resolved_at, category');
    
    // Get user statistics
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, user_type')
      .limit(1000);
    
    if (complaintsError) {
      console.log('❌ Error fetching complaints:', complaintsError);
    }
    
    if (usersError) {
      console.log('❌ Error fetching users:', usersError);
    }
    
    // Calculate dashboard statistics
    const complaintStats = calculateComplaintStatistics(complaints || []);
    const userStats = calculateUserStatistics(users || []);
    
    res.json({
      success: true,
      message: 'Admin dashboard data',
      data: {
        complaints: complaintStats,
        users: userStats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      details: error.message
    });
  }
});

// Helper function to calculate complaint statistics
function calculateComplaintStatistics(complaints) {
  const total = complaints.length;
  const pending = complaints.filter(c => c.status === 'pending').length;
  const inProgress = complaints.filter(c => c.status === 'in_progress').length;
  const resolved = complaints.filter(c => c.status === 'resolved').length;
  
  // Resolution rate
  const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : 0;
  
  // Average resolution time
  const resolvedComplaints = complaints.filter(c => c.status === 'resolved' && c.created_at && c.resolved_at);
  let avgResolutionDays = 0;
  
  if (resolvedComplaints.length > 0) {
    const totalDays = resolvedComplaints.reduce((sum, c) => {
      const created = new Date(c.created_at);
      const resolved = new Date(c.resolved_at);
      return sum + Math.round((resolved - created) / (1000 * 60 * 60 * 24));
    }, 0);
    avgResolutionDays = Math.round(totalDays / resolvedComplaints.length);
  }
  
  return {
    total,
    pending,
    inProgress,
    resolved,
    resolutionRate,
    avgResolutionDays
  };
}

// Helper function to calculate user statistics
function calculateUserStatistics(users) {
  const total = users.length;
  const citizens = users.filter(u => u.user_type === 'citizen').length;
  const admins = users.filter(u => u.user_type === 'admin').length;
  
  return {
    total,
    citizens,
    admins
  };
}

module.exports = router;
