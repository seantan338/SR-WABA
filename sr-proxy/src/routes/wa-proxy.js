// sr-proxy/src/routes/wa-proxy.js
// WhatsApp Cloud API proxy route — direct to Meta, no BSP
// Mounts at /proxy/whatsapp/* via app.use('/proxy/whatsapp', require('./routes/wa-proxy'));

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// ============================================================================
// CONFIG — from Zeabur env vars
// ============================================================================

const META_GRAPH_VERSION = 'v21.0';
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

const PROXY_SECRET = process.env.PROXY_SECRET;
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WA_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WA_WABA_ID = process.env.WHATSAPP_WABA_ID;
const WA_APP_SECRET = process.env.WHATSAPP_APP_SECRET;
const WA_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const WA_DAILY_SEND_CAP = parseInt(process.env.WHATSAPP_DAILY_SEND_CAP || '200', 10);
const WA_QUALITY_HALT = (process.env.WHATSAPP_QUALITY_HALT || 'red').toLowerCase();

// Firebase Admin SDK — assumed already initialized elsewhere in sr-proxy
// If not, add: const admin = require('firebase-admin'); admin.initializeApp(...);
const admin = require('firebase-admin');
const db = admin.firestore();

// ============================================================================
// MIDDLEWARE — proxy secret check
// ============================================================================

function requireProxySecret(req, res, next) {
  const provided = req.headers['x-proxy-secret'];
  if (!provided || provided !== PROXY_SECRET) {
    return res.status(401).json({ error: 'invalid_proxy_secret' });
  }
  next();
}

// ============================================================================
// MIDDLEWARE — dual auth (proxy secret OR Firebase ID token)
// Used by browser-facing routes (/send-freeform, /conversation/:phone).
//   Option 1: server-to-server / n8n  → x-proxy-secret header
//   Option 2: browser (admin/manager) → Authorization: Bearer <Firebase ID token>
// ============================================================================

async function requireAuth(req, res, next) {
  // Option 1: proxy secret (n8n, server-to-server)
  if (req.headers['x-proxy-secret'] === PROXY_SECRET) return next();

  // Option 2: Firebase ID token (browser)
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = await admin.auth().verifyIdToken(token);
      const userDoc = await db.collection('users').doc(decoded.uid).get();
      const role = userDoc.data() && userDoc.data().role;
      if (!['admin', 'manager'].includes(role)) {
        return res.status(403).json({ error: 'insufficient_role' });
      }
      req.authenticatedUser = { uid: decoded.uid, role };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid_token' });
    }
  }

  return res.status(401).json({ error: 'no_auth' });
}

// ============================================================================
// MIDDLEWARE — opt-in capture auth
// Used by POST /optin. whatsapp_optin is NOT client-writable (firestore.rules),
// so consent writes are funnelled through this server route instead.
//   Option 1: server-to-server / n8n  → x-proxy-secret header
//   Option 2: any signed-in user       → Authorization: Bearer <Firebase ID token>
//             (a user records their own opt-in; no admin/manager role required)
// ============================================================================

async function requireOptinAuth(req, res, next) {
  if (req.headers['x-proxy-secret'] === PROXY_SECRET) return next();

  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split(' ')[1]);
      req.authenticatedUser = { uid: decoded.uid };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid_token' });
    }
  }

  return res.status(401).json({ error: 'no_auth' });
}

// ============================================================================
// HELPERS
// ============================================================================

// Normalize phone to E.164 — Malaysia / Singapore aware
// Accepts: +60123456789, 60123456789, 0123456789 (MY), +6591234567, etc.
function normalizeE164(raw, defaultCountry = 'MY') {
  if (!raw) return null;
  let s = String(raw).replace(/[\s\-\(\)]/g, '');
  if (s.startsWith('+')) return s;
  if (defaultCountry === 'MY') {
    if (s.startsWith('0')) return '+6' + s; // 0123456789 → +60123456789
    if (s.startsWith('60')) return '+' + s;
    if (s.startsWith('6')) return '+' + s;
  }
  if (defaultCountry === 'SG') {
    if (/^\d{8}$/.test(s)) return '+65' + s;
    if (s.startsWith('65')) return '+' + s;
  }
  // Fallback — assume already correct
  return s.startsWith('+') ? s : '+' + s;
}

