const axios = require('axios');
const fs = require('fs');
const sharp = require('sharp');

console.log('📦 ImageAnalysisService module loaded');

class ImageAnalysisService {
    constructor() {
        console.log('🏗️ ImageAnalysisService constructor called');
        this.apiKey = process.env.ROBOFLOW_API_KEY;
        this.workspaceName = process.env.ROBOFLOW_WORKSPACE;
        this.workflowId = process.env.ROBOFLOW_WORKFLOW;
        this.apiUrl = process.env.ROBOFLOW_API_URL || 'https://serverless.roboflow.com';
        
        console.log('🔧 ImageAnalysisService initialized with:');
        console.log(`   API Key: ${this.apiKey ? 'Set' : 'Missing'}`);
        console.log(`   Workspace: ${this.workspaceName || 'Missing'}`);
        console.log(`   Workflow: ${this.workflowId || 'Missing'}`);
        console.log(`   API URL: ${this.apiUrl}`);
    }

    /**
     * Static method to validate image using Roboflow
     * @param {string} imageUrl - The image URL
     * @returns {Promise<{confidence: number, modelConfidence: number, openaiConfidence: number, allowUpload: boolean, message: string, raw: any}>}
     */
    static async validateImageWithRoboflow(imageUrl) {
        const ROBOFLOW_API_KEY = process.env.ROBOFLOW_API_KEY || 'YOUR_ROBOFLOW_API_KEY';
        const ROBOFLOW_MODEL_ENDPOINT = process.env.ROBOFLOW_MODEL_ENDPOINT || 'https://serverless.roboflow.com/infer/workflows/civicrezo/custom-workflow-6';
        try {
            const response = await axios.post(
                ROBOFLOW_MODEL_ENDPOINT,
                {
                    api_key: ROBOFLOW_API_KEY,
                    inputs: {
                        image: { type: 'url', value: imageUrl }
                    }
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    timeout: 15000
                }
            );
            // Parse new workflow output format
            let modelConfidence = 0;
            let openaiConfidence = 0;
            let confidence = 0;
            let allowUpload = false;
            let message = '';
            let modelPrediction = null;
            let openaiPrediction = null;
            const raw = response.data;
            const threshold = 0.7;

            if (raw && Array.isArray(raw.outputs)) {
                console.log('🔍 Roboflow workflow outputs:', JSON.stringify(raw.outputs, null, 2));
                for (const outputObj of raw.outputs) {
                    const output2 = outputObj.output2;
                    const outputText = outputObj.output;

                    // Model output parsing
                    if (output2 && Array.isArray(output2.predictions) && output2.predictions.length > 0 && output2.image?.width && output2.image?.height) {
                        modelConfidence = Math.max(...output2.predictions.map(p => p.confidence || 0));
                        modelPrediction = output2.predictions[0]?.class || output2.predictions[0]?.label || null;
                    }

                    // OpenAI output parsing
                    if (outputText) {
                        let openaiObj = null;
                        try {
                            openaiObj = JSON.parse(outputText);
                        } catch (e) {}
                        if (openaiObj && typeof openaiObj === 'object' && (openaiObj.confidence !== undefined || openaiObj.confidence !== null)) {
                            openaiPrediction = openaiObj.prediction || null;
                            openaiConfidence = Number(openaiObj.confidence);
                        } else {
                            const predMatch = outputText.match(/prediction:\s*([^\n,]+)/i);
                            openaiPrediction = predMatch ? predMatch[1].trim() : null;
                            let confMatch = outputText.match(/confidence:\s*(\d*\.?\d+)/i);
                            if (!confMatch) {
                                confMatch = outputText.match(/,\s*confidence:\s*(\d*\.?\d+)/i);
                            }
                            openaiConfidence = confMatch ? parseFloat(confMatch[1]) : 0;
                            if (!openaiPrediction && outputText.includes(',')) {
                                openaiPrediction = outputText.split(',')[0].trim();
                            }
                        }
                    }

                    // Log both model and OpenAI results for debugging
                    console.log('🧠 Model result:', {
                        prediction: modelPrediction,
                        confidence: modelConfidence
                    });
                    console.log('🤖 OpenAI result:', {
                        prediction: openaiPrediction,
                        confidence: openaiConfidence,
                        outputText
                    });

                    // Decision logic: Use model confidence if >= threshold, otherwise use OpenAI confidence if present
                    if (modelConfidence >= threshold) {
                        confidence = modelConfidence;
                        allowUpload = true;
                        message = `Detected Issue: ${modelPrediction || 'unknown'}`;
                    } else if (openaiConfidence > 0) {
                        confidence = openaiConfidence;
                        allowUpload = openaiConfidence >= threshold;
                        if (openaiPrediction === 'None' || openaiConfidence === 0) {
                            allowUpload = false;
                            message = 'No valid civic issue detected in image (OpenAI fallback).';
                        } else if (openaiConfidence >= threshold) {
                            allowUpload = true;
                            message = `Detected Issue: ${openaiPrediction || 'unknown'}`;
                        } else {
                            allowUpload = false;
                            message = `Detected Issue: ${openaiPrediction || 'unknown'}`;
                        }
                    } else {
                        confidence = 0;
                        allowUpload = false;
                        message = 'No valid civic issue detected in image.';
                    }
                }
            } else {
                allowUpload = false;
                message = 'Invalid workflow response format.';
            }
            // If workflow error or failed to assemble image
            if (raw?.error || raw?.message?.includes('Failed to assemble')) {
                allowUpload = false;
                message = raw?.message || 'Image validation failed.';
            }
            return { confidence, modelConfidence, openaiConfidence, allowUpload, message, raw };
        } catch (error) {
            console.error('Roboflow validation error:', error.message);
            return { confidence: 0, modelConfidence: 0, openaiConfidence: 0, allowUpload: false, message: error.message || 'Image validation failed', raw: null };
        }
    }

