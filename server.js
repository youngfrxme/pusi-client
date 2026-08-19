const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./keys.db');

db.run(`
  CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    plan TEXT,
    created_at INTEGER,
    expires_at INTEGER,
    used BOOLEAN DEFAULT 0,
    hardware_id TEXT,
    user_settings TEXT
  )
`);

function planToDays(plan) {
  if (plan === '1m') return 30;
  if (plan === '6m') return 180;
  if (plan === '1y') return 365;
  return 0;
}

app.post('/api/generate', (req, res) => {
  const { plan } = req.body;
  if (!['1m','6m','1y'].includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }
  const key = uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
  const created = Date.now();
  const expires = created + planToDays(plan) * 24 * 60 * 60 * 1000;
  db.run(
    'INSERT INTO keys (key, plan, created_at, expires_at) VALUES (?, ?, ?, ?)',
    [key, plan, created, expires],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ key, plan, expires: new Date(expires).toISOString() });
    }
  );
});

app.post('/api/login', (req, res) => {
  const { key, hardwareId } = req.body;
  if (!key || !hardwareId) {
    return res.status(400).json({ error: 'Key and hardwareId required' });
  }
  db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: 'Invalid key' });
    if (row.used) {
      if (row.hardware_id === hardwareId) {
        if (Date.now() > row.expires_at) {
          return res.status(403).json({ error: 'Key expired' });
        }
        const settings = row.user_settings ? JSON.parse(row.user_settings) : {};
        return res.json({ success: true, settings, expires: row.expires_at });
      } else {
        return res.status(403).json({ error: 'Key already used on another device' });
      }
    }
    if (Date.now() > row.expires_at) {
      return res.status(403).json({ error: 'Key expired' });
    }
    db.run(
      'UPDATE keys SET used = 1, hardware_id = ? WHERE key = ?',
      [hardwareId, key],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, settings: {}, expires: row.expires_at });
      }
    );
  });
});

app.get('/api/settings/:key', (req, res) => {
  const { key } = req.params;
  db.get('SELECT * FROM keys WHERE key = ?', [key], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'Key not found' });
    if (Date.now() > row.expires_at) {
      return res.status(403).json({ error: 'Key expired' });
    }
    const settings = row.user_settings ? JSON.parse(row.user_settings) : {};
    res.json({ settings, expires: row.expires_at });
  });
});

app.post('/api/settings', (req, res) => {
  const { key, settings } = req.body;
  if (!key || !settings) return res.status(400).json({ error: 'Missing data' });
  db.run(
    'UPDATE keys SET user_settings = ? WHERE key = ?',
    [JSON.stringify(settings), key],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

app.get('/api/keys', (req, res) => {
  db.all('SELECT key, plan, created_at, expires_at, used, hardware_id FROM keys', (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
