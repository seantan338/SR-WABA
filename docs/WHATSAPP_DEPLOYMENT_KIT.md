# CP4U WhatsApp Cloud API — Deployment Kit

**Owner:** Sean Tan / EULA Management Services Sdn Bhd
**Stack:** WhatsApp Cloud API (direct Meta, no BSP)
**Last updated:** May 2026
**Status:** Spec only — execution items listed at bottom

---

## 0. What this kit gives you

A complete, ready-to-execute package for connecting CP4U / Sunrise Recruit directly to Meta's WhatsApp Cloud API — bypassing WATI, Twilio, 360dialog and all other BSPs. Zero markup, zero monthly platform fee.

What's done in this kit (you copy-paste / file accordingly):
- 9 message templates, bilingual EN + 中文, with category, body, variables, and submission JSON
- `sr-proxy` route handler for `/proxy/whatsapp` with security, rate-limit guard, audit logging
- Firestore schema additions: `whatsapp_optin`, `whatsapp_send_log`, `whatsapp_quality`
- n8n HTTP node configuration spec
- Opt-in capture UI copy (bilingual) for candidate signup, client onboarding, partner onboarding
- Ban-prevention rules baked into code (rate limits, opt-in checks, template-only enforcement)

What only **you** can do (listed in §10):
- Meta Business Manager account setup + business verification
- WhatsApp Business Account (WABA) creation
- Phone number provisioning (must be NEW, never used on WA)
- Template submission via Business Manager UI
- Env var population on Zeabur

---

## 1. The core decision: direct Cloud API, no BSP

| Item | Direct Cloud API (this kit) | BSP (WATI / Twilio / etc.) |
|---|---|---|
| Setup fee | RM 0 | RM 0 – RM 5,000 |
| Monthly platform fee | RM 0 | USD 49 – USD 299/mo |
| Per-message markup over Meta rate | 0% | 15% – 50% |
| Free service conversations | 1,000/mo (Meta) | 1,000/mo (Meta) |
| Templates submission | Direct via Business Manager UI | Through BSP UI |
| Vendor lock-in | None — Meta is the platform | High — switching means re-onboarding |
| Engineering effort | ~5–7 days | ~1–2 days |

Trade-off: you give up a pre-built UI for sending broadcasts, agent inbox, analytics dashboard. For CP4U this doesn't matter — your platform IS the UI. Recruitment OS already has candidate cards, status changes, and notes. WhatsApp send becomes a button on those cards, not a separate tool.

---

## 2. Ban-prevention rules (read these first)

These are baked into the code in §6. They are non-negotiable.

**Rule A: Templates only for outbound.**
Every message you send to a user who has NOT messaged you in the last 24 hours MUST be a Meta-approved template. No exceptions. No "just this once" free-form. Free-form text outside the 24-hour window = instant policy violation.

**Rule B: Opt-in required, recorded, timestamped.**
You cannot send to a phone number you scraped, bought, or pulled from an old CV pile. Every recipient needs a recorded opt-in event in Firestore (`whatsapp_optin` collection) with timestamp, source, and the exact consent wording shown. This is PDPA + WhatsApp double-compliance.

**Rule C: 24-hour service window.**
When a user messages you first, you have 24 hours to reply with anything (free-form, AI-generated, media). After 24h, back to templates only. The system tracks this per phone number.

**Rule D: No general-purpose AI bot.**
Meta banned "ChatGPT-style" general-purpose bots on WhatsApp as of January 2026. CP4U uses AI for: parsing JDs, suggesting candidate matches, drafting employer responses for human review. This is task-specific AI = compliant. Do NOT build "ask Claude anything on WhatsApp" entry points.

**Rule E: Rate limits enforced in code, not just policy.**
Starting limit: 250 messages/24h (unverified) → 1,000 (verified Tier 1) → 10K → 100K → unlimited. The proxy code below has a configurable cap. Set it to 80% of your current Meta tier. Quality Rating drop = stop sending immediately.

**Rule F: Quality Rating monitored.**
Green → Yellow → Red. Pull the rating daily via Meta API. Display in admin dashboard. If Yellow, slow down. If Red, stop outbound entirely until investigation.

**Rule G: Easy opt-out on every marketing template.**
Every marketing-category template must include an opt-out instruction. Honor opt-outs immediately by writing `whatsapp_optin.status = 'opted_out'` and never sending again.

