const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const LocationPriorityService = require('../services/LocationPriorityService');
const { emotionService } = require('../services/EmotionAnalysisService');
const { analyzeTextAuthenticity } = require('../services/TextAuthenticityService');
const priorityConfig = require('../services/priorityConfig');
const potholeGeometryService = require('../services/potholeGeometryService');
const { castUpvote, toggleUpvote } = require('../services/voteService');
const { findNearbyDuplicateComplaint } = require('../services/duplicateComplaintService');

// Initialize services
const locationPriorityService = new LocationPriorityService();

/**
 * Run sentiment/emotion analysis and authenticity/correctness checks on a
 * complaint description together, so both the pre-submit check and the
 * final submission use one source of truth.
 */
async function analyzeComplaintText({ description, category, imagePrimaryClass, translation }) {
  const [emotionResult, authenticity] = await Promise.all([
    emotionService.analyzeEmotion(description, category, translation),
    Promise.resolve(analyzeTextAuthenticity({ text: description, category, imagePrimaryClass })),
  ]);

  return { emotion: emotionResult, authenticity };
}

/**
 * POST /api/complaints/analyze-text
 * Lets the client run sentiment + authenticity/correctness checks on a
 * description before final submission, so the UI can warn the citizen if
 * their text doesn't seem to match the selected/detected issue category
 * (e.g. category is "pothole" but the description is about something else)
 * or reads like spam/gibberish.
 */
router.post('/analyze-text', async (req, res) => {
  try {
    const { description, category, imagePrimaryClass, translation } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({
        success: false,
        error: 'description is required',
        code: 'MISSING_DESCRIPTION'
      });
    }

    const result = await analyzeComplaintText({ description, category, imagePrimaryClass, translation });

    res.json({
      success: true,
      emotion: result.emotion,
      authenticity: result.authenticity,
    });
  } catch (error) {
    console.error('❌ Text analysis error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze complaint text',
      details: error.message
    });
  }
});

/**
 * Submit a new complaint with automatic location processing
 * POST /api/complaints/submit
 */
// Function to check the complaints table schema
async function checkComplaintsTableSchema() {
  try {
    console.log('📊 Checking complaints table schema...');
    // Introspect the table schema to see column names
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .limit(1);
      
    if (error) {
      console.error('❌ Schema check error:', error);
      return null;
    }
    
    if (data && data.length > 0) {
      console.log('📋 Available columns in complaints table:', Object.keys(data[0]));
      return Object.keys(data[0]);
    } else {
      console.log('ℹ️ No records in complaints table to infer schema');
      return [];
    }
  } catch (error) {
    console.error('❌ Schema check failed:', error);
    return null;
  }
}

// Filter the complaint data to match available columns
async function filterComplaintDataForInsertion(complaintData, availableColumns) {
  const filteredData = {};
  
  // Only include fields that exist in the database schema
  Object.keys(complaintData).forEach(key => {
    if (availableColumns.includes(key)) {
      filteredData[key] = complaintData[key];
    }
  });
  
  // Validate numeric fields to prevent overflow errors
  // For columns with precision 3, scale 2 (max value < 10)
  const numericFields = ['priority_score', 'location_sensitivity_score', 'emotion_score', 'ai_confidence_score', 'text_authenticity_score'];
  numericFields.forEach(field => {
    if (field in filteredData) {
      // Ensure value is a number between 0 and 9.99
      if (typeof filteredData[field] === 'number') {
        if (filteredData[field] >= 10) {
          console.log(`⚠️ Adjusting ${field} from ${filteredData[field]} to 9.99 to prevent overflow`);
          filteredData[field] = 9.99;
        } else if (filteredData[field] < 0) {
          console.log(`⚠️ Adjusting ${field} from ${filteredData[field]} to 0 to ensure positive value`);
          filteredData[field] = 0;
        } else {
          // Ensure we're working with 2 decimal places max
          filteredData[field] = parseFloat(filteredData[field].toFixed(2));
        }
      }
    }
  });
  
  console.log('📝 Filtered complaint data for insertion:', filteredData);
  return filteredData;
}

