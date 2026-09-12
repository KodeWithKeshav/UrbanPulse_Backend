const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const { toggleUpvote } = require('../services/voteService');
const { deviceIdColumnAvailable } = require('../services/schemaAvailability');

/**
 * Guest voting endpoint - allows anonymous voting, deduped per-device once
 * database/add_device_id_to_complaint_votes.sql has been run.
 *
 * This file previously defined this same POST '/' route twice - Express
 * only ever reached the first (broken) definition, which inserted a new
 * vote row and incremented vote_count unconditionally on every request:
 * no duplicate protection, no way to undo a vote, and the vote_count
 * arithmetic could drift under concurrent requests. The correctly-written
 * second definition (with real per-device dedup) was unreachable dead
 * code. Replaced with the one handler below, built on the shared
 * services/voteService.js used by the authenticated vote endpoint too.
 *
 * POST /api/guest-votes/
 * Body: { complaintId: string, deviceId?: string }
 */
router.post('/', async (req, res) => {
  try {
    const { complaintId, deviceId } = req.body;

    if (!complaintId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameter: complaintId',
      });
    }

    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('id')
      .eq('id', complaintId)
      .single();

    if (complaintError || !complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found',
      });
    }

    // Only dedupe by device once the column exists - otherwise fall back
    // to the pre-migration behavior (every guest vote counts, no undo)
    // rather than erroring on a missing column.
    const canDedupe = deviceId && (await deviceIdColumnAvailable(supabase));
    const identity = canDedupe ? { deviceId } : {};

    const { action, voteCount } = await toggleUpvote(supabase, complaintId, identity);

    return res.status(200).json({
      success: true,
      message: action === 'voted' ? 'Vote added successfully' : 'Vote removed successfully',
      data: {
        complaint_id: complaintId,
        action,
        userVoted: action === 'voted',
        voteCount,
        isGuestVote: true,
        deduped: canDedupe,
      },
    });
  } catch (error) {
    console.error('❌ Guest vote processing error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing guest vote',
    });
  }
});

/**
 * Get vote status for a guest device.
 * GET /api/guest-votes/status/:complaintId?deviceId=xxx
 * Reports the real per-device status once device_id is migrated;
 * otherwise reports the complaint's total count with hasVoted always
 * false, since pre-migration guest votes can't be traced back to a device.
 */
router.get('/status/:complaintId', async (req, res) => {
  try {
    const { complaintId } = req.params;
    const { deviceId } = req.query;

    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('vote_count')
      .eq('id', complaintId)
      .single();

    if (complaintError || !complaint) {
      return res.status(404).json({
        success: false,
        message: 'Complaint not found',
      });
    }

    let hasVoted = false;
    const canDedupe = deviceId && (await deviceIdColumnAvailable(supabase));
    if (canDedupe) {
      const { data: vote } = await supabase
        .from('complaint_votes')
        .select('vote_type')
        .eq('complaint_id', complaintId)
        .eq('device_id', deviceId)
        .maybeSingle();
      hasVoted = vote?.vote_type === 'upvote';
    }

    return res.status(200).json({
      success: true,
      data: {
        complaintId,
        voteCount: complaint.vote_count || 0,
        userVoteStatus: {
          hasVoted,
          voteType: hasVoted ? 'upvote' : null,
          isActive: hasVoted,
        },
      },
    });
  } catch (error) {
    console.error('❌ Error getting guest vote status:', error);
    return res.status(500).json({
      success: false,
      message: 'Error retrieving vote status',
    });
  }
});

module.exports = router;
