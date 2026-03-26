#!/usr/bin/env python3
"""
Test script for local Roboflow inference service
"""

import requests
import json

# Test configuration
LOCAL_SERVICE_URL = "http://localhost:5000"
TEST_IMAGE_PATH = "../test_civic_issue.jpg"  # Adjust path as needed

def test_health():
    """Test health check endpoint"""
    print("🏥 Testing health check...")
    try:
        response = requests.get(f"{LOCAL_SERVICE_URL}/health")
        if response.status_code == 200:
            print("✅ Health check passed")
            print(f"   Response: {response.json()}")
            return True
        else:
            print(f"❌ Health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Health check error: {e}")
        return False

def test_analyze():
    """Test image analysis endpoint"""
    print("\n🔍 Testing image analysis...")
    try:
        response = requests.post(
            f"{LOCAL_SERVICE_URL}/analyze",
            json={"image_path": TEST_IMAGE_PATH},
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Analysis successful")
            print(f"   Success: {result.get('success')}")
            print(f"   Confidence: {result.get('confidence')}")
            print(f"   Predictions: {result.get('predictions')}")
            return True
        else:
            print(f"❌ Analysis failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Analysis error: {e}")
        return False

def test_validate():
    """Test image validation endpoint"""
    print("\n✓ Testing image validation...")
    try:
        response = requests.post(
            f"{LOCAL_SERVICE_URL}/validate",
            json={"image_path": TEST_IMAGE_PATH},
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            print("✅ Validation successful")
            print(f"   Allow Upload: {result.get('allowUpload')}")
            print(f"   Confidence: {result.get('confidence')}")
            print(f"   Message: {result.get('message')}")
            return True
        else:
            print(f"❌ Validation failed: {response.status_code}")
            print(f"   Response: {response.text}")
            return False
    except Exception as e:
        print(f"❌ Validation error: {e}")
        return False

def main():
    """Run all tests"""
    print("=" * 60)
    print("🧪 Local Roboflow Service Test Suite")
    print("=" * 60)
    
    results = []
    results.append(("Health Check", test_health()))
    results.append(("Image Analysis", test_analyze()))
    results.append(("Image Validation", test_validate()))
    
    print("\n" + "=" * 60)
    print("📊 Test Results Summary")
    print("=" * 60)
    
    for test_name, passed in results:
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"{test_name:20} {status}")
    
    total_passed = sum(1 for _, passed in results if passed)
    print(f"\nTotal: {total_passed}/{len(results)} tests passed")
    
    if total_passed == len(results):
        print("\n🎉 All tests passed!")
    else:
        print("\n⚠️  Some tests failed. Check the output above.")

if __name__ == "__main__":
    print("\n⚙️  Make sure the local Roboflow service is running:")
    print("   python roboflow_local_service.py")
    print("\n⚙️  Make sure the local Roboflow server is running on localhost:9001")
    print("\n")
    
    main()