router.post('/submit', async (req, res) => {
  try {
    console.log('📝 New complaint submission:', req.body);
    
    // Check if user is authenticated
    const authenticatedUser = req.user;
    console.log('👤 Authenticated user:', authenticatedUser ? authenticatedUser.id : 'None');
    
    // Check the table schema first
    const columns = await checkComplaintsTableSchema() || [];
    
    const {
      title,
      description,
      category,
      imageUrl,
      imageValidation,
      locationData,
      userId = 'anonymous',
      userType = 'citizen'
    } = req.body;
    
    // Input validation
    if (!title || !description || !category || !locationData) {
      return res.status(400).json({
        success: false,
        error: 'Title, description, category, and location are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    // Generate a proper UUID for demo users or use the provided userId if it's in UUID format
    const generateUuid = () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    };
    
    // Validate if string is a UUID
    const isUuid = (str) => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      return uuidRegex.test(str);
    };
    
    // Create or ensure the demo user exists for foreign key constraint
    const ensureDemoUser = async () => {
      console.log('🔍 Checking for demo user...');
      
      // First, check if our default demo user exists
      const { data: existingUser, error: findError } = await supabase
        .from('users')
        .select('id')
        .eq('email', 'demo@civicrezo.org')
        .limit(1);
      
      if (findError) {
        console.error('❌ Error checking for demo user:', findError);
      }
      
      // If user exists, return its ID
      if (existingUser && existingUser.length > 0) {
        console.log('✅ Using existing demo user:', existingUser[0].id);
        return existingUser[0].id;
      }
      
      console.log('⚠️ Demo user not found, creating one...');
      
      // Check if the RPC function exists by trying to call it
      try {
        const { data: demoId, error: rpcError } = await supabase.rpc('create_demo_user');
        
        if (!rpcError && demoId) {
          console.log('✅ Created demo user via RPC:', demoId);
          return demoId;
        }
        
        if (rpcError) {
          console.log('⚠️ RPC function not available:', rpcError.message);
          // Fall back to direct insert
        }
      } catch (e) {
        console.log('⚠️ RPC call failed, falling back to direct insert');
      }
      
      // If RPC failed or isn't available, try direct insert
      const demoUuid = generateUuid();
      
      try {
        // Use raw SQL to ensure the insert works correctly with the database schema
        const { data, error: sqlError } = await supabase.rpc('execute_sql', {
          sql_query: `
            INSERT INTO users (
              id, email, password, full_name, phone_number, 
              user_type, address, is_active, created_at, updated_at
            ) VALUES (
              '${demoUuid}', 'demo@civicrezo.org', 'not-a-real-password', 
              'Demo User', '1234567890', 'citizen', 'Demo Address', 
              true, NOW(), NOW()
            )
            RETURNING id;
          `
        });
        
        if (sqlError) {
          console.error('❌ SQL error creating demo user:', sqlError);
        } else {
          console.log('✅ Created demo user via SQL:', data);
          return demoUuid;
        }
      } catch (sqlExecError) {
        console.error('❌ SQL execution error:', sqlExecError);
      }
      
      // Last attempt: standard insert
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          id: demoUuid,
          email: 'demo@civicrezo.org',
          password: 'not-a-real-password-hash',
          full_name: 'Demo User',
          phone_number: '1234567890',
          user_type: 'citizen',
          address: 'Demo Address',
          is_active: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select();
      
      if (insertError) {
        console.error('❌ Error creating demo user:', insertError);
        // All attempts failed, but we need to return something
        console.log('⚠️ All demo user creation methods failed, using generated UUID as fallback');
        return demoUuid;
      }
      
      console.log('✅ Created new demo user:', newUser[0].id);
      return newUser[0].id;
    };
    
    // Get a valid user ID for the database (actual user or demo)
    let userUuid;
    
    // If user is authenticated, use their ID
    if (authenticatedUser && authenticatedUser.id) {
      console.log(`🔑 Using authenticated user_id: ${authenticatedUser.id}`);
      userUuid = authenticatedUser.id;
    } 
    // If userId is provided in the request and it's a valid UUID, use it
    else if (isUuid(userId)) {
      console.log(`🔑 Using provided user_id: ${userId}`);
      userUuid = userId;
    } 
    // Otherwise create or find a demo user
    else {
      userUuid = await ensureDemoUser();
      console.log(`🔑 Using demo user_id: ${userUuid}`);
    }

    // --- Duplicate-complaint detection -------------------------------
    // Same category within ~40m of an existing non-resolved complaint ->
    // add this submitter's upvote to it instead of creating a new row (see
    // services/duplicateComplaintService.js). Runs before the image/text
    // validation and priority-scoring below, since a duplicate skips all
    // of that entirely - no point spending a Roboflow/emotion-analysis
    // call on a submission that isn't going to become a new complaint.
    const duplicateComplaint = await findNearbyDuplicateComplaint({
      supabase,
      category,
      latitude: locationData.latitude,
      longitude: locationData.longitude,
    });

    if (duplicateComplaint) {
      console.log(
        `♻️ Duplicate complaint detected ${Math.round(duplicateComplaint._distanceMeters)}m away ` +
        `(${duplicateComplaint.id}) - upvoting instead of creating a new complaint`
      );

      const { voteCount, alreadyVoted } = await castUpvote(supabase, duplicateComplaint.id, { userId: userUuid });

      return res.json({
        success: true,
        duplicate: true,
        // Same trimmed shape as the normal-submission response below
        // (response.complaint), so the client can render either result
        // with one code path.
        complaint: {
          id: duplicateComplaint.id,
          title: duplicateComplaint.title,
          category: duplicateComplaint.category,
          status: duplicateComplaint.status,
          submittedAt: duplicateComplaint.created_at,
        },
        voteCount,
        alreadyVoted,
        message: alreadyVoted
          ? "This issue was already reported nearby, and you'd already voted for it — no new complaint or vote was added."
          : 'This issue was already reported nearby, so we added your vote to it instead of creating a duplicate report.',
      });
    }

    // Reject outright if an image was uploaded but never passed validation
    // against the selected category (client should already prevent this,
    // but the server is the authority — never trust the client alone).
    if (imageUrl) {
      if (!imageValidation || imageValidation.allowUpload !== true) {
        return res.status(400).json({
          success: false,
          error: imageValidation?.message || 'The uploaded photo does not match the selected issue type.',
          code: 'IMAGE_CATEGORY_MISMATCH',
          categoryMatch: imageValidation?.categoryMatch ?? false,
          detectedClass: imageValidation?.primaryClass || null,
        });
      }
    }

    // Analyze the description: sentiment/emotion + authenticity/correctness
    // (does the text actually describe the declared/detected issue, and does
    // it read like a genuine report rather than spam/gibberish?)
    const textAnalysis = await analyzeComplaintText({
      description,
      category,
      imagePrimaryClass: imageValidation?.primaryClass || null,
    });
    console.log('🔎 Text analysis result:', {
      authenticityScore: textAnalysis.authenticity.authenticityScore,
      flagged: textAnalysis.authenticity.flagged,
      mismatchDetected: textAnalysis.authenticity.mismatchDetected,
      emotionScore: textAnalysis.emotion.emotionScore,
    });

    // Reject outright if the description doesn't genuinely match the
    // selected/detected issue (or reads like spam/gibberish) — no
    // "submit anyway" path. The citizen must fix the text or the category.
    if (textAnalysis.authenticity.flagged) {
      return res.status(400).json({
        success: false,
        error: 'The description does not appear to match the selected issue type.',
        code: 'DESCRIPTION_CATEGORY_MISMATCH',
        contentAnalysis: {
          authenticityScore: textAnalysis.authenticity.authenticityScore,
          reasons: textAnalysis.authenticity.reasons,
          suggestedCategory: textAnalysis.authenticity.suggestedCategory,
        },
      });
    }

    // Calculate comprehensive priority score
    const priorityAnalysis = await calculateComprehensivePriority({
      imageValidation,
      locationData,
      category,
      description
    });

    // Create a base complaint object with essential fields
    const baseComplaint = {
      title: title.trim(),
      description: description.trim(),
      category,
      status: 'pending', // initial status as pending
      
      // User information - ensure it's a UUID for Supabase
      user_id: userUuid,
      
      // Timestamps in PostgreSQL timestamptz format (ISO format works well)
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    
    // Add expected fields according to your schema, with fallbacks
    const complaintData = {
      ...baseComplaint,
      
      // Location information
      location_latitude: locationData.latitude,
      location_longitude: locationData.longitude,
      
      // Try both versions of fields to increase compatibility
      location_address: locationData.address || `${locationData.latitude.toFixed(4)}, ${locationData.longitude.toFixed(4)}`,
      
      // Scoring fields - adjust to match the database constraints
      // For numeric fields with precision 3, scale 2, values must be < 10^1 (i.e., < 10)
      priority_score: parseFloat((priorityAnalysis.totalScore).toFixed(2)),
      location_sensitivity_score: parseFloat((priorityAnalysis.locationScore).toFixed(2)),
      emotion_score: parseFloat((textAnalysis.emotion.emotionScore ?? 0.5).toFixed(2)),

      // Add AI confidence score if available
      ai_confidence_score: imageValidation?.modelConfidence ?
        parseFloat((imageValidation.modelConfidence).toFixed(2)) : 0.5,

      // How well the description matches the declared/detected category and
      // reads like a genuine report (0-1, see TextAuthenticityService)
      text_authenticity_score: textAnalysis.authenticity.authenticityScore,
      content_flagged: textAnalysis.authenticity.flagged,
      content_flag_reason: textAnalysis.authenticity.reasons.join(' ') || null,

      // Images and media
      image_urls: imageUrl ? [imageUrl] : [],
      audio_url: null,

      // Status fields
      verification_status: textAnalysis.authenticity.flagged
        ? 'flagged'
        : (imageValidation?.allowUpload ? 'verified' : 'unverified'),
      assigned_department: null,
      assigned_admin_id: null,
      resolution_notes: null,
      resolved_at: null,
    };
    
    // Filter the complaint data to match available columns
    const filteredData = await filterComplaintDataForInsertion(complaintData, columns);
    
    let complaint;
    
    try {
      // Insert into Supabase
      const { data, error } = await supabase
        .from('complaints')
        .insert([filteredData])
        .select();
      
      if (error) {
        console.error('❌ Supabase insert error:', error);
        
        // Provide more specific error handling for numeric overflow
        if (error.code === '22003' && error.message.includes('numeric field overflow')) {
          throw new Error(`Database error: Numeric field overflow. Scores must be less than 10 with up to 2 decimal places.`);
        }
        
        throw new Error(`Database error: ${error.message}`);
      }
      
      complaint = data;
      console.log('✅ Complaint saved to Supabase:', complaint);
      
      // After successful complaint submission, create an initial complaint update entry
      if (complaint && complaint[0] && complaint[0].id) {
        const complaintId = complaint[0].id;

        // Fire-and-forget pothole footprint/depth estimation (see
        // services/potholeGeometryService.js and PRIORITY_ENGINE plan doc
        // "Pothole Footprint & Depth Estimation"). Deliberately NOT
        // awaited and wrapped in .catch() so a slow/failed Roboflow call
        // can never delay or fail the citizen's response below.
        potholeGeometryService
          .estimateAndPersistGeometry({
            complaintId,
            imageUrl,
            category,
            primaryClass: imageValidation?.primaryClass || null,
            deviceTilt: req.body.deviceTilt ?? null, // present once the mobile app sends it (Phase 2)
          })
          .catch((e) => console.error('❌ Geometry estimation error (non-blocking):', e.message));

        // 1. Add entry to complaint_updates table
        const { data: updateData, error: updateError } = await supabase
          .from('complaint_updates')
          .insert([{
            complaint_id: complaintId,
            updated_by_id: userUuid, // Use the same user who submitted the complaint
            old_status: null, // No old status for a new complaint
            new_status: 'pending', // Initial status
            update_notes: 'Complaint submitted',
            created_at: new Date().toISOString()
          }]);
        
        if (updateError) {
          console.error('❌ Error creating complaint update entry:', updateError);
        } else {
          console.log('✅ Added initial complaint update entry');
        }
        
        
        // 2. Register the creator's initial upvote (see services/voteService.js
        // - also recomputes and persists complaints.vote_count, which the
        // old delete-then-insert here never did, so a brand new complaint
        // used to show a vote count of 0 despite the creator "having voted").
        try {
          await castUpvote(supabase, complaintId, { userId: userUuid });
          console.log('✅ Added initial complaint vote entry');
        } catch (voteErr) {
          console.error('❌ Exception in complaint vote creation:', voteErr.message);
        }
      }
    } catch (dbError) {
      console.error('❌ Database operation failed:', dbError);
      
      // Attempt to get table schema directly (alternative approach)
      try {
        const { data: schema } = await supabase.rpc('get_table_columns', { table_name: 'complaints' });
        if (schema) {
          console.log('📊 Complaints table columns:', schema);
        }
      } catch (e) {
        console.error('Could not fetch schema via RPC:', e);
      }
      
      throw new Error(`Database error: ${dbError.message}`);
    }
    
    // Prepare response - safe access in case structure changed
    const complaintRecord = complaint && complaint[0] ? complaint[0] : {};

    const finalScore = Number(priorityAnalysis.totalScore || 0);
    const finalPriorityLevel = priorityConfig.getPriorityLevel(finalScore);

    const response = {
      success: true,
      complaint: {
        id: complaintRecord.id || `temp-${Date.now()}`,
        title: complaintRecord.title || title,
        category: complaintRecord.category || category,
        priorityScore: Math.round(finalScore * 100),
        status: complaintRecord.status || 'pending',
        submittedAt: complaintRecord.created_at || new Date().toISOString()
      },
      priorityAnalysis: {
        totalScore: finalScore,
        priorityLevel: finalPriorityLevel,
        breakdown: {
          locationScore: priorityAnalysis.locationScore,
          imageScore: priorityAnalysis.imageScore,
          facilitiesNearby: priorityAnalysis.facilitiesCount
        },
        reasoning: priorityAnalysis.reasoning
      },
      location: {
        privacyLevel: locationData.privacyLevel,
        accuracy: locationData.accuracy ? `±${locationData.accuracy}m` : 'Unknown',
        description: locationData.description
      },
      contentAnalysis: {
        authenticityScore: textAnalysis.authenticity.authenticityScore,
        flagged: textAnalysis.authenticity.flagged,
        mismatchDetected: textAnalysis.authenticity.mismatchDetected,
        suggestedCategory: textAnalysis.authenticity.suggestedCategory,
        reasons: textAnalysis.authenticity.reasons,
        emotionScore: textAnalysis.emotion.emotionScore,
      },
      nextSteps: generateNextSteps(finalPriorityLevel, category),
    };
    
    res.json(response);
  } catch (error) {
    console.error('❌ Complaint submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit complaint',
      code: 'SUBMISSION_ERROR',
      details: error.message || 'Internal server error',
      suggestion: 'Please check your database schema and ensure all required fields are properly configured.'
    });
  }
});

/**
 * Calculate comprehensive priority score combining image and location analysis.
 *
 * FIX: this function used to contain a second, independent priority
 * formula (locationScore*0.6 + imageScore*0.4) that silently ran whenever
 * LocationPriorityService.calculateComprehensivePriority() threw --
 * meaning a transient Places-API hiccup could change which formula (and
 * which undocumented weights) produced a citizen's stored priority score.
 * Its own comment even disagreed with its own code (comment said "50%
 * location / 40% image", code used 60/40). There is now exactly one
 * formula, defined in services/priorityConfig.js and used everywhere
 * (final submission, /calculate-priority preview, and
 * /api/location-priority/comprehensive all call it). If it genuinely can't
 * run (no location data, or the calculation throws), this returns an
 * honestly-labeled category-tier-only estimate instead of silently
 * recomputing with different weights.
 */
async function calculateComprehensivePriority({ imageValidation, locationData, category, description }) {
  const startTime = Date.now();

  const categoryOnlyFallback = (reason) => {
    const fallbackScore = priorityConfig.getFallbackPriorityScore(category);
    return {
      totalScore: fallbackScore,
      priorityLevel: priorityConfig.getPriorityLevel(fallbackScore),
      locationScore: 0,
      imageScore: imageValidation?.data?.priorityScore || imageValidation?.confidence || 0,
      reasoning: `${reason} Priority assigned from complaint category "${category}" (${priorityConfig.getCategoryImportanceLabel(category)}) only.`,
      facilitiesCount: 0,
      processingTime: Date.now() - startTime,
      breakdown: {
        infrastructureScore: 0,
        imageValidationScore: imageValidation?.data?.priorityScore || imageValidation?.confidence || 0,
        emotionScore: 0,
        voteScore: 0,
        statusMultiplier: 1.0,
        degraded: true
      }
    };
  };

  if (!locationData || !locationData.latitude || !locationData.longitude) {
    return categoryOnlyFallback('No location data provided.');
  }

  try {
    const priorityResult = await locationPriorityService.calculateComprehensivePriority(
      locationData.latitude,
      locationData.longitude,
      imageValidation || {},
      {
        complaintType: category,
        created_at: new Date().toISOString(),
        status: 'pending',
        votes: 0,
        description,
        locationMeta: {
          privacyLevel: locationData.privacyLevel,
          radiusM: locationData.accuracy,
          precision: locationData.precision,
          description: locationData.description
        }
      }
    );

    console.log('✅ Priority calculation result:', priorityResult);

    return {
      totalScore: priorityResult.priorityScore,
      priorityLevel: priorityResult.priorityLevel,
      locationScore: priorityResult.breakdown.infrastructureScore,
      imageScore: priorityResult.breakdown.imageValidationScore,
      reasoning: priorityResult.reasoning,
      facilitiesCount: priorityResult.totalFacilities || 0,
      processingTime: Date.now() - startTime,
      breakdown: priorityResult.breakdown
    };
  } catch (priorityErr) {
    console.error('❌ Priority calculation error, using category-tier fallback:', priorityErr);
    return categoryOnlyFallback(`Priority calculation service unavailable (${priorityErr.message}).`);
  }
}

// NOTE: this file used to also define generatePriorityReasoning(),
// getFallbackPriority(), getCategoryImportance(), and getPriorityLevelFromScore()
// -- a THIRD independent category->score/label table (after
// EmotionAnalysisService's ~30-category multiplier table and this app's own
// 8-class taxonomy), several of whose category names couldn't even occur in
// this app. All four are now provided by services/priorityConfig.js
// (getFallbackPriorityScore, getCategoryImportanceLabel, getPriorityLevel)
// and used directly at each call site, so there is exactly one category ->
// tier mapping in the codebase.

/**
 * Generate next steps based on priority level and category
 */
function generateNextSteps(priorityLevel, category) {
  const defaultSteps = [
    'Your complaint has been received and will be reviewed shortly.',
    'You can track the status of your complaint in the dashboard.',
    'A citizen representative will be assigned to your case.'
  ];

  if (priorityLevel === 'CRITICAL') {
    return [
      '🚨 Your complaint has been marked as CRITICAL priority.',
      'An urgent response team will be notified immediately.',
      'Expect a response within 24 hours.',
      'You can track real-time updates in your dashboard.'
    ];
  } else if (priorityLevel === 'HIGH') {
    return [
      '⚠️ Your complaint has been marked as HIGH priority.',
      'It will be reviewed by municipal staff within 48 hours.',
      'You will receive updates when your complaint status changes.',
      'Local authorities have been notified about this issue.'
    ];
  } else if (priorityLevel === 'MEDIUM') {
    return [
      'Your complaint has been marked as MEDIUM priority.',
      'It will be assessed within the next 3-5 business days.',
      'Similar complaints in your area will be addressed together for efficiency.',
      'Check back for status updates.'
    ];
  }
  
  return defaultSteps;
}

/**
 * Get complaints with pagination and filters
 * GET /api/complaints
 */
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10,
      status,
      category,
      userId,
      adminId,
      sort = 'created_at',
      order = 'desc',
      latitude,
      longitude,
      radius
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    let query = supabase
      .from('complaints')
      .select(`
        *,
        users:user_id (id, full_name, email)
      `, { count: 'exact' });
    
    // Apply filters if provided
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    if (userId) query = query.eq('user_id', userId);
    if (adminId) query = query.eq('assigned_admin_id', adminId);
    
    // Apply location-based filtering if latitude, longitude, and radius are provided
    if (latitude && longitude && radius) {
      console.log(`🌎 Filtering complaints by location: lat=${latitude}, lng=${longitude}, radius=${radius}m`);
      
      // Calculate the approximate distance in degrees for the radius
      const radiusInDegrees = parseFloat(radius) / 111000; // 1 degree is approximately 111km
      
      // Filter by bounding box first (more efficient than calculating exact distances for all records)
      query = query.filter(
        `location_latitude`, 'gte', parseFloat(latitude) - radiusInDegrees
      ).filter(
        `location_latitude`, 'lte', parseFloat(latitude) + radiusInDegrees
      ).filter(
        `location_longitude`, 'gte', parseFloat(longitude) - radiusInDegrees
      ).filter(
        `location_longitude`, 'lte', parseFloat(longitude) + radiusInDegrees
      );
    }
    
    // Apply sorting
    if (sort && order) {
      query = query.order(sort, { ascending: order.toLowerCase() === 'asc' });
    }
    
    // Apply pagination
    query = query.range(offset, offset + limit - 1);
    
    const { data, error, count } = await query;
    
    // If we have user authentication, add vote information to each complaint
    if (data && req.user) {
      const authenticatedUserId = req.user.id;
      
      // Vote counts are already included in complaints table, no need to fetch separately
      // Just get user votes for all complaints to check if user has voted
      const { data: userVotes, error: userVoteError } = await supabase
        .from('complaint_votes')
        .select('complaint_id, vote_type')
        .eq('user_id', authenticatedUserId)
        .in('complaint_id', data.map(c => c.id));
        
      // Map of user votes by complaint
      const userVoteMap = {};
      if (!userVoteError && userVotes) {
        userVotes.forEach(vote => {
          // User has upvoted if vote_type is 'upvote'
          userVoteMap[vote.complaint_id] = (vote.vote_type === 'upvote');
        });
      }
      
      // Add user vote information to each complaint (vote_count already exists in complaints table)
      data.forEach(complaint => {
        // vote_count is already available from complaints table
        complaint.userVoted = userVoteMap[complaint.id] || false;
      });
    }
    
    if (error) {
      throw new Error(error.message);
    }
    
    // Log the vote counts to help with debugging
    if (data) {
      console.log(`📊 Returning ${data.length} complaints with vote counts:`, 
        data.map(c => ({id: c.id, votes: c.vote_count || 0, userVoted: c.userVoted || false}))
      );
    }
    
    res.json({
      success: true,
      complaints: data,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / limit)
      }
    });
  } catch (error) {
    console.error('Fetch complaints error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Get all complaints
 * GET /api/complaints/all
 */
router.get('/all', async (req, res) => {
  try {
    console.log('📋 Fetching all complaints');
    
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      throw new Error(error.message);
    }
    
    console.log(`✅ Successfully fetched ${data.length} complaints`);
    
    res.json({
      success: true,
      complaints: data
    });
  } catch (error) {
    console.error('Fetch all complaints error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// NEW: Personal Reports - Get user's own complaints with Amazon-style tracking
router.get('/personal-reports', async (req, res) => {
  try {
    const userId = req.user?.id;
    console.log('🔍 Getting personal reports for user ID:', userId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Get all complaints by this user
    const { data: complaints, error: complaintsError } = await supabase
      .from('complaints')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (complaintsError) {
      console.error('Personal complaints query error:', complaintsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch your complaints'
      });
    }

    // Get workflow data for all complaints separately
    let workflowData = [];
    if (complaints && complaints.length > 0) {
      const complaintIds = complaints.map(c => c.id);
      const { data: workflows, error: workflowError } = await supabase
        .from('complaint_workflow')
        .select('*')
        .in('complaint_id', complaintIds);

      if (workflowError) {
        console.error('Personal workflow query error:', workflowError);
        workflowData = [];
      } else {
        workflowData = workflows || [];
      }
    }

    // Transform complaints with Amazon-style tracking stages
    const complaintsWithTracking = complaints?.map(complaint => {
      const workflow = workflowData.find(w => w.complaint_id === complaint.id);
      
      // Create Amazon-style tracking stages
      const trackingStages = [
        {
          id: 1,
          name: 'Complaint Submitted',
          status: 'completed',
          date: complaint.created_at,
          description: 'Your complaint has been received and is being reviewed',
          icon: '📝'
        },
        {
          id: 2,
          name: 'Initial Review',
          status: workflow?.step_1_status === 'completed' ? 'completed' : 
                 workflow?.step_1_status === 'in_progress' ? 'in_progress' : 'pending',
          date: workflow?.step_1_timestamp,
          description: 'Our team is reviewing your complaint for validity and priority',
          icon: '🔍',
          officer: workflow?.step_1_officer_id ? 'Assigned to officer' : null
        },
        {
          id: 3,
          name: 'Assessment & Planning',
          status: workflow?.step_2_status === 'completed' ? 'completed' : 
                 workflow?.step_2_status === 'in_progress' ? 'in_progress' : 'pending',
          date: workflow?.step_2_timestamp,
          description: 'Field assessment and resource planning in progress',
          icon: '📋',
          officer: workflow?.step_2_officer_id ? 'Officer assigned' : null,
          estimatedCost: workflow?.step_2_estimated_cost
        },
        {
          id: 4,
          name: 'Work in Progress',
          status: workflow?.step_3_status === 'completed' ? 'completed' : 
                 workflow?.step_3_status === 'in_progress' ? 'in_progress' : 'pending',
          date: workflow?.step_3_timestamp,
          description: 'Resolution work is being carried out',
          icon: '🔧',
          contractor: workflow?.step_3_contractor_id ? 'Contractor assigned' : null,
          startDate: workflow?.step_3_start_date
        },
        {
          id: 5,
          name: 'Completed',
          status: complaint.status === 'resolved' ? 'completed' : 'pending',
          date: workflow?.step_3_completion_date || (complaint.status === 'resolved' ? complaint.updated_at : null),
          description: complaint.status === 'resolved' ? 'Issue has been resolved successfully' : 'Awaiting completion',
          icon: complaint.status === 'resolved' ? '✅' : '⏳',
          photos: workflow?.step_3_completion_photos
        }
      ];

      return {
        ...complaint,
        trackingStages,
        currentStage: trackingStages.findIndex(stage => stage.status === 'in_progress') + 1 || 
                     (complaint.status === 'resolved' ? 5 : trackingStages.filter(stage => stage.status === 'completed').length + 1)
      };
    }) || [];

    // Calculate statistics
    const stats = {
      totalComplaints: complaints?.length || 0,
      resolved: complaints?.filter(c => c.status === 'resolved').length || 0,
      inProgress: complaints?.filter(c => c.status === 'in_progress').length || 0,
      pending: complaints?.filter(c => c.status === 'pending').length || 0,
      cancelled: complaints?.filter(c => c.status === 'cancelled').length || 0
    };

    console.log('✅ Personal reports fetched successfully:', stats);

    res.json({
      success: true,
      data: {
        complaints: complaintsWithTracking,
        stats
      }
    });

  } catch (error) {
    console.error('Personal reports endpoint error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch your reports'
    });
  }
});

/**
 * Get individual complaint details
 * GET /api/complaints/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const complaintId = req.params.id;
    
    if (!complaintId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Complaint ID is required' 
      });
    }

    console.log(`🔍 Fetching complaint details for ID: ${complaintId}`);

    // Get complaint details
    const { data: complaint, error } = await supabase
      .from('complaints')
      .select(`
        *,
        users!complaints_user_id_fkey (
          id,
          full_name,
          email
        )
      `)
      .eq('id', complaintId)
      .single();

    if (error) {
      console.error('❌ Error fetching complaint:', error);
      return res.status(404).json({ 
        success: false, 
        message: 'Complaint not found' 
      });
    }

    if (!complaint) {
      return res.status(404).json({ 
        success: false, 
        message: 'Complaint not found' 
      });
    }

    if (!complaint.users && complaint.user_id) {
      const { data: u } = await supabase
        .from('users')
        .select('id, full_name, email')
        .eq('id', complaint.user_id)
        .single();
      if (u) complaint.users = u;
    }

    const citizenFullName = complaint.users?.full_name || complaint.user_name || 'Verified Citizen';
    complaint.users = complaint.users || { full_name: citizenFullName, email: complaint.users?.email };
    complaint.user = complaint.users;
    complaint.user_name = citizenFullName;
    complaint.citizenName = citizenFullName;

    // Vote count is already available in complaints table (complaint.vote_count)
    const voteCount = complaint.vote_count || 0;

    // Check if current user has voted (if authenticated)
    let userVoted = false;
    if (req.user && req.user.id) {
      const { data: userVote, error: userVoteError } = await supabase
        .from('complaint_votes')
        .select('vote_type')
        .eq('complaint_id', complaintId)
        .eq('user_id', req.user.id)
        .eq('vote_type', 'upvote')
        .single();

      userVoted = !userVoteError && userVote;
    }

    // Add vote information to complaint
    complaint.vote_count = voteCount;
    complaint.userVoted = userVoted;

    console.log(`✅ Found complaint: ${complaint.title} with ${voteCount} votes`);

    res.json({
      success: true,
      complaint: complaint
    });
  } catch (error) {
    console.error('❌ Get complaint error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

/**
 * Toggle vote on a complaint
 * POST /api/complaints/vote
 * Requires authentication
 * Body: { complaintId: string }
 * Toggles between upvote (vote_count: 1) and downvote (vote_count: 0)
 */
router.post('/vote', async (req, res) => {
  try {
    // Check for authenticated user
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to vote on complaints'
      });
    }

    const { complaintId } = req.body;
    const userId = req.user.id;

    console.log('🗳️ Processing toggle vote request:', req.body);

    if (!complaintId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request. Required: complaintId'
      });
    }

    // First check if the complaint exists
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('id')
      .eq('id', complaintId)
      .single();

    if (complaintError || !complaint) {
      console.error('❌ Complaint not found:', complaintError || 'No data returned');
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }

    // See services/voteService.js - also recomputes and persists
    // complaints.vote_count from complaint_votes, which this endpoint used
    // to never do (it only mutated complaint_votes, so the visible count
    // never moved even though the vote itself was correctly recorded).
    const { action, userVoted, voteCount } = await toggleUpvote(supabase, complaintId, { userId });

    return res.status(200).json({
      success: true,
      message: action === 'voted' ? 'Vote added successfully' : 'Vote removed successfully',
      data: {
        complaint_id: complaintId,
        action,
        userVoted,
        voteCount
      }
    });

  } catch (error) {
    console.error('❌ Vote processing error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing vote'
    });
  }
});

