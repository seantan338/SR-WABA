# Firestore Schema — WhatsApp Collections

Three new collections + security rule additions. Hand to Claude Code for implementation against the existing SR-Web-AS / CP4U Firestore project.

## Collection: `whatsapp_optin`

Document ID = phone in E.164 format (e.g. `+60123456789`). Using phone as ID prevents duplicate opt-in records.

```typescript
// types/whatsapp.ts
export interface WhatsAppOptin {
  phoneE164: string;                    // matches doc ID
  userId: string | null;                // linked CP4U user if any
  status: 'active' | 'opted_out' | 'pending_verification';
  source:
    | 'candidate_signup'
    | 'employer_signup'
    | 'partner_signup'
    | 'jd_upload_form'
    | 'career_fair_rsvp'
    | 'manual_admin'                    // requires actorAdminId
    | 'imported_with_consent';          // legacy — requires consentEvidence
  consentText: string;                  // exact wording shown at opt-in
  consentLocale: 'en' | 'zh' | 'ms';
  consentEvidence?: string;             // URL/path to evidence file if imported
  optinAt: Timestamp;
  optoutAt: Timestamp | null;
  optoutMessage?: string;               // the actual STOP message text if user-initiated
  lastTemplateAt: Timestamp | null;
  serviceWindowExpiresAt: Timestamp | null;  // 24h from last incoming message
  marketingOptin: boolean;              // separate consent for MARKETING category
  marketingOptinAt: Timestamp | null;
  actorAdminId?: string;                // if source = manual_admin
}
```

## Collection: `whatsapp_send_log`

Append-only log of every outbound attempt — successes, failures, blocked attempts. Source of truth for audit + analytics.

```typescript
export interface WhatsAppSendLog {
  // identifiers
  phoneE164: string;
  metaMessageId: string | null;         // null if blocked before send

  // template
  templateName: string;
  templateCategory: 'utility' | 'marketing' | 'authentication';
  language: 'en' | 'zh_CN' | 'ms';
  variables: string[];

  // status lifecycle
  status:
    | 'queued'
    | 'sent'        // accepted by Meta
    | 'delivered'   // delivered to handset
    | 'read'        // user opened
    | 'failed'      // Meta returned error
    | 'blocked';    // our pre-flight rejected (opt-in / quality / cap)
  errorCode: string | null;
  errorDetail: string | null;
  metaRawError?: any;                   // full Meta error object if failed
  statusUpdatedAt: Timestamp | null;

  // context
  actorUserId: string | null;           // user who triggered (admin/recruiter/system)
  actorRole: 'admin' | 'manager' | 'recruiter' | 'system' | 'n8n' | null;
  relatedEntityType: 'candidate' | 'application' | 'referral' | 'job' | null;
  relatedEntityId: string | null;

  createdAt: Timestamp;
}
```

## Collection: `whatsapp_quality`

Time-series snapshots of Meta-reported quality + tier. Polled daily via cron + on webhook events.

```typescript
export interface WhatsAppQuality {
  phoneNumberId: string;
  qualityRating: 'green' | 'yellow' | 'red' | 'unknown';
  messagingLimitTier:
    | 'tier_250'
    | 'tier_1k'
    | 'tier_10k'
    | 'tier_100k'
    | 'unlimited'
    | 'unknown';
  throughputTier: 'standard' | 'high';
  rawEvent?: any;                       // raw Meta webhook payload if available
  capturedAt: Timestamp;
}
```

## Collection: `whatsapp_incoming`

All incoming messages from users. Used to maintain 24h service window and capture replies (e.g. interview confirmations).

```typescript
export interface WhatsAppIncoming {
  phoneE164: string;
  metaMessageId: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'sticker' | 'interactive' | 'button';
  body: string;                         // text body or empty for non-text
  contactName: string | null;           // from Meta contact profile
  matched: boolean;                     // did our app process this (e.g. linked to candidate)?
  linkedEntityType: 'candidate' | 'application' | 'referral' | null;
  linkedEntityId: string | null;
  receivedAt: Timestamp;
}
```

## Collection: `whatsapp_templates`

