/**
 * Get the server configuration for cloud deployment
 * @returns {object} Server configuration with host and port
 */
function getServerConfig() {
  // Use SERVER_HOST from env if available, otherwise bind to all interfaces
  const host = process.env.SERVER_HOST || '0.0.0.0';
  const port = process.env.PORT || 3001;
  
  // For cloud deployments, use the provided external URL or construct based on environment
  let baseUrl;
  if (process.env.NODE_ENV === 'production') {
    // For Render, the URL is typically https://your-app-name.onrender.com
    baseUrl = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL || `https://your-app.onrender.com`;
  } else {
    // For development, use the SERVER_HOST or localhost
    const displayHost = process.env.SERVER_HOST || 'localhost';
    baseUrl = `http://${displayHost}:${port}`;
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