// Check opt-in status before sending
async function getOptinStatus(phoneE164) {
  const doc = await db.collection('whatsapp_optin').doc(phoneE164).get();
  if (!doc.exists) return { allowed: false, reason: 'no_optin_record' };
  const data = doc.data();
  if (data.status === 'opted_out') return { allowed: false, reason: 'opted_out' };
  if (data.status !== 'active') return { allowed: false, reason: `status_${data.status}` };
  return { allowed: true, data };
}

// Count sends in last 24h
async function getRecentSendCount() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const snap = await db.collection('whatsapp_send_log')
    .where('createdAt', '>=', since)
    .where('status', 'in', ['queued', 'sent', 'delivered', 'read'])
    .get();
  return snap.size;
}

// Check current quality rating
async function getQualityStatus() {
  const snap = await db.collection('whatsapp_quality')
    .orderBy('capturedAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return { rating: 'unknown', tier: 'unknown' };
  const doc = snap.docs[0].data();
  return { rating: doc.qualityRating, tier: doc.messagingLimitTier };
}

// Pre-flight gate — runs before every send
async function preflightCheck(phoneE164, templateCategory) {
  // Gate 1: opt-in
  const optin = await getOptinStatus(phoneE164);
  if (!optin.allowed) {
    return { ok: false, code: 'optin_blocked', detail: optin.reason };
  }

  // Gate 2: quality rating halt
  const quality = await getQualityStatus();
  if (quality.rating === WA_QUALITY_HALT) {
    return { ok: false, code: 'quality_halted', detail: `quality=${quality.rating}` };
  }

  // Gate 3: daily cap
  const recent = await getRecentSendCount();
  if (recent >= WA_DAILY_SEND_CAP) {
    return { ok: false, code: 'daily_cap_reached', detail: `${recent}/${WA_DAILY_SEND_CAP}` };
  }

  return { ok: true, optin: optin.data, quality, recent };
}

// Webhook signature verification (Meta signs payloads with App Secret)
function verifyWebhookSignature(req, rawBody) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature || !WA_APP_SECRET) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', WA_APP_SECRET)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ============================================================================
// POST /proxy/whatsapp/send
// Sends a template message
// Body: {
//   to: "+60123456789" | "60123456789" | "0123456789",
//   templateName: "candidate_cv_received",
//   language: "en" | "zh_CN",
//   templateCategory: "utility" | "marketing" | "authentication",
//   variables: ["Sean", "Senior Engineer", ...],   // ordered array
//   actorUserId: "uid_xxx",                          // who triggered
//   relatedEntityType: "candidate" | "application" | "referral" | "job",
//   relatedEntityId: "entity_xxx"
// }
// ============================================================================

