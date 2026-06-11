// sr-proxy/src/index.js
// REFERENCE mount file for sr-proxy. The real sr-proxy entry point lives in the
// `seantan338/sr-proxy` repo (could be index.js / server.js / app.js). This file
// demonstrates the correct mounting + body-parser ordering for the WhatsApp route.
//
// CRITICAL ORDERING (TASK 1):
//   The WhatsApp webhook (POST /proxy/whatsapp/webhook) needs the RAW request body
//   to verify Meta's HMAC signature. A global express.json() would consume the body
//   first and break signature verification. The middleware below parses JSON for
//   every route EXCEPT the webhook path, which the router parses with express.raw().
//
// To integrate into the real sr-proxy: copy the two marked sections (the JSON-skip
// middleware and the app.use mount) into the existing entry file, keeping all other
// existing routes (/proxy/anthropic, /proxy/gemini, /proxy/openai, /proxy/ai).

const express = require('express');
const admin = require('firebase-admin');

// --- Firebase Admin SDK init (only if not already initialized elsewhere) ---
// wa-proxy.js assumes admin is initialized. If sr-proxy does not already do this,
// it must — e.g. via Application Default Credentials on Zeabur.
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const app = express();

// === SECTION 1: body parsing — skip JSON for the WhatsApp webhook path ===
// The webhook route inside wa-proxy.js applies express.raw() itself; every other
// route gets parsed JSON as usual.
app.use((req, res, next) => {
  if (req.originalUrl === '/proxy/whatsapp/webhook') return next();
  express.json({ limit: '1mb' })(req, res, next);
});

// === SECTION 2: route mounts ===
// (existing proxy routes would be mounted here, e.g.)
// app.use('/proxy/anthropic', require('./routes/anthropic'));
// app.use('/proxy/gemini', require('./routes/gemini'));
// app.use('/proxy/openai', require('./routes/openai'));
// app.use('/proxy/ai', require('./routes/ai'));

// WhatsApp Cloud API route (mount BEFORE the catch-all 404 handler).
app.use('/proxy/whatsapp', require('./routes/wa-proxy'));

// Catch-all 404
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.originalUrl });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  // sr-proxy uses its existing structured logger here; this is a reference file.
  console.log(`sr-proxy listening on :${PORT}`);
});

module.exports = app;
