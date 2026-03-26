#!/usr/bin/env python3
"""
Local Roboflow Inference Service
Connects to local Roboflow server at localhost:9001
"""

from inference_sdk import InferenceHTTPClient
from flask import Flask, request, jsonify
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Initialize the local Roboflow client
client = InferenceHTTPClient(
    api_url="http://localhost:9001",  # Local server address
    api_key=os.getenv('ROBOFLOW_API_KEY', 'your-api-key-here')
)

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'Local Roboflow Inference',
        'server': 'localhost:9001'
    })

@app.route('/analyze', methods=['POST'])
def analyze_image():
    """
    Analyze image using local Roboflow workflow
    Expects JSON with 'image_path' or 'image_url'
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400
        
        # Get image path or URL
        image_source = data.get('image_path') or data.get('image_url') or data.get('image')
        
        if not image_source:
            return jsonify({
                'success': False,
                'error': 'No image source provided'
            }), 400
        
        # Run workflow on local server
        result = client.run_workflow(
            workspace_name="civicrezo",
            workflow_id="custom-workflow-6",
            images={
                "image": image_source
            },
            use_cache=True  # Speeds up repeated requests
        )
        
        # Extract predictions and confidence
        predictions = []
        confidence = 0
        
        if result and isinstance(result, list) and len(result) > 0:
            output = result[0]
            
            # Parse model predictions
            if 'output2' in output and 'predictions' in output['output2']:
                model_predictions = output['output2']['predictions']
                if model_predictions:
                    for pred in model_predictions:
                        predictions.append({
                            'class': pred.get('class') or pred.get('label'),
                            'confidence': pred.get('confidence', 0)
                        })
                    confidence = max([p.get('confidence', 0) for p in model_predictions])
        
        return jsonify({
            'success': True,
            'predictions': predictions,
            'confidence': confidence,
            'raw_result': result
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/validate', methods=['POST'])
def validate_image():
    """
    Validate if image contains civic issues
    Returns allowUpload flag based on confidence threshold
    """
    try:
        data = request.get_json()
        image_source = data.get('image_path') or data.get('image_url') or data.get('image')
        
        if not image_source:
            return jsonify({
                'success': False,
                'error': 'No image source provided'
            }), 400
        
        # Run workflow
        result = client.run_workflow(
            workspace_name="civicrezo",
            workflow_id="custom-workflow-6",
            images={"image": image_source},
            use_cache=True
        )
        
        # Process results
        confidence = 0
        detected_issue = None
        allow_upload = False
        threshold = 0.7
        
        if result and isinstance(result, list) and len(result) > 0:
            output = result[0]
            
            if 'output2' in output and 'predictions' in output['output2']:
                predictions = output['output2']['predictions']
                if predictions:
                    # Get highest confidence prediction
                    best_pred = max(predictions, key=lambda x: x.get('confidence', 0))
                    confidence = best_pred.get('confidence', 0)
                    detected_issue = best_pred.get('class') or best_pred.get('label')
                    allow_upload = confidence >= threshold
        
        return jsonify({
            'success': True,
            'confidence': confidence,
            'modelConfidence': confidence,
            'allowUpload': allow_upload,
            'message': f'Detected Issue: {detected_issue}' if detected_issue else 'No civic issue detected',
            'detectedIssue': detected_issue
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e),
            'confidence': 0,
            'allowUpload': False
        }), 500

if __name__ == '__main__':
    print("🚀 Starting Local Roboflow Inference Service...")
    print("📡 Connecting to localhost:9001")
    print("🌐 Flask server running on http://localhost:5000")
    
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True
    )