---

## 3. The 9 templates (ready to submit)

All templates are bilingual where appropriate. Submitted as separate templates per language (Meta requires this) — same `name`, different `language` code.

| # | Template name | Category | Languages | Used for |
|---|---|---|---|---|
| 1 | `candidate_cv_received` | UTILITY | en, zh_CN | Confirm CV received into Sunrise database |
| 2 | `candidate_interview_invite` | UTILITY | en, zh_CN | Invite candidate to interview, with date/time |
| 3 | `candidate_offer_notification` | UTILITY | en, zh_CN | Notify candidate of offer received |
| 4 | `candidate_placement_confirmed` | UTILITY | en, zh_CN | Confirm successful placement |
| 5 | `client_jd_received` | UTILITY | en | Confirm JD received into platform |
| 6 | `client_candidate_submitted` | UTILITY | en | Notify client that candidates submitted |
| 7 | `partner_referral_status_update` | UTILITY | en, zh_CN | Update partner on referral status |
| 8 | `verification_otp` | AUTHENTICATION | en | Login / phone verification OTP |
| 9 | `candidate_job_match_alert` | MARKETING | en, zh_CN | New job matches candidate's profile (opt-in only) |

### Category logic

- **UTILITY**: triggered by a specific user action or transactional event ("you applied → we received your CV"). Cheapest tier, lowest scrutiny. Use this whenever possible.
- **MARKETING**: anything promotional, including job recommendations not directly tied to a specific application. Most expensive. Stricter opt-in scrutiny. Requires opt-out language.
- **AUTHENTICATION**: OTP only. Cheapest of all. Cannot contain anything else.

⚠️ Meta may auto-recategorize. If you write `client_candidate_submitted` as UTILITY but add "Click here for our pricing" → Meta will recategorize it as MARKETING and you'll pay 2-3x more per send. Keep utility templates strictly transactional.

### Template 1: `candidate_cv_received`

**Category:** UTILITY
**Trigger:** Candidate's CV uploaded to Sunrise database via website / partner referral

**EN body:**
```
Hi {{1}},

Thanks for sending your CV to Sunrise Recruit. We've added you to our talent database.

Our consultants will be in touch when a suitable role opens up. You can also explore live openings at https://www.sunriserecruit.com/jobs

If you'd prefer not to receive updates, reply STOP.

— The Sunrise Recruit Team
```

**ZH body:**
```
{{1}}，您好。

感谢您将简历发送给 Sunrise Recruit，我们已经将您加入人才库。

当有合适的职位时，我们的顾问会主动联系您。您也可以浏览当前职位空缺：https://www.sunriserecruit.com/jobs

如不希望收到更新，请回复 STOP。

— Sunrise Recruit 团队
```

**Variables:** `{{1}}` = candidate first name (≤25 chars)
**Footer:** `Sunrise Recruit | Connecting People for You`

---

### Template 2: `candidate_interview_invite`

**Category:** UTILITY
**Trigger:** Recruiter / Admin marks candidate as "Interview Scheduled" in pipeline

**EN body:**
```
Hi {{1}},

Good news — you've been shortlisted for an interview.

Position: {{2}}
Date: {{3}}
Time: {{4}}
Format: {{5}}

Please reply YES to confirm or contact your consultant if you need to reschedule.

— Sunrise Recruit
```

**ZH body:**
```
{{1}}，您好。

好消息 — 您已被选中参加面试。

职位：{{2}}
日期：{{3}}
时间：{{4}}
形式：{{5}}

请回复 YES 确认，或联系您的顾问以重新安排时间。

— Sunrise Recruit
```

**Variables:**
- `{{1}}` = candidate first name (≤25 chars)
- `{{2}}` = job title (≤40 chars)
- `{{3}}` = date string e.g. "Mon, 3 Jun 2026" (≤25 chars)
- `{{4}}` = time string e.g. "10:30 AM MYT" (≤20 chars)
- `{{5}}` = "In-person at [address]" / "Zoom call" / "Phone call" (≤60 chars)

---

### Template 3: `candidate_offer_notification`

**Category:** UTILITY
**Trigger:** Status moves to "Offer Out"

