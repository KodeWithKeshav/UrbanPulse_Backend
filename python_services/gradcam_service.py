"""
UrbanPulse Grad-CAM Explainability Service
===========================================
Production-ready, model-agnostic Grad-CAM using `pytorch-grad-cam`.

Endpoints:
  POST /explain          - Generate Grad-CAM for an uploaded image + model
  POST /explain/url      - Generate Grad-CAM from an image URL
  GET  /health           - Health check

Requirements (pip install):
  torch torchvision pytorch-grad-cam pillow flask flask-cors requests numpy opencv-python-headless
"""

import os
import io
import sys
import base64
import logging
import tempfile
import traceback
from typing import Optional, Dict, Any, List

import numpy as np
import cv2
import requests
import torch
import torch.nn as nn
import torchvision.transforms as transforms
from PIL import Image

# pytorch-grad-cam core
from pytorch_grad_cam import (
    GradCAM,
    GradCAMPlusPlus,
    EigenCAM,
    LayerCAM,
    FullGrad,
)
from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget
from pytorch_grad_cam.utils.image import show_cam_on_image

from flask import Flask, request, jsonify
from flask_cors import CORS

# ─────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("gradcam_service")

# ─────────────────────────────────────────────
# Flask app
# ─────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ─────────────────────────────────────────────
# UrbanPulse civic issue classes (matches Roboflow model)
# ─────────────────────────────────────────────
CIVIC_CLASSES = [
    "pothole",
    "garbage_dump",
    "crack",
    "waterlogging",
    "damaged_drain",
    "broken_streetlight",
    "water_leakage",
    "sewage_overflow",
    "fire_hazard",
    "electrical_danger",
    "road_damage",
    "normal",          # not a civic issue
]

# ─────────────────────────────────────────────
# Available CAM methods
# ─────────────────────────────────────────────
CAM_METHODS = {
    "gradcam":      GradCAM,
    "gradcam++":    GradCAMPlusPlus,
    "eigencam":     EigenCAM,
    "layercam":     LayerCAM,
    "fullgrad":     FullGrad,
}

# ─────────────────────────────────────────────
# Device
# ─────────────────────────────────────────────
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
log.info(f"[INFO] Using device: {DEVICE}")


# ═══════════════════════════════════════════════════════
# Layer auto-detection — model-agnostic
# ═══════════════════════════════════════════════════════

def _find_last_conv_block(model: nn.Module) -> Optional[nn.Module]:
    """
    Walk the model in order and return the last Conv2d-containing block.
    Works for ResNet, EfficientNet, MobileNetV3, ConvNeXt, and custom CNNs.
    """
    candidate = None

    def _recurse(m: nn.Module):
        nonlocal candidate
        has_conv = any(isinstance(c, nn.Conv2d) for c in m.children())
        if has_conv:
            candidate = m
        for child in m.children():
            _recurse(child)

    _recurse(model)
    return candidate


def _get_target_layer(model: nn.Module, architecture_hint: str = "") -> nn.Module:
    """
    Auto-detect the best Conv layer for Grad-CAM based on architecture.
    Priority: explicit hint → known-arch pattern → generic last-conv search.
    """
    hint = architecture_hint.lower()

    # ── ResNet / ResNeXt / Wide-ResNet ──────────────────────────────────────
    if "resnet" in hint or hasattr(model, "layer4"):
        try:
            return model.layer4[-1]
        except Exception:
            pass

    # ── EfficientNet (torchvision) ──────────────────────────────────────────
    if "efficientnet" in hint or hasattr(model, "features"):
        try:
            features = model.features
            # Walk backwards to find the last block with Conv2d
            for block in reversed(list(features.children())):
                if any(isinstance(m, nn.Conv2d) for m in block.modules()):
                    return block
        except Exception:
            pass

    # ── MobileNetV3 ─────────────────────────────────────────────────────────
    if "mobilenet" in hint:
        try:
            features = model.features
            return features[-1]
        except Exception:
            pass

    # ── ConvNeXt (torchvision ≥ 0.13) ───────────────────────────────────────
    if "convnext" in hint or hasattr(model, "features"):
        try:
            return model.features[-1][-1]
        except Exception:
            pass

    # ── Generic fallback: deepest Conv2d-containing module ──────────────────
    layer = _find_last_conv_block(model)
    if layer is not None:
        log.info("[OK] Auto-detected target layer via generic search.")
        return layer

    raise ValueError(
        "Could not auto-detect a suitable target layer. "
        "Please pass `target_layer_name` in the request body."
    )


