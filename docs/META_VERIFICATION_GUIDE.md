# Meta Business Verification — Step-by-Step Upload Guide

For **Sunrise Recruit Sdn Bhd** (per Decision #1).

This is the document upload + verification process you'll go through on `business.facebook.com`. It's the gate to Tier 1 (1,000 messages/24h). Without it, you're stuck at 250 messages/24h.

**Timeline:** 30 minutes upload + 1–7 days Meta review.
**Cost:** Free.

---

## Documents to prepare before you start

Have these ready as PDF or JPG. Scans must be clear, all 4 corners visible, no glare, no shadows.

| Document | Source | What it proves |
|---|---|---|
| **SSM business registration** (Form 9 or Sijil Pendaftaran Perniagaan / Borang D for Sdn Bhd) | Suruhanjaya Syarikat Malaysia | Legal entity exists |
| **SSM company profile** (Form 24 + 49) showing directors and shareholders | SSM (or company secretary can pull) | You are authorized to represent it |
| **Recent bank statement** (last 3 months) for Sunrise Recruit's business account | Your bank — Maybank / CIMB / Public Bank etc. | Active business operations |
| **Utility bill OR tenancy agreement OR domain registration proof** for `sunriserecruit.com` | Shinjiru invoice / your DNS provider receipt | Business has a physical / digital address |

If you don't have one of these handy, the easiest substitute is:
- **Domain proof**: log into Shinjiru → My Domains → take a screenshot showing `sunriserecruit.com` registered to Sunrise Recruit Sdn Bhd. PDF the screenshot.
- **Utility bill substitute**: TNB / Indah Water / Telekom bill for the office address, in Sunrise's name.

**Important**: All documents must be in the name of "Sunrise Recruit Sdn Bhd" (not your personal name). If any are in your personal name, get them reissued or use alternatives.

---

## Step-by-step in Meta Business Manager

### Pre-step: Make sure your Business Manager is set up correctly

1. Go to `business.facebook.com`
2. If you haven't created one yet: click "Create Account"
3. **Business Name**: enter exactly `Sunrise Recruit Sdn Bhd` (must match SSM registration)
4. **Your Name**: Sean Tan
5. **Business Email**: use a `@sunriserecruit.com` email if possible (not Gmail). Meta penalizes free-email-only business accounts.

### Step 1: Open Business Settings

- Top-right corner → Settings (gear icon) → Business Settings
- OR direct URL: `business.facebook.com/settings`

### Step 2: Navigate to Business Info

- Left sidebar → **Business Info**
- You'll see a card showing "Business verification status: Not Started" or "Pending"

### Step 3: Fill in Business Details

Click "Edit" on Business Details. Fill every field exactly:

| Field | Value |
|---|---|
| Legal Business Name | `Sunrise Recruit Sdn Bhd` (exactly as on SSM) |
| Business Address | Your registered office address as on SSM |
| Business Phone Number | A landline or mobile registered to Sunrise (NOT the new WhatsApp SIM you're about to dedicate to the platform) |
| Website | `https://www.sunriserecruit.com` |
| Email | Your `@sunriserecruit.com` email |
| Country | Malaysia |
| Tax ID / Business Registration | Your SSM number (e.g. `202301012345 (1234567-K)`) — exact format on your SSM cert |

Save.

### Step 4: Start Business Verification

- Left sidebar → **Security Center** → Business Verification
- Click "Start Verification"
- Meta will ask: "What's your business type?"
  - Select: **Registered Business** (not "Sole Proprietorship" — Sdn Bhd is a corporation)

### Step 5: Confirm business details

Meta will show what you entered in Step 3. Confirm everything matches your SSM cert **exactly**. Even a missing "Sdn Bhd" suffix will cause rejection. If anything's off, go back and edit.

### Step 6: Upload documents

Meta will request **2 documents** typically. Upload in this order for best results:

**Document 1: Business Registration**
- Upload your SSM Form 9 (Borang 9) or Sijil Pendaftaran for Sdn Bhd
- File type: PDF (preferred) or JPG, under 8MB
- Verify: company name visible, SSM stamp/seal visible, registration number visible

**Document 2: Address Proof**
- Upload one of:
  - Bank statement (last 3 months, business account, shows Sunrise's name + address)
  - TNB / utility bill in Sunrise's name
  - Tenancy agreement signed
  - Or domain registration proof (Shinjiru receipt)
- File type: PDF/JPG, under 8MB
- Verify: business name + address visible, date within last 3 months (for bills)

If Meta asks for a 3rd document, upload another address proof from a different source than Document 2.

### Step 7: Phone verification

Meta will call or SMS your business phone (from Step 3) with a 6-digit code. Enter it.

**Important**: do NOT use the new WhatsApp dedicated SIM for this phone verification. Use a separate business landline or your existing Sunrise main number. The new SIM is exclusively for WhatsApp Cloud API.

### Step 8: Submit and wait

- Click "Submit for Review"
- Status changes to "Pending"
- Meta email confirms submission

**Typical wait times (2026):**
- Simple cases (clear documents, matching info): **1–2 business days**
- If Meta asks for follow-up documents: **3–7 business days**
- Holidays / heavy load: up to **14 days**

You can continue with Day 2 work (template submission, code deployment) in parallel — Templates and Cloud API don't require business verification to be COMPLETE, just STARTED. You'll just be capped at Tier 0 (250 msgs/24h) until verified, then auto-upgraded to Tier 1.

---

## What to do if verification gets rejected

Don't panic. Rejection is fixable in ~50% of cases without a re-submission.

### Common rejection reasons + fixes

| Reason | Fix |
|---|---|
| "Business name doesn't match document" | Make sure Business Manager name is EXACTLY "Sunrise Recruit Sdn Bhd" — including the "Sdn Bhd" |
| "Document is illegible / blurry" | Re-scan with better lighting; use Adobe Scan app on phone |
| "Document is older than 90 days" (for bills) | Get a fresh bill or bank statement |
| "Address on document doesn't match Business Manager" | Update Business Manager address to match what's on the bill, OR submit a bill matching your registered address |
| "Cannot verify legal status" | Submit Form 9 or Form 24 from SSM showing current active status |

### How to appeal

- Security Center → Business Verification → Failed verification → Click "Appeal"
- You'll get a form to upload a new document or explain
- Appeals reviewed in 3-5 business days

If 2 appeals fail, contact Meta Business Support (link in Security Center). Real humans review escalations — be polite, attach all documents, explain it's a 10-year-old recruitment agency operating in Malaysia.

---

## After verification approved

You'll receive:
- Email: "Your business has been verified"
- Business Manager shows green ✓ "Verified Business"
- Your WABA messaging tier **automatically upgrades from 250 to 1,000 msgs/24h** within 24 hours

You can now also:
- Create a green tick verified business badge application (separate process, more requirements — defer this for now, not needed for messaging)
- Access higher API rate limits
- Add multiple phone numbers under the same WABA

---

## Things that will NOT trigger verification (don't worry about these)

- The phone number you're going to put on WhatsApp Cloud API
- Templates you've submitted (separate review pipeline)
- Your sr-proxy deployment
- Firestore data
- Whether you've sent any messages yet

These are all independent. Business verification is purely about "is Sunrise Recruit Sdn Bhd a real, active Malaysian business that you're authorized to represent?"

---

## Estimated total time investment for this step

- Document preparation: **30 minutes** (gathering files)
- Form filling + upload: **20 minutes**
- Phone verification: **5 minutes**
- Wait for Meta review: **1–7 days** (you do other work in parallel)
- Appeal if rejected (worst case): **add 1 cycle, +3-5 days**

Realistic worst case: **2 weeks**. Realistic best case: **2 working days**.

If you start this Friday, you can reasonably expect Tier 1 by next Wednesday-Friday.