**EN body:**
```
Hi {{1}},

An offer is being prepared for you for the {{2}} role at our client.

Your consultant will reach out shortly with the full details. Please keep this number reachable today.

— Sunrise Recruit
```

**ZH body:**
```
{{1}}，您好。

针对客户的 {{2}} 职位，我们正在为您准备 offer。

您的顾问稍后会与您联系，告知完整细节。请保持此号码畅通。

— Sunrise Recruit
```

**Variables:**
- `{{1}}` = candidate first name (≤25 chars)
- `{{2}}` = job title (≤40 chars)

---

### Template 4: `candidate_placement_confirmed`

**Category:** UTILITY
**Trigger:** Status = "Filled" with this candidate

**EN body:**
```
Hi {{1}},

Congratulations on your new role as {{2}}.

We'll be in touch in your first month to make sure everything's going smoothly. If you know someone who'd be a good candidate for our other roles, your referrals are always welcome.

— Sunrise Recruit
```

**ZH body:**
```
{{1}}，恭喜您！

祝贺您获得 {{2}} 这份新工作。

入职后第一个月，我们会主动联系您确认一切顺利。如果您身边有合适的朋友推荐给我们其他职位，我们随时欢迎。

— Sunrise Recruit
```

**Variables:**
- `{{1}}` = candidate first name (≤25 chars)
- `{{2}}` = job title (≤40 chars)

---

### Template 5: `client_jd_received`

**Category:** UTILITY
**Trigger:** Client uploads JD via portal, or Sunrise admin enters a new job on their behalf

**EN body (only):**
```
Hi {{1}},

We've received your job order for {{2}}. Our consultants are reviewing the brief and will start sourcing immediately.

You can track candidate submissions live at https://www.sunriserecruit.com/employer/jobs

— Sunrise Recruit
```

**Variables:**
- `{{1}}` = client contact first name (≤25 chars)
- `{{2}}` = job title (≤40 chars)

---

### Template 6: `client_candidate_submitted`

**Category:** UTILITY
**Trigger:** Recruiter submits candidate to client (status: "Submitted to Client")

**EN body (only):**
```
Hi {{1}},

We've submitted {{2}} candidate(s) for your {{3}} role.

Review and provide feedback in your portal: https://www.sunriserecruit.com/employer/jobs/{{4}}

— Sunrise Recruit
```

**Variables:**
- `{{1}}` = client contact first name (≤25 chars)
- `{{2}}` = number of candidates e.g. "3" (≤3 chars)
- `{{3}}` = job title (≤40 chars)
- `{{4}}` = job slug for URL (≤40 chars, lowercase alphanumeric + dashes)

---

### Template 7: `partner_referral_status_update`

**Category:** UTILITY
**Trigger:** Status of a partner-referred candidate changes

**EN body:**
```
Hi {{1}},

Update on your referral {{2}} for the {{3}} role:

Status: {{4}}

View full details: https://www.sunriserecruit.com/partner/referrals

— Sunrise Recruit | Dollarize Partner Network
```

**ZH body:**
```
{{1}}，您好。

您推荐的候选人 {{2}}（{{3}} 职位）状态更新：

当前状态：{{4}}

查看完整信息：https://www.sunriserecruit.com/partner/referrals

— Sunrise Recruit | Dollarize 合作伙伴网络
```

**Variables:**
- `{{1}}` = partner first name (≤25 chars)
- `{{2}}` = candidate masked name e.g. "Tan W** S***" (≤25 chars)
- `{{3}}` = job title (≤40 chars)
- `{{4}}` = status label e.g. "Interviewing" / "Offer Out" / "Hired" (≤25 chars)

---

### Template 8: `verification_otp`

**Category:** AUTHENTICATION
**Trigger:** User requests OTP for login or phone verification
**Format:** Meta has a preset format for authentication templates. NO other content allowed besides the OTP code and a tap-to-copy button.

**EN body:**
```
{{1}} is your Sunrise Recruit verification code.

For your security, do not share this code.
```

**Button:** "Copy code" (one-tap autofill, Meta-managed)
**Variables:** `{{1}}` = 6-digit numeric code (exactly 6 chars)

⚠️ Authentication templates have stricter format: no greetings, no marketing, no extra info. Meta will reject if you add "Welcome!" or company description.

---

### Template 9: `candidate_job_match_alert`

