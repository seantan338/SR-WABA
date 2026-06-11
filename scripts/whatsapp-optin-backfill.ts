// scripts/whatsapp-optin-backfill.ts
// One-time migration. Run: npx ts-node scripts/whatsapp-optin-backfill.ts
// Creates pending_verification records for existing users with phones.
// Does NOT auto-opt-in anyone. Sean must confirm before running in production.
//
// Dry run (logs what WOULD be written, writes nothing):
//   DRY_RUN=true npx ts-node scripts/whatsapp-optin-backfill.ts
//
// Credentials: uses Application Default Credentials. Set GOOGLE_APPLICATION_CREDENTIALS
// to the service-account JSON path, or run in an environment where ADC is configured.

import * as admin from 'firebase-admin';

const DRY_RUN = String(process.env.DRY_RUN || '').toLowerCase() === 'true';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}
const db = admin.firestore();

// Normalize phone to E.164 — Malaysia / Singapore aware (mirrors wa-proxy.js).
function normalizeE164(raw: unknown, defaultCountry: 'MY' | 'SG' = 'MY'): string | null {
  if (!raw) return null;
  const s = String(raw).replace(/[\s\-()]/g, '');
  if (s.startsWith('+')) return s;
  if (defaultCountry === 'MY') {
    if (s.startsWith('0')) return '+6' + s;
    if (s.startsWith('60')) return '+' + s;
    if (s.startsWith('6')) return '+' + s;
  }
  if (defaultCountry === 'SG') {
    if (/^\d{8}$/.test(s)) return '+65' + s;
    if (s.startsWith('65')) return '+' + s;
  }
  return s.startsWith('+') ? s : '+' + s;
}

// One-time migration. Does NOT auto-opt-in. Creates 'pending_verification'
// records so we can see what's outstanding, but blocks all sends until the
// user actively opts in via UI.
async function backfillOptinPending(): Promise<void> {
  const usersSnap = await db.collection('users').get();
  let processed = 0;
  let skippedNoPhone = 0;
  let skippedBadPhone = 0;
  let skippedExisting = 0;

  for (const userDoc of usersSnap.docs) {
    const user = userDoc.data();
    if (!user.phone) {
      skippedNoPhone++;
      continue;
    }
    const phoneE164 = normalizeE164(user.phone);
    if (!phoneE164) {
      skippedBadPhone++;
      continue;
    }

    const optinRef = db.collection('whatsapp_optin').doc(phoneE164);
    const existing = await optinRef.get();
    if (existing.exists) {
      skippedExisting++;
      continue;
    }

    const record = {
      phoneE164,
      userId: userDoc.id,
      status: 'pending_verification', // explicitly NOT 'active'
      source: 'imported_with_consent',
      consentText: '[BACKFILL — no explicit WhatsApp consent on record]',
      consentLocale: user.locale || 'en',
      optinAt: admin.firestore.Timestamp.now(),
      optoutAt: null,
      lastTemplateAt: null,
      serviceWindowExpiresAt: null,
      marketingOptin: false,
      marketingOptinAt: null,
    };

    if (DRY_RUN) {
      console.log(`[dry-run] would create whatsapp_optin/${phoneE164} for user ${userDoc.id}`);
    } else {
      await optinRef.set(record);
    }
    processed++;
  }

  const verb = DRY_RUN ? 'Would backfill' : 'Backfilled';
  console.log(
    `${verb} ${processed} pending opt-in records ` +
      `(skipped: ${skippedNoPhone} no-phone, ${skippedBadPhone} invalid-phone, ${skippedExisting} already-exists).`
  );
  if (DRY_RUN) {
    console.log('DRY_RUN=true — nothing was written. Re-run without DRY_RUN to apply.');
  }
}

backfillOptinPending()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