/**
 * Get user vote status for complaints
 * GET /api/complaints/vote/status
 * Requires authentication
 * Query: { complaintIds: string } - comma-separated list of complaint IDs
 */
router.get('/vote/status', async (req, res) => {
  try {
    // Check for authenticated user
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authentication required to check vote status' 
      });
    }

    const { complaintIds } = req.query;
    const userId = req.user.id;

    if (!complaintIds) {
      return res.status(400).json({ 
        success: false, 
        message: 'complaintIds query parameter is required' 
      });
    }

    // Parse comma-separated complaint IDs
    const idsArray = complaintIds.split(',');
    
    // Get user's votes for these complaints
    const { data: votes, error } = await supabase
      .from('complaint_votes')
      .select('complaint_id, vote_type')
      .eq('user_id', userId)
      .in('complaint_id', idsArray)
      .eq('vote_type', 'upvote'); // Only consider upvotes

    if (error) {
      console.error('❌ Error fetching vote status:', error);
      return res.status(500).json({ 
        success: false, 
        message: 'Error fetching vote status' 
      });
    }

    // Build a map of complaint IDs to vote status
    const voteStatusMap = {};
    idsArray.forEach(id => {
      voteStatusMap[id] = false;
    });

    votes.forEach(vote => {
      voteStatusMap[vote.complaint_id] = true;
    });

    return res.status(200).json({
      success: true,
      data: voteStatusMap
    });
    
  } catch (error) {
    console.error('❌ Vote status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while getting vote status'
    });
  }
});

