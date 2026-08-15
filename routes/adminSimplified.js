const express = require('express');
const router = express.Router();

// Simplified admin routes that work with current database structure
router.get('/dashboard/overview', async (req, res) => {
  try {
    const supabase = req.app.get('supabase');

    // Get basic statistics that we know work
    const { data: complaints, error: complaintsError } = await supabase
      .from('complaints')
      .select('id, status, priority_score, category, created_at');

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, created_at')
      .limit(100);

    if (complaintsError || usersError) {
      console.error('Dashboard data error:', { complaintsError, usersError });
    }

    // Calculate overview stats
    const totalComplaints = complaints?.length || 0;
    const resolvedComplaints = complaints?.filter(c => c.status === 'resolved').length || 0;
    const pendingComplaints = complaints?.filter(c => c.status === 'pending').length || 0;
    const inProgressComplaints = complaints?.filter(c => c.status === 'in_progress').length || 0;
    
    // High priority complaints (score >= 7)
    const highPriorityComplaints = complaints?.filter(c => (c.priority_score || 0) >= 7).length || 0;

    // Recent complaints (last 7 days)
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const recentComplaints = complaints?.filter(c => 
      new Date(c.created_at) >= weekAgo
    ).length || 0;

    // Category breakdown
    const categoryStats = {};
    complaints?.forEach(complaint => {
      const category = complaint.category || 'other';
      categoryStats[category] = (categoryStats[category] || 0) + 1;
    });

    const dashboardData = {
      overview: {
        totalComplaints,
        resolvedComplaints,
        pendingComplaints,
        inProgressComplaints,
        highPriorityComplaints,
        recentComplaints,
        totalUsers: users?.length || 0,
        resolutionRate: totalComplaints > 0 ? Math.round((resolvedComplaints / totalComplaints) * 100) : 0
      },
      topPriorityComplaints: complaints
        ?.filter(c => c.priority_score)
        ?.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
        ?.slice(0, 5) || [],
      locationHotspots: [],
      recentActivity: complaints
        ?.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        ?.slice(0, 10) || [],
      stageProgress: {
        pending: pendingComplaints,
        in_progress: inProgressComplaints,
        resolved: resolvedComplaints
      },
      costAnalysis: {
        totalEstimatedCost: 0,
        completedCost: 0,
        pendingCost: 0
      },
      categoryStats
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

// Simplified priority queue
router.get('/complaints/priority-queue', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, status } = req.query;
    const offset = (page - 1) * limit;
    const supabase = req.app.get('supabase');

    let query = supabase
      .from('complaints')
      .select(`
        id,
        title,
        description,
        category,
        status,
        priority_score,
        location_address,
        created_at,
        updated_at,
        user_id
      `);

    // Apply filters
    if (search) {
      query = query.or(`title.ilike.%${search}%,location_address.ilike.%${search}%`);
    }
    
    if (category) {
      query = query.eq('category', category);
    }
    
    if (status) {
      query = query.eq('status', status);
    }

    query = query.order('priority_score', { ascending: false })
                 .order('created_at', { ascending: false })
                 .range(offset, offset + limit - 1);

    const { data: complaints, error } = await query;

    if (error) {
      console.error('Priority queue query error:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    // Get user details for each complaint
    const complaintsWithUsers = [];
    if (complaints) {
      for (const complaint of complaints) {
        const { data: user } = await supabase
          .from('users')
          .select('full_name, email')
          .eq('id', complaint.user_id)
          .single();
        
        complaintsWithUsers.push({
          ...complaint,
          users: user || { full_name: 'Unknown User', email: 'unknown@example.com' }
        });
      }
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('complaints')
      .select('id', { count: 'exact', head: true });

    if (search) {
      countQuery = countQuery.or(`title.ilike.%${search}%,location_address.ilike.%${search}%`);
    }
    if (category) countQuery = countQuery.eq('category', category);
    if (status) countQuery = countQuery.eq('status', status);

    const { count } = await countQuery;
    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: {
        complaints: complaintsWithUsers,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages,
          totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1
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

// Simplified citizens endpoint
router.get('/citizens', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, sort = 'recent' } = req.query;
    const offset = (page - 1) * limit;
    const supabase = req.app.get('supabase');

    let query = supabase
      .from('users')
      .select('id, full_name, email, phone_number, created_at');

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    // Apply sorting
    if (sort === 'name') {
      query = query.order('full_name', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    query = query.range(offset, offset + limit - 1);

    const { data: citizens, error } = await query;

    if (error) {
      console.error('Citizens query error:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    // Get complaint counts for each citizen
    const citizensWithStats = [];
    if (citizens) {
      for (const citizen of citizens) {
        const { data: complaints } = await supabase
          .from('complaints')
          .select('id, status, created_at')
          .eq('user_id', citizen.id);
        
        const complaintsCount = complaints?.length || 0;
        const resolvedComplaints = complaints?.filter(c => c.status === 'resolved').length || 0;
        const lastComplaintDate = complaints?.length > 0 
          ? Math.max(...complaints.map(c => new Date(c.created_at).getTime()))
          : null;

        citizensWithStats.push({
          ...citizen,
          complaints_count: complaintsCount,
          resolved_complaints: resolvedComplaints,
          last_complaint_date: lastComplaintDate ? new Date(lastComplaintDate).toISOString() : null,
          status: 'active', // Default status
          reputation_score: Math.min(complaintsCount * 10 + resolvedComplaints * 5, 100) // Simple calculation
        });
      }
    }

    // Get total count for pagination
    let countQuery = supabase
      .from('users')
      .select('id', { count: 'exact', head: true });

    if (search) {
      countQuery = countQuery.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    const { count } = await countQuery;
    const totalCount = count || 0;
    const totalPages = Math.ceil(totalCount / limit);

    res.json({
      success: true,
      data: {
        citizens: citizensWithStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages,
          totalCount,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('Citizens error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch citizens'
    });
  }
});

// Get citizen details
router.get('/citizens/:id/details', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = req.app.get('supabase');

    // Get citizen data
    const { data: citizen, error: citizenError } = await supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .single();

    if (citizenError || !citizen) {
      return res.status(404).json({
        success: false,
        message: 'Citizen not found'
      });
    }

    // Get citizen's complaints
    const { data: complaints, error: complaintsError } = await supabase
      .from('complaints')
      .select('*')
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    if (complaintsError) {
      console.error('Complaints query error:', complaintsError);
    }

    const resolvedComplaints = complaints?.filter(c => c.status === 'resolved').length || 0;

    const citizenDetails = {
      ...citizen,
      status: 'active',
      complaints: complaints || [],
      resolved_complaints: resolvedComplaints,
      votes_count: 0, // Placeholder
      reputation_score: Math.min((complaints?.length || 0) * 10 + resolvedComplaints * 5, 100)
    };

    res.json({
      success: true,
      data: citizenDetails
    });

  } catch (error) {
    console.error('Citizen details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch citizen details'
    });
  }
});

// Update citizen status
router.put('/citizens/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    // For now, just return success since we don't have a status field in users table
    res.json({
      success: true,
      data: { message: `Citizen status would be updated to ${status}` }
    });

  } catch (error) {
    console.error('Update citizen status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update citizen status'
    });
  }
});

// Get complaint details
router.get('/complaints/:id/details', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = req.app.get('supabase');

    // Get complaint data
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('*')
      .eq('id', id)
      .single();

    if (complaintError || !complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Get user data
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('full_name, email, phone_number')
      .eq('id', complaint.user_id)
      .single();

    const complaintDetails = {
      ...complaint,
      users: user || { full_name: 'Unknown User', email: 'unknown@example.com' },
      complaint_stages: [], // Placeholder for stages
    };

    res.json({
      success: true,
      data: complaintDetails
    });

  } catch (error) {
    console.error('Complaint details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaint details'
    });
  }
});

// Update complaint status
router.put('/complaints/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const supabase = req.app.get('supabase');

    const { data, error } = await supabase
      .from('complaints')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update complaint status error:', error);
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error('Update complaint status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update complaint status'
    });
  }
});

// Placeholder routes for officers and contractors
router.get('/officers', (req, res) => {
  res.json({
    success: true,
    data: [
      { id: 1, name: 'John Smith', department: 'Public Works', status: 'active' },
      { id: 2, name: 'Sarah Johnson', department: 'Infrastructure', status: 'active' }
    ]
  });
});

router.get('/contractors', (req, res) => {
  res.json({
    success: true,
    data: [
      { id: 1, name: 'ABC Construction Ltd', specialization: 'Road Repair', status: 'active' },
      { id: 2, name: 'Quick Fix Services', specialization: 'Streetlight Maintenance', status: 'active' }
    ]
  });
});

module.exports = router;
