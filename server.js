// Homeroom — tiny server that hosts the app and sends iPhone push reminders.
const express = require('express');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- VAPID keys (identify this server to Apple's push service) ----
// Strip stray quotes, commas, spaces and "key:" labels that sneak in when pasting.
const clean = (v) => (v || '').trim().replace(/^[^:]*key"?\s*:\s*/i, '').replace(/[\s"',;]/g, '').replace(/=+$/, '');
function fileKeys() {
  const f = path.join(DATA_DIR, 'vapid.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(f, JSON.stringify(keys, null, 2));
  console.log('Generated new VAPID keys in', f);
  return keys;
}
let subject = (process.env.VAPID_SUBJECT || '').trim().replace(/^["']|["']$/g, '');
if (subject && !/^(mailto:|https:\/\/)/.test(subject)) subject = subject.includes('@') ? 'mailto:' + subject : '';
subject = subject || 'mailto:homeroom@example.com';

let vapid = null;
if (process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PRIVATE_KEY) {
  const envKeys = { publicKey: clean(process.env.VAPID_PUBLIC_KEY), privateKey: clean(process.env.VAPID_PRIVATE_KEY) };
  try {
    webpush.setVapidDetails(subject, envKeys.publicKey, envKeys.privateKey);
    vapid = envKeys;
    console.log('Using VAPID keys from environment variables');
  } catch (e) {
    console.error('!! VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY look wrong (' + e.message + '). ' +
      'Falling back to generated keys — notifications will stop working after a restart until this is fixed.');
  }
}
if (!vapid) {
  vapid = fileKeys();
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);
}

// ---- Storage: { [endpoint]: { subscription, reminders: [{id,title,body,at,sent}] } } ----
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) : {};
let saveTimer;
const save = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db), () => {}), 200);
};

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/api/vapid-public-key', (_req, res) => res.json({ key: vapid.publicKey }));

const validSub = (s) => s && typeof s.endpoint === 'string' && s.endpoint.startsWith('https://') && s.keys;

// Replace all pending reminders for one device.
app.post('/api/sync', (req, res) => {
  const { subscription, reminders } = req.body || {};
  if (!validSub(subscription) || !Array.isArray(reminders)) return res.status(400).json({ error: 'bad request' });
  const prev = db[subscription.endpoint]?.reminders || [];
  const sentKeys = new Set(prev.filter((r) => r.sent).map((r) => r.id + '@' + r.at));
  db[subscription.endpoint] = {
    subscription,
    reminders: reminders.slice(0, 500).map((r) => ({
      id: String(r.id).slice(0, 64),
      title: String(r.title || 'Reminder').slice(0, 120),
      body: String(r.body || '').slice(0, 240),
      at: Number(r.at),
      sent: sentKeys.has(r.id + '@' + Number(r.at)),
    })),
  };
  save();
  res.json({ ok: true, pending: db[subscription.endpoint].reminders.filter((r) => !r.sent).length });
});

app.post('/api/test', async (req, res) => {
  const { subscription } = req.body || {};
  if (!validSub(subscription)) return res.status(400).json({ error: 'bad request' });
  try {
    await webpush.sendNotification(subscription, JSON.stringify({
      title: 'Homeroom notifications are on 🎉',
      body: "You'll get reminders here for your tasks and homework.",
      tag: 'test',
    }));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.body || e.message });
  }
});

// ---- Scheduler ----
async function tick() {
  const now = Date.now();
  for (const [endpoint, entry] of Object.entries(db)) {
    for (const r of entry.reminders) {
      if (r.sent || r.at > now) continue;
      r.sent = true;
      save();
      if (now - r.at > 6 * 3600e3) continue; // too stale (server was down) – skip
      try {
        await webpush.sendNotification(entry.subscription, JSON.stringify({ title: r.title, body: r.body, tag: r.id }));
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) { delete db[endpoint]; save(); break; }
        console.error('push failed', e.statusCode, e.body || e.message);
      }
    }
  }
}
setInterval(tick, 15000);

app.listen(PORT, () => console.log(`Homeroom running on http://localhost:${PORT}`));