router.post('/create', async (req, res) => {
  res.json({
    success: true,
    message: 'Legacy endpoint - use /submit for new complaint submission'
  });
});

/**
 * Calculate priority score before complaint submission
 * This allows the frontend to display the priority before final submission
 * POST /api/complaints/calculate-priority
 */
router.post('/calculate-priority', async (req, res) => {
  try {
    console.log('🧮 Pre-submission priority calculation request:', req.body);
    
    const {
      category,
      description,
      imageValidation,
      locationData
    } = req.body;
    
    // Basic validation
    if (!category || !locationData || !locationData.latitude || !locationData.longitude) {
      return res.status(400).json({
        success: false,
        error: 'Category and location data are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }
    
    // Calculate comprehensive priority
    const priorityAnalysis = await calculateComprehensivePriority({
      imageValidation,
      locationData,
      category,
      description
    });
    
    // Format response for frontend
    const response = {
      success: true,
      priorityScore: Math.round(priorityAnalysis.totalScore * 100), // 0-100 scale for frontend
      priorityLevel: priorityAnalysis.priorityLevel,
      reasoningSummary: priorityAnalysis.reasoning.split('. ')[0] + '.',  // First sentence of reasoning
      reasoning: priorityAnalysis.reasoning,
      breakdown: {
        infrastructureScore: Math.round(priorityAnalysis.breakdown.infrastructureScore * 100),
        imageValidationScore: Math.round(priorityAnalysis.breakdown.imageValidationScore * 100),
        facilitiesCount: priorityAnalysis.facilitiesCount || 0
      },
      detailedBreakdown: priorityAnalysis.breakdown,
      metadata: {
        processingTimeMs: priorityAnalysis.processingTime,
        timestamp: new Date().toISOString(),
        apiVersion: 'v2'
      }
    };
    
    res.json(response);
    
  } catch (error) {
    console.error('Error calculating priority:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate complaint priority',
      message: error.message
    });
  }
});

module.exports = router;
