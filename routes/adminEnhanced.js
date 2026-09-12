const express = require('express');
const router = express.Router();

// ============================================================================
// ENHANCED ADMIN DASHBOARD ROUTES
// ============================================================================

// Get comprehensive dashboard overview
router.get('/dashboard/overview', async (req, res) => {
  try {
    console.log('📊 Loading comprehensive admin dashboard...');
    const supabase = req.app.get('supabase');
    
    // Get complaint statistics with stages
    const { data: complaints, error: complaintsError } = await supabase
      .from('complaints')
      .select(`
        *,
        complaint_stages (
          stage_number,
          stage_name,
          stage_status,
          completed_at
        ),
        users (
          full_name,
          email
        )
      `);
    
    // Get user statistics
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, user_type, created_at, is_active')
      .limit(1000);
    
    // Get top priority complaints
    const { data: priorityComplaints, error: priorityError } = await supabase
      .from('complaints')
      .select(`
        *,
        users (full_name, email),
        complaint_stages (
          stage_number,
          stage_name,
          stage_status
        )
      `)
      .order('priority_score', { ascending: false })
      .limit(10);
    
    // Get location-based hotspots
    const { data: locationHotspots, error: locationError } = await supabase
      .rpc('get_location_hotspots', { radius_km: 1, min_complaints: 2 });
    
    if (complaintsError || usersError || priorityError) {
      console.error('Dashboard data error:', {
        complaintsError,
        usersError,
        priorityError,
        locationError
      });
    }
    
    const dashboardData = {
      overview: calculateDashboardOverview(complaints || [], users || []),
      topPriorityComplaints: priorityComplaints || [],
      locationHotspots: locationHotspots || [],
      recentActivity: await getRecentActivity(supabase),
      stageProgress: calculateStageProgress(complaints || []),
      costAnalysis: calculateCostAnalysis(complaints || [])
    };
    
    res.json({
      success: true,
      data: dashboardData
    });
    
  } catch (error) {
    console.error('Dashboard overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load dashboard overview'
    });
  }
});

// Get priority queue with search and filtering
router.get('/complaints/priority-queue', async (req, res) => {
  try {
    const { search, location, category, status, page = 1, limit = 20 } = req.query;
    const supabase = req.app.get('supabase');
    
    let query = supabase
      .from('complaints')
      .select(`
        *,
        users (full_name, email, phone_number),
        complaint_stages (
          stage_number,
          stage_name,
          stage_status,
          assigned_officer_id,
          assigned_contractor_id,
          started_at,
          expected_completion,
          officers (name, department),
          contractors (name, company_name)
        )
      `);
    
    // Apply filters
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,location_address.ilike.%${search}%`);
    }
    
    if (location) {
      query = query.ilike('location_address', `%${location}%`);
    }
    
    if (category) {
      query = query.eq('category', category);
    }
    
    if (status) {
      query = query.eq('status', status);
    }
    
    // Order by priority score and creation date
    query = query.order('priority_score', { ascending: false })
                 .order('created_at', { ascending: true });
    
    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);
    
    const { data: complaints, error, count } = await query;
    
    if (error) {
      console.error('Priority queue error:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    res.json({
      success: true,
      data: {
        complaints: complaints || [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      }
    });
    
  } catch (error) {
    console.error('Priority queue error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch priority queue'
    });
  }
});

// Get citizen management data
router.get('/citizens', async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const supabase = req.app.get('supabase');
    
    let query = supabase
      .from('users')
      .select(`
        *,
        complaints (
          id,
          title,
          status,
          priority_score,
          created_at
        )
      `)
      .eq('user_type', 'citizen');
    
    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone_number.ilike.%${search}%`);
    }
    
    query = query.order('created_at', { ascending: false });
    
    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);
    
    const { data: citizens, error, count } = await query;
    
    if (error) {
      console.error('Citizens fetch error:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    
    res.json({
      success: true,
      data: {
        citizens: citizens || [],
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          totalPages: Math.ceil(count / limit)
        }
      }
    });
    
  } catch (error) {
    console.error('Citizens management error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch citizens data'
    });
  }
});

