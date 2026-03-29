const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');
const LocationPriorityService = require('../services/LocationPriorityService');

// Initialize services
const locationPriorityService = new LocationPriorityService();

/**
 * Submit a new complaint with automatic location processing
 * POST /api/complaints/submit
 */
// Function to check the complaints table schema
async function checkComplaintsTableSchema() {
  try {
    console.log(' Checking complaints table schema...');
    // Introspect the table schema to see column names
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .limit(1);
      
    if (error) {
      console.error(' Schema check error:', error);
      return null;
    }
    
    if (data && data.length > 0) {
      console.log(' Available columns in complaints table:', Object.keys(data[0]));
      return Object.keys(data[0]);
    } else {
      console.log(' No records in complaints table to infer schema');
      return [];
    }
  } catch (error) {
    console.error(' Schema check failed:', error);
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
  const numericFields = ['priority_score', 'location_sensitivity_score', 'emotion_score', 'ai_confidence_score'];
  numericFields.forEach(field => {
    if (field in filteredData) {
      // Ensure value is a number between 0 and 9.99
      if (typeof filteredData[field] === 'number') {
        if (filteredData[field] >= 10) {
          console.log(` Adjusting ${field} from ${filteredData[field]} to 9.99 to prevent overflow`);
          filteredData[field] = 9.99;
        } else if (filteredData[field] < 0) {
          console.log(` Adjusting ${field} from ${filteredData[field]} to 0 to ensure positive value`);
          filteredData[field] = 0;
        } else {
          // Ensure we're working with 2 decimal places max
          filteredData[field] = parseFloat(filteredData[field].toFixed(2));
        }
      }
    }
  });
  
  console.log('Filtered complaint data for insertion:', filteredData);
  return filteredData;
}

router.post('/submit', async (req, res) => {
  try {
    console.log('New complaint submission:', req.body);
    
    
    const authenticatedUser = req.user;
    console.log('Authenticated user:', authenticatedUser ? authenticatedUser.id : 'None');
    
    
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
    
    // Calculate comprehensive priority score
    const priorityAnalysis = await calculateComprehensivePriority({
      imageValidation,
      locationData,
      category,
      description
    });
    
    const generateUuid = () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    };
    
    const isUuid = (str) => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      return uuidRegex.test(str);
    };
    
    // Create or ensure the demo user exists for foreign key constraint
    const ensureDemoUser = async () => {
      console.log('Checking for demo user...');
      
      // First, check if our default demo user exists
      const { data: existingUser, error: findError } = await supabase
        .from('users')
        .select('id')
        .eq('email', 'demo@urbanpulse.org')
        .limit(1);
      
      if (findError) {
        console.error(' Error checking for demo user:', findError);
      }
      
      // If user exists, return its ID
      if (existingUser && existingUser.length > 0) {
        console.log(' Using existing demo user:', existingUser[0].id);
        return existingUser[0].id;
      }
      
      console.log(' Demo user not found, creating one...');
      
      try {
        const { data: demoId, error: rpcError } = await supabase.rpc('create_demo_user');
        
        if (!rpcError && demoId) {
          console.log(' Created demo user via RPC:', demoId);
          return demoId;
        }
        
        if (rpcError) {
          console.log(' RPC function not available:', rpcError.message);
        }
      } catch (e) {
        console.log(' RPC call failed, falling back to direct insert');
      }
      
      const demoUuid = generateUuid();
      
      try {
        const { data, error: sqlError } = await supabase.rpc('execute_sql', {
          sql_query: `
            INSERT INTO users (
              id, email, password, full_name, phone_number, 
              user_type, address, is_active, created_at, updated_at
            ) VALUES (
              '${Uuid}', '${email}',
              '${username}', '${phNo}', 'citizen', '${address}', 
              true, NOW(), NOW()
            )
            RETURNING id;
          `
        });
        
        if (sqlError) {
          console.error(' SQL error creating demo user:', sqlError);
        } else {
          console.log(' Created demo user via SQL:', data);
          return demoUuid;
        }
      } catch (sqlExecError) {
        console.error(' SQL execution error:', sqlExecError);
      }
      
      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([{
          id: demoUuid,
          email: 'demo@urbanpulse.org',
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
        console.error(' Error creating demo user:', insertError);
        // All attempts failed, but we need to return something
        console.log(' All demo user creation methods failed, using generated UUID as fallback');
        return demoUuid;
      }
      
      console.log(' Created new demo user:', newUser[0].id);
      return newUser[0].id;
    };
    
    // Get a valid user ID for the database (actual user or demo)
    let userUuid;
    
    // If user is authenticated, use their ID
    if (authenticatedUser && authenticatedUser.id) {
      console.log(` Using authenticated user_id: ${authenticatedUser.id}`);
      userUuid = authenticatedUser.id;
    } 
    // If userId is provided in the request and it's a valid UUID, use it
    else if (isUuid(userId)) {
      console.log(` Using provided user_id: ${userId}`);
      userUuid = userId;
    } 
    // Otherwise create or find a demo user
    else {
      userUuid = await ensureDemoUser();
      console.log(` Using demo user_id: ${userUuid}`);
    }
    
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
      emotion_score: imageValidation?.confidence ? parseFloat((imageValidation.confidence).toFixed(2)) : 0.5,
      
      // Add AI confidence score if available
      ai_confidence_score: imageValidation?.modelConfidence ? 
        parseFloat((imageValidation.modelConfidence).toFixed(2)) : 0.5,
      
      // Images and media
      image_urls: imageUrl ? [imageUrl] : [],
      audio_url: null,
      
      // Status fields
      verification_status: imageValidation?.allowUpload ? 'verified' : 'unverified',
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
        console.error(' Supabase insert error:', error);
        
        // Provide more specific error handling for numeric overflow
        if (error.code === '22003' && error.message.includes('numeric field overflow')) {
          throw new Error(`Database error: Numeric field overflow. Scores must be less than 10 with up to 2 decimal places.`);
        }
        
        throw new Error(`Database error: ${error.message}`);
      }
      
      complaint = data;
      console.log(' Complaint saved to Supabase:', complaint);
      
      // After successful complaint submission, create an initial complaint update entry
      if (complaint && complaint[0] && complaint[0].id) {
        const complaintId = complaint[0].id;
        
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
          console.error(' Error creating complaint update entry:', updateError);
        } else {
          console.log(' Added initial complaint update entry');
        }
        
        
        // 2. Add entry to complaint_votes table (creator's vote)
        try {
          // Use a simpler approach - just delete existing votes first if any
          await supabase
            .from('complaint_votes')
            .delete()
            .eq('complaint_id', complaintId)
            .eq('user_id', userUuid);
            
          // Then insert a fresh upvote
          console.log('Adding initial upvote for complaint creator');
          const { data: voteData, error: voteError } = await supabase
            .from('complaint_votes')
            .insert([{
              complaint_id: complaintId,
              user_id: userUuid,
              vote_type: 'upvote'
            }]);
          
          if (voteError) {
            console.error(' Error creating complaint vote entry:', voteError);
          } else {
            console.log(' Added initial complaint vote entry');
          }
        } catch (voteErr) {
          console.error(' Exception in complaint vote creation:', voteErr);
        }
      }
    } catch (dbError) {
      console.error(' Database operation failed:', dbError);
      
      // Attempt to get table schema directly (alternative approach)
      try {
        const { data: schema } = await supabase.rpc('get_table_columns', { table_name: 'complaints' });
        if (schema) {
          console.log(' Complaints table columns:', schema);
        }
      } catch (e) {
        console.error('Could not fetch schema via RPC:', e);
      }
      
      throw new Error(`Database error: ${dbError.message}`);
    }
    
    // Prepare response - safe access in case structure changed
    const complaintRecord = complaint && complaint[0] ? complaint[0] : {}; 
    
    const response = {
      success: true,
      complaint: {
        id: complaintRecord.id || `temp-${Date.now()}`,
        title: complaintRecord.title || title,
        category: complaintRecord.category || category,
        priorityScore: complaintRecord.priority_score || Math.round(priorityAnalysis.totalScore * 100),
        status: complaintRecord.status || 'pending',
        submittedAt: complaintRecord.created_at || new Date().toISOString()
      },
      priorityAnalysis: {
        totalScore: priorityAnalysis.totalScore,
        priorityLevel: priorityAnalysis.priorityLevel,
        breakdown: {
          locationScore: priorityAnalysis.locationScore,
          imageScore: priorityAnalysis.imageScore,
          facilitiesNearby: priorityAnalysis.facilitiesCount
        },
        reasoning: priorityAnalysis.reasoning
      },
      location: {
        privacyLevel: locationData.privacyLevel,
        accuracy: locationData.accuracy ? `${locationData.accuracy}m` : 'Unknown',
        description: locationData.description
      },
      nextSteps: generateNextSteps(priorityAnalysis.priorityLevel, category),
    };
    
    res.json(response);
  } catch (error) {
    console.error(' Complaint submission error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to submit complaint',
      code: 'SUBMISSION_ERROR',
      details: error.message || 'Internal server error',
      suggestion: 'Please check your database schema and ensure all required fields are properly configured.'
    });
  }
});


