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
app.use(bodyParser.json({ limit: '50mb' })); // safe upper limit

// ─── Serve static files ──────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── JSONBin Configuration ──────────────────────────────────
const JSONBIN_BIN_ID = '6a47e235da38895dfe299a10';
const JSONBIN_API_KEY = '$2a$10$yAgKMt6GKitAdLZbY864Auu79zK7L6gKzLXAL7UPEZ/fRhWJX3/tW';
const JSONBIN_GET_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`;
const JSONBIN_PUT_URL = `https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`;

// ─── ntfy ────────────────────────────────────────────────────
const NTFY_TOPIC = 'p_reg';
const NTFY_URL = `https://ntfy.sh/${NTFY_TOPIC}`;

// ─── Helper: Read submissions ──────────────────────────────
async function getSubmissions() {
  try {
    const response = await axios.get(JSONBIN_GET_URL, {
      headers: { 'X-Master-Key': JSONBIN_API_KEY }
    });
    const data = response.data.record;
    if (!data || !Array.isArray(data.submissions)) {
      await saveSubmissions([]);
      return [];
    }
    return data.submissions;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      await saveSubmissions([]);
      return [];
    }
    console.error('❌ Error reading from JSONBin:', error.message);
    throw new Error(`Failed to read from storage: ${error.message}`);
  }
}

// ─── Helper: Write submissions ──────────────────────────────
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
    console.log('✅ JSONBin write successful.');
  } catch (error) {
    console.error('❌ Error writing to JSONBin:', error.response?.data || error.message);
    throw new Error(`Failed to save to storage: ${error.response?.data?.message || error.message}`);
  }
}

// ─── API Endpoints ──────────────────────────────────────────

app.get('/api/test', async (req, res) => {
  try {
    await getSubmissions();
    res.json({ success: true, message: 'JSONBin connection works!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/submit', async (req, res) => {
  try {
    const { fullName, address, country, email, countyCode, image } = req.body;

    if (!fullName || !address || !country || !email || !countyCode || !image) {
      return res.status(400).json({ error: 'All fields are required.' });
    }

    // Optional: reject if image base64 is still huge (>200KB)
    if (image.length > 250000) { // ~200KB base64
      return res.status(400).json({ error: 'Image too large even after compression. Please use a smaller image.' });
    }

    const submissions = await getSubmissions();
    const id = uuidv4();
    const newEntry = {
      id,
      fullName: fullName.trim(),
      address: address.trim(),
      country: country.trim(),
      email: email.trim().toLowerCase(),
      countyCode: countyCode.trim().toUpperCase(),
      image,
      timestamp: new Date().toISOString(),
      status: 'pending'
    };

    submissions.push(newEntry);
    await saveSubmissions(submissions);

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

app.get('/api/submissions', async (req, res) => {
  try {
    const submissions = await getSubmissions();
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/submission/:id', async (req, res) => {
  try {
    const submissions = await getSubmissions();
    const entry = submissions.find(s => s.id === req.params.id);
    if (!entry) return res.status(404).json({ error: 'Not found' });
    res.json(entry);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Catch‑all ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📦 JSONBin Bin ID: ${JSONBIN_BIN_ID}`);
  console.log(`📢 ntfy topic: ${NTFY_TOPIC}`);
});
