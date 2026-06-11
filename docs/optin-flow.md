# WhatsApp Opt-In Capture — UI Copy & Flow

Where opt-in is captured + the exact bilingual consent wording. Each opt-in event MUST write to Firestore `whatsapp_optin` with status `active`, source, consent text, locale, and timestamp.

---

## Principle

There are TWO consent levels:

1. **Transactional opt-in** (UTILITY templates): Required for any platform-related WhatsApp notification — CV received, interview invite, offer notice, placement confirmation, JD received, candidate submitted, referral updates. Bundled with main signup but **must be visually distinct** (separate checkbox, not buried in T&Cs).

2. **Marketing opt-in** (MARKETING templates): Required for proactive job alerts, newsletters, promotional content. **Separate, explicit, unchecked-by-default checkbox.** Required by Meta + PDPA.

Never imply consent. Never pre-check the boxes. Never use dark patterns.

---

## Location 1: Candidate Signup Form

After standard fields (name, email, phone, password), before submit button:

### EN

```
☐ I agree to receive transactional WhatsApp messages from Sunrise Recruit
   about my CV submissions, interviews, offers and placements at +60XXXXXXXXX.
   I can reply STOP at any time to unsubscribe.

☐ I'd also like to receive WhatsApp job alerts when new openings match my profile.
   (Optional — you'll still hear from us about your active applications.)
```

### ZH

```
☐ 我同意接收 Sunrise Recruit 通过 WhatsApp 发送的事务性消息，
   包括简历接收确认、面试邀约、Offer 通知和入职确认。
   号码：+60XXXXXXXXX。我可以随时回复 STOP 退订。

☐ 我同时希望接收 WhatsApp 职位匹配提醒（可选）。
   即使不勾选，您仍会收到关于您主动申请职位的更新。
```

### What to record in Firestore

```javascript
await db.collection('whatsapp_optin').doc(phoneE164).set({
  phoneE164,
  userId: newUser.uid,
  status: transactionalChecked ? 'active' : 'pending_verification',
  source: 'candidate_signup',
  consentText: '[exact EN/ZH text shown above]',
  consentLocale: userLocale,
  optinAt: admin.firestore.FieldValue.serverTimestamp(),
  optoutAt: null,
  lastTemplateAt: null,
  serviceWindowExpiresAt: null,
  marketingOptin: marketingChecked === true,
  marketingOptinAt: marketingChecked ? admin.firestore.FieldValue.serverTimestamp() : null
});
```

⚠️ If `transactionalChecked === false`, the signup still succeeds but no WhatsApp will be sent. Candidate still gets email notifications.

---

## Location 2: Employer Signup Form

After company details + contact person fields:

### EN

```
☐ Send transactional WhatsApp updates to my number +60XXXXXXXXX about
   job orders, candidate submissions and platform activity.
   Reply STOP at any time to unsubscribe.
```