def _resolve_layer_by_name(model: nn.Module, name: str) -> nn.Module:
    """
    Walk the model's named modules and return the one matching `name`.
    e.g. 'layer4.1', 'features.18.0', 'blocks.6'
    """
    for module_name, module in model.named_modules():
        if module_name == name:
            return module
    raise ValueError(f"Layer '{name}' not found in model. "
                     f"Available layers: {[n for n, _ in model.named_modules()][:30]}")


# ═══════════════════════════════════════════════════════
# Image preprocessing
# ═══════════════════════════════════════════════════════

# Standard ImageNet normalisation (used by all torchvision models)
_IMAGENET_MEAN = [0.485, 0.456, 0.406]
_IMAGENET_STD  = [0.229, 0.224, 0.225]

_preprocess = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=_IMAGENET_MEAN, std=_IMAGENET_STD),
])


def _load_image_from_bytes(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data)).convert("RGB")


def _load_image_from_url(url: str) -> Image.Image:
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    return _load_image_from_bytes(resp.content)


def _pil_to_rgb_float(pil_img: Image.Image, size: int = 224) -> np.ndarray:
    """Return HxWx3 float32 in [0,1] – used to overlay the heatmap."""
    img = pil_img.resize((size, size))
    arr = np.array(img, dtype=np.float32) / 255.0
    return arr


def _preprocess_for_model(pil_img: Image.Image) -> torch.Tensor:
    """Return a (1, 3, H, W) tensor ready for model inference."""
    return _preprocess(pil_img).unsqueeze(0).to(DEVICE)


# ═══════════════════════════════════════════════════════
# Model loading helpers
# ═══════════════════════════════════════════════════════

def _load_model_from_path(
    model_path: str,
    architecture: str,
    num_classes: int,
) -> nn.Module:
    """
    Load a saved .pt / .pth checkpoint into the appropriate torchvision backbone.
    """
    import torchvision.models as tv_models

    arch = architecture.lower()

    # Build the bare architecture (no pretrained weights; we load ours)
    if "resnet50" in arch:
        model = tv_models.resnet50(weights=None, num_classes=num_classes)
    elif "resnet18" in arch:
        model = tv_models.resnet18(weights=None, num_classes=num_classes)
    elif "resnet34" in arch:
        model = tv_models.resnet34(weights=None, num_classes=num_classes)
    elif "resnet101" in arch:
        model = tv_models.resnet101(weights=None, num_classes=num_classes)
    elif "efficientnet_b0" in arch:
        model = tv_models.efficientnet_b0(weights=None, num_classes=num_classes)
    elif "efficientnet_b4" in arch:
        model = tv_models.efficientnet_b4(weights=None, num_classes=num_classes)
    elif "mobilenet_v3_small" in arch:
        model = tv_models.mobilenet_v3_small(weights=None, num_classes=num_classes)
    elif "mobilenet_v3_large" in arch:
        model = tv_models.mobilenet_v3_large(weights=None, num_classes=num_classes)
    elif "convnext_tiny" in arch:
        model = tv_models.convnext_tiny(weights=None, num_classes=num_classes)
    elif "convnext_small" in arch:
        model = tv_models.convnext_small(weights=None, num_classes=num_classes)
    else:
        raise ValueError(
            f"Unknown architecture '{architecture}'. "
            "Supported: resnet18/34/50/101, efficientnet_b0/b4, "
            "mobilenet_v3_small/large, convnext_tiny/small"
        )

    state = torch.load(model_path, map_location=DEVICE)
    # Handle both raw state_dict and checkpoint dicts
    if isinstance(state, dict) and "state_dict" in state:
        state = state["state_dict"]
    elif isinstance(state, dict) and "model_state_dict" in state:
        state = state["model_state_dict"]

    model.load_state_dict(state, strict=False)
    model.to(DEVICE).eval()
    log.info(f"[OK] Loaded model '{architecture}' from {model_path}")
    return model


