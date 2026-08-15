const express = require('express');
const router = express.Router();
const { supabase } = require('../config/supabase');

/**
 * Submit feedback for a complaint submission experience
 * POST /api/feedback/submit
 * Body: { complaintId: string, rating: number (1-5), feedback: string, improvements: string }
 */
router.post('/submit', async (req, res) => {
  try {
    console.log('📝 Processing feedback submission:', req.body);
    
    const { complaintId, rating, feedback, improvements, submittedAt } = req.body;
    
    // Validation
    if (!complaintId || !rating) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: complaintId and rating are required'
      });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }
    
    // Check if complaint exists
    const { data: complaint, error: complaintError } = await supabase
      .from('complaints')
      .select('id, title')
      .eq('id', complaintId)
      .single();
      
    if (complaintError || !complaint) {
      console.error('❌ Complaint not found:', complaintError);
      return res.status(404).json({
        success: false,
        message: 'Complaint not found'
      });
    }
    
    // Prepare feedback data
    const feedbackData = {
      complaint_id: complaintId,
      user_id: req.user?.id || null, // Authenticated user or null for guest
      rating: parseInt(rating),
      feedback_text: feedback || null,
      improvement_suggestions: improvements || null,
      submitted_at: submittedAt || new Date().toISOString(),
      created_at: new Date().toISOString()
    };
    
    // Insert feedback into database
    const { data: newFeedback, error: insertError } = await supabase
      .from('complaint_feedback')
      .insert([feedbackData])
      .select();
      
    if (insertError) {
      console.error('❌ Error inserting feedback:', insertError);
      
      // If table doesn't exist, create it
      if (insertError.code === '42P01') {
        console.log('📋 Creating complaint_feedback table...');
        
        const { error: createTableError } = await supabase.rpc('create_feedback_table', {});
        
        if (createTableError) {
          console.error('❌ Error creating feedback table:', createTableError);
          return res.status(500).json({
            success: false,
            message: 'Failed to create feedback table'
          });
        }
        
        // Retry insertion
        const { data: retryFeedback, error: retryError } = await supabase
          .from('complaint_feedback')
          .insert([feedbackData])
          .select();
          
        if (retryError) {
          console.error('❌ Error inserting feedback after table creation:', retryError);
          return res.status(500).json({
            success: false,
            message: 'Failed to submit feedback'
          });
        }
        
        newFeedback = retryFeedback;
      } else {
        return res.status(500).json({
          success: false,
          message: 'Failed to submit feedback',
          details: insertError.message
        });
      }
    }
    
    console.log('✅ Feedback submitted successfully:', newFeedback?.[0]?.id);
    
    // Return success response
    return res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      data: {
        feedbackId: newFeedback?.[0]?.id,
        complaintId: complaintId,
        rating: rating,
        submittedAt: feedbackData.submitted_at
      }
    });
    
  } catch (error) {
    console.error('❌ Error processing feedback submission:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while processing feedback'
    });
  }
});

/**
 * Get feedback statistics (for admin dashboard)
 * GET /api/feedback/stats
 */
router.get('/stats', async (req, res) => {
  try {
    console.log('📊 Getting feedback statistics...');
    
    // Get overall statistics
    const { data: stats, error: statsError } = await supabase
      .from('complaint_feedback')
      .select('rating, created_at');
      
    if (statsError) {
      console.error('❌ Error getting feedback stats:', statsError);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve feedback statistics'
      });
    }
    
    // Calculate statistics
    const totalFeedback = stats.length;
    const averageRating = totalFeedback > 0 
      ? (stats.reduce((sum, item) => sum + item.rating, 0) / totalFeedback).toFixed(2)
      : 0;
      
    const ratingDistribution = {
      1: stats.filter(s => s.rating === 1).length,
      2: stats.filter(s => s.rating === 2).length,
      3: stats.filter(s => s.rating === 3).length,
      4: stats.filter(s => s.rating === 4).length,
      5: stats.filter(s => s.rating === 5).length,
    };
    
    // Get recent feedback with text
    const { data: recentFeedback, error: recentError } = await supabase
      .from('complaint_feedback')
      .select('rating, feedback_text, improvement_suggestions, created_at')
      .not('feedback_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10);
    
    const responseData = {
      totalFeedback,
      averageRating: parseFloat(averageRating),
      ratingDistribution,
      recentFeedback: recentError ? [] : recentFeedback
    };
    
    console.log('✅ Feedback statistics retrieved');
    
    return res.status(200).json({
      success: true,
      data: responseData
    });
    
  } catch (error) {
    console.error('❌ Error getting feedback statistics:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while retrieving statistics'
    });
  }
});

module.exports = router;