**Category:** MARKETING
**Trigger:** Weekly digest n8n workflow finds jobs matching candidate's saved skills/preferences
**Opt-in required:** Yes (explicit, separate checkbox at signup)

**EN body:**
```
Hi {{1}},

We've found {{2}} new job(s) matching your profile this week. Top match:

{{3}} | {{4}}

See all matches: https://www.sunriserecruit.com/dashboard

To stop receiving job alerts, reply STOP.

— Sunrise Recruit
```

**ZH body:**
```
{{1}}，您好。

本周我们为您匹配了 {{2}} 个新职位。最佳匹配：

{{3}} | {{4}}

查看全部匹配：https://www.sunriserecruit.com/dashboard

如不希望再收到职位提醒，请回复 STOP。

— Sunrise Recruit
```

**Variables:**
- `{{1}}` = candidate first name (≤25 chars)
- `{{2}}` = match count e.g. "3" (≤2 chars)
- `{{3}}` = top match job title (≤40 chars)
- `{{4}}` = top match location/salary e.g. "KL | RM 6-8k" (≤30 chars)

⚠️ This is MARKETING category. Costs more. Requires explicit opt-in separate from general account creation.

---

## 4. Template submission JSON (machine-readable)

See companion file `templates.json` in this kit. To submit:

1. Log into Meta Business Manager → WhatsApp Manager → Message Templates → Create Template
2. Fill in the UI fields matching the spec above (Meta's UI doesn't accept direct JSON upload via the dashboard — you fill the form)
3. For programmatic submission later, use `POST /v21.0/{WABA_ID}/message_templates` — the JSON in `templates.json` is the exact request body

Typical review time: 1–24 hours per template. Submit all 9 in one batch on day 1.

---

## 5. Pricing — what you'll actually pay Meta

Malaysia falls under Meta's "Rest of World" pricing tier. As of 2026 (verify current rates at Meta's pricing page before going live):

| Category | Approx. per-message cost | Notes |
|---|---|---|
| Service (within 24h of user msg) | **Free** | First 1,000/mo always free. |
| Authentication (OTP) | USD 0.0149 (~RM 0.07) | Cheapest. |
| Utility (transactional) | USD 0.0049 (~RM 0.023) | Most of your sends will be here. |
| Marketing (promotional) | USD 0.0231 (~RM 0.11) | Job alerts only. |

**Estimated monthly cost at MVP scale** (5 employers, 50 active candidates, 3 partners):
- Utility: ~500 sends × RM 0.023 = **RM 12**
- Auth (OTP): ~200 sends × RM 0.07 = **RM 14**
- Marketing (weekly digest, opted-in candidates): ~200 sends × RM 0.11 = **RM 22**
- **Total: ~RM 48/month**

For scale comparison: WATI would bill ~RM 800/month minimum (USD 49 plan + per-message markup). You save ~RM 9,000/year by going direct.

---

## 6. sr-proxy code: `/proxy/whatsapp` route

The route lives in your existing `sr-proxy` Node.js server. Same pattern as `/proxy/anthropic` — secret in header, real credential injected from env vars, never exposed to browser.

See companion file `wa-proxy.js`. To install:

```bash
# In sr-proxy repo
cp wa-proxy.js src/routes/
# Edit src/index.js to mount the route:
#   app.use('/proxy/whatsapp', require('./routes/wa-proxy'));
```

Then on Zeabur, set these env vars on the `sr-proxy` service:

```
WHATSAPP_PHONE_NUMBER_ID=<from Meta Business Manager>
WHATSAPP_ACCESS_TOKEN=<permanent System User token, NOT a temporary token>
WHATSAPP_WABA_ID=<from Meta Business Manager>
WHATSAPP_APP_SECRET=<from Meta App > Settings > Basic>
WHATSAPP_VERIFY_TOKEN=<random 32-char string YOU choose, used for webhook verification>
WHATSAPP_DAILY_SEND_CAP=200    # set to 80% of your current Meta tier
WHATSAPP_QUALITY_HALT=red      # halt sending if quality = this rating
```

The `WHATSAPP_ACCESS_TOKEN` must be a **System User permanent token**, not the temporary 24-hour token Meta gives you in the dev UI. Generate via Business Manager → System Users → Generate Token → select WABA + `whatsapp_business_messaging` and `whatsapp_business_management` permissions.