def _load_pretrained_fallback(architecture: str, num_classes: int) -> nn.Module:
    """
    When no model path is given, load ImageNet pretrained weights
    (useful for demonstration / integration testing).
    """
    import torchvision.models as tv_models
    arch = architecture.lower()

    if "resnet50" in arch:
        model = tv_models.resnet50(weights=tv_models.ResNet50_Weights.IMAGENET1K_V2)
    elif "resnet18" in arch:
        model = tv_models.resnet18(weights=tv_models.ResNet18_Weights.IMAGENET1K_V1)
    elif "efficientnet_b0" in arch:
        model = tv_models.efficientnet_b0(weights=tv_models.EfficientNet_B0_Weights.IMAGENET1K_V1)
    elif "mobilenet_v3_large" in arch:
        model = tv_models.mobilenet_v3_large(weights=tv_models.MobileNet_V3_Large_Weights.IMAGENET1K_V2)
    elif "convnext_tiny" in arch:
        model = tv_models.convnext_tiny(weights=tv_models.ConvNeXt_Tiny_Weights.IMAGENET1K_V1)
    else:
        model = tv_models.resnet50(weights=tv_models.ResNet50_Weights.IMAGENET1K_V2)
        log.warning(f"[WARN] Unknown arch '{architecture}', defaulting to ResNet-50")

    model.to(DEVICE).eval()
    log.info(f"[OK] Loaded ImageNet-pretrained model: {architecture}")
    return model


# ═══════════════════════════════════════════════════════
# Core Grad-CAM generation
# ═══════════════════════════════════════════════════════

def _numpy_to_base64_png(arr: np.ndarray) -> str:
    """Convert an HxWx3 uint8 ndarray to a base64-encoded PNG string."""
    success, buffer = cv2.imencode(".png", cv2.cvtColor(arr, cv2.COLOR_RGB2BGR))
    if not success:
        raise RuntimeError("cv2.imencode failed")
    return base64.b64encode(buffer).decode("utf-8")


