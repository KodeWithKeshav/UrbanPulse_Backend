// Load environment variables from the project .env (resolve relative to this file)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const { supabase } = require('./config/supabase');
const { getServerConfig } = require('./utils/networkUtils');

// Debug environment variables only in development
if (process.env.NODE_ENV !== 'production') {
  console.log('🔧 Environment Debug:', {
    ROBOFLOW_API_KEY: process.env.ROBOFLOW_API_KEY ? 'SET' : 'NOT SET',
    SUPABASE_URL: process.env.SUPABASE_URL ? 'SET' : 'NOT SET',
    NODE_ENV: process.env.NODE_ENV || 'development'
  });
}

// Ensure JWT secret exists
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  } else {
    console.warn('⚠️  Using default JWT secret for development. Set JWT_SECRET in production!');
    process.env.JWT_SECRET = 'dev-secret-change-me';
  }
}

const app = express();
const serverConfig = getServerConfig();
const { host, port, url } = serverConfig;

// Make supabase available to routes
app.set('supabase', supabase);

// Middleware
app.use(helmet());

// Enable response compression for faster transfers
app.use(compression());

// CORS configuration - allow frontend origins
const allowedOrigins = [
  'http://localhost:8081', // Expo development server
  'http://localhost:3000', // React development server  
  'http://localhost:19006', // Expo web development
  'https://civic-rezo-frontend.netlify.app', // Production Netlify URL (placeholder)
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

// Lightweight logging - only in development
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('tiny'));
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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
app.use('/api/gradcam', require('./routes/gradcam'));
app.use('/api/weather', require('./routes/weather'));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'CivicStack Backend Server is running',
    timestamp: new Date().toISOString()
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to CivicStack API',
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

app.listen(port, host, () => {
  console.log(`🚀 CivicStack Backend Server is running on ${url}`);
  console.log(`📊 Health check: ${url}/health`);
  console.log(`📱 API endpoints: ${url}/api`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('⭐ Server is ready to accept connections');
});

module.exports = app;