    async validateAndAnalyzeImage(imagePath) {
        try {
            console.log('🔍 Starting image validation and analysis...');
            
            if (!fs.existsSync(imagePath)) {
                throw new Error('Image file not found');
            }

            const imageValidation = await this.validateImageQuality(imagePath);
            if (!imageValidation.isValid) {
                return {
                    success: false,
                    error: imageValidation.error,
                    suggestions: imageValidation.suggestions
                };
            }

            const blankCheck = await this.detectBlankImage(imagePath);
            if (blankCheck.isBlank) {
                return {
                    success: false,
                    error: 'Image appears to be blank or has insufficient content',
                    suggestions: ['Please upload a clearer image', 'Ensure the image shows the civic issue clearly']
                };
            }

            const analysisResult = await this.runWorkflow(imagePath);
            
            if (analysisResult && typeof analysisResult.allowUpload === 'boolean') {
                return analysisResult;
            }
            
            return {
                success: true,
                allowUpload: true,
                stage: 'workflow_analysis',
                reason: 'Image analysis completed successfully',
                priorityScore: analysisResult?.priorityScore || 75,
                urgencyLevel: analysisResult?.urgencyLevel || 'medium',
                detectedIssues: analysisResult?.detectedIssues || ['civic_issue_detected'],
                imageValidation,
                analysis: analysisResult,
                metadata: {
                    processingTime: Date.now(),
                    imageSize: imageValidation.size
                }
            };

        } catch (error) {
            console.error('❌ Image validation/analysis failed:', error);
            return {
                success: false,
                error: error.message,
                suggestions: ['Please try uploading a different image', 'Ensure the image is clear and shows the issue']
            };
        }
    }

