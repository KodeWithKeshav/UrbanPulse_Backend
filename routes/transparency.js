const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

/**
 * Get comprehensive transparency dashboard data
 * GET /api/transparency/dashboard
 */
router.get('/dashboard', async (req, res) => {
  try {
    console.log('🏛️ Transparency dashboard data requested');
    
    // Get all complaints with detailed information
    const { data: complaints, error: complaintsError } = await supabase
      .from('complaints')
      .select('id, status, category, created_at, resolved_at, priority_score, vote_count')
      .order('created_at', { ascending: false });
    
    if (complaintsError) {
      throw new Error(complaintsError.message);
    }
    
    // Calculate basic statistics
    const totalComplaints = complaints.length;
    const resolvedComplaints = complaints.filter(c => 
      c.status?.toLowerCase() === 'resolved' || 
      c.status?.toLowerCase() === 'completed'
    ).length;
    const pendingComplaints = complaints.filter(c => 
      c.status?.toLowerCase() === 'pending'
    ).length;
    const inProgressComplaints = complaints.filter(c => 
      c.status?.toLowerCase() === 'in_progress'
    ).length;
    
    const resolutionRate = totalComplaints > 0 ? 
      Math.round((resolvedComplaints / totalComplaints) * 100) : 0;
    
    // Calculate category statistics
    const categoryStats = calculateCategoryStats(complaints);
    
    // Calculate monthly data for the last 9 months
    const monthlyData = calculateMonthlyData(complaints);
    
    // Calculate impact statistics
    const impactStats = calculateImpactStats(complaints);
    
    // Calculate average resolution time
    const avgResolutionTime = calculateAvgResolutionTime(complaints);
    
    // Calculate voting statistics
    const votingStats = calculateVotingStats(complaints);
    
    const dashboardData = {
      success: true,
      data: {
        // Basic statistics
        totalComplaints,
        resolvedComplaints,
        pendingComplaints,
        inProgressComplaints,
        resolutionRate,
        avgResolutionTime,
        
        // Category breakdown
        categoryStats,
        
        // Monthly trends
        monthlyData,
        
        // Impact metrics
        impactStats,
        
        // Voting engagement
        votingStats,
        
        // Metadata
        lastUpdated: new Date().toISOString(),
        dataRange: {
          from: complaints.length > 0 ? new Date(Math.min(...complaints.map(c => new Date(c.created_at)))).toISOString() : null,
          to: new Date().toISOString()
        }
      }
    };
    
    console.log('📊 Transparency data calculated:', {
      totalComplaints,
      resolutionRate,
      categoriesCount: categoryStats.length
    });
    
    res.json(dashboardData);
    
  } catch (error) {
    console.error('Transparency dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transparency data',
      error: error.message
    });
  }
});

/**
 * Calculate category statistics
 */
function calculateCategoryStats(complaints) {
  const categoryMap = {};
  
  complaints.forEach(complaint => {
    const category = complaint.category || 'others';
    if (!categoryMap[category]) {
      categoryMap[category] = {
        total: 0,
        resolved: 0,
        pending: 0,
        inProgress: 0
      };
    }
    
    categoryMap[category].total++;
    
    const status = complaint.status?.toLowerCase();
    if (status === 'resolved' || status === 'completed') {
      categoryMap[category].resolved++;
    } else if (status === 'pending') {
      categoryMap[category].pending++;
    } else if (status === 'in_progress') {
      categoryMap[category].inProgress++;
    }
  });
  
  // Convert to array with readable names
  const categoryNames = {
    'pothole': 'Road Damage',
    'broken_streetlight': 'Streetlights',
    'garbage_collection': 'Garbage',
    'water_leakage': 'Water Issues',
    'sewage_overflow': 'Sewage',
    'traffic_signal': 'Traffic',
    'electrical_danger': 'Power',
    'noise_complaint': 'Noise',
    'illegal_parking': 'Parking',
    'others': 'Others'
  };
  
  return Object.entries(categoryMap).map(([key, stats]) => ({
    name: categoryNames[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    ...stats,
    resolutionRate: stats.total > 0 ? Math.round((stats.resolved / stats.total) * 100) : 0
  })).sort((a, b) => b.total - a.total);
}

/**
 * Calculate monthly data for trends
 */
function calculateMonthlyData(complaints) {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const monthlyMap = {};
  const currentDate = new Date();
  
  // Initialize last 9 months
  for (let i = 8; i >= 0; i--) {
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - i, 1);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const monthName = monthNames[date.getMonth()];
    
    monthlyMap[monthKey] = {
      month: monthName,
      total: 0,
      resolved: 0
    };
  }
  
  // Count complaints by month
  complaints.forEach(complaint => {
    const date = new Date(complaint.created_at);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    if (monthlyMap[monthKey]) {
      monthlyMap[monthKey].total++;
      
      if (complaint.status?.toLowerCase() === 'resolved' || 
          complaint.status?.toLowerCase() === 'completed') {
        monthlyMap[monthKey].resolved++;
      }
    }
  });
  
  return Object.values(monthlyMap);
}