router.post('/send', requireProxySecret, async (req, res) => {
  const {
    to,
    templateName,
    language = 'en',
    templateCategory,
    variables = [],
    actorUserId,
    relatedEntityType,
    relatedEntityId
  } = req.body || {};

  // Validation
  if (!to || !templateName || !templateCategory) {
    return res.status(400).json({
      error: 'missing_fields',
      required: ['to', 'templateName', 'templateCategory']
    });
  }

  const phoneE164 = normalizeE164(to);
  if (!phoneE164 || !/^\+\d{8,15}$/.test(phoneE164)) {
    return res.status(400).json({ error: 'invalid_phone', received: to });
  }

  // Pre-flight checks (opt-in, quality, rate limit)
  const preflight = await preflightCheck(phoneE164, templateCategory);
  if (!preflight.ok) {
    // Log the blocked attempt for audit
    await db.collection('whatsapp_send_log').add({
      phoneE164,
      templateName,
      templateCategory,
      variables,
      status: 'blocked',
      errorCode: preflight.code,
      errorDetail: preflight.detail,
      actorUserId: actorUserId || null,
      relatedEntityType: relatedEntityType || null,
      relatedEntityId: relatedEntityId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return res.status(403).json({ error: preflight.code, detail: preflight.detail });
  }

  // Build Meta API payload
  const components = [];
  if (variables.length > 0) {
    components.push({
      type: 'body',
      parameters: variables.map(v => ({ type: 'text', text: String(v) }))
    });
  }

  const metaPayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneE164.replace('+', ''), // Meta expects without leading +
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length > 0 && { components })
    }
  };

  // Call Meta
  let metaResponse;
  try {
    const fetchRes = await fetch(`${META_GRAPH_BASE}/${WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WA_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(metaPayload)
    });
    metaResponse = await fetchRes.json();

    if (!fetchRes.ok) {
      await db.collection('whatsapp_send_log').add({
        phoneE164,
        templateName,
        templateCategory,
        language,
        variables,
        status: 'failed',
        errorCode: metaResponse?.error?.code || 'meta_error',
        errorDetail: metaResponse?.error?.message || 'unknown',
        metaRawError: metaResponse,
        actorUserId: actorUserId || null,
        relatedEntityType: relatedEntityType || null,
        relatedEntityId: relatedEntityId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.status(502).json({ error: 'meta_send_failed', detail: metaResponse });
    }
  } catch (err) {
    return res.status(502).json({ error: 'meta_unreachable', detail: err.message });
  }

  // Log success
  const metaMessageId = metaResponse?.messages?.[0]?.id || null;
  const logRef = await db.collection('whatsapp_send_log').add({
    phoneE164,
    templateName,
    templateCategory,
    language,
    variables,
    metaMessageId,
    status: 'sent',
    actorUserId: actorUserId || null,
    relatedEntityType: relatedEntityType || null,
    relatedEntityId: relatedEntityId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Update lastTemplateAt on optin record
  await db.collection('whatsapp_optin').doc(phoneE164).update({
    lastTemplateAt: admin.firestore.FieldValue.serverTimestamp()
  }).catch(() => { /* ignore — already logged the send */ });

  return res.json({
    ok: true,
    metaMessageId,
    logId: logRef.id,
    sentCountToday: preflight.recent + 1,
    dailyCap: WA_DAILY_SEND_CAP,
    qualityRating: preflight.quality.rating
  });
});

// ============================================================================
// POST /proxy/whatsapp/send-freeform
// Sends a free-form text message — ONLY valid within the 24h service window.
// Auth: requireAuth (x-proxy-secret OR Firebase ID token w/ admin|manager role)
// Body: { to, text, actorUserId, actorRole, relatedEntityType, relatedEntityId }
// ============================================================================

router.post('/send-freeform', requireAuth, async (req, res) => {
  const { to, text, actorUserId, actorRole, relatedEntityType, relatedEntityId } = req.body || {};

  if (!to || !text?.trim()) {
    return res.status(400).json({ error: 'missing_fields', required: ['to', 'text'] });
  }

  const phoneE164 = normalizeE164(to);
  if (!phoneE164) return res.status(400).json({ error: 'invalid_phone' });
  if (text.length > 4096) return res.status(400).json({ error: 'text_too_long', max: 4096 });

  // Resolve actor — prefer authenticated browser user, fall back to body
  const resolvedActorUserId = actorUserId || req.authenticatedUser?.uid || null;
  const resolvedActorRole = actorRole || req.authenticatedUser?.role || null;

  // CRITICAL: Check 24h service window before sending
  const optinDoc = await db.collection('whatsapp_optin').doc(phoneE164).get();
  if (!optinDoc.exists) return res.status(403).json({ error: 'no_optin_record' });

  const optin = optinDoc.data();
  const windowExpiry = optin.serviceWindowExpiresAt?.toDate();
  if (!windowExpiry || windowExpiry < new Date()) {
    return res.status(403).json({
      error: 'service_window_expired',
      detail: 'User has not messaged in the last 24h. Use a template instead.',
      windowExpiredAt: windowExpiry?.toISOString() || null,
    });
  }

  // Quality halt check
  const quality = await getQualityStatus();
  if (quality.rating === WA_QUALITY_HALT) {
    return res.status(403).json({ error: 'quality_halted', rating: quality.rating });
  }

  const metaPayload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phoneE164.replace('+', ''),
    type: 'text',
    text: { body: text.trim() },
  };

  let metaResponse;
  try {
    const fetchRes = await fetch(`${META_GRAPH_BASE}/${WA_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metaPayload),
    });
    metaResponse = await fetchRes.json();
    if (!fetchRes.ok) {
      await db.collection('whatsapp_send_log').add({
        phoneE164, templateName: '_freeform', templateCategory: 'service',
        language: 'free', variables: [text.substring(0, 100)],
        status: 'failed', errorCode: metaResponse?.error?.code?.toString() || 'meta_error',
        errorDetail: metaResponse?.error?.message, metaRawError: metaResponse,
        actorUserId: resolvedActorUserId, actorRole: resolvedActorRole,
        relatedEntityType: relatedEntityType || null, relatedEntityId: relatedEntityId || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(502).json({ error: 'meta_send_failed', detail: metaResponse });
    }
  } catch (err) {
    return res.status(502).json({ error: 'meta_unreachable', detail: err.message });
  }

  const metaMessageId = metaResponse?.messages?.[0]?.id || null;
  const logRef = await db.collection('whatsapp_send_log').add({
    phoneE164, templateName: '_freeform', templateCategory: 'service',
    language: 'free', variables: [text.substring(0, 100)],
    metaMessageId, status: 'sent',
    actorUserId: resolvedActorUserId, actorRole: resolvedActorRole,
    relatedEntityType: relatedEntityType || null, relatedEntityId: relatedEntityId || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Audit log
  await db.collection('auditLogs').add({
    actorUserId: resolvedActorUserId || 'system',
    actorRole: resolvedActorRole || 'system',
    action: 'whatsapp_freeform_sent',
    entityType: relatedEntityType || 'contact',
    entityId: relatedEntityId || phoneE164,
    beforeState: null,
    afterState: { to: phoneE164, textLength: text.length, metaMessageId },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || '',
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
  });

  return res.json({ ok: true, metaMessageId, logId: logRef.id });
});

// ============================================================================
// POST /proxy/whatsapp/optin
// Records / updates a consent (opt-in / opt-out) event. Called from browser
// signup forms + settings (TASK 3 / 4) and from server flows. Writes the
// whatsapp_optin doc via Admin SDK (clients cannot write it directly) and an
// auditLogs entry. Idempotent per phone (merges).
// Body: {
//   phoneE164 | to, userId, source, status?, transactional?, marketingOptin?,
//   consentText, consentLocale, actorUserId?, actorRole?
// }
// ============================================================================

const OPTIN_SOURCES = [
  'candidate_signup', 'employer_signup', 'partner_signup', 'jd_upload_form',
  'career_fair_rsvp', 'manual_admin', 'imported_with_consent', 'user_settings',
];

router.post('/optin', requireOptinAuth, async (req, res) => {
  const b = req.body || {};
  const phoneE164 = normalizeE164(b.phoneE164 || b.to);
  if (!phoneE164 || !/^\+\d{8,15}$/.test(phoneE164)) {
    return res.status(400).json({ error: 'invalid_phone', received: b.phoneE164 || b.to });
  }

  const source = OPTIN_SOURCES.includes(b.source) ? b.source : 'manual_admin';
  // status precedence: explicit status wins; else derive from transactional flag.
  const status = b.status
    || (b.transactional === false ? 'pending_verification' : 'active');
  const marketingOptin = b.marketingOptin === true;
  const actorUserId = b.actorUserId || req.authenticatedUser?.uid || null;

  const ref = db.collection('whatsapp_optin').doc(phoneE164);
  const prev = await ref.get();
  const before = prev.exists ? prev.data() : null;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const record = {
    phoneE164,
    userId: b.userId ?? before?.userId ?? null,
    status,
    source,
    consentText: b.consentText || before?.consentText || '',
    consentLocale: b.consentLocale || before?.consentLocale || 'en',
    optinAt: before?.optinAt || now,
    optoutAt: status === 'opted_out' ? now : (before?.optoutAt || null),
    lastTemplateAt: before?.lastTemplateAt || null,
    serviceWindowExpiresAt: before?.serviceWindowExpiresAt || null,
    marketingOptin,
    marketingOptinAt: marketingOptin ? now : (before?.marketingOptinAt || null),
  };
  await ref.set(record, { merge: true });

  await db.collection('auditLogs').add({
    actorUserId: actorUserId || 'system',
    actorRole: b.actorRole || 'system',
    action: 'whatsapp_optin_changed',
    entityType: 'whatsapp_optin',
    entityId: phoneE164,
    beforeState: before ? { status: before.status, marketingOptin: before.marketingOptin } : null,
    afterState: { status, marketingOptin },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || '',
    timestamp: now,
  });

  return res.json({ ok: true, phoneE164, status, marketingOptin });
});

// ============================================================================
// GET /proxy/whatsapp/conversation/:phoneE164
// Returns last 50 messages (incoming + outgoing) for a phone number, merged & sorted.
// Auth: requireAuth (x-proxy-secret OR Firebase ID token w/ admin|manager role)
// ============================================================================

router.get('/conversation/:phoneE164', requireAuth, async (req, res) => {
  const phone = req.params.phoneE164;

  const [incomingSnap, outgoingSnap] = await Promise.all([
    db.collection('whatsapp_incoming')
      .where('phoneE164', '==', phone)
      .orderBy('receivedAt', 'desc')
      .limit(50)
      .get(),
    db.collection('whatsapp_send_log')
      .where('phoneE164', '==', phone)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get(),
  ]);

  const incoming = incomingSnap.docs.map(d => ({
    id: d.id, direction: 'inbound', body: d.data().body,
    timestamp: d.data().receivedAt?.toDate()?.toISOString() || null,
    type: d.data().type, metaMessageId: d.data().metaMessageId,
  }));

  const outgoing = outgoingSnap.docs.map(d => ({
    id: d.id, direction: 'outbound',
    body: d.data().templateName === '_freeform'
      ? `[free-form] ${d.data().variables?.[0] || ''}`
      : `[template: ${d.data().templateName}]`,
    timestamp: d.data().createdAt?.toDate()?.toISOString() || null,
    status: d.data().status, actorUserId: d.data().actorUserId,
  }));

  const merged = [...incoming, ...outgoing]
    .sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime())
    .slice(0, 50);

  return res.json({ phone, messages: merged });
});

// ============================================================================
// GET /proxy/whatsapp/webhook
// Meta webhook verification challenge (one-time, when you set webhook URL)
// ============================================================================

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WA_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ============================================================================
// POST /proxy/whatsapp/webhook
// Receives incoming messages, status updates, quality updates
// Must accept raw body for signature verification — mount with bodyParser.raw
// or use express.raw({ type: 'application/json' }) at app level for this route
// ============================================================================

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Verify signature
  if (!verifyWebhookSignature(req, req.body)) {
    return res.sendStatus(403);
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch (err) {
    return res.sendStatus(400);
  }

  // Acknowledge quickly — Meta retries if we don't 200 within 20s
  res.sendStatus(200);

  // Process async
  try {
    await processWebhookPayload(payload);
  } catch (err) {
    console.error('Webhook processing error:', err);
    // Already 200'd to Meta — log internally for debugging
    await db.collection('whatsapp_webhook_errors').add({
      error: err.message,
      payload,
      capturedAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});
  }
});

