const jwt = require('jsonwebtoken');
const { supabase } = require('../config/supabase');

/**
 * Authentication middleware to validate JWT tokens
 * 
 * If a valid token is provided, the user information is attached to the request object.
 * If no token is provided or the token is invalid, the request continues but without user information.
 * This allows both authenticated and anonymous users to use the API.
 */
const authenticateUser = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    // If no token, continue as anonymous user
    if (!token) {
      console.log('🔒 No authentication token provided');
      req.user = null;
      return next();
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists and is active
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, full_name, user_type, is_active')
      .eq('id', decoded.userId)
      .eq('is_active', true)
      .single();
    
    if (error || !user) {
      console.log('🔒 User not found or inactive:', decoded.userId);
      req.user = null;
      return next();
    }
    
    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      userType: user.user_type,
      isAuthenticated: true
    };
    
    console.log(`🔓 Authenticated user: ${user.email} (${user.id})`);
    next();
  } catch (error) {
    console.log('🔒 Authentication error:', error.message);
    req.user = null;
    next();
  }
};

/**
 * Authorization middleware to restrict access to specific user types
 * @param {Array} allowedTypes - Array of allowed user types (e.g., ['admin', 'citizen'])
 */
const authorizeUserType = (allowedTypes) => {
  return (req, res, next) => {
    // If user is not authenticated
    if (!req.user || !req.user.isAuthenticated) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    // Check if user type is allowed
    if (!allowedTypes.includes(req.user.userType)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    next();
  };
};

module.exports = {
  authenticateUser,
  authorizeUserType
};
