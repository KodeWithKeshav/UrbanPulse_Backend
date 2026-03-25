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
  const numericFields = ['priority_score', 'location_sensitivity_score', 'emotion_score', 'ai_confidence_score'];
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
      
      // User information 
      user_id: userId || 'demo_user',
      
      // Timestamps that should be in any database
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
        console.error('❌ Supabase insert error:', error);
        
        // Provide more specific error handling for numeric overflow
        if (error.code === '22003' && error.message.includes('numeric field overflow')) {
          throw new Error(`Database error: Numeric field overflow. Scores must be less than 10 with up to 2 decimal places.`);
        }
        
        throw new Error(`Database error: ${error.message}`);
      }
      
      complaint = data;
      console.log('✅ Complaint saved to Supabase:', complaint);
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
        accuracy: locationData.accuracy ? `±${locationData.accuracy}m` : 'Unknown',
        description: locationData.description
      },
      nextSteps: generateNextSteps(priorityAnalysis.priorityLevel, category),
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
 * Calculate comprehensive priority score combining image and location analysis
 */
async function calculateComprehensivePriority({ imageValidation, locationData, category, description }) {
  const startTime = Date.now();
  
  try {
    // 1. Location-based priority (60% weight)
    let locationPriority = null;
    let locationScore = 0;
    
    if (locationData) {
      try {
        locationPriority = await locationPriorityService.calculateLocationPriority(
          locationData.latitude,
          locationData.longitude,
          category,
          {
            privacyLevel: locationData.privacyLevel,
            radiusM: locationData.accuracy,
            precision: locationData.precision,
            description: locationData.description
          }
        );
        locationScore = locationPriority?.priorityScore || 0;
      } catch (locErr) {
        console.error('❌ Location priority calculation error:', locErr);
        // Fallback to a default score
        locationScore = 0.5;
      }
    }
    
    // 2. Image-based priority (40% weight)
    const imageScore = imageValidation?.data?.priorityScore || 
                      (imageValidation?.confidence ? imageValidation.confidence : 0.5);
    
    // 3. Calculate weighted total score - ensure it's within database constraints (< 10)
    const totalScore = Math.min((locationScore * 0.6) + (imageScore * 0.4), 0.999);
    
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
      processingTime
    };
    
  } catch (error) {
    console.error('❌ Priority calculation error:', error);
    
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
      order = 'desc'
    } = req.query;
    
    const offset = (page - 1) * limit;
    
    let query = supabase
      .from('complaints')
      .select('*', { count: 'exact' });
    
    // Apply filters if provided
    if (status) query = query.eq('status', status);
    if (category) query = query.eq('category', category);
    if (userId) query = query.eq('user_id', userId);
    if (adminId) query = query.eq('assigned_admin_id', adminId);
    
    // Apply sorting
    if (sort && order) {
      query = query.order(sort, { ascending: order.toLowerCase() === 'asc' });
    }
    
    // Apply pagination
    query = query.range(offset, offset + limit - 1);
    
    const { data, error, count } = await query;
    
    if (error) {
      throw new Error(error.message);
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

router.post('/create', async (req, res) => {
  res.json({
    success: true,
    message: 'Legacy endpoint - use /submit for new complaint submission'
  });
});

module.exports = router;