(No marketing opt-in for employers — they're not the audience for that.)

### What to record

```javascript
await db.collection('whatsapp_optin').doc(phoneE164).set({
  phoneE164,
  userId: newUser.uid,
  status: transactionalChecked ? 'active' : 'pending_verification',
  source: 'employer_signup',
  consentText: '[exact EN text shown above]',
  consentLocale: 'en',
  optinAt: admin.firestore.FieldValue.serverTimestamp(),
  optoutAt: null,
  lastTemplateAt: null,
  serviceWindowExpiresAt: null,
  marketingOptin: false,
  marketingOptinAt: null
});
```

---

## Location 3: Partner Signup Form (Dollarize)

After identity + KYC fields:

### EN

```
☐ Send transactional WhatsApp updates to my number +60XXXXXXXXX about
   my referrals, commissions, tier changes and platform notifications.
   Reply STOP at any time to unsubscribe.

☐ Send WhatsApp alerts when new jobs in my specialty open up.
   (Optional — helps you act on opportunities faster.)
```

### ZH

```
☐ 我同意接收 Sunrise Recruit 通过 WhatsApp 发送的事务性消息，
   包括推荐进度、佣金、级别变化和平台通知。
   号码：+60XXXXXXXXX。我可以随时回复 STOP 退订。

☐ 我希望在我专长领域有新职位空缺时收到 WhatsApp 提醒（可选）。
```

### What to record

```javascript
await db.collection('whatsapp_optin').doc(phoneE164).set({
  phoneE164,
  userId: newPartner.uid,
  status: transactionalChecked ? 'active' : 'pending_verification',
  source: 'partner_signup',
  consentText: '[exact text shown above]',
  consentLocale: userLocale,
  optinAt: admin.firestore.FieldValue.serverTimestamp(),
  optoutAt: null,
  lastTemplateAt: null,
  serviceWindowExpiresAt: null,
  marketingOptin: marketingChecked === true,
  marketingOptinAt: marketingChecked ? admin.firestore.FieldValue.serverTimestamp() : null
});
```

---

## Location 4: JD Upload Form (Quick Lead Capture)

When a hiring manager uploads a JD without a full account yet (lead-gen flow):

### EN

```
After upload, we'll have a consultant follow up.
☐ Send a WhatsApp confirmation to +60XXXXXXXXX when we receive your JD.
   We'll never share your number or send promotional messages.
```

(Note: this only covers the single confirmation message. Anything beyond that requires full signup.)

### What to record

```javascript
await db.collection('whatsapp_optin').doc(phoneE164).set({
  phoneE164,
  userId: null,                    // no account yet
  status: confirmChecked ? 'active' : 'pending_verification',
  source: 'jd_upload_form',
  consentText: '[exact text]',
  consentLocale: 'en',
  optinAt: admin.firestore.FieldValue.serverTimestamp(),
  optoutAt: null,
  lastTemplateAt: null,
  serviceWindowExpiresAt: null,
  marketingOptin: false,
  marketingOptinAt: null
});
```

---

## Location 5: Career Fair RSVP

When candidate RSVPs to an online Career Fair event:

### EN

```
We'll send you the Zoom link and event reminders.
☐ Send WhatsApp reminders to +60XXXXXXXXX (24h before + 1h before).
   Email reminders will be sent regardless.
```

---

## Location 6: User Profile / Settings — Manage Consent

Every user must be able to view + revoke consent. Place in `/dashboard/settings` or equivalent:

### EN

```
WhatsApp notifications
─────────────────────────────────────────────
Status:     ✅ Active   (since 28 May 2026)
Number:     +60123456789

Transactional updates    [✅ ON]   [Turn off]
   Application updates, interviews, offers, placements

Job match alerts         [☐ OFF]  [Turn on]
   New jobs matching your profile (weekly)

[ Unsubscribe from all WhatsApp messages ]
```

### Behavior

- "Turn off transactional" → set `status: 'opted_out'`, `optoutAt: now()`, source = 'user_settings'
- "Turn off marketing only" → set `marketingOptin: false`, leave `status: 'active'`
- "Unsubscribe from all" → set `status: 'opted_out'`, `marketingOptin: false`, `optoutAt: now()`

User can re-enable. Same Firestore write pattern, status flips back to `active`.

---

## Migration / re-engagement plan for existing CV database (12,000 candidates)

**DO NOT** auto-opt-in any of these.

Strategy:

1. Run `backfillOptinPending()` (see `firestore-schema.md`) — creates pending records for all 12,000, status = `pending_verification`. This blocks sends but lets us see who's outstanding.

2. Re-engagement email campaign (NOT WhatsApp — use email or platform notification):

> Subject: Your Sunrise Recruit profile — new opportunities + a quick update
>
> Hi [name],
>
> You're in our database from when you submitted your CV with us back in [year]. We've upgraded our platform — you can now see live jobs, track your applications, and get faster updates.
>
> Set up your access in 30 seconds: [link to /signup with pre-filled email]
>
> While you're there, you can also opt in to WhatsApp notifications so you hear from us directly when something matches.
>
> Not interested? No action needed — we'll quietly remove your number from our active list within 6 months.
>
> — The Sunrise Recruit Team

3. As candidates re-engage and complete signup, they go through Location 1's flow and explicitly opt in. Now their pending record becomes active.

4. 6 months later: bulk delete `pending_verification` records that never converted. They never received a WhatsApp message; they never will.

---

## Audit log requirement

Every consent change writes to Firestore `auditLogs` (the existing CP4U audit collection):

```javascript
await db.collection('auditLogs').add({
  actorUserId: userId,
  actorRole: 'candidate' | 'employer' | 'partner' | 'admin',
  action: 'whatsapp_optin_changed',
  entityType: 'whatsapp_optin',
  entityId: phoneE164,
  beforeState: { status: oldStatus, marketingOptin: oldMarketing },
  afterState: { status: newStatus, marketingOptin: newMarketing },
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
  timestamp: admin.firestore.FieldValue.serverTimestamp()
});
```

This is what makes the PDPA story defensible: every change, who made it, when, from where.