async function processWebhookPayload(payload) {
  if (payload.object !== 'whatsapp_business_account') return;

  for (const entry of (payload.entry || [])) {
    for (const change of (entry.changes || [])) {
      const field = change.field;
      const value = change.value;

      if (field === 'messages') {
        // Incoming messages OR status updates
        if (value.messages) {
          for (const msg of value.messages) {
            await handleIncomingMessage(msg, value.contacts || []);
          }
        }
        if (value.statuses) {
          for (const status of value.statuses) {
            await handleStatusUpdate(status);
          }
        }
      } else if (field === 'message_template_status_update') {
        await db.collection('whatsapp_templates').doc(value.message_template_name || 'unknown').set({
          name: value.message_template_name,
          language: value.message_template_language,
          event: value.event, // APPROVED, REJECTED, PAUSED, etc.
          reason: value.reason || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      } else if (field === 'phone_number_quality_update') {
        await db.collection('whatsapp_quality').add({
          phoneNumberId: WA_PHONE_NUMBER_ID,
          qualityRating: (value.current_limit || '').toLowerCase().includes('red') ? 'red'
            : (value.event || '').toLowerCase(),
          rawEvent: value,
          capturedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }
  }
}

async function handleIncomingMessage(msg, contacts) {
  const fromPhone = '+' + msg.from;
  const messageBody = msg.text?.body?.trim() || '';
  const lowerBody = messageBody.toLowerCase();

  // Reset 24h service window
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const optinRef = db.collection('whatsapp_optin').doc(fromPhone);

  // Log incoming
  await db.collection('whatsapp_incoming').add({
    phoneE164: fromPhone,
    metaMessageId: msg.id,
    type: msg.type,
    body: messageBody,
    contactName: contacts?.[0]?.profile?.name || null,
    receivedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Opt-out keywords (EN + ZH + MS)
  const OPTOUT_KEYWORDS = ['stop', 'unsubscribe', 'opt out', 'optout',
                           '停止', '退订', '取消订阅', 'berhenti'];
  if (OPTOUT_KEYWORDS.some(kw => lowerBody === kw || lowerBody.includes(kw))) {
    await optinRef.set({
      phoneE164: fromPhone,
      status: 'opted_out',
      optoutAt: admin.firestore.FieldValue.serverTimestamp(),
      optoutMessage: messageBody
    }, { merge: true });
    return;
  }

  // Update service window
  await optinRef.set({
    serviceWindowExpiresAt: expiresAt
  }, { merge: true }).catch(() => {});
}

async function handleStatusUpdate(status) {
  // status.id = Meta message ID, status.status = sent|delivered|read|failed
  const snap = await db.collection('whatsapp_send_log')
    .where('metaMessageId', '==', status.id)
    .limit(1)
    .get();
  if (snap.empty) return;
  await snap.docs[0].ref.update({
    status: status.status,
    statusUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...(status.errors && { metaStatusErrors: status.errors })
  });
}

// ============================================================================
// GET /proxy/whatsapp/quality
// Fetch current quality + tier from Meta, write snapshot to Firestore
// Call this via cron daily; also exposed for admin dashboard refresh button
// ============================================================================

router.get('/quality', requireProxySecret, async (req, res) => {
  try {
    const url = `${META_GRAPH_BASE}/${WA_PHONE_NUMBER_ID}?fields=quality_rating,messaging_limit_tier,throughput`;
    const fetchRes = await fetch(url, {
      headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` }
    });
    const data = await fetchRes.json();
    if (!fetchRes.ok) {
      return res.status(502).json({ error: 'meta_query_failed', detail: data });
    }
    const snapshot = {
      phoneNumberId: WA_PHONE_NUMBER_ID,
      qualityRating: (data.quality_rating || 'unknown').toLowerCase(),
      messagingLimitTier: data.messaging_limit_tier || 'unknown',
      throughputTier: data.throughput?.level || 'standard',
      capturedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('whatsapp_quality').add(snapshot);
    return res.json(snapshot);
  } catch (err) {
    return res.status(502).json({ error: 'meta_unreachable', detail: err.message });
  }
});

module.exports = router;