async function calculateComprehensivePriority({ imageValidation, locationData, category, description }) {
  const startTime = Date.now();
  
  try {
    
    // Skip slow Google Places API calls if key is not configured
    // Without the key, LocationPriorityService retries dozens of calls with exponential backoff,
    // causing 30-60+ second hangs before falling back anyway
    if (!process.env.GOOGLE_PLACES_API_KEY) {
      console.log(' Google Places API key not configured - using fast fallback priority');
      const fallbackScore = getFallbackPriority(category);
      const imageScore = imageValidation?.confidence || imageValidation?.modelConfidence || 0;
      const totalScore = Math.min((fallbackScore * 0.6) + (imageScore * 0.4), 0.999);
      
      return {
        totalScore,
        priorityLevel: totalScore >= 0.8 ? 'CRITICAL' : totalScore >= 0.6 ? 'HIGH' : totalScore >= 0.4 ? 'MEDIUM' : 'LOW',
        locationScore: 0,
        imageScore,
        reasoning: `Priority assigned based on complaint type (${category}). Location analysis unavailable (Google Places API not configured).`,
        facilitiesCount: 0,
        processingTime: Date.now() - startTime,
        breakdown: {
          infrastructureScore: 0,
          imageValidationScore: imageScore,
          ageScore: 1.0,
          voteScore: 0,
          statusMultiplier: 1.0
        }
      };
    }
    
    let priorityResult = null;
    
    
    if (locationData && locationData.latitude && locationData.longitude) {
      try {
       
        priorityResult = await locationPriorityService.calculateComprehensivePriority(
          locationData.latitude,
          locationData.longitude,
          imageValidation || {},
          {
            complaintType: category,
            created_at: new Date().toISOString(),
            status: 'pending',
            votes: 0,
            locationMeta: {
              privacyLevel: locationData.privacyLevel,
              radiusM: locationData.accuracy,
              precision: locationData.precision,
              description: locationData.description
            }
          }
        );
        
        console.log('New priority calculation result:', priorityResult);
        
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
        console.error('New priority calculation error:', priorityErr);
        // Fall back to original calculation
      }
    }
    
    // Fallback to original calculation if new method fails
    
    // 1. Location-based priority (50% weight)
    let locationPriority = null;
    let locationScore = 0;
    
    if (locationData) {
      locationPriority = await locationPriorityService.calculateLocationPriority(
        locationData.latitude,
        locationData.longitude,
        category,
        {
          privacyLevel: locationData.privacyLevel,
          radiusM: locationData.radiusM,
          precision: locationData.precision,
          description: locationData.description
        }
      );
      locationScore = locationPriority.priorityScore || 0;
    }
    
    // 2. Image-based priority (40% weight)
    const imageScore = imageValidation?.data?.priorityScore || 0;
    
    // 3. Calculate weighted total score
    const totalScore = (locationScore * 0.6) + (imageScore * 0.4);
    
    // 4. Determine priority level
    let priorityLevel = 'LOW';
    if (totalScore >= 0.8) priorityLevel = 'CRITICAL';
    else if (totalScore >= 0.6) priorityLevel = 'HIGH';
    else if (totalScore >= 0.4) priorityLevel = 'MEDIUM';
    
    // 5. Generate reasoning
    const reasoning = generatePriorityReasoning({
      locationScore,
      imageScore,
      totalScore,
      priorityLevel,
      category,
      locationPriority,
      imageValidation
    });
    
    const processingTime = Date.now() - startTime;
    
    return {
      totalScore,
      priorityLevel,
      locationScore,
      imageScore,
      reasoning,
      facilitiesCount: locationPriority?.totalFacilities || 0,
      processingTime,
      breakdown: {
        infrastructureScore: locationScore,
        imageValidationScore: imageScore,
        ageScore: 1.0, // Default for new complaint
        voteScore: 0,
        statusMultiplier: 1.0
      }
    };
    
  } catch (error) {
    console.error(' Priority calculation error:', error);
    
    // Fallback priority based on complaint category
    const fallbackScore = getFallbackPriority(category);
    
    return {
      totalScore: Math.min(fallbackScore, 0.999),
      priorityLevel: fallbackScore >= 0.6 ? 'HIGH' : 'MEDIUM',
      locationScore: 0,
      imageScore: imageValidation?.data?.priorityScore || 0,
      reasoning: `Priority assigned based on complaint type (${category}). Location analysis unavailable.`,
      facilitiesCount: 0,
      processingTime: Date.now() - startTime
    };
  }
}