Mirror of Meta's template approval status. Populated by webhook + manual sync. Lets the platform UI know which templates are usable.

```typescript
export interface WhatsAppTemplate {
  name: string;                         // doc ID
  language: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  event:
    | 'APPROVED'
    | 'REJECTED'
    | 'PAUSED'
    | 'DISABLED'
    | 'PENDING'
    | 'IN_APPEAL';
  reason: string | null;                // rejection reason from Meta
  updatedAt: Timestamp;
}
```

---

## Firestore Security Rules

Add to `firestore.rules`. Pattern: all WhatsApp collections are **never client-writable**. Only the sr-proxy (via Admin SDK) writes. Clients can read their own audit data only.

```javascript
// firestore.rules — add inside `service cloud.firestore` -> `match /databases/{db}/documents`

// === WhatsApp collections — server-only writes ===

match /whatsapp_optin/{phoneE164} {
  // Read: admin can read all; user can read their own
  allow read: if isAdmin() ||
               (isSignedIn() && resource.data.userId == request.auth.uid);
  // Write: never from client. Admin SDK only (which bypasses these rules).
  allow write: if false;
}

match /whatsapp_send_log/{logId} {
  // Read: admin + manager only — this is sensitive operational data
  allow read: if isAdmin() || isManager();
  allow write: if false;
}

match /whatsapp_quality/{snapshotId} {
  // Read: admin + manager
  allow read: if isAdmin() || isManager();
  allow write: if false;
}

match /whatsapp_incoming/{msgId} {
  // Read: admin only — incoming messages may contain candidate info
  allow read: if isAdmin();
  allow write: if false;
}

match /whatsapp_templates/{templateName} {
  // Read: all authenticated users (UI needs to know what's available)
  allow read: if isSignedIn();
  allow write: if false;
}

// Helper functions (assumed to exist already; add if not)
function isSignedIn() {
  return request.auth != null;
}
function isAdmin() {
  return isSignedIn() &&
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
}
function isManager() {
  return isSignedIn() &&
         get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'manager'];
}
```

## Firestore Composite Indexes

Add to `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "whatsapp_send_log",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "createdAt", "order": "DESCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "whatsapp_send_log",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "phoneE164", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "whatsapp_send_log",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "relatedEntityType", "order": "ASCENDING" },
        { "fieldPath": "relatedEntityId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "whatsapp_quality",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "capturedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "whatsapp_optin",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "marketingOptin", "order": "ASCENDING" }
      ]
    }
  ]
}
```

## Migration step for existing users

When this rolls out, existing users in CP4U / Sunrise have no opt-in record. For each existing candidate / employer / partner with a phone number on file:

```typescript
// One-time migration script — run from sr-proxy or Cloud Function
// Does NOT auto-opt-in. Creates 'pending_verification' records so we can
// see what's outstanding, but blocks all sends until user actively opts in via UI.

async function backfillOptinPending() {
  const usersSnap = await db.collection('users').get();
  let processed = 0;
  for (const userDoc of usersSnap.docs) {
    const user = userDoc.data();
    if (!user.phone) continue;
    const phoneE164 = normalizeE164(user.phone);
    if (!phoneE164) continue;

    const optinRef = db.collection('whatsapp_optin').doc(phoneE164);
    const existing = await optinRef.get();
    if (existing.exists) continue;

    await optinRef.set({
      phoneE164,
      userId: userDoc.id,
      status: 'pending_verification',  // explicitly NOT 'active'
      source: 'imported_with_consent',
      consentText: '[BACKFILL — no explicit WhatsApp consent on record]',
      consentLocale: user.locale || 'en',
      optinAt: admin.firestore.Timestamp.now(),
      optoutAt: null,
      lastTemplateAt: null,
      serviceWindowExpiresAt: null,
      marketingOptin: false,
      marketingOptinAt: null
    });
    processed++;
  }
  console.log(`Backfilled ${processed} pending opt-in records`);
}
```

**Important:** The pre-flight check in `wa-proxy.js` only allows `status === 'active'`. `pending_verification` records block sends. To activate, the user must opt in through a UI flow (re-engagement campaign via email or in-platform notification).
