/**
 * Single source of truth for casting/toggling votes and for keeping
 * complaints.vote_count in sync. Used by routes/complaints.js's /vote
 * endpoint, routes/guest-votes.js, and the submit-time duplicate-complaint
 * auto-upvote path (services/duplicateComplaintService.js).
 *
 * Before this existed, three-plus independent copies of this logic lived
 * across routes/complaints.js, routes/guest-votes.js,
 * routes/simplified-votes.js and routes/complaintDetails.js, each with
 * different bugs (see routes/complaints.js's /vote handler, which never
 * wrote complaints.vote_count at all -- votes recorded correctly in
 * complaint_votes but the visible count never moved).
 *
 * identity: exactly one of:
 *   { userId }   - authenticated or demo user, matched by complaint_votes.user_id
 *   { deviceId } - guest, matched by complaint_votes.device_id (only usable
 *                  once that column exists - see
 *                  database/add_device_id_to_complaint_votes.sql and
 *                  services/schemaAvailability.js's deviceIdColumnAvailable)
 *   {}           - anonymous with no stable identity to dedupe against;
 *                  every call is treated as "no existing vote" (matches
 *                  this repo's pre-migration guest voting behavior rather
 *                  than erroring)
 */

async function recomputeVoteCount(supabase, complaintId) {
  const { count, error } = await supabase
    .from('complaint_votes')
    .select('*', { count: 'exact', head: true })
    .eq('complaint_id', complaintId)
    .eq('vote_type', 'upvote');

  if (error) {
    console.error(`❌ Failed to recompute vote_count for complaint ${complaintId}:`, error.message);
    return null;
  }

  const voteCount = count || 0;
  const { error: updateError } = await supabase
    .from('complaints')
    .update({ vote_count: voteCount })
    .eq('id', complaintId);

  if (updateError) {
    console.error(`❌ Failed to persist vote_count for complaint ${complaintId}:`, updateError.message);
  }

  return voteCount;
}

function applyIdentityFilter(query, identity) {
  return identity.userId
    ? query.eq('user_id', identity.userId)
    : query.eq('device_id', identity.deviceId);
}

async function findExistingVote(supabase, complaintId, identity) {
  if (!identity.userId && !identity.deviceId) return null;

  const { data, error } = await applyIdentityFilter(
    supabase.from('complaint_votes').select('*').eq('complaint_id', complaintId),
    identity
  ).maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

function buildVoteRow(complaintId, identity) {
  const row = {
    complaint_id: complaintId,
    vote_type: 'upvote',
    created_at: new Date().toISOString(),
    user_id: identity.userId || null,
  };
  // Only set device_id when the caller has confirmed the column exists -
  // omitting it entirely (rather than passing null) keeps this working on
  // a database that hasn't run the migration yet.
  if (identity.deviceId) row.device_id = identity.deviceId;
  return row;
}

/**
 * Ensures identity has an upvote on complaintId: inserts one if missing,
 * flips an existing non-upvote to upvote, no-ops if already upvoted. Never
 * removes a vote - use toggleUpvote() for an explicit vote button.
 */
async function castUpvote(supabase, complaintId, identity) {
  const existing = await findExistingVote(supabase, complaintId, identity);

  if (!existing) {
    const { error } = await supabase.from('complaint_votes').insert([buildVoteRow(complaintId, identity)]);
    if (error) throw new Error(error.message);
  } else if (existing.vote_type !== 'upvote') {
    const { error } = await supabase
      .from('complaint_votes')
      .update({ vote_type: 'upvote' })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
  }

  const voteCount = await recomputeVoteCount(supabase, complaintId);
  return { voteCount, alreadyVoted: !!existing && existing.vote_type === 'upvote' };
}

/**
 * Explicit vote-button behavior: no vote -> add upvote; already upvoted ->
 * remove the vote entirely (this app has no separate downvote UI, so
 * "vote again" means "undo my vote", not "flip to a downvote").
 */
async function toggleUpvote(supabase, complaintId, identity) {
  const existing = await findExistingVote(supabase, complaintId, identity);

  let action;
  if (!existing) {
    const { error } = await supabase.from('complaint_votes').insert([buildVoteRow(complaintId, identity)]);
    if (error) throw new Error(error.message);
    action = 'voted';
  } else if (existing.vote_type === 'upvote') {
    const { error } = await supabase.from('complaint_votes').delete().eq('id', existing.id);
    if (error) throw new Error(error.message);
    action = 'unvoted';
  } else {
    const { error } = await supabase
      .from('complaint_votes')
      .update({ vote_type: 'upvote' })
      .eq('id', existing.id);
    if (error) throw new Error(error.message);
    action = 'voted';
  }

  const voteCount = await recomputeVoteCount(supabase, complaintId);
  return { action, userVoted: action === 'voted', voteCount };
}

module.exports = { castUpvote, toggleUpvote, recomputeVoteCount };