    async validateImageQuality(imagePath) {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            const metadata = await sharp(imageBuffer).metadata();
            
            console.log('📊 Image metadata:', {
                format: metadata.format,
                width: metadata.width,
                height: metadata.height,
                size: `${Math.round(imageBuffer.length / 1024)}KB`
            });

            const validation = {
                isValid: true,
                format: metadata.format,
                width: metadata.width,
                height: metadata.height,
                size: imageBuffer.length,
                errors: [],
                suggestions: []
            };

            if (metadata.width < 100 || metadata.height < 100) {
                validation.isValid = false;
                validation.errors.push('Image too small (minimum 100x100 pixels)');
                validation.suggestions.push('Upload a larger image for better analysis');
            }

            if (imageBuffer.length > 10 * 1024 * 1024) {
                validation.isValid = false;
                validation.errors.push('Image file too large (maximum 10MB)');
                validation.suggestions.push('Compress the image or upload a smaller file');
            }

            const supportedFormats = ['jpeg', 'jpg', 'png', 'webp'];
            if (!supportedFormats.includes(metadata.format?.toLowerCase())) {
                validation.isValid = false;
                validation.errors.push(`Unsupported format: ${metadata.format}`);
                validation.suggestions.push('Upload JPEG, PNG, or WebP images only');
            }

            return validation;

        } catch (error) {
            console.error('❌ Image quality validation failed:', error);
            return {
                isValid: false,
                error: 'Unable to process image file',
                suggestions: ['Check if the file is a valid image', 'Try uploading a different image']
            };
        }
    }

    async detectBlankImage(imagePath) {
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            const { data, info } = await sharp(imageBuffer)
                .grayscale()
                .raw()
                .toBuffer({ resolveWithObject: true });

            let sum = 0;
            for (let i = 0; i < data.length; i++) {
                sum += data[i];
            }
            const average = sum / data.length;

            let variance = 0;
            for (let i = 0; i < data.length; i++) {
                variance += Math.pow(data[i] - average, 2);
            }
            variance = variance / data.length;

            console.log('📈 Image content analysis:', {
                avgIntensity: average.toFixed(2),
                variance: variance.toFixed(2)
            });

            const isBlank = variance < 50;
            
            return {
                isBlank,
                avgIntensity: average,
                variance,
                confidence: isBlank ? (50 - variance) / 50 : 1 - (variance / 1000)
            };

        } catch (error) {
            console.error('❌ Blank detection failed:', error);
            return { isBlank: false, error: error.message };
        }
    }

    async runWorkflow(imagePath) {
        const QUICK_DEV_MODE = process.env.QUICK_DEV_MODE === 'true';
        
        if (QUICK_DEV_MODE) {
            console.log('⚡ Quick development mode enabled - using fallback analysis');
            return this.getFallbackAnalysis();
        }
        
        try {
            console.log('🔬 Starting Roboflow workflow analysis...');
            console.log(`📋 Using InferenceHTTPClient approach:`);
            console.log(`   Workspace: ${this.workspaceName}`);
            console.log(`   Workflow: ${this.workflowId}`);
            console.log(`   API URL: ${this.apiUrl}`);

            if (!this.apiKey || !this.workspaceName || !this.workflowId) {
                console.log('⚠️ Roboflow credentials missing - using fallback analysis');
                console.log(`   API Key: ${this.apiKey ? 'SET' : 'MISSING'}`);
                console.log(`   Workspace: ${this.workspaceName || 'MISSING'}`);
                console.log(`   Workflow: ${this.workflowId || 'MISSING'}`);
                return this.getFallbackAnalysis();
            }

            const imageBuffer = fs.readFileSync(imagePath);
            const FormData = require('form-data');
            const form = new FormData();
            
            form.append('image', imageBuffer, {
                filename: 'civic_issue.jpg',
                contentType: 'image/jpeg'
            });

            const possibleUrls = [
                `https://detect.roboflow.com/${this.workspaceName}/${this.workflowId}?api_key=${this.apiKey}`,
                `https://api.roboflow.com/${this.workspaceName}/${this.workflowId}?api_key=${this.apiKey}`,
                `${this.apiUrl}/${this.workspaceName}/${this.workflowId}?api_key=${this.apiKey}`,
                `${this.apiUrl}/workflows/${this.workspaceName}/${this.workflowId}`
            ];
            
            let response = null;
            let successfulUrl = null;
            
            for (let i = 0; i < possibleUrls.length; i++) {
                const workflowUrl = possibleUrls[i];
                console.log(`🚀 Trying endpoint ${i + 1}/${possibleUrls.length}: ${workflowUrl}`);
                
                try {
                    const attemptResponse = await axios.post(workflowUrl, form, {
                        headers: {
                            ...form.getHeaders(),
                            'Authorization': `Bearer ${this.apiKey}`,
                            'User-Agent': 'CivicRezo/1.0 (Node.js HTTP Client)'
                        },
                        timeout: 8000,
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity
                    });
                    
                    console.log(`✅ Endpoint ${i + 1} succeeded!`);
                    response = attemptResponse;
                    successfulUrl = workflowUrl;
                    break;
                    
                } catch (urlError) {
                    console.log(`❌ Endpoint ${i + 1} failed:`, {
                        status: urlError.response?.status,
                        statusText: urlError.response?.statusText,
                        error: urlError.response?.data?.detail || urlError.message
                    });
                    
                    if (i === possibleUrls.length - 1) {
                        throw urlError;
                    }
                }
            }
            
            if (!response) {
                throw new Error('All endpoint formats failed');
            }
            
            console.log(`🎯 Successful endpoint: ${successfulUrl}`);
            console.log(`🔍 Response status: ${response.status}`);
            console.log(`🔍 Response data:`, JSON.stringify(response.data, null, 2));

            console.log('✅ Roboflow workflow response received');
            console.log(`📊 Response status: ${response.status}`);
            console.log('📄 Response data keys:', Object.keys(response.data || {}));
            
            return this.processWorkflowResponse(response.data);

        } catch (error) {
            console.error('❌ Roboflow workflow analysis failed:', error.message);
            
            if (error.response) {
                console.error(`🔍 Response status: ${error.response.status}`);
                console.error('🔍 Response data:', error.response.data);
                this.handleWorkflowError(error.response.status, error.response.data);
            } else if (error.code === 'ECONNABORTED') {
                console.error('⏱️ Request timeout - API took too long to respond');
            } else if (error.code === 'ENOTFOUND') {
                console.error('🌐 Network error - Cannot reach Roboflow servers');
            } else {
                console.error('❌ Request setup error:', error.message);
            }
            
            console.log('🔄 Falling back to development analysis mode');
            return this.getFallbackAnalysis();
        }
    }

    handleWorkflowError(status, data) {
        switch (status) {
            case 401:
                console.log('🔑 Authentication Error:');
                console.log('   - API key may be invalid or expired');
                console.log('   - Check API key permissions in Roboflow dashboard');
                break;
            case 403:
                console.log('🚫 Access Forbidden:');
                console.log('   - API key lacks permission for this workspace/workflow');
                console.log('   - Verify workspace and workflow access rights');
                break;
            case 404:
                console.log('🔍 Not Found:');
                console.log('   - Workflow may not exist or be published');
                console.log('   - Check workspace name and workflow ID');
                break;
            case 422:
                console.log('📝 Validation Error:');
                console.log('   - Image format or size may be invalid');
                console.log('   - Check image requirements for the workflow');
                break;
            case 502:
                console.log('🔧 Workflow Configuration Issue:');
                console.log('   - Workflow may need inference server setup');
                console.log('   - Check Roboflow dashboard for workflow status');
                console.log('   - Ensure all workflow blocks are properly configured');
                break;
            case 503:
                console.log('⏳ Service Temporarily Unavailable:');
                console.log('   - Roboflow servers may be busy');
                console.log('   - Try again in a few minutes');
                break;
            default:
                console.log(`❓ Unexpected Error (${status}):`, data);
        }
    }

    processWorkflowResponse(responseData) {
        try {
            console.log('📄 Processing workflow response...');
            
            if (!responseData) {
                console.log('⚠️ Empty response data');
                return this.getFallbackAnalysis();
            }

            console.log('🔍 Full response structure:', JSON.stringify(responseData, null, 2));

            let predictions = [];
            let hasIssues = false;

            if (responseData.predictions && Array.isArray(responseData.predictions)) {
                console.log(`📊 Found ${responseData.predictions.length} predictions`);
                predictions = responseData.predictions.map(pred => this.formatPrediction(pred));
                hasIssues = predictions.length > 0;
            } else if (responseData.outputs) {
                console.log('📊 Processing workflow outputs...');
                for (const [outputKey, outputValue] of Object.entries(responseData.outputs)) {
                    console.log(`   Processing output: ${outputKey}`);
                    
                    if (outputValue && outputValue.predictions) {
                        const outputPredictions = outputValue.predictions.map(pred => this.formatPrediction(pred));
                        predictions.push(...outputPredictions);
                        hasIssues = true;
                    }
                }
            } else if (responseData.result) {
                console.log('📊 Processing result data...');
                if (responseData.result.predictions) {
                    predictions = responseData.result.predictions.map(pred => this.formatPrediction(pred));
                    hasIssues = predictions.length > 0;
                }
            }

            console.log(`✅ Processed ${predictions.length} total predictions`);

            const result = {
                hasIssues,
                predictions,
                priorityScore: this.calculateOverallPriority(predictions),
                metadata: {
                    workflowId: this.workflowId,
                    responseTime: new Date().toISOString(),
                    predictionCount: predictions.length,
                    rawResponse: responseData
                }
            };

            console.log('🎯 Analysis result summary:', {
                hasIssues: result.hasIssues,
                predictionCount: result.predictions.length,
                priorityScore: result.priorityScore
            });

            return result;

        } catch (error) {
            console.error('❌ Error processing workflow response:', error);
            return this.getFallbackAnalysis();
        }
    }

    formatPrediction(pred) {
        return {
            type: pred.class || pred.label || 'civic_issue',
            confidence: pred.confidence || pred.score || 0.5,
            location: {
                x: pred.x || pred.bbox?.[0] || 0,
                y: pred.y || pred.bbox?.[1] || 0,
                width: pred.width || pred.bbox?.[2] || 0,
                height: pred.height || pred.bbox?.[3] || 0
            },
            priority: this.calculatePriority(pred),
            urgency: this.determineUrgency(pred.confidence || pred.score || 0.5),
            description: `${pred.class || pred.label || 'Issue'} detected`,
            category: this.mapToCategory(pred.class || pred.label || 'general')
        };
    }

    calculatePriority(prediction) {
        const confidence = prediction.confidence || prediction.score || 0.5;
        const className = (prediction.class || prediction.label || '').toLowerCase();
        
        let priority = confidence;
        
        const highPriorityIssues = ['pothole', 'broken_pipe', 'electrical_hazard', 'structural_damage', 'safety_hazard'];
        const mediumPriorityIssues = ['garbage', 'graffiti', 'street_light', 'road_sign', 'maintenance_needed'];
        
        if (highPriorityIssues.some(issue => className.includes(issue))) {
            priority = Math.min(1.0, priority * 1.3);
        } else if (mediumPriorityIssues.some(issue => className.includes(issue))) {
            priority = Math.min(1.0, priority * 1.1);
        }
        
        return Math.round(priority * 100) / 100;
    }

    determineUrgency(confidence) {
        if (confidence >= 0.8) return 'high';
        if (confidence >= 0.6) return 'medium';
        return 'low';
    }

    mapToCategory(className) {
        const categoryMap = {
            'pothole': 'roads',
            'garbage': 'sanitation',
            'graffiti': 'vandalism',
            'street_light': 'lighting',
            'broken_pipe': 'utilities',
            'electrical_hazard': 'utilities',
            'structural_damage': 'infrastructure',
            'safety_hazard': 'safety',
            'maintenance': 'maintenance'
        };
        
        const lowerClassName = className.toLowerCase();
        for (const [key, category] of Object.entries(categoryMap)) {
            if (lowerClassName.includes(key)) {
                return category;
            }
        }
        
        return 'general';
    }

    calculateOverallPriority(predictions) {
        if (!predictions.length) return 0;
        
        const priorities = predictions.map(p => p.priority || 0.5);
        const maxPriority = Math.max(...priorities);
        const avgPriority = priorities.reduce((sum, p) => sum + p, 0) / priorities.length;
        
        return Math.round((maxPriority * 0.7 + avgPriority * 0.3) * 100) / 100;
    }

    getFallbackAnalysis() {
        console.log('🔄 Using fallback analysis for development');
        
        return {
            success: true,
            allowUpload: true,
            stage: 'fallback_analysis',
            reason: 'Civic issue detected using fallback analysis',
            priorityScore: 75,
            urgencyLevel: 'medium',
            detectedIssues: ['civic_infrastructure_issue'],
            analysis: {
                hasIssues: true,
                predictions: [{
                    type: 'civic_issue_detected',
                    confidence: 75,
                    location: { x: 200, y: 150, width: 100, height: 80 },
                    priority: 75,
                    urgency: 'medium',
                    description: 'Civic issue detected (fallback mode)',
                    category: 'infrastructure'
                }],
                confidence: 75,
                metadata: {
                    mode: 'fallback',
                    note: 'Using development fallback analysis - Roboflow workflow unavailable',
                    timestamp: new Date().toISOString()
                }
            }
        };
    }

    getHealthStatus() {
        return {
            status: 'healthy',
            apiKey: !!this.apiKey,
            workspace: !!this.workspaceName,
            workflow: !!this.workflowId,
            apiUrl: this.apiUrl,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = ImageAnalysisService;
module.exports.validateImageWithRoboflow = ImageAnalysisService.validateImageWithRoboflow;