const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { authenticateUser, authorizeUserType } = require('../middleware/auth');

// Get complaint by ID with detailed information
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;

    // Get the main complaint with location details
    let { data: complaint, error } = await supabase
      .from('complaints')
      .select(`
        *,
        users:user_id (id, full_name, email)
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching complaint:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error fetching complaint details', 
        error: error.message 
      });
    }

    if (!complaint) {
      return res.status(404).json({ 
        success: false, 
        message: 'Complaint not found' 
      });
    }

    // Check if current user has voted for this complaint
    let userVoted = false;
    if (userId) {
      const { data: votes, error: votesError } = await supabase
        .from('complaint_votes')
        .select('*')
        .eq('complaint_id', id)
        .eq('user_id', userId)
        .single();

      if (!votesError && votes) {
        userVoted = true;
      }
    }

    // Get complaint vote count
    const { data: voteCount, error: voteCountError } = await supabase
      .from('complaint_votes')
      .select('id', { count: 'exact' })
      .eq('complaint_id', id);

    if (voteCountError) {
      console.error('Error fetching vote count:', voteCountError);
    }

    // Get complaint updates
    const { data: updates, error: updatesError } = await supabase
      .from('complaint_updates')
      .select('*')
      .eq('complaint_id', id)
      .order('created_at', { ascending: true });

    if (updatesError) {
      console.error('Error fetching complaint updates:', updatesError);
    }

    // Get similar complaints nearby (within 500m)
    let similarComplaints = [];
    if (complaint.location_latitude && complaint.location_longitude) {
      // Try using stored procedure first
      try {
        const { data: nearby, error: nearbyError } = await supabase.rpc(
          'find_complaints_within_distance',
          {
            origin_lat: complaint.location_latitude,
            origin_lng: complaint.location_longitude,
            distance_meters: 500,
            max_results: 5,
            exclude_id: id
          }
        );

        if (!nearbyError && nearby) {
          similarComplaints = nearby.map(item => ({
            id: item.id,
            title: item.title,
            status: item.status,
            image_urls: item.image_urls,
            distance: Math.round(item.distance) // Round to nearest meter
          }));
        } else {
          // Fallback to manual query if RPC fails
          console.log('Falling back to manual nearby query');
          const { data: manualNearby, error: manualError } = await supabase
            .from('complaints')
            .select('id, title, status, image_urls, location_latitude, location_longitude')
            .neq('id', id)
            .filter('location_latitude', 'not.is', null)
            .filter('location_longitude', 'not.is', null)
            .limit(5);
            
          if (!manualError && manualNearby) {
            // Calculate distances manually
            similarComplaints = manualNearby
              .map(item => {
                const distance = calculateDistance(
                  complaint.location_latitude,
                  complaint.location_longitude,
                  item.location_latitude,
                  item.location_longitude
                );
                return {
                  ...item,
                  distance: Math.round(distance * 1000) // Convert km to meters and round
                };
              })
              .filter(item => item.distance <= 500) // Only include items within 500m
              .sort((a, b) => a.distance - b.distance); // Sort by distance
          }
        }
      } catch (nearbyErr) {
        console.error('Error fetching nearby complaints:', nearbyErr);
      }
    }

    // Combine all data
    const completeComplaint = {
      ...complaint,
      userVoted,
      vote_count: voteCount?.length || 0,
      updates: updates || [],
      similarComplaints
    };

    return res.status(200).json({ 
      success: true, 
      complaint: completeComplaint 
    });
  } catch (error) {
    console.error('❌ Error in complaint details API:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// Vote on a complaint
router.post('/vote', authenticateUser, async (req, res) => {
  try {
    const { complaintId, voteType } = req.body;
    const userId = req.user.id;

    if (!complaintId || !voteType) {
      return res.status(400).json({
        success: false,
        message: 'Complaint ID and vote type are required'
      });
    }

    // Check if complaint exists
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('id')
      .eq('id', complaintId)
      .single();

    if (complaintError || !complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Check if user has already voted
    const { data: existingVote, error: voteError } = await supabase
      .from('complaint_votes')
      .select('id')
      .eq('complaint_id', complaintId)
      .eq('user_id', userId)
      .single();

    // Handle upvote (add vote) or downvote (change vote type)
    if (voteType === 'upvote' && !existingVote) {
      // Add new vote
      const { data, error } = await supabase
        .from('complaint_votes')
        .insert({
          complaint_id: complaintId,
          user_id: userId,
          vote_type: 'upvote', // Include vote_type to satisfy check constraint
          vote_count: 1, // Include vote_count as required by the database schema
          created_at: new Date().toISOString()
        });

      if (error) {
        console.error('Error adding vote:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to add vote',
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Vote added successfully'
      });
    } 
    else if (voteType === 'downvote' && existingVote) {
      // Update existing vote to downvote
      const { error } = await supabase
        .from('complaint_votes')
        .update({ 
          vote_count: 0,
          vote_type: 'downvote' // Set to 'downvote' to match the check constraint
        })
        .eq('complaint_id', complaintId)
        .eq('user_id', userId);

      if (error) {
        console.error('Error changing vote to downvote:', error);
        return res.status(500).json({
          success: false,
          message: 'Failed to change vote to downvote',
          error: error.message
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Vote changed to downvote successfully'
      });
    }
    else {
      // Vote already exists or doesn't exist as expected
      return res.status(200).json({
        success: true,
        message: 'No change needed'
      });
    }
  } catch (error) {
    console.error('❌ Error in vote API:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Get nearby complaints
router.get('/nearby', async (req, res) => {
  try {
    const { latitude, longitude, distance = 5000, limit = 20 } = req.query;
    const userId = req.user?.id || null;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    let complaints = [];
    
    // Try RPC function first
    try {
      const { data: rpcResults, error: rpcError } = await supabase.rpc(
        'find_complaints_within_distance',
        {
          origin_lat: parseFloat(latitude),
          origin_lng: parseFloat(longitude),
          distance_meters: parseFloat(distance),
          max_results: parseInt(limit),
          exclude_id: null
        }
      );

      if (!rpcError && rpcResults) {
        complaints = rpcResults;
      } else {
        // Fallback if RPC fails
        console.log('RPC failed, using fallback query:', rpcError);
        
        // Get all complaints with coordinates
        const { data: allComplaints, error: queryError } = await supabase
          .from('complaints')
          .select('*')
          .filter('location_latitude', 'not.is', null)
          .filter('location_longitude', 'not.is', null)
          .limit(parseInt(limit) * 2); // Fetch more than needed to filter by distance

        if (!queryError && allComplaints) {
          // Calculate distance manually and filter
          complaints = allComplaints
            .map(complaint => {
              const dist = calculateDistance(
                parseFloat(latitude),
                parseFloat(longitude),
                complaint.location_latitude,
                complaint.location_longitude
              );
              return {
                ...complaint,
                distance: dist * 1000 // Convert km to meters
              };
            })
            .filter(complaint => complaint.distance <= parseFloat(distance))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, parseInt(limit));
        }
      }
    } catch (locationError) {
      console.error('Error getting nearby complaints:', locationError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch nearby complaints',
        error: locationError.message
      });
    }

    // If there are no nearby complaints
    if (complaints.length === 0) {
      return res.status(200).json({
        success: true,
        complaints: []
      });
    }

    // Get complaint IDs for vote queries
    const complaintIds = complaints.map(c => c.id);
    
    // Get vote counts
    const { data: voteCounts, error: voteError } = await supabase
      .from('complaint_votes')
      .select('complaint_id, id')
      .in('complaint_id', complaintIds);

    if (voteError) {
      console.error('Error fetching vote counts:', voteError);
    }

    // Check which complaints the user has voted for
    let userVotes = [];
    if (userId) {
      const { data: votes, error: userVoteError } = await supabase
        .from('complaint_votes')
        .select('complaint_id')
        .in('complaint_id', complaintIds)
        .eq('user_id', userId);

      if (!userVoteError) {
        userVotes = votes.map(v => v.complaint_id);
      } else {
        console.error('Error fetching user votes:', userVoteError);
      }
    }

    // Create a map of complaint_id to vote count
    const voteCountMap = {};
    if (voteCounts) {
      voteCounts.forEach(vote => {
        if (!voteCountMap[vote.complaint_id]) {
          voteCountMap[vote.complaint_id] = 0;
        }
        voteCountMap[vote.complaint_id]++;
      });
    }

    // Add vote counts and user votes to complaints
    const completeComplaints = complaints.map(complaint => ({
      ...complaint,
      vote_count: voteCountMap[complaint.id] || 0,
      userVoted: userVotes.includes(complaint.id),
      distance: Math.round(complaint.distance) // Round to nearest meter
    }));

    // Sort by distance and vote count (prioritize those with more votes)
    completeComplaints.sort((a, b) => {
      // First prioritize by vote count (higher first)
      if (b.vote_count !== a.vote_count) {
        return b.vote_count - a.vote_count;
      }
      // Then by distance (closer first)
      return a.distance - b.distance;
    });

    return res.status(200).json({
      success: true,
      complaints: completeComplaints
    });
  } catch (error) {
    console.error('❌ Error in nearby complaints API:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
});

// Helper function to calculate distance between two points using Haversine formula
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  const distance = R * c; // Distance in km
  return distance;
}

function deg2rad(deg) {
  return deg * (Math.PI/180);
}

// Get complaint progress and timeline for citizens
router.get('/:id/progress', async (req, res) => {
  try {
    const { id } = req.params;

    // Get complaint with progress stages and timeline
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select(`
        *,
        users:user_id (id, full_name),
        complaint_stages (
          id,
          stage_number,
          stage_name,
          stage_description,
          stage_status,
          assigned_officer_id,
          assigned_contractor_id,
          estimated_completion_date,
          actual_completion_date,
          created_at,
          updated_at,
          officers (name, department, contact_phone),
          contractors (name, company_name, contact_phone)
        ),
        complaint_timeline (
          id,
          action_type,
          action_description,
          performed_by,
          created_at,
          metadata
        )
      `)
      .eq('id', id)
      .single();

    if (complaintError) {
      console.error('Error fetching complaint progress:', complaintError);
      return res.status(500).json({
        success: false,
        message: 'Error fetching complaint progress',
        error: complaintError.message
      });
    }

    if (!complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // Calculate progress percentage
    let totalStages = complaint.complaint_stages?.length || 0;
    let completedStages = complaint.complaint_stages?.filter(stage => 
      stage.stage_status === 'completed'
    )?.length || 0;
    
    let progressPercentage = totalStages > 0 ? Math.round((completedStages / totalStages) * 100) : 0;

    // Get current active stage
    let currentStage = complaint.complaint_stages?.find(stage => 
      stage.stage_status === 'in_progress'
    ) || null;

    // If no in_progress stage, get the next pending stage
    if (!currentStage) {
      currentStage = complaint.complaint_stages?.find(stage => 
        stage.stage_status === 'pending'
      ) || null;
    }

    // Format timeline for better readability
    let timeline = complaint.complaint_timeline?.map(entry => ({
      ...entry,
      formatted_date: new Date(entry.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    })) || [];

    // Sort timeline by date (newest first)
    timeline.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Format stages with progress info
    let stages = complaint.complaint_stages?.map(stage => ({
      ...stage,
      formatted_created_date: stage.created_at ? new Date(stage.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }) : null,
      formatted_completion_date: stage.actual_completion_date ? new Date(stage.actual_completion_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }) : null,
      formatted_estimated_date: stage.estimated_completion_date ? new Date(stage.estimated_completion_date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }) : null
    })) || [];

    // Sort stages by stage_number
    stages.sort((a, b) => (a.stage_number || 0) - (b.stage_number || 0));

    const progressData = {
      complaint: {
        id: complaint.id,
        title: complaint.title,
        description: complaint.description,
        status: complaint.status,
        category: complaint.category,
        priority_score: complaint.priority_score,
        created_at: complaint.created_at,
        formatted_created_date: new Date(complaint.created_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }),
        user: complaint.users
      },
      progress: {
        percentage: progressPercentage,
        completed_stages: completedStages,
        total_stages: totalStages,
        current_stage: currentStage
      },
      stages: stages,
      timeline: timeline.slice(0, 10) // Limit to recent 10 entries
    };

    res.json({
      success: true,
      data: progressData
    });

  } catch (error) {
    console.error('Complaint progress error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch complaint progress'
    });
  }
});

module.exports = router;