/**
 * Generate priority reasoning explanation
 */
function generatePriorityReasoning({ locationScore, imageScore, totalScore, priorityLevel, category, locationPriority, imageValidation }) {
  let reasoning = `${priorityLevel} priority assigned. `;
  
  // Location component
  if (locationScore > 0) {
    reasoning += `Location analysis: ${(locationScore * 100).toFixed(1)}% `;
    if (locationPriority?.reasoning) {
      reasoning += `(${locationPriority.reasoning.substring(0, 100)}...) `;
    }
  }
  
  // Image component
  if (imageScore > 0) {
    reasoning += `Image validation: ${(imageScore * 100).toFixed(1)}% `;
    if (imageValidation?.allowUpload) {
      reasoning += `(Valid civic issue detected) `;
    }
  }
  
  // Category-based component
  reasoning += `Category '${category}' is considered ${getCategoryImportance(category)}. `;
  
  return reasoning;
}

/**
 * Get fallback priority score based on complaint category
 */
function getFallbackPriority(category) {
  const categoryPriorities = {
    'road_damage': 0.7,
    'pothole': 0.65,
    'water_issue': 0.8,
    'sewage_overflow': 0.85,
    'garbage': 0.6,
    'streetlight': 0.55,
    'broken_streetlight': 0.6,
    'electricity': 0.75,
    'public_property_damage': 0.65,
    'tree_issue': 0.5,
    'flooding': 0.9,
    'traffic_signal': 0.8,
    'stray_animals': 0.4,
    'noise_pollution': 0.4,
    'air_pollution': 0.7,
    'other': 0.5
  };
  
  return categoryPriorities[category] || 0.5;
}

