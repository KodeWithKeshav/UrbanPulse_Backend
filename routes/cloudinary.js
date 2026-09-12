const express = require('express');
const router = express.Router();
const axios = require('axios');
require('dotenv').config();

// POST /cloudinary/delete-image
router.post('/delete-image', async (req, res) => {
  const { public_id } = req.body;
  if (!public_id) return res.status(400).json({ error: 'public_id required' });
  try {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const url = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?public_id=${public_id}`;
    const response = await axios.delete(url, {
      auth: {
        username: apiKey,
        password: apiSecret
      }
    });
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;