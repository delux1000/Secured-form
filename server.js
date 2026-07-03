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

// ── Serve static files from "public" directory ──
app.use(express.static(path.join(__dirname, 'public')));

// ── JSONBin Configuration (hardcoded with provided credentials) ──
const JSONBIN_BIN_ID = '6a47e235da38895dfe299a10';
const JSONBIN_API_KEY = '$2a$10$yAgKMt6GKitAdLZbY864Auu79zK7L6gKzLXAL7UPEZ/fRhWJX3/tW';
const JSONBIN_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// ── ntfy Configuration ──
const NTFY_TOPIC = 'p_reg';
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;

// ── Helper: Read submissions from JSONBin ──
async function getSubmissions() {
  try {
    const response = await axios.get(`${JSONBIN_URL}/latest`, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    return response.data.record.submissions || [];
  } catch (error) {
    console.error('Error reading from JSONBin:', error.message);
    return [];
  }
}

// ── Helper: Write submissions to JSONBin ──
async function saveSubmissions(submissions) {
  await axios.put(JSONBIN_URL, { submissions }, {
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': JSONBIN_API_KEY
    }
  });
}

// ── API Endpoints ──

// 1. Submit a new package
app.post('/api/submit', async (req, res) => {
  try {
    const { fullName, address, country, email, countyCode, image } = req.body;

    // Basic validation
    if (!fullName || !address || !country || !email || !countyCode || !image) {
      return res.status(400).json({ error: 'All fields are required, including image.' });
    }

    const submissions = await getSubmissions();
    const id = uuidv4();
    const newEntry = {
      id,
      fullName,
      address,
      country,
      email,
      countyCode,
      image, // base64 string
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    submissions.push(newEntry);
    await saveSubmissions(submissions);

    // ── Send ntfy notification (silent, no user action) ──
    const viewUrl = `http://localhost:${PORT}/view.html?id=${id}`;
    const adminUrl = `http://localhost:${PORT}/admin.html`;
    const message = `📦 New submission from ${fullName}\nView: ${viewUrl}\nAdmin: ${adminUrl}`;
    axios.post(NTFY_URL, message, {
      headers: { 'Title': 'New Package Submission', 'Priority': 'default' }
    }).catch(err => console.error('ntfy error:', err.message));

    res.status(201).json({ success: true, id });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2. Get all submissions (for admin)
app.get('/api/submissions', async (req, res) => {
  try {
    const submissions = await getSubmissions();
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch submissions' });
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
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

// ── Catch-all: serve index.html for any unknown routes (so that direct navigation to /view.html etc. still works) ──
app.get('*', (req, res) => {
  // If the request is for a static file that doesn't exist, serve index.html
  // However, because we used express.static first, it will handle existing files.
  // This catch-all will only be hit if no static file matches.
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📦 JSONBin Bin ID: ${JSONBIN_BIN_ID}`);
  console.log(`📢 ntfy topic: ${NTFY_TOPIC}`);
  console.log(`📁 Serving static files from: ${path.join(__dirname, 'public')}`);
});
