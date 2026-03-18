const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

// Vote on a complaint (upvote only for now - we'll simplify)
router.post('/', async (req, res) => {
  try {
    console.log('Processing vote request:', req.body);
    
    // Check for authenticated user
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required to vote on complaints' 
      });
    }

    const { complaintId } = req.body;
    const userId = req.user.id;
    
    if (!complaintId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required parameter: complaintId' 
      });
    }

    // First check if the complaint exists
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('*')
      .eq('id', complaintId)
      .single();

    if (complaintError || !complaint) {
      console.error('Complaint not found:', complaintError || 'No data returned');
      return res.status(404).json({ 
        success: false, 
        message: 'Complaint not found' 
      });
    }

    // Check if user already voted for this complaint
    const { data: existingVote, error: voteError } = await supabase
      .from('complaint_votes')
      .select('*')
      .eq('complaint_id', complaintId)
      .eq('user_id', userId)
      .single();

    if (voteError && voteError.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error checking existing vote:', voteError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error checking vote status' 
      });
    }

    let result;

    // Follow new toggle voting methodology
    if (!existingVote) {
      // User hasn't voted yet - add upvote (vote_count = 1)
      const { data: newVote, error: insertError } = await supabase
        .from('complaint_votes')
        .insert([
          { 
            complaint_id: complaintId, 
            user_id: userId,
            vote_type: 'upvote',
            vote_count: 1, // This will trigger database to increment complaints.vote_count
            created_at: new Date().toISOString()
          }
        ])
        .select();

      if (insertError) {
        console.error('Error adding vote:', insertError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to add vote',
          details: insertError.message
        });
      }

      result = newVote;
      console.log('Vote added successfully');
      
    } else {
      // User already voted - toggle behavior based on current vote
      if (existingVote.vote_type === 'upvote' && existingVote.vote_count === 1) {
        // Currently upvoted, change to downvote (vote_count = 0)
        const { data: updatedVote, error: updateError } = await supabase
          .from('complaint_votes')
          .update({
            vote_type: 'downvote',
            vote_count: 0 // This will trigger database to decrement complaints.vote_count
          })
          .eq('complaint_id', complaintId)
          .eq('user_id', userId)
          .select();

        if (updateError) {
          console.error('Error updating vote to downvote:', updateError);
          return res.status(500).json({ 
            success: false, 
            message: 'Failed to update vote' 
          });
        }

        result = updatedVote;
        console.log('Vote toggled to downvote');
        
      } else {
        // Currently downvoted, change back to upvote (vote_count = 1)
        const { data: updatedVote, error: updateError } = await supabase
          .from('complaint_votes')
          .update({
            vote_type: 'upvote',
            vote_count: 1 // This will trigger database to increment complaints.vote_count
          })
          .eq('complaint_id', complaintId)
          .eq('user_id', userId)
          .select();

        if (updateError) {
          console.error('Error updating vote to upvote:', updateError);
          return res.status(500).json({ 
            success: false, 
            message: 'Failed to update vote' 
          });
        }

        result = updatedVote;
        console.log('Vote toggled back to upvote');
      }
    }

    // Get updated vote count from complaints table (more efficient than aggregating)
    const { data: complaintData, error: countError } = await supabase
      .from('complaints')
      .select('vote_count')
      .eq('id', complaintId)
      .single();

    const voteCount = countError ? 0 : (complaintData?.vote_count || 0);

    // Return the updated vote information
    return res.status(200).json({
      success: true,
      message: existingVote ? 'Vote removed successfully' : 'Vote added successfully',
      data: {
        ...result,
        voteCount: voteCount
      }
    });
    
  } catch (error) {
    console.error('Vote processing error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing vote'
    });
  }
});

module.exports = router;
