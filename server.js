// Load environment variables from the project .env (no hardcoded absolute paths)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { supabase } = require('./config/supabase');
const { getServerConfig } = require('./utils/networkUtils');

// Debug environment variables
console.log(' Environment Debug:', {
    ROBOFLOW_API_KEY: process.env.ROBOFLOW_API_KEY ? 'SET' : 'NOT SET',
    ROBOFLOW_WORKSPACE: process.env.ROBOFLOW_WORKSPACE || 'NOT SET',
    ROBOFLOW_WORKFLOW: process.env.ROBOFLOW_WORKFLOW || 'NOT SET',
    ROBOFLOW_API_URL: process.env.ROBOFLOW_API_URL || 'NOT SET',
    SUPABASE_URL: process.env.SUPABASE_URL ? 'SET' : 'NOT SET',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY ? 'SET' : 'NOT SET',
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || '3001'
});

// Ensure JWT secret exists
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  } else {
    console.warn('  Using default JWT secret for development. Set JWT_SECRET in production!');
    process.env.JWT_SECRET = 'dev-secret-change-me';
  }
}

const app = express();
const serverConfig = getServerConfig();
const { host, port, url } = serverConfig;

// Make supabase available to routes
app.set('supabase', supabase);

// Log connection status
console.log(' Supabase client initialized');

// Middleware
app.use(helmet());

// CORS configuration - allow frontend origins
const allowedOrigins = [
  'http://localhost:8081', // Expo development server
  'http://localhost:3000', // React development server  
  'http://localhost:19006', // Expo web development
  'https://urban-pulse-frontend.netlify.app', // Production Netlify URL (placeholder)
  process.env.FRONTEND_URL // Allow custom frontend URL from environment
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // In development, allow all origins
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// More detailed logging for API requests
app.use(morgan(':remote-addr - :method :url :status :res[content-length] - :response-time ms'));

// Add custom middleware to log request bodies for debugging
app.use((req, res, next) => {
  // Log API request details
  if (req.url.startsWith('/api/')) {
    const logInfo = {
      method: req.method,
      url: req.url,
      query: req.query,
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type']
      }
    };
    
    // Only log request body for POST/PUT methods and if it exists
    if ((req.method === 'POST' || req.method === 'PUT') && req.body && Object.keys(req.body).length > 0) {
      // Truncate request body to avoid huge logs
      const bodyStr = JSON.stringify(req.body);
      logInfo.body = bodyStr.length > 200 ? bodyStr.substring(0, 200) + '...' : bodyStr;
    }
    
    console.log(' API REQUEST:', JSON.stringify(logInfo));
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth middleware - applies to all routes
const { authenticateUser } = require('./middleware/auth');
app.use(authenticateUser);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/complaints', require('./routes/complaints'));
app.use('/api/complaint-details', require('./routes/complaintDetails'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin-enhanced', require('./routes/adminMinimal'));
app.use('/api/image-analysis', require('./routes/imageAnalysis'));
app.use('/cloudinary', require('./routes/cloudinary'));
app.use('/api/location-priority', require('./routes/locationPriority'));
app.use('/api/heat-map', require('./routes/heatMap'));
app.use('/transcribe', require('./routes/transcription'));
app.use('/api/transcribe', require('./routes/transcribe'));
app.use('/api/chatbot', require('./routes/chatbot'));
app.use('/api/statistics', require('./routes/statistics'));
app.use('/api/transparency', require('./routes/transparency'));
app.use('/api/emotion', require('./routes/emotion'));
app.use('/api/simplified-votes', require('./routes/simplified-votes'));
app.use('/api/guest-votes', require('./routes/guest-votes'));
app.use('/api/feedback', require('./routes/feedback'));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'UrbanPulse Backend Server is running',
    timestamp: new Date().toISOString()
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to UrbanPulse API',
    version: '1.0.0',
    endpoints: [
      '/api/auth - Authentication routes',
      '/api/complaints - Complaint management',
      '/api/admin - Basic admin dashboard',
      '/api/admin-enhanced - Advanced admin workflow management',
      '/health - Health check'
    ]
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
  error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

app.listen(port, '0.0.0.0', () => {
  console.log(` UrbanPulse Backend Server is running on ${url}`);
  console.log(` Health check: ${url}/health`);
  console.log(` API endpoints: ${url}/api`);
  console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(' Server is ready to accept connections');
});

module.exports = app;


