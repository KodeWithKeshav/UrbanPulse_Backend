const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const crypto = require('crypto');

/**
 * Generate a deterministic UUID for guest users based on device ID
 * This ensures the same device always gets the same guest UUID
 */
function generateGuestUUID(deviceId) {
  const hash = crypto.createHash('md5').update('guest_' + deviceId).digest('hex');
  // Format as UUID v4
  const uuid = [
    hash.substr(0, 8),
    hash.substr(8, 4),
    '4' + hash.substr(13, 3), // Version 4
    ((parseInt(hash.substr(16, 1), 16) & 0x3) | 0x8).toString(16) + hash.substr(17, 3), // Variant bits
    hash.substr(20, 12)
  ].join('-');
  return uuid;
}

/**
 * Guest voting endpoint - allows anonymous voting
 * POST /api/guest-votes/
 * Body: { complaintId: string, deviceId: string (optional) }
 * 
 * Note: Since user_id can be NULL, we'll use NULL for guest votes
 * Device tracking will be done in the frontend for preventing multiple votes
 */
router.post('/', async (req, res) => {
  try {
    console.log('🗳️ Processing guest vote request:', req.body);
    
    const { complaintId, deviceId } = req.body;
    
    if (!complaintId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameter: complaintId' 
      });
    }

    // First check if the complaint exists
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('id, vote_count')
      .eq('id', complaintId)
      .single();

    if (complaintError || !complaint) {
      console.error('❌ Complaint not found:', complaintError || 'No data returned');
      return res.status(404).json({ 
        success: false, 
        message: 'Complaint not found' 
      });
    }

    // For guest voting, we'll simply add a vote with NULL user_id
    // The frontend will handle preventing multiple votes from the same device
    const { data: newVote, error: insertError } = await supabase
      .from('complaint_votes')
      .insert([
        { 
          complaint_id: complaintId, 
          user_id: null, // Guest vote - no user association
          vote_type: 'upvote',
          created_at: new Date().toISOString()
        }
      ])
      .select();

    if (insertError) {
      console.error('❌ Error adding guest vote:', insertError);
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to add vote',
        details: insertError.message
      });
    }

    // Manually increment the vote count in complaints table
    const { error: updateError } = await supabase
      .from('complaints')
      .update({ 
        vote_count: (complaint.vote_count || 0) + 1 
      })
      .eq('id', complaintId);

    if (updateError) {
      console.error('❌ Error updating vote count:', updateError);
      // We could rollback the vote insert here, but for simplicity we'll continue
    }

    console.log('✅ Guest vote added successfully');

    // Get updated vote count
    const { data: updatedComplaint, error: fetchError } = await supabase
      .from('complaints')
      .select('vote_count')
      .eq('id', complaintId)
      .single();

    const finalVoteCount = fetchError ? (complaint.vote_count || 0) + 1 : (updatedComplaint.vote_count || 0);

    // Return the updated vote information
    return res.status(200).json({
      success: true,
      message: 'Vote added successfully',
      data: {
        complaint_id: complaintId,
        vote_type: 'upvote',
        voteCount: finalVoteCount,
        isGuestVote: true
      }
    });
    
  } catch (error) {
    console.error('❌ Guest vote processing error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing guest vote'
    });
  }
});
router.post('/', async (req, res) => {
  try {
    console.log('🗳️ Processing guest vote request:', req.body);
    
    const { complaintId, deviceId } = req.body;
    
    if (!complaintId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameter: complaintId' 
      });
    }

    // First check if the complaint exists
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('id, vote_count')
      .eq('id', complaintId)
      .single();

    if (complaintError || !complaint) {
      console.error('❌ Complaint not found:', complaintError || 'No data returned');
      return res.status(404).json({ 
        success: false, 
        message: 'Complaint not found' 
      });
    }

    // For guest voting, we'll use a simple approach with UUID-compatible guest IDs
    let existingVote = null;
    
    if (deviceId) {
      // Generate a deterministic UUID for this device
      const guestUserId = generateGuestUUID(deviceId);
      
      // Check if this device already voted for this complaint
      const { data: deviceVote, error: deviceVoteError } = await supabase
        .from('complaint_votes')
        .select('*')
        .eq('complaint_id', complaintId)
        .eq('user_id', guestUserId)
        .single();

      if (deviceVoteError && deviceVoteError.code !== 'PGRST116') {
        console.error('❌ Error checking device vote:', deviceVoteError);
        return res.status(500).json({ 
          success: false, 
          message: 'Error checking vote status' 
        });
      }

      existingVote = deviceVote;
    }

    let result;
    let message;

    if (!existingVote) {
      // No existing vote - add new guest vote
      const guestUserId = deviceId ? generateGuestUUID(deviceId) : generateGuestUUID(`temp_${Date.now()}_${Math.random().toString(36).substring(2)}`);
      
      const { data: newVote, error: insertError } = await supabase
        .from('complaint_votes')
        .insert([
          { 
            complaint_id: complaintId, 
            user_id: guestUserId, // Store guest UUID in user_id field
            vote_type: 'upvote',
            created_at: new Date().toISOString()
          }
        ])
        .select();

      if (insertError) {
        console.error('❌ Error adding guest vote:', insertError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to add vote',
          details: insertError.message
        });
      }

      // Manually increment the vote count in complaints table
      const { error: updateError } = await supabase
        .from('complaints')
        .update({ 
          vote_count: complaint.vote_count + 1 
        })
        .eq('id', complaintId);

      if (updateError) {
        console.error('❌ Error updating vote count:', updateError);
        // Note: We could rollback the vote insert here, but for simplicity we'll continue
      }

      result = newVote;
      message = 'Vote added successfully';
      console.log('✅ Guest vote added successfully');
      
    } else {
      // Existing vote found - toggle it
      const newVoteType = existingVote.vote_type === 'upvote' ? 'downvote' : 'upvote';
      const voteCountChange = newVoteType === 'upvote' ? 1 : -1;

      const { data: updatedVote, error: updateError } = await supabase
        .from('complaint_votes')
        .update({
          vote_type: newVoteType,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingVote.id)
        .select();

      if (updateError) {
        console.error('❌ Error updating guest vote:', updateError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to update vote' 
        });
      }

      // Update the vote count in complaints table
      const { error: countUpdateError } = await supabase
        .from('complaints')
        .update({ 
          vote_count: Math.max(0, complaint.vote_count + voteCountChange)
        })
        .eq('id', complaintId);

      if (countUpdateError) {
        console.error('❌ Error updating vote count:', countUpdateError);
      }

      result = updatedVote;
      message = newVoteType === 'upvote' ? 'Vote added successfully' : 'Vote removed successfully';
      console.log(`✅ Guest vote toggled to: ${newVoteType}`);
    }

    // Get updated vote count from complaints table
    const { data: complaintData, error: countError } = await supabase
      .from('complaints')
      .select('vote_count')
      .eq('id', complaintId)
      .single();

    const voteCount = countError ? 0 : (complaintData?.vote_count || 0);

    // Return the updated vote information
    return res.status(200).json({
      success: true,
      message,
      data: {
        complaint_id: complaintId,
        vote_type: result?.[0]?.vote_type || 'upvote',
        voteCount: complaint.vote_count + (message.includes('added') ? 1 : (message.includes('removed') ? -1 : 0)),
        isGuestVote: true
      }
    });
    
  } catch (error) {
    console.error('❌ Guest vote processing error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing guest vote'
    });
  }
});

/**
 * Get vote status for a guest device
 * GET /api/guest-votes/status/:complaintId?deviceId=xxx
 * 
 * Note: Since guest votes use NULL user_id, we can't track individual devices
 * This endpoint returns the total vote count for the complaint
 */
router.get('/status/:complaintId', async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { deviceId } = req.query;
    
    if (!complaintId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing complaintId parameter' 
      });
    }

    // Get complaint vote count
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('vote_count')
      .eq('id', complaintId)
      .single();

    if (complaintError || !complaint) {
      return res.status(404).json({ 
        success: false, 
        message: 'Complaint not found' 
      });
    }

    // Since we can't track individual guest votes, we'll return basic status
    // The frontend will handle vote state management for guest users
    return res.status(200).json({
      success: true,
      data: {
        complaintId,
        voteCount: complaint.vote_count || 0,
        userVoteStatus: {
          hasVoted: false, // Guest votes can't be tracked individually
          voteType: null,
          isActive: false
        }
      }
    });
    
  } catch (error) {
    console.error('❌ Error getting guest vote status:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving vote status'
    });
  }
});

module.exports = router;
