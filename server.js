const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// ─── Serve static files from "public" ─────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── JSONBin Configuration ─────────────────────────────────────
const JSONBIN_BIN_ID = '6a47e235da38895dfe299a10';
const JSONBIN_API_KEY = '$2a$10$yAgKMt6GKitAdLZbY864Auu79zK7L6gKzLXAL7UPEZ/fRhWJX3/tW';
const JSONBIN_GET_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;
const JSONBIN_PUT_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// ─── ntfy Notification ──────────────────────────────────────────
const NTFY_TOPIC = 'p_reg';
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;

// ─── Helper: Read submissions from JSONBin ─────────────────────
async function getSubmissions() {
  try {
    const response = await axios.get(JSONBIN_GET_URL, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    // The record should contain a 'submissions' array
    const data = response.data.record;
    if (!data || !Array.isArray(data.submissions)) {
      // If the bin exists but doesn't have the expected structure, initialize it
      await saveSubmissions([]);
      return [];
    }
    return data.submissions;
  } catch (error) {
    // If the bin doesn't exist (404) or other errors, we can initialize
    if (error.response && error.response.status === 404) {
      console.warn('⚠️ JSONBin bin not found. Creating a new one with empty submissions.');
      await saveSubmissions([]);
      return [];
    }
    console.error('❌ Error reading from JSONBin:', error.message);
    throw new Error('Failed to read submissions from storage.');
  }
}

// ─── Helper: Write submissions to JSONBin ─────────────────────
async function saveSubmissions(submissions) {
  try {
    await axios.put(
      JSONBIN_PUT_URL,
      { submissions },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': JSONBIN_API_KEY
        }
      }
    );
  } catch (error) {
    console.error('❌ Error writing to JSONBin:', error.message);
    throw new Error('Failed to save submissions to storage.');
  }
}

// ─── API Endpoints ──────────────────────────────────────────────

// 1. Submit a new package
app.post('/api/submit', async (req, res) => {
  try {
    const { fullName, address, country, email, countyCode, image } = req.body;

    // Validate required fields
    if (!fullName || !address || !country || !email || !countyCode || !image) {
      return res.status(400).json({
        error: 'All fields are required: fullName, address, country, email, countyCode, image.'
      });
    }

    // Read current submissions
    const submissions = await getSubmissions();
    const id = uuidv4();
    const newEntry = {
      id,
      fullName: fullName.trim(),
      address: address.trim(),
      country: country.trim(),
      email: email.trim().toLowerCase(),
      countyCode: countyCode.trim().toUpperCase(),
      image, // base64 string (without data:image/... prefix)
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    submissions.push(newEntry);
    await saveSubmissions(submissions);

    // ── Send ntfy notification (asynchronous, don't wait) ──
    const viewUrl = `http://localhost:${PORT}/view.html?id=${id}`;
    const adminUrl = `http://localhost:${PORT}/admin.html`;
    const message = `📦 New submission from ${fullName}\nView: ${viewUrl}\nAdmin: ${adminUrl}`;
    axios.post(NTFY_URL, message, {
      headers: { 'Title': 'New Package Submission' }
    }).catch(err => console.error('⚠️ ntfy error:', err.message));

    res.status(201).json({ success: true, id });
  } catch (error) {
    console.error('❌ Submit error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// 2. Get all submissions (for admin)
app.get('/api/submissions', async (req, res) => {
  try {
    const submissions = await getSubmissions();
    res.json(submissions);
  } catch (error) {
    console.error('❌ Fetch all error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch submissions' });
  }
});

// 3. Get a single submission by ID (for view page)
app.get('/api/submission/:id', async (req, res) => {
  try {
    const submissions = await getSubmissions();
    const entry = submissions.find(s => s.id === req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    res.json(entry);
  } catch (error) {
    console.error('❌ Fetch one error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch submission' });
  }
});

// ─── Catch‑all: serve index.html for any unknown routes ─────────
// This ensures that refreshing /view.html or /admin.html works
// because express.static handles existing files first.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📦 JSONBin Bin ID: ${JSONBIN_BIN_ID}`);
  console.log(`📢 ntfy topic: ${NTFY_TOPIC}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
});
