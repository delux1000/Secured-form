const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── JSONBin Configuration ──
const JSONBIN_BIN_ID = '6a47e235da38895dfe299a10';
const JSONBIN_API_KEY = '$2a$10$yAgKMt6GKitAdLZbY864Auu79zK7L6gKzLXAL7UPEZ/fRhWJX3/tW';
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// ── ntfy Configuration ──
const NTFY_TOPIC = 'p_reg';
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;

// ── Helper: Read submissions with fallback ──
async function getSubmissions() {
  try {
    const response = await axios.get(`${JSONBIN_URL}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    // Ensure we have a submissions array; if not, return empty array
    const data = response.data.record;
    if (data && Array.isArray(data.submissions)) {
      return data.submissions;
    }
    return [];
  } catch (error) {
    // If bin is empty or doesn't exist, return empty array
    console.warn('Could not read from JSONBin, starting fresh:', error.message);
    return [];
  }
}

// ── Helper: Write submissions with retry ──
async function saveSubmissions(submissions) {
  try {
    // Ensure submissions is an array
    if (!Array.isArray(submissions)) submissions = [];
    await axios.put(JSONBIN_URL, { submissions }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': JSONBIN_API_KEY
      }
    });
  } catch (error) {
    console.error('JSONBin write error:', error.response?.data || error.message);
    throw new Error('Failed to save data to storage.');
  }
}

// ── API: Submit new package ──
app.post('/api/submit', async (req, res) => {
  try {
    const { fullName, address, country, email, countyCode, image } = req.body;

    // Validate required fields
    if (!fullName || !address || !country || !email || !countyCode || !image) {
      return res.status(400).json({ error: 'All fields are required, including image.' });
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }

    // Read existing submissions
    let submissions = await getSubmissions();

    // Create new entry
    const id = uuidv4();
    const newEntry = {
      id,
      fullName: fullName.trim(),
      address: address.trim(),
      country: country.trim(),
      email: email.trim(),
      countyCode: countyCode.trim().toUpperCase(),
      image: image.trim(), // base64 string
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    submissions.push(newEntry);
    await saveSubmissions(submissions);

    // ── Send ntfy notification (fire-and-forget) ──
    const viewUrl = `http://localhost:${PORT}/view.html?id=${id}`;
    const adminUrl = `http://localhost:${PORT}/admin.html`;
    const message = `📦 New submission from ${fullName}\nView: ${viewUrl}\nAdmin: ${adminUrl}`;
    axios.post(NTFY_URL, message, {
      headers: { 'Title': 'New Package Submission', 'Priority': 'default' }
    }).catch(err => console.error('ntfy notification failed:', err.message));

    res.status(201).json({ success: true, id });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
});

// ── API: Get all submissions ──
app.get('/api/submissions', async (req, res) => {
  try {
    const submissions = await getSubmissions();
    res.json(submissions);
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// ── API: Get single submission by ID ──
app.get('/api/submission/:id', async (req, res) => {
  try {
    const submissions = await getSubmissions();
    const entry = submissions.find(s => s.id === req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    res.json(entry);
  } catch (error) {
    console.error('Fetch single error:', error);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

// ── Catch-all: serve index.html for SPA routes ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📦 JSONBin Bin ID: ${JSONBIN_BIN_ID}`);
  console.log(`📢 ntfy topic: ${NTFY_TOPIC}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
});