// Update complaint stage
router.put('/complaints/:complaintId/stages/:stageId', async (req, res) => {
  try {
    const { complaintId, stageId } = req.params;
    const { 
      stage_status,
      assigned_officer_id,
      assigned_contractor_id,
      admin_notes,
      estimated_cost,
      expected_completion 
    } = req.body;
    
    const supabase = req.app.get('supabase');
    
    // Update the stage
    const { data: updatedStage, error: stageError } = await supabase
      .from('complaint_stages')
      .update({
        stage_status,
        assigned_officer_id,
        assigned_contractor_id,
        admin_notes,
        estimated_cost,
        expected_completion,
        started_at: stage_status === 'in_progress' ? new Date().toISOString() : null,
        completed_at: stage_status === 'completed' ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', stageId)
      .eq('complaint_id', complaintId)
      .select();
    
    if (stageError) {
      console.error('Stage update error:', stageError);
      return res.status(400).json({
        success: false,
        message: stageError.message
      });
    }
    
    // Add timeline entry
    await supabase
      .from('complaint_timeline')
      .insert({
        complaint_id: complaintId,
        event_type: 'stage_update',
        event_title: `Stage Updated: ${updatedStage[0]?.stage_name}`,
        event_description: admin_notes || `Stage status changed to ${stage_status}`,
        performed_by: req.user?.id, // Assuming auth middleware provides user
        related_stage_id: stageId,
        metadata: {
          old_status: req.body.old_status,
          new_status: stage_status,
          officer_assigned: assigned_officer_id,
          contractor_assigned: assigned_contractor_id
        }
      });
    
    // Update complaint status and progress
    await updateComplaintProgress(supabase, complaintId);
    
    res.json({
      success: true,
      message: 'Stage updated successfully',
      data: updatedStage[0]
    });
    
  } catch (error) {
    console.error('Update stage error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update stage'
    });
  }
});

// Get complaint timeline and details
router.get('/complaints/:complaintId/details', async (req, res) => {
  try {
    const { complaintId } = req.params;
    const supabase = req.app.get('supabase');
    
    // Get complaint with all related data
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select(`
        *,
        users (full_name, email, phone_number),
        complaint_stages (
          *,
          officers (name, department, contact_phone),
          contractors (name, company_name, contact_phone, rating)
        ),
        complaint_timeline (*),
        complaint_costs (*)
      `)
      .eq('id', complaintId)
      .single();
    
    if (complaintError) {
      console.error('Complaint details error:', complaintError);
      return res.status(400).json({
        success: false,
        message: complaintError.message
      });
    }
    
    res.json({
      success: true,
      data: complaint
    });
    
  } catch (error) {
    console.error('Complaint details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaint details'
    });
  }
});

// Get officers and contractors for assignments
router.get('/personnel', async (req, res) => {
  try {
    const { type, department } = req.query;
    const supabase = req.app.get('supabase');
    
    let officers = [];
    let contractors = [];
    
    if (!type || type === 'officers') {
      let officersQuery = supabase
        .from('officers')
        .select('*')
        .eq('is_active', true);
      
      if (department) {
        officersQuery = officersQuery.eq('department', department);
      }
      
      const { data: officersData } = await officersQuery;
      officers = officersData || [];
    }
    
    if (!type || type === 'contractors') {
      const { data: contractorsData } = await supabase
        .from('contractors')
        .select('*')
        .eq('is_active', true)
        .order('rating', { ascending: false });
      
      contractors = contractorsData || [];
    }
    
    res.json({
      success: true,
      data: {
        officers,
        contractors
      }
    });
    
  } catch (error) {
    console.error('Personnel fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch personnel data'
    });
  }
});

