# 🚀 Deploying CIVIC REZO Backend to Render

This guide will help you deploy your Node.js backend to Render.

## Prerequisites

- A GitHub account
- Your code pushed to a GitHub repository
- A Render account (free tier available at https://render.com)

## Step-by-Step Deployment Guide

### 1. Push Your Code to GitHub

First, make sure your code is pushed to a GitHub repository:

```bash
# Initialize git if you haven't already
git init

# Add all files
git add .

# Commit your changes
git commit -m "Initial commit for Render deployment"

# Add your remote repository (replace with your GitHub repo URL)
git remote add origin https://github.com/YOUR_USERNAME/CIVIC-REZO-Backend.git

# Push to GitHub
git push -u origin main
```

### 2. Sign Up for Render

1. Go to https://render.com
2. Click "Get Started" or "Sign Up"
3. Sign up with GitHub (recommended for easier integration)

### 3. Create a New Web Service

1. From your Render dashboard, click **"New +"** button
2. Select **"Web Service"**
3. Connect your GitHub repository:
   - If first time, authorize Render to access your GitHub
   - Select the `CIVIC-REZO-Backend` repository
4. Configure your web service:

#### Basic Configuration:
- **Name**: `civic-rezo-backend` (or any name you prefer)
- **Region**: Choose the closest to your users (e.g., Singapore, Oregon, Frankfurt)
- **Branch**: `main` (or your default branch)
- **Root Directory**: Leave blank (unless your backend is in a subdirectory)
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`

#### Instance Type:
- Select **"Free"** for testing (includes 750 hours/month free)
- Note: Free tier sleeps after 15 minutes of inactivity

### 4. Add Environment Variables

Scroll down to the **Environment Variables** section and add these variables one by one:

**Click "Add Environment Variable" for each:**

```
NODE_ENV = production
PORT = 3001
JWT_SECRET = civic-rezo-super-secret-jwt-key-2026
SUPABASE_URL = https://edragfuoklcgdgtospuq.supabase.co
SUPABASE_ANON_KEY = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkcmFnZnVva2xjZ2RndG9zcHVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1NDE3MjMsImV4cCI6MjA3MjExNzcyM30.A58Ms03zTZC6J5OuhQbkkZQy-5uTxgu4vlLilrjPEwo
ROBOFLOW_API_KEY = dRfPw6fcbBzHQ2lhg7cc
ROBOFLOW_WORKSPACE = civicrezo
ROBOFLOW_WORKFLOW = custom-workflow-6
ROBOFLOW_API_URL = https://serverless.roboflow.com
ROBOFLOW_MODEL_ENDPOINT = https://serverless.roboflow.com/infer/workflows/civicrezo/custom-workflow-6
OPENAI_API_KEY = your_openai_api_key_here
CLOUDINARY_CLOUD_NAME = your_cloudinary_cloud_name
CLOUDINARY_API_KEY = your_cloudinary_api_key
CLOUDINARY_API_SECRET = your_cloudinary_api_secret
USE_OPENSTREETMAP = true
NOMINATIM_URL = https://nominatim.openstreetmap.org
OVERPASS_URL = https://overpass-api.de/api/interpreter
OSRM_URL = https://router.project-osrm.org
PLACES_SEARCH_RADIUS = 1000
MAX_PLACES_RESULTS = 20
LOCATION_CACHE_DURATION = 86400
ENABLE_LOCATION_FALLBACK = true
PLACES_API_RATE_LIMIT = 100
GEOCODING_API_RATE_LIMIT = 50
WIT_AI_TOKEN = DLHJZZTU2ZXDLJW2PB5E3IMCHYPKAUSZ
SARVAM_API_KEY = sk_2xnkkrid_QkpU1rOIZDj5bsUxtbaZhaaB
QUICK_DEV_MODE = false
```

### 5. Deploy

1. Click **"Create Web Service"** at the bottom
2. Render will automatically:
   - Clone your repository
   - Install dependencies (`npm install`)
   - Start your server (`npm start`)

### 6. Monitor Deployment

- Watch the deployment logs in real-time
- Wait for the "Your service is live 🎉" message
- You'll get a URL like: `https://civic-rezo-backend.onrender.com`

### 7. Update Your Expo Frontend

Once deployed, update your Expo frontend to use the new backend URL:

In your Expo app configuration or API client:

```javascript
// Replace localhost with your Render URL
const API_BASE_URL = 'https://civic-rezo-backend.onrender.com';
// or
const API_BASE_URL = 'https://YOUR-SERVICE-NAME.onrender.com';
```

### 8. Test Your Deployment

Test your deployed backend:

```bash
# Health check
curl https://YOUR-SERVICE-NAME.onrender.com/health

# Or visit in browser
https://YOUR-SERVICE-NAME.onrender.com/health
```

## Important Notes

### Free Tier Limitations:
- ⏱️ Service sleeps after 15 minutes of inactivity
- 🐌 First request after sleep takes ~30 seconds to wake up
- 📊 750 free hours per month
- 💾 Limited memory (512 MB)

### To Prevent Sleep (Optional):
1. Upgrade to a paid plan ($7/month for Starter)
2. Use a service like [Uptime Robot](https://uptimerobot.com/) to ping your API every 5 minutes

### Auto-Deploy:
Render automatically redeploys when you push to your GitHub repository!

```bash
git add .
git commit -m "Update backend"
git push
# Render will automatically deploy the changes
```

## Troubleshooting

### If deployment fails:

1. **Check the logs** in the Render dashboard
2. **Common issues:**
   - Missing environment variables → Add them in Render dashboard
   - Port binding issue → Make sure server listens on `process.env.PORT`
   - Build failures → Check `package.json` scripts

### View Logs:
- Click on your service in Render dashboard
- Go to "Logs" tab
- Check for any errors

### Environment Variables:
- Go to "Environment" tab
- Verify all variables are set correctly
- Make sure there are no extra spaces

## Alternative: Deploy Using render.yaml

We've included a `render.yaml` file. To use it:

1. Go to Render Dashboard
2. Click **"New +"** → **"Blueprint"**
3. Connect your repository
4. Render will detect the `render.yaml` and auto-configure
5. You'll still need to add secret environment variables manually

## Connect with Expo Frontend

In your Expo app, update the API base URL:

### Option 1: Environment Variables
Create a `.env` file in your Expo project:
```
EXPO_PUBLIC_API_URL=https://YOUR-SERVICE-NAME.onrender.com
```

### Option 2: Configuration File
Update `app.config.js` or similar:
```javascript
export default {
  extra: {
    apiUrl: 'https://YOUR-SERVICE-NAME.onrender.com'
  }
}
```

### Option 3: Direct Update
Find where you make API calls and update:
```javascript
const API_URL = 'https://YOUR-SERVICE-NAME.onrender.com';
```

## Support

- 📧 Render Support: https://render.com/docs
- 💬 Community: https://community.render.com
- 📚 Render Docs: https://render.com/docs/deploy-node-express-app

---

**Your backend is now live! 🎉**
