const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

class GradCamService {
    constructor() {
        this.pythonServiceUrl = process.env.GRADCAM_SERVICE_URL || 'http://localhost:5002';
    }

    /**
     * Get explanation for an uploaded image file
     * @param {string} imagePath - Local path to the image
     * @param {Object} options - Explanation options
     * @returns {Promise<Object>}
     */
    async explainImageFile(imagePath, options = {}) {
        try {
            const form = new FormData();
            form.append('image', fs.createReadStream(imagePath));
            
            if (options.architecture) form.append('architecture', options.architecture);
            if (options.modelPath) form.append('model_path', options.modelPath);
            if (options.targetLayer) form.append('target_layer', options.targetLayer);
            if (options.targetClass !== undefined) form.append('target_class', options.targetClass);
            if (options.camMethod) form.append('cam_method', options.camMethod);

            const response = await axios.post(`${this.pythonServiceUrl}/explain`, form, {
                headers: {
                    ...form.getHeaders()
                },
                maxBodyLength: Infinity,
                timeout: 30000 // 30 seconds timeout
            });

            return response.data;
        } catch (error) {
            console.error('Grad-CAM Service Error (File):', error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
            }
            throw new Error(error.response?.data?.error || error.message);
        }
    }

    /**
     * Get explanation for an image URL
     * @param {string} imageUrl - URL of the image
     * @param {Object} options - Explanation options
     * @returns {Promise<Object>}
     */
    async explainImageUrl(imageUrl, options = {}) {
        try {
            const payload = {
                image_url: imageUrl,
                ...options
            };

            const response = await axios.post(`${this.pythonServiceUrl}/explain/url`, payload, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });

            return response.data;
        } catch (error) {
            console.error('Grad-CAM Service Error (URL):', error.message);
            if (error.response) {
                console.error('Response data:', error.response.data);
            }
            throw new Error(error.response?.data?.error || error.message);
        }
    }

    /**
     * Check if the python service is healthy
     */
    async checkHealth() {
        try {
            const response = await axios.get(`${this.pythonServiceUrl}/health`);
            return response.data;
        } catch (error) {
            return { status: 'down', error: error.message };
        }
    }
}

module.exports = new GradCamService();