/**
 * Get category importance level for priority reasoning
 */
function getCategoryImportance(category) {
  const categoryImportance = {
    'road_damage': 'high-priority',
    'pothole': 'high-priority',
    'water_issue': 'critical',
    'sewage_overflow': 'critical',
    'garbage': 'medium-priority',
    'streetlight': 'medium-priority',
    'broken_streetlight': 'medium-priority',
    'electricity': 'high-priority',
    'public_property_damage': 'high-priority',
    'tree_issue': 'medium-priority',
    'flooding': 'critical',
    'traffic_signal': 'high-priority',
    'stray_animals': 'standard',
    'noise_pollution': 'standard',
    'air_pollution': 'high-priority',
    'other': 'standard'
  };
  
  return categoryImportance[category] || 'standard';
}

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
      ' Your complaint has been marked as CRITICAL priority.',
      'An urgent response team will be notified immediately.',
      'Expect a response within 24 hours.',
      'You can track real-time updates in your dashboard.'
    ];
  } else if (priorityLevel === 'HIGH') {
    return [
      ' Your complaint has been marked as HIGH priority.',
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
      console.log(` Filtering complaints by location: lat=${latitude}, lng=${longitude}, radius=${radius}m`);
      
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
      console.log(` Returning ${data.length} complaints with vote counts:`, 
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
    console.log(' Fetching all complaints');
    
    const { data, error } = await supabase
      .from('complaints')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      throw new Error(error.message);
    }
    
    console.log(` Successfully fetched ${data.length} complaints`);
    
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
    console.log(' Getting personal reports for user ID:', userId);

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
          icon: ''
        },
        {
          id: 2,
          name: 'Initial Review',
          status: workflow?.step_1_status === 'completed' ? 'completed' : 
                 workflow?.step_1_status === 'in_progress' ? 'in_progress' : 'pending',
          date: workflow?.step_1_timestamp,
          description: 'Our team is reviewing your complaint for validity and priority',
          icon: '',
          officer: workflow?.step_1_officer_id ? 'Assigned to officer' : null
        },
        {
          id: 3,
          name: 'Assessment & Planning',
          status: workflow?.step_2_status === 'completed' ? 'completed' : 
                 workflow?.step_2_status === 'in_progress' ? 'in_progress' : 'pending',
          date: workflow?.step_2_timestamp,
          description: 'Field assessment and resource planning in progress',
          icon: '',
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
          icon: '',
          contractor: workflow?.step_3_contractor_id ? 'Contractor assigned' : null,
          startDate: workflow?.step_3_start_date
        },
        {
          id: 5,
          name: 'Completed',
          status: complaint.status === 'resolved' ? 'completed' : 'pending',
          date: workflow?.step_3_completion_date || (complaint.status === 'resolved' ? complaint.updated_at : null),
          description: complaint.status === 'resolved' ? 'Issue has been resolved successfully' : 'Awaiting completion',
          icon: complaint.status === 'resolved' ? '' : '',
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

    console.log(' Personal reports fetched successfully:', stats);

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

    console.log(` Fetching complaint details for ID: ${complaintId}`);

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
      console.error(' Error fetching complaint:', error);
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

    console.log(` Found complaint: ${complaint.title} with ${voteCount} votes`);

    res.json({
      success: true,
      complaint: complaint
    });
  } catch (error) {
    console.error(' Get complaint error:', error);
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

    console.log(` Processing toggle vote request:`, req.body);
    
    if (!complaintId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid request. Required: complaintId' 
      });
    }

    // First check if the complaint exists
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('*')
      .eq('id', complaintId)
      .single();

    if (complaintError || !complaint) {
      console.error(' Complaint not found:', complaintError || 'No data returned');
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
      console.error(' Error checking existing vote:', voteError);
      return res.status(500).json({ 
        success: false, 
        message: 'Error checking vote status' 
      });
    }

    let result;

    // Process vote with simple upvote/downvote toggle logic
    if (!existingVote) {
      // User hasn't voted yet - add upvote
      console.log(' Adding new upvote for user');
      const { data: newVote, error: insertError } = await supabase
        .from('complaint_votes')
        .insert([
          { 
            complaint_id: complaintId, 
            user_id: userId,
            vote_type: 'upvote'
          }
        ])
        .select();

      if (insertError) {
        console.error(' Error adding vote:', insertError);
        return res.status(500).json({ 
          success: false, 
          message: 'Failed to add vote',
          details: insertError.message
        });
      }

      result = newVote[0];
      result.action = 'voted';
      console.log(' Vote added successfully');
      
    } else {
      // User has already voted - toggle the vote
      if (existingVote.vote_type === 'upvote') {
        // Currently upvoted - DELETE the vote record completely (don't create downvote)
        console.log(' Removing upvote (deleting vote record)');
        const { error: deleteError } = await supabase
          .from('complaint_votes')
          .delete()
          .eq('complaint_id', complaintId)
          .eq('user_id', userId);

        if (deleteError) {
          console.error(' Error deleting vote:', deleteError);
          return res.status(500).json({ 
            success: false, 
            message: 'Failed to remove vote',
            details: deleteError.message
          });
        }

        result = { vote_type: null, action: 'unvoted' };
        console.log(' Vote deleted successfully');
        
      } else {
        // Currently has downvote or other vote type - change to upvote
        console.log(' Changing to upvote');
        const { data: updatedVote, error: updateError } = await supabase
          .from('complaint_votes')
          .update({ 
            vote_type: 'upvote'
          })
          .eq('complaint_id', complaintId)
          .eq('user_id', userId)
          .select();

        if (updateError) {
          console.error(' Error updating to upvote:', updateError);
          return res.status(500).json({ 
            success: false, 
            message: 'Failed to add vote',
            details: updateError.message
          });
        }

        result = updatedVote[0];
        result.action = 'voted';
        console.log(' Vote updated to upvote successfully');
      }
    }

    // Get updated vote count directly from complaints table (more efficient)
    const { data: complaintData, error: countError } = await supabase
      .from('complaints')
      .select('vote_count')
      .eq('id', complaintId)
      .single();

    const voteCount = countError ? 0 : (complaintData?.vote_count || 0);

    // Determine user voted status based on the result
    const userVoted = result.vote_type === 'upvote';
    
    // Return the updated vote information
    const message = result.action === 'voted' ? 'Vote added successfully' : 'Vote removed successfully';
    return res.status(200).json({
      success: true,
      message: message,
      data: {
        ...result,
        voteCount: voteCount,
        userVoted: userVoted
      }
    });
    
  } catch (error) {
    console.error(' Vote processing error:', error);
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
      console.error(' Error fetching vote status:', error);
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
    console.error(' Vote status error:', error);
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
    console.log(' Pre-submission priority calculation request:', req.body);
    
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


