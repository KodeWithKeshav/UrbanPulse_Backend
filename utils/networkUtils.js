/**
 * Get the server configuration for cloud deployment
 * @returns {object} Server configuration with host and port
 */
function getServerConfig() {
  // In production/cloud environments, use 0.0.0.0 to bind to all interfaces
  const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '0.0.0.0';
  const port = process.env.PORT || 3001;
  
  // For cloud deployments, use the provided external URL or construct based on environment
  let baseUrl;
  if (process.env.NODE_ENV === 'production') {
    // For Render, the URL is typically https://your-app-name.onrender.com
    baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL || `https://your-app.onrender.com`;
  } else {
    // For development, use localhost
    baseUrl = `http://localhost:${port}`;
  }
  
  return {
    host,
    port: parseInt(port),
    url: baseUrl
  };
}

module.exports = {
  getServerConfig
};