---

## 7. Webhook for incoming messages

Meta sends incoming messages (replies, opt-outs, status updates) to a webhook URL on your domain. The route is included in `wa-proxy.js`.

Configure in Meta Business Manager → WhatsApp → Configuration → Webhook:
- **Callback URL:** `https://proxy.sunriserecruitment.com.au/proxy/whatsapp/webhook` (or your sr-proxy URL)
- **Verify token:** the `WHATSAPP_VERIFY_TOKEN` value from above
- **Subscribe to:** `messages`, `message_template_status_update`, `phone_number_quality_update`

The webhook handler in `wa-proxy.js` does three things:
1. On incoming `messages` event → write to Firestore `whatsapp_incoming` and reset the 24h service window for that phone number
2. On `message_template_status_update` → update Firestore `whatsapp_templates` collection (you'll see template approvals here)
3. On `phone_number_quality_update` → write to Firestore `whatsapp_quality`; if Red, set platform-wide flag `whatsapp_outbound_halted = true`

Opt-out handling: when an incoming message contains exactly "STOP" / "停止" / "退订" (case-insensitive), webhook automatically writes `whatsapp_optin.status = 'opted_out'` for that phone.

---

## 8. Firestore additions

See companion file `firestore-schema.md`. Three new collections:

```
/whatsapp_optin/{phoneE164}
  - phoneE164: string (key, +60123456789 format)
  - userId: string (linked CP4U user if any)
  - status: enum [active, opted_out]
  - source: enum [candidate_signup, employer_signup, partner_signup, jd_upload_form,
                  career_fair_rsvp, manual_admin, imported_with_consent]
  - consentText: string (exact wording shown at opt-in time)
  - consentLocale: enum [en, zh, ms]
  - optinAt: timestamp
  - optoutAt: timestamp (null until opted out)
  - lastTemplateAt: timestamp
  - serviceWindowExpiresAt: timestamp (resets when user messages us)

/whatsapp_send_log/{logId}
  - logId: uuid
  - phoneE164: string
  - templateName: string
  - templateCategory: enum [utility, marketing, authentication]
  - variables: array<string>
  - metaMessageId: string (from Meta response)
  - status: enum [queued, sent, delivered, read, failed]
  - errorCode: string (if failed)
  - createdAt: timestamp
  - actorUserId: string (who triggered this send)
  - relatedEntityType: enum [candidate, application, referral, job]
  - relatedEntityId: string

/whatsapp_quality/{snapshotId}
  - phoneNumberId: string
  - qualityRating: enum [green, yellow, red, unknown]
  - messagingLimitTier: enum [tier_250, tier_1k, tier_10k, tier_100k, unlimited]
  - throughputTier: enum [standard, high]
  - capturedAt: timestamp
```

Firestore security rules: all three collections are admin-only writable from client (clients can't fake an opt-in). Writes happen from sr-proxy or n8n workflows server-side using Firebase Admin SDK.

---

## 9. n8n workflow nodes

n8n doesn't need a special WhatsApp plugin — use the **HTTP Request** node pointing at your sr-proxy. See companion file `n8n-send-whatsapp-node.json` for the exact node config.

Five n8n workflows to update:

| Workflow | When it fires WhatsApp | Template used |
|---|---|---|
| **Sunrise CV Automated Pipeline** | CV ingested, candidate created | `candidate_cv_received` |
| **SR Job Order Auto Entry** | Client uploads JD | `client_jd_received` |
| Candidate Pipeline Status Sync (new) | Status → Interviewing | `candidate_interview_invite` |
| Candidate Pipeline Status Sync (new) | Status → Offer Out | `candidate_offer_notification` |
| Candidate Pipeline Status Sync (new) | Status → Filled | `candidate_placement_confirmed` |
| Weekly Job Match Digest (new, Phase 2) | Monday 09:00 MYT cron | `candidate_job_match_alert` |
| Partner Referral Status (new) | Referral status changes | `partner_referral_status_update` |

All n8n nodes hit the same endpoint: `POST https://proxy.sunriserecruitment.com.au/proxy/whatsapp/send` with the proxy secret in headers.

---

## 10. What only you can do — Sean's execution list

In rough order. Total time: **2–3 working days**, plus 1–7 days of Meta review wait.

### Day 1 — Meta Business setup (your hands only)

1. **Create / log into Meta Business Manager** at `business.facebook.com`. Use the EULA Management Services Sdn Bhd entity if possible (or Sunrise Recruit if EULA isn't fully set up yet — you can transfer later). **S** (15 min)

2. **Complete Business Verification** by uploading SSM cert + bank statement + utility bill / domain proof. This unlocks Tier 1 (1,000 msg/24h) immediately on approval. **S** (30 min upload, then 1–7 days Meta review)

3. **Add a WhatsApp Business Account (WABA)** inside Business Manager → WhatsApp Accounts → Add. **S** (5 min)

4. **Add a phone number** to the WABA. Use a brand new SIM that has never been used for WhatsApp personal or Business app. Cannot be reversed — once on Cloud API, can't go back to regular app. Suggestion: get a new Maxis / Celcom number specifically for CP4U operations. **S** (10 min, plus going to get the SIM)

5. **Verify the number** via SMS or voice call code from Meta. **S** (5 min)

6. **Create a Meta App** (developer app, not Business app) at `developers.facebook.com/apps`. Type: "Business". Link it to your Business Manager. Add "WhatsApp" product to the app. **S** (10 min)

7. **Generate Permanent Access Token:**
   - Business Manager → Business Settings → Users → System Users → Add → name it `cp4u-system`, role: Admin
   - Add Assets → WhatsApp Account → grant `Full control`
   - Generate Token → select your app → permissions: `whatsapp_business_messaging`, `whatsapp_business_management`
   - Token expiry: **Never** (this is the whole point — don't generate a 60-day token)
   - **Copy and save it now — you won't see it again.** **S** (10 min)

8. **Note down these 5 values** (you'll paste them into Zeabur in step 13):
   - Phone Number ID (in WhatsApp Manager → Phone Numbers)
   - WABA ID (in WhatsApp Manager → Overview)
   - Permanent Access Token (from step 7)
   - App Secret (in Meta App → Settings → Basic)
   - Choose a random 32-char string for Webhook Verify Token (you make this up)

### Day 2 — Templates + code deployment (mostly delegate-able)

9. **Submit all 9 message templates** via WhatsApp Manager → Message Templates → Create Template. Use the bodies in §3 exactly. For bilingual ones, submit two separate templates with same name, different language code. **M** (1–2 hours for all 9, then 1–24 hours Meta review)

10. **Hand `wa-proxy.js` to your IT partner** to add to the sr-proxy repo and deploy to Zeabur. **S** (30 min if IT partner is fluent)

11. **Hand `firestore-schema.md` to Claude Code** to create the 3 new Firestore collections + security rules. **S** (30 min)

12. **Configure webhook** in Meta Business Manager → WhatsApp → Configuration:
    - Callback URL: `https://[your sr-proxy domain]/proxy/whatsapp/webhook`
    - Verify Token: the 32-char string from step 8
    - Subscribe to: `messages`, `message_template_status_update`, `phone_number_quality_update`
    - Click "Verify and Save" — Meta will hit your webhook with the verify challenge. If it succeeds, you're connected. **S** (15 min)

13. **Set env vars on Zeabur** sr-proxy service (use the 5 values from step 8 plus the two operational caps):
    ```
    WHATSAPP_PHONE_NUMBER_ID=...
    WHATSAPP_ACCESS_TOKEN=...
    WHATSAPP_WABA_ID=...
    WHATSAPP_APP_SECRET=...
    WHATSAPP_VERIFY_TOKEN=...
    WHATSAPP_DAILY_SEND_CAP=200
    WHATSAPP_QUALITY_HALT=red
    ```
    **S** (10 min)

### Day 3 — Test send + opt-in capture rollout

14. **Send a test message to your own number** by manually triggering via Postman or curl against `/proxy/whatsapp/send` with the `candidate_cv_received` template. If your number is in the opt-in collection (add it manually first), it should arrive on WhatsApp. **S** (15 min)

15. **Add opt-in capture UI** to candidate signup, employer signup, partner signup, and JD upload forms — copy in companion file `optin-flow.md`. Have Claude Code add the checkbox + Firestore write. **M** (half day)

16. **Update existing n8n workflows** (Sunrise CV Automated Pipeline + SR Job Order Auto Entry) to call the new WhatsApp endpoint after the existing steps. Spec in `n8n-send-whatsapp-node.json`. **S** (30 min per workflow)

17. **Add admin dashboard tile** showing: current quality rating, current tier, today's send count, send cap, last 10 sends. **M** (half day, Claude Code)

### Items NOT to do yet

- ❌ Don't bulk-import the 12,000 old CV phone numbers into `whatsapp_optin`. None of them have a WhatsApp-specific opt-in. Doing so = mass policy violation = number banned within 48 hours. Treat the old database as opt-OUT until each person individually opts in again via the new platform.
- ❌ Don't send marketing template (#9 job match alert) until you have a separate, explicit opt-in checkbox at signup specifically for "job alerts via WhatsApp". General account creation doesn't count.
- ❌ Don't connect WhatsApp into Recruitment OS's "Generate Job Ad" feature in a way that broadcasts the generated ad. Generating ad text for human copy-paste = fine. Auto-broadcasting to candidate lists = ban-worthy.

---

## 11. Status check — what to monitor in week 1

Daily for the first 7 days, then weekly:

| Metric | Where to find it | Action threshold |
|---|---|---|
| Quality Rating | Admin dashboard tile (or WhatsApp Manager) | Yellow → review; Red → halt outbound |
| Daily sends vs cap | Admin dashboard | At 90% of cap → raise cap only if quality green |
| Failed sends | Firestore `whatsapp_send_log` where status=failed | >5% failure rate → check error codes |
| Opt-out count this week | Firestore `whatsapp_optin` where status=opted_out, ordered by optoutAt | >3% of recipients → message content too aggressive |
| Service window 24h breaches | Server logs from wa-proxy | Zero tolerance — if it logs a breach, fix the calling code |

---

## 12. Open questions for Sean

These I can't decide without your input. Flag your answer when ready:

1. **Which phone number?** A new dedicated CP4U number, or do you want to retire one of your existing numbers? My strong recommendation: new number, dedicated to platform automation. Keep your personal WhatsApp separate.

2. **WABA owner: EULA or Sunrise?** EULA Management Services Sdn Bhd is cleaner for the platform architecture story, but Sunrise has more business history. Either works; you can also create the WABA under EULA and add Sunrise as a "Connected Account" later.

3. **Opt-in for the existing CV database (12,000 CVs):** I'm assuming we treat all 12,000 as opted-OUT for WhatsApp. They can opt back in by re-engaging via the new platform. If you want a re-engagement campaign to invite them to opt in, that's a separate (delicate) email/SMS campaign, NOT a WhatsApp blast. Confirm this assumption.

4. **Marketing tier for the job alerts:** Do you want job alerts (#9) live at MVP, or defer to Sprint 3? Argument to defer: marketing templates have stricter scrutiny + cost more. Argument to launch: Phase 4 roadmap already has "Automated Email Sequences" — WhatsApp version is the natural parallel.

5. **Do you want me to write the n8n workflow JSON exports directly?** I can produce them ready to import, but I'd need to confirm your n8n's current version/auth setup first. Cheaper to just hand the spec to your IT partner.

---

## 13. Compliance summary (for future government / lawyer conversations)

When the JS-SEZ / Lee Ting Han conversation happens, here's the WhatsApp compliance story:

- **Direct Meta Cloud API** — no third-party messaging vendor with access to candidate PII
- **Explicit opt-in recorded** per phone number with timestamp, source, consent text, locale — full audit trail in Firestore `whatsapp_optin`
- **All outbound messages logged** — Firestore `whatsapp_send_log` is queryable by candidate, by employer, by template, by date range
- **Quality Rating + Tier monitored** — outbound automatically halts if Meta flags the account
- **Templates pre-approved by Meta** — every outbound message has been reviewed by Meta's compliance team before first use
- **Opt-out honored immediately** — "STOP" / "停止" / "退订" reply triggers automatic status flip and never sends again
- **PDPA-aligned** — opt-in consent stored separately from general account creation; consent revocable; data retention aligns with PDPA standards
- **No general-purpose AI exposure** — all AI use is task-specific (JD parsing, matching, draft generation for human review), compliant with Meta's January 2026 chatbot policy

This is materially stronger than any BSP-based setup, because you own the audit logs and Meta is the only third party in the loop.

---

End of v1.0.