def generate_gradcam(
    model: nn.Module,
    pil_image: Image.Image,
    target_layer: Optional[nn.Module] = None,
    target_class: Optional[int] = None,
    architecture_hint: str = "",
    cam_method: str = "gradcam",
    class_names: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Core function — runs real model inference + real Grad-CAM.

    Parameters
    ----------
    model            : Loaded, eval-mode PyTorch model.
    pil_image        : PIL Image (RGB).
    target_layer     : Target nn.Module for Grad-CAM. Auto-detected if None.
    target_class     : Class index to explain. Uses argmax prediction if None.
    architecture_hint: String hint for auto layer detection ('resnet50' etc.)
    cam_method       : One of 'gradcam', 'gradcam++', 'eigencam', 'layercam', 'fullgrad'
    class_names      : List of class name strings.

    Returns
    -------
    dict with keys: heatmap_base64, overlay_base64, target_class, confidence, explanation_text
    """
    if class_names is None:
        class_names = CIVIC_CLASSES

    # ── 1. Resolve target layer ──────────────────────────────────────────────
    if target_layer is None:
        target_layer = _get_target_layer(model, architecture_hint)
        log.info(f"[INFO] Auto-selected target layer: {type(target_layer).__name__}")

    # ── 2. Preprocess image ──────────────────────────────────────────────────
    input_tensor = _preprocess_for_model(pil_image)           # (1,3,H,W)
    rgb_float    = _pil_to_rgb_float(pil_image, size=224)     # (H,W,3) float [0,1]

    # ── 3. Run inference to get predicted class & confidence ─────────────────
    with torch.no_grad():
        logits = model(input_tensor)                           # (1, num_classes)
        probs  = torch.softmax(logits, dim=1)[0]              # (num_classes,)

    predicted_idx  = int(probs.argmax().item())
    confidence_val = float(probs[predicted_idx].item())

    explain_idx = predicted_idx if target_class is None else target_class
    explain_idx = min(explain_idx, len(probs) - 1)            # bounds safety

    # Resolve class name
    if explain_idx < len(class_names):
        class_label = class_names[explain_idx]
    else:
        class_label = f"class_{explain_idx}"

    log.info(f"[INFO] Inference -> predicted: '{class_label}' (idx={explain_idx}), "
             f"confidence={confidence_val:.4f}")

    # ── 4. Build CAM ─────────────────────────────────────────────────────────
    CAMClass = CAM_METHODS.get(cam_method.lower(), GradCAM)

    # reshape_transform for ViT-like / ConvNeXt transformer stages (no-op for CNNs)
    reshape = None

    cam_obj = CAMClass(
        model=model,
        target_layers=[target_layer],
        reshape_transform=reshape,
    )

    targets = [ClassifierOutputTarget(explain_idx)]

    # grayscale_cam: shape (1, H, W), values in [0, 1]
    grayscale_cam = cam_obj(input_tensor=input_tensor, targets=targets)[0]

    # ── 5. Build heatmap (standalone, colourised) ────────────────────────────
    heatmap_norm = (grayscale_cam * 255).astype(np.uint8)           # (H,W) uint8
    heatmap_color = cv2.applyColorMap(heatmap_norm, cv2.COLORMAP_JET)  # BGR
    heatmap_rgb   = cv2.cvtColor(heatmap_color, cv2.COLOR_BGR2RGB)

    # ── 6. Overlay (heatmap superimposed on original image) ──────────────────
    overlay_rgb = show_cam_on_image(
        rgb_float,          # float [0,1]
        grayscale_cam,      # float [0,1]
        use_rgb=True,
        image_weight=0.5,
    )  # returns uint8 RGB

    # ── 7. Encode both to base64 PNG ─────────────────────────────────────────
    heatmap_b64 = _numpy_to_base64_png(heatmap_rgb)
    overlay_b64 = _numpy_to_base64_png(overlay_rgb)

    # ── 8. Human-readable explanation ───────────────────────────────────────
    confidence_pct = confidence_val * 100
    hot_region = _describe_hot_region(grayscale_cam)

    explanation = (
        f"The model predicted '{class_label}' with {confidence_pct:.1f}% confidence. "
        f"The highlighted region ({hot_region}) contributed most to this decision. "
        f"Grad-CAM method used: {cam_method}."
    )

    return {
        "heatmap_base64":   heatmap_b64,
        "overlay_base64":   overlay_b64,
        "target_class":     class_label,
        "target_class_idx": explain_idx,
        "confidence":       round(confidence_val, 6),
        "cam_method":       cam_method,
        "explanation_text": explanation,
    }


def _describe_hot_region(grayscale_cam: np.ndarray) -> str:
    """
    Describe the location of the hottest activation in human terms.
    grayscale_cam: (H, W) float [0, 1]
    """
    H, W = grayscale_cam.shape
    flat_idx = int(grayscale_cam.argmax())
    row, col = divmod(flat_idx, W)

    vert  = "top"    if row < H // 3 else ("middle" if row < 2 * H // 3 else "bottom")
    horiz = "left"   if col < W // 3 else ("center" if col < 2 * W // 3 else "right")
    return f"{vert}-{horiz}"


# ═══════════════════════════════════════════════════════
# Flask routes
# ═══════════════════════════════════════════════════════

@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status":     "ok",
        "service":    "UrbanPulse Grad-CAM Explainability",
        "device":     str(DEVICE),
        "cam_methods": list(CAM_METHODS.keys()),
        "civic_classes": CIVIC_CLASSES,
    })


@app.route("/explain", methods=["POST"])
def explain():
    """
    Accepts multipart/form-data:
      - image          : image file (required)
      - model_path     : path to .pt / .pth file (optional; uses pretrained if absent)
      - architecture   : e.g. 'resnet50', 'efficientnet_b0' (default: 'resnet50')
      - num_classes    : int (default: len(CIVIC_CLASSES))
      - target_layer   : named module path, e.g. 'layer4.1' (optional; auto-detected)
      - target_class   : int class index (optional; uses argmax prediction)
      - cam_method     : 'gradcam' | 'gradcam++' | 'eigencam' | 'layercam' | 'fullgrad'
      - class_names    : comma-separated list (optional)
    """
    try:
        # ── Parse inputs ────────────────────────────────────────────────────
        if "image" not in request.files:
            return jsonify({"error": "No image file provided. Use field name 'image'."}), 400

        image_file   = request.files["image"]
        architecture = request.form.get("architecture", "resnet50")
        model_path   = request.form.get("model_path", "")
        num_classes  = int(request.form.get("num_classes", len(CIVIC_CLASSES)))
        target_layer_name = request.form.get("target_layer", "")
        target_class_raw  = request.form.get("target_class", "")
        cam_method   = request.form.get("cam_method", "gradcam")
        class_names_raw   = request.form.get("class_names", "")

        target_class_idx = int(target_class_raw) if target_class_raw.strip() else None
        class_names = (
            [c.strip() for c in class_names_raw.split(",") if c.strip()]
            if class_names_raw.strip()
            else CIVIC_CLASSES
        )

        # ── Load image ──────────────────────────────────────────────────────
        image_bytes = image_file.read()
        pil_image   = _load_image_from_bytes(image_bytes)
        log.info(f"[INFO] Received image: size={pil_image.size}, mode={pil_image.mode}")

        # ── Load model ──────────────────────────────────────────────────────
        if model_path and os.path.isfile(model_path):
            model = _load_model_from_path(model_path, architecture, num_classes)
        else:
            if model_path:
                log.warning(f"[WARN] model_path '{model_path}' not found — using pretrained fallback")
            model = _load_pretrained_fallback(architecture, num_classes)

        # ── Resolve target layer ─────────────────────────────────────────────
        target_layer = None
        if target_layer_name.strip():
            target_layer = _resolve_layer_by_name(model, target_layer_name.strip())
            log.info(f"[INFO] Using user-specified layer: {target_layer_name}")

        # ── Run Grad-CAM ─────────────────────────────────────────────────────
        result = generate_gradcam(
            model=model,
            pil_image=pil_image,
            target_layer=target_layer,
            target_class=target_class_idx,
            architecture_hint=architecture,
            cam_method=cam_method,
            class_names=class_names,
        )

        return jsonify({"success": True, **result})

    except Exception as exc:
        log.error(f"[ERROR] /explain error: {exc}\n{traceback.format_exc()}")
        return jsonify({"error": str(exc), "success": False}), 500


@app.route("/explain/url", methods=["POST"])
def explain_url():
    """
    Accepts JSON:
      {
        "image_url":    "https://...",
        "architecture": "resnet50",          // optional
        "model_path":   "/path/to/model.pt", // optional
        "num_classes":  12,                  // optional
        "target_layer": "layer4.1",          // optional
        "target_class": 0,                   // optional
        "cam_method":   "gradcam",           // optional
        "class_names":  ["pothole", ...]     // optional
      }
    """
    try:
        data = request.get_json(force=True) or {}

        image_url = data.get("image_url", "")
        if not image_url:
            return jsonify({"error": "'image_url' is required"}), 400

        architecture = data.get("architecture", "resnet50")
        model_path   = data.get("model_path", "")
        num_classes  = int(data.get("num_classes", len(CIVIC_CLASSES)))
        target_layer_name = data.get("target_layer", "")
        target_class_idx  = data.get("target_class", None)
        cam_method   = data.get("cam_method", "gradcam")
        class_names  = data.get("class_names", CIVIC_CLASSES)

        if target_class_idx is not None:
            target_class_idx = int(target_class_idx)

        # ── Load image from URL ──────────────────────────────────────────────
        log.info(f"[INFO] Fetching image from URL: {image_url}")
        pil_image = _load_image_from_url(image_url)
        log.info(f"[INFO] Image loaded: size={pil_image.size}, mode={pil_image.mode}")

        # ── Load model ──────────────────────────────────────────────────────
        if model_path and os.path.isfile(model_path):
            model = _load_model_from_path(model_path, architecture, num_classes)
        else:
            if model_path:
                log.warning(f"[WARN] model_path '{model_path}' not found — using pretrained fallback")
            model = _load_pretrained_fallback(architecture, num_classes)

        # ── Resolve target layer ─────────────────────────────────────────────
        target_layer = None
        if target_layer_name.strip():
            target_layer = _resolve_layer_by_name(model, target_layer_name.strip())

        # ── Run Grad-CAM ─────────────────────────────────────────────────────
        result = generate_gradcam(
            model=model,
            pil_image=pil_image,
            target_layer=target_layer,
            target_class=target_class_idx,
            architecture_hint=architecture,
            cam_method=cam_method,
            class_names=class_names,
        )

        return jsonify({"success": True, **result})

    except Exception as exc:
        log.error(f"[ERROR] /explain/url error: {exc}\n{traceback.format_exc()}")
        return jsonify({"error": str(exc), "success": False}), 500


@app.route("/list-layers", methods=["POST"])
def list_layers():
    """
    Utility endpoint — returns named modules for a given architecture,
    so callers can pick a specific target_layer.

    Body JSON: { "architecture": "resnet50" }
    """
    try:
        data = request.get_json(force=True) or {}
        architecture = data.get("architecture", "resnet50")
        num_classes  = int(data.get("num_classes", len(CIVIC_CLASSES)))

        model = _load_pretrained_fallback(architecture, num_classes)

        layers = [
            {"name": name, "type": type(module).__name__}
            for name, module in model.named_modules()
            if name  # skip root
        ]

        return jsonify({"success": True, "architecture": architecture, "layers": layers})

    except Exception as exc:
        log.error(f"[ERROR] /list-layers error: {exc}")
        return jsonify({"error": str(exc), "success": False}), 500


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("GRADCAM_PORT", 5002))
    log.info(f"[INFO] UrbanPulse Grad-CAM service starting on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