// Delete/deactivate citizen
router.delete('/citizens/:citizenId', async (req, res) => {
  try {
    const { citizenId } = req.params;
    const { permanent = false } = req.query;
    const supabase = req.app.get('supabase');
    
    if (permanent === 'true') {
      // Permanent deletion
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', citizenId)
        .eq('user_type', 'citizen');
      
      if (error) {
        console.error('Citizen deletion error:', error);
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
    } else {
      // Soft deletion (deactivation)
      const { error } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', citizenId)
        .eq('user_type', 'citizen');
      
      if (error) {
        console.error('Citizen deactivation error:', error);
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
    }
    
    res.json({
      success: true,
      message: permanent ? 'Citizen deleted permanently' : 'Citizen deactivated successfully'
    });
    
  } catch (error) {
    console.error('Citizen management error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to manage citizen account'
    });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function calculateDashboardOverview(complaints, users) {
  const totalComplaints = complaints.length;
  const pendingComplaints = complaints.filter(c => c.status === 'pending').length;
  const inProgressComplaints = complaints.filter(c => c.status === 'in_progress').length;
  const resolvedComplaints = complaints.filter(c => c.status === 'resolved').length;
  
  const totalUsers = users.filter(u => u.user_type === 'citizen').length;
  const activeUsers = users.filter(u => u.user_type === 'citizen' && u.is_active).length;
  
  const avgResolutionTime = calculateAverageResolutionTime(complaints);
  const highPriorityComplaints = complaints.filter(c => c.priority_score > 7).length;
  
  return {
    totalComplaints,
    pendingComplaints,
    inProgressComplaints,
    resolvedComplaints,
    totalUsers,
    activeUsers,
    avgResolutionTime,
    highPriorityComplaints,
    resolutionRate: totalComplaints > 0 ? (resolvedComplaints / totalComplaints * 100).toFixed(1) : 0
  };
}

function calculateStageProgress(complaints) {
  const stageStats = {};
  
  complaints.forEach(complaint => {
    if (complaint.complaint_stages) {
      complaint.complaint_stages.forEach(stage => {
        if (!stageStats[stage.stage_name]) {
          stageStats[stage.stage_name] = {
            pending: 0,
            in_progress: 0,
            completed: 0,
            failed: 0
          };
        }
        stageStats[stage.stage_name][stage.stage_status]++;
      });
    }
  });
  
  return stageStats;
}

function calculateCostAnalysis(complaints) {
  let totalEstimated = 0;
  let totalActual = 0;
  
  complaints.forEach(complaint => {
    if (complaint.estimated_cost) {
      totalEstimated += parseFloat(complaint.estimated_cost);
    }
    if (complaint.actual_cost) {
      totalActual += parseFloat(complaint.actual_cost);
    }
  });
  
  return {
    totalEstimated,
    totalActual,
    costVariance: totalEstimated > 0 ? ((totalActual - totalEstimated) / totalEstimated * 100).toFixed(1) : 0
  };
}

function calculateAverageResolutionTime(complaints) {
  const resolvedComplaints = complaints.filter(c => c.status === 'resolved' && c.resolved_at);
  
  if (resolvedComplaints.length === 0) return 0;
  
  const totalTime = resolvedComplaints.reduce((sum, complaint) => {
    const created = new Date(complaint.created_at);
    const resolved = new Date(complaint.resolved_at);
    return sum + (resolved - created);
  }, 0);
  
  const avgMilliseconds = totalTime / resolvedComplaints.length;
  return Math.round(avgMilliseconds / (1000 * 60 * 60)); // Convert to hours
}

async function getRecentActivity(supabase) {
  const { data } = await supabase
    .from('complaint_timeline')
    .select(`
      *,
      complaints (title),
      users (full_name)
    `)
    .order('created_at', { ascending: false })
    .limit(10);
  
  return data || [];
}

async function updateComplaintProgress(supabase, complaintId) {
  // Get all stages for this complaint
  const { data: stages } = await supabase
    .from('complaint_stages')
    .select('*')
    .eq('complaint_id', complaintId)
    .order('stage_number');
  
  if (!stages || stages.length === 0) return;
  
  const totalStages = stages.length;
  const completedStages = stages.filter(s => s.stage_status === 'completed').length;
  const currentStage = stages.find(s => s.stage_status === 'in_progress') || stages.find(s => s.stage_status === 'pending');
  
  // Determine overall complaint status
  let overallStatus = 'pending';
  if (completedStages === totalStages) {
    overallStatus = 'resolved';
  } else if (completedStages > 0 || stages.some(s => s.stage_status === 'in_progress')) {
    overallStatus = 'in_progress';
  }
  
  // Update complaint
  await supabase
    .from('complaints')
    .update({
      status: overallStatus,
      current_stage_id: currentStage?.id,
      completed_stages: completedStages,
      total_stages: totalStages,
      resolved_at: overallStatus === 'resolved' ? new Date().toISOString() : null
    })
    .eq('id', complaintId);
}

module.exports = router;