/**
 * Calculate impact statistics
 */
function calculateImpactStats(complaints) {
  // Estimate people impacted based on complaint type and vote count
  let totalPeopleImpacted = 0;
  let highPriorityIssues = 0;
  let communityEngagement = 0;
  
  complaints.forEach(complaint => {
    const voteCount = complaint.vote_count || 0;
    const priorityScore = complaint.priority_score || 0;
    
    // Estimate impact based on category
    let impactMultiplier = 1;
    const category = complaint.category?.toLowerCase();
    
    if (category?.includes('road') || category?.includes('pothole')) {
      impactMultiplier = 50; // Roads affect many people
    } else if (category?.includes('water') || category?.includes('sewage')) {
      impactMultiplier = 30; // Water issues affect neighborhoods
    } else if (category?.includes('garbage')) {
      impactMultiplier = 20; // Garbage affects local areas
    } else if (category?.includes('streetlight')) {
      impactMultiplier = 15; // Streetlights affect smaller areas
    } else {
      impactMultiplier = 10; // Other issues
    }
    
    // Calculate estimated people impacted (base + votes * multiplier)
    const estimatedImpact = Math.max(impactMultiplier, (voteCount + 1) * impactMultiplier);
    totalPeopleImpacted += estimatedImpact;
    
    // Count high priority issues
    if (priorityScore >= 8 || voteCount >= 5) {
      highPriorityIssues++;
    }
    
    // Community engagement (total votes)
    communityEngagement += voteCount;
  });
  
  return {
    peopleImpacted: Math.min(totalPeopleImpacted, 50000), // Cap at reasonable number
    highPriorityIssues,
    communityEngagement,
    avgVotesPerComplaint: complaints.length > 0 ? 
      Math.round(communityEngagement / complaints.length * 10) / 10 : 0
  };
}

/**
 * Calculate average resolution time
 */
function calculateAvgResolutionTime(complaints) {
  const resolvedComplaints = complaints.filter(c => 
    (c.status?.toLowerCase() === 'resolved' || c.status?.toLowerCase() === 'completed') &&
    c.created_at && c.resolved_at
  );
  
  if (resolvedComplaints.length === 0) {
    return 0;
  }
  
  const totalDays = resolvedComplaints.reduce((sum, complaint) => {
    const created = new Date(complaint.created_at);
    const resolved = new Date(complaint.resolved_at);
    const days = Math.round((resolved - created) / (1000 * 60 * 60 * 24));
    return sum + Math.max(0, days); // Ensure non-negative
  }, 0);
  
  return Math.round(totalDays / resolvedComplaints.length);
}

/**
 * Calculate voting statistics
 */
function calculateVotingStats(complaints) {
  const totalVotes = complaints.reduce((sum, c) => sum + (c.vote_count || 0), 0);
  const complaintsWithVotes = complaints.filter(c => (c.vote_count || 0) > 0).length;
  const highEngagementComplaints = complaints.filter(c => (c.vote_count || 0) >= 5).length;
  
  return {
    totalVotes,
    complaintsWithVotes,
    highEngagementComplaints,
    engagementRate: complaints.length > 0 ? 
      Math.round((complaintsWithVotes / complaints.length) * 100) : 0
  };
}

module.exports = router;
