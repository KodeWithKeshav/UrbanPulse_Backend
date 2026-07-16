"""
DistilBERT Emotion / Sentiment Analysis Service (HF Inference API)
===================================================================
Uses huggingface_hub InferenceClient to call the hosted
distilbert-base-uncased-finetuned-sst-2-english model.

Endpoint:
  POST /predict   { "text": "..." }  →  [[{ "label": "NEGATIVE", "score": 0.98 }, ...]]
  GET  /health                        →  { "status": "ok", "model": "..." }
"""

import os
import sys

# Load environment variables from ../.env
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
if os.path.exists(env_path):
    with open(env_path, 'r') as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                if key not in os.environ:
                    os.environ[key.strip()] = val.strip()

from flask import Flask, request, jsonify
from flask_cors import CORS
from huggingface_hub import InferenceClient

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# HF Inference Client setup
# ---------------------------------------------------------------------------
MODEL_NAME = "distilbert/distilbert-base-uncased-finetuned-sst-2-english"
HF_TOKEN = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_API_KEY", "")

if not HF_TOKEN:
    print("[ERROR] No HF token found. Set HF_TOKEN or HUGGING_FACE_API_KEY env var.")
    sys.exit(1)

print(f"[INIT] Initializing InferenceClient for: {MODEL_NAME}")
client = InferenceClient(provider="auto", api_key=HF_TOKEN)
print("[OK] InferenceClient ready!")

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model": MODEL_NAME,
        "method": "huggingface_hub.InferenceClient",
    })


@app.route("/predict", methods=["POST"])
def predict():
    """
    Accepts: { "text": "some complaint text" }
    Returns: [[ { "label": "NEGATIVE", "score": 0.987 }, { "label": "POSITIVE", "score": 0.013 } ]]
    """
    data = request.get_json(force=True)
    text = data.get("text") or data.get("inputs", "")

    if not text or not text.strip():
        return jsonify({"error": "text is required"}), 400

    try:
        result = client.text_classification(
            text,
            model=MODEL_NAME,
        )

        # result is a list of ClassificationOutput objects
        # Convert to the nested-array format the Node.js code expects
        results = []
        for item in result:
            results.append({
                "label": item.label,
                "score": round(item.score, 6),
            })

        # Sort by score descending
        results.sort(key=lambda x: x["score"], reverse=True)

        print(f"[PREDICT] Prediction for '{text[:60]}': {results[0]['label']} ({results[0]['score']:.4f})")

        # Return in nested array format to match HF Inference API
        return jsonify([results])

    except Exception as e:
        print(f"[ERROR] Prediction error: {e}")
        return jsonify({"error": str(e)}), 500


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("DISTILBERT_PORT", 5001))
    print(f"🚀 DistilBERT service starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
