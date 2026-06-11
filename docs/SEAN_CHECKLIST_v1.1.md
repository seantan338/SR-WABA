# Sean's Execution Checklist — v1.1 (Decisions Locked)

**Decisions locked:**
1. ✅ **WABA owner**: Sunrise Recruit Sdn Bhd
2. ✅ **Phone**: New dedicated SIM (you to acquire)
3. ✅ **12,000 old CV database**: Treat as opted-OUT until each person re-engages via new platform
4. ✅ **Marketing template #9**: REMOVED. Deferred to Sprint 4+. Only 8 templates being submitted. (Analysis: marketing risk to Quality Rating outweighs RM 180/year savings; email is better channel for job alerts.)
5. ✅ **n8n workflow JSON exports**: All 5 written and ready to import

---

## Pre-flight

- [ ] Get a NEW SIM dedicated to platform automation. **Cannot have had WhatsApp Personal or Business app on it before.** Recommendation: Maxis or Celcom postpaid (RM 30/mo). Register in Sunrise Recruit Sdn Bhd's name.
- [ ] Prepare documents for business verification (see `META_VERIFICATION_GUIDE.md`):
  - SSM Form 9 / Borang D (Sunrise Recruit Sdn Bhd)
  - SSM Form 24 + 49 (directors/shareholders)
  - Last 3 months bank statement (business account)
  - Utility bill OR Shinjiru domain receipt for sunriserecruit.com

---

## Day 1 — Meta Business setup (~2 hours hands-on, then 1-7 days wait)

Follow `META_VERIFICATION_GUIDE.md` step by step. Key milestones:

- [ ] **Step 1.** Log into `business.facebook.com`. Open Business Manager for Sunrise Recruit Sdn Bhd
- [ ] **Step 2.** Complete Business Verification (upload documents per guide)
- [ ] **Step 3.** Add WhatsApp Business Account (WABA) inside Business Manager
- [ ] **Step 4.** Add the new SIM number to WABA → verify via SMS/voice
- [ ] **Step 5.** Create Meta App at `developers.facebook.com/apps` → add WhatsApp product → link to Business Manager
- [ ] **Step 6.** Generate Permanent Access Token (System User, never expire)
- [ ] **Step 7.** Record 5 values in password manager (Phone Number ID, WABA ID, Access Token, App Secret, your Webhook Verify Token)

Status: working on Business Verification in parallel with Day 2.

---

## Day 2 — Templates + code deployment (~3 hours)

- [ ] **Step 8.** Submit 8 templates from `templates.json`. For bilingual (4 of them), submit each twice — once `en`, once `zh_CN`. **Total submissions: 12** (4 EN-only + 4 × 2 bilingual = 12).
  - candidate_cv_received (EN + ZH)
  - candidate_interview_invite (EN + ZH)
  - candidate_offer_notification (EN + ZH)
  - candidate_placement_confirmed (EN + ZH)
  - client_jd_received (EN only)
  - client_candidate_submitted (EN only)
  - partner_referral_status_update (EN + ZH)
  - verification_otp (EN only)
- [ ] **Step 9.** Hand `wa-proxy.js` + `firestore-schema.md` to IT partner or Claude Code:
  - Add `wa-proxy.js` to sr-proxy repo at `src/routes/wa-proxy.js`
  - Mount in sr-proxy main file
  - Apply Firestore schema (5 collections, security rules, indexes)
  - Deploy sr-proxy to Zeabur
- [ ] **Step 10.** Set Zeabur env vars on sr-proxy service:
  ```
  WHATSAPP_PHONE_NUMBER_ID=<from Day 1 Step 7>
  WHATSAPP_ACCESS_TOKEN=<from Day 1 Step 7>
  WHATSAPP_WABA_ID=<from Day 1 Step 7>
  WHATSAPP_APP_SECRET=<from Day 1 Step 7>
  WHATSAPP_VERIFY_TOKEN=<from Day 1 Step 7>
  WHATSAPP_DAILY_SEND_CAP=200
  WHATSAPP_QUALITY_HALT=red
  ```
- [ ] **Step 11.** Configure Meta webhook:
  - WhatsApp Manager → Configuration → Webhook
  - Callback URL: `https://[your sr-proxy domain]/proxy/whatsapp/webhook`
  - Verify Token: paste your random 32-char string
  - Subscribe: `messages`, `message_template_status_update`, `phone_number_quality_update`
  - Click "Verify and Save"

---

## Day 3 — n8n + UI + test send (~half day)

- [ ] **Step 12.** Import 5 n8n workflows from JSON files:
  - `n8n-workflow-1-candidate-cv-received.json`
  - `n8n-workflow-2-client-jd-received.json`
  - `n8n-workflow-3-candidate-status-sync.json`
  - `n8n-workflow-4-partner-referral-status.json`
  - `n8n-workflow-5-daily-quality-poll.json`
  - n8n → Workflows → Import from File for each
- [ ] **Step 13.** Set n8n environment variables (Settings → Variables):
  ```
  SR_PROXY_URL=https://[your sr-proxy domain]
  SR_PROXY_SECRET=<same as PROXY_SECRET on sr-proxy>
  SLACK_ALERTS_WEBHOOK=<optional, your Slack webhook URL>
  SEAN_EMAIL=<your email>
  ```
- [ ] **Step 14.** Configure n8n Firestore credentials (if not already done) — Google Firebase Cloud Firestore OAuth2 → service account JSON
- [ ] **Step 15.** Activate workflows (start with #5 quality poll only — safest test); leave 1-4 inactive until you've done test send
- [ ] **Step 16.** Hand React components to Claude Code:
  - `WhatsAppOptInBlock.tsx` → integrate into candidate, employer, partner signup forms + JD upload form + Career Fair RSVP
  - `WhatsAppConsentSettings.tsx` → add to `/dashboard/settings`, `/employer/settings`, `/partner/settings`
  - `WhatsAppQualityTile.tsx` → add to `/admin` dashboard
- [ ] **Step 17.** Manually create your own opt-in record for testing:
  - Firebase Console → Firestore → `whatsapp_optin` → Create document
  - Doc ID: `+60[your number]`
  - Fields:
    ```
    phoneE164: +60xxxxxxxxx
    status: active
    source: manual_admin
    consentText: "Manual test entry by Sean"
    consentLocale: en
    optinAt: (timestamp - now)
    marketingOptin: false
    ```
- [ ] **Step 18.** Test send via curl:
  ```bash
  curl -X POST https://[sr-proxy-domain]/proxy/whatsapp/send \
    -H "Content-Type: application/json" \
    -H "x-proxy-secret: <your PROXY_SECRET>" \
    -d '{
      "to": "+60xxxxxxxxx",
      "templateName": "candidate_cv_received",
      "language": "en",
      "templateCategory": "utility",
      "variables": ["Sean"],
      "actorUserId": "test"
    }'
  ```
  - Expected response: `{"ok": true, "metaMessageId": "...", ...}`
  - Expected: WhatsApp message arrives on your phone within 5 seconds
- [ ] **Step 19.** Activate the rest of n8n workflows 1-4 once test send succeeds

---

## Day 4+ — Monitor + iterate

Daily for week 1, then weekly:
- [ ] Check WhatsAppQualityTile in admin dashboard (should be Green)
- [ ] Check daily send count vs cap (currently 200; raise to 800 if quality stays Green after 2 weeks)
- [ ] Check opt-out count in Firestore `whatsapp_optin` where status = opted_out
- [ ] Check failed send rate in `whatsapp_send_log`

---

## When Business Verification is approved

- [ ] Your tier auto-upgrades from 250 to 1,000 messages/24h within 24 hours
- [ ] In sr-proxy env vars on Zeabur: raise `WHATSAPP_DAILY_SEND_CAP` from 200 → 800 (80% of new tier)

---

## Re-engagement campaign for the 12,000 CV database (separate workstream)

Per Decision #3: do NOT auto-opt-in the 12,000 old CVs.

The campaign:
- [ ] **Phase 1** (Sprint 1): Run `backfillOptinPending()` script → creates `pending_verification` records for all 12,000. Status blocks sends, but data is visible to admin.
- [ ] **Phase 2** (Sprint 2): Send re-engagement email (NOT WhatsApp) inviting them to set up CP4U accounts. Template in `optin-flow.md`. Use Resend or your existing SendGrid.
- [ ] **Phase 3** (Sprint 2-3): As candidates re-engage via the new signup flow, `WhatsAppOptInBlock` captures explicit consent → record flips from `pending_verification` to `active`.
- [ ] **Phase 4** (Month 6): Bulk delete `pending_verification` records that never converted. They never got a WhatsApp message — clean data hygiene.

---

## Hard NOs (still in force)

- ❌ Don't mass-import 12,000 phones as opted-in
- ❌ Don't enable marketing template (#9 deferred — file is removed from kit)
- ❌ Don't auto-broadcast AI-generated job ads to candidate lists
- ❌ Don't skip the 24h service window
- ❌ Don't use the WABA phone for personal WhatsApp ever

---

## Files in this v1.1 kit

| File | Purpose | Who handles it |
|---|---|---|
| `SEAN_CHECKLIST.md` (this) | Master execution list | You |
| `WHATSAPP_DEPLOYMENT_KIT.md` | Full reference doc | Reference |
| `META_VERIFICATION_GUIDE.md` | Step-by-step Meta Business Verification | You |
| `wa-proxy.js` | sr-proxy backend route | IT partner / Claude Code |
| `templates.json` | 8 message template specs | You (manual UI submission) |
| `firestore-schema.md` | Firestore collections + rules | Claude Code |
| `optin-flow.md` | UI consent copy + flow | Claude Code |
| `WhatsAppOptInBlock.tsx` | Signup form checkbox component | Claude Code |
| `WhatsAppConsentSettings.tsx` | User settings consent manager | Claude Code |
| `WhatsAppQualityTile.tsx` | Admin dashboard health tile | Claude Code |
| `n8n-workflow-1-candidate-cv-received.json` | n8n workflow | You (import) |
| `n8n-workflow-2-client-jd-received.json` | n8n workflow | You (import) |
| `n8n-workflow-3-candidate-status-sync.json` | n8n workflow | You (import) |
| `n8n-workflow-4-partner-referral-status.json` | n8n workflow | You (import) |
| `n8n-workflow-5-daily-quality-poll.json` | n8n workflow | You (import) |

---

## What's removed from v1.0

- ❌ `candidate_job_match_alert` (marketing template) — deferred to Sprint 4+
- All references to marketing-category sending have been pulled from sr-proxy code (the route still supports the parameter for future use, but no template uses it)
