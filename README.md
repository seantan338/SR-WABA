# SR-WABA — WhatsApp Cloud API Integration

Direct Meta WhatsApp Cloud API integration for CP4U / Sunrise Recruit (replaces WATI).
This repo is the **build staging area**: every file is laid out under the path it
belongs to in its real home (`sr-proxy/` and `apps/platform-web/` = SR-Web-AS), so each
can be lifted into the live repos. Source-of-truth specs are in [`docs/`](./docs).

## Repo layout

```
sr-proxy/src/
  index.js                          REFERENCE mount (body-parser ordering + route mount)
  routes/wa-proxy.js                Proxy route: /send, /send-freeform, /conversation, /webhook, /quality
apps/platform-web/src/
  types/whatsapp.ts                 5 collection interfaces + Team Inbox fields
  pages/admin/WhatsAppInbox.tsx     Team Inbox UI (Admin + Manager)
firestore.rules                     WhatsApp collection rules + helpers (APPEND into SR-Web-AS rules)
firestore.indexes.json              Composite indexes (MERGE into SR-Web-AS indexes)
scripts/whatsapp-optin-backfill.ts  One-time pending_verification backfill (dry-run supported)
templates/templates.json            8 Meta template specs (submit via Business Manager)
n8n/                                5 ready-to-import workflow JSONs
docs/                               firestore-schema.md, optin-flow.md, deployment kit, checklists
```

## Task status (against the build brief)

| Task | Status | Notes |
|---|---|---|
| 0 — Read pre-written files | ✅ | All kit files read; this build matches them. |
| 1 — Mount wa-proxy | ✅ (staged) | `wa-proxy.js` + reference `index.js`. Copy into real sr-proxy; see *Integration* below. |
| 2 — Firestore schema | ✅ | types / rules / indexes / backfill script all produced. |
| 3 — OptInBlock in signup forms | ✅ | `WhatsAppOptInBlock.tsx` authored from `optin-flow.md` + canonical `CandidateSignup` wiring example. |
| 4 — ConsentSettings on settings pages | ✅ | `WhatsAppConsentSettings.tsx` + reusable `SettingsNotificationsSection`. |
| 5 — QualityTile on admin dashboard | ✅ | `WhatsAppQualityTile.tsx` + `AdminDashboard` stub. |
| 6a — send-freeform + conversation + optin routes | ✅ | Added to `wa-proxy.js` with `requireAuth` (admin/manager) and `requireOptinAuth` (any signed-in user). |
| 6b — whatsapp_incoming inbox fields | ✅ | `assignedTo / resolved / resolvedAt / resolvedByUserId` + update rule. |
| 6c — Team Inbox UI | ✅ | `WhatsAppInbox.tsx`. |
| 7 — Navigation entry | ✅ (snippet) | See below — wire into the real admin sidebar. |

## Integration steps

### sr-proxy (TASK 1, 6a)
1. Copy `sr-proxy/src/routes/wa-proxy.js` → real `sr-proxy/src/routes/wa-proxy.js`.
2. In the real entry file, ensure the webhook path is **excluded from global `express.json()`**
   (it needs the raw body for HMAC verification) and mount the router **before** the 404
   handler. The reference `sr-proxy/src/index.js` shows the exact pattern.
3. Confirm Firebase Admin SDK is initialized (`wa-proxy.js` assumes `admin` is ready).
4. Set Zeabur env vars: `PROXY_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_WABA_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`,
   `WHATSAPP_DAILY_SEND_CAP=200`, `WHATSAPP_QUALITY_HALT=red`.

### SR-Web-AS (TASK 2, 6b, 6c)
1. Copy `apps/platform-web/src/types/whatsapp.ts` and `pages/admin/WhatsAppInbox.tsx`.
2. **APPEND** the 5 `match` blocks + helpers from `firestore.rules` into the existing rules.
3. **MERGE** the indexes from `firestore.indexes.json` into the existing indexes array; deploy.
4. Set `VITE_SR_PROXY_URL` to the sr-proxy base URL.
5. Add the Inbox route behind the Admin/Manager guard (React Router v6):
   ```tsx
   import WhatsAppInbox from '@/pages/admin/WhatsAppInbox';
   <Route path="/admin/whatsapp" element={<RequireRole roles={['admin','manager']}><WhatsAppInbox /></RequireRole>} />
   ```

### TASK 7 — admin sidebar nav entry
```tsx
// Unread badge = whatsapp_incoming docs where resolved === false
<NavItem to="/admin/whatsapp" icon="💬" label="WhatsApp" badge={unresolvedCount}>
  <NavSubItem to="/admin/whatsapp" label="Inbox" />
  <NavSubItem to="/admin/whatsapp/quality" label="Quality" />
</NavItem>
```
Get `unresolvedCount` via `onSnapshot(query(collection(db,'whatsapp_incoming'), where('resolved','==',false)))`.

### TASK 3 / 4 — wiring the consent components into real forms
`CandidateSignup.tsx` is the canonical example. The other four sources are the same
wiring with a different `source` prop:

| Form | `source` | `showMarketingOption` |
|---|---|---|
| Candidate signup | `candidate_signup` | `false` |
| Employer signup | `employer_signup` | `false` |
| Partner signup | `partner_signup` | `false` *(marketing deferred per v1.1)* |
| JD upload (lead capture) | `jd_upload_form` | `false` |
| Career Fair RSVP | `career_fair_rsvp` | `false` |

For settings pages, drop `SettingsNotificationsSection` with the role:
`/dashboard/settings` → `candidate`, `/employer/settings` → `employer`,
`/partner/settings` → `partner`.

## New proxy route (beyond the brief — necessary)
`POST /proxy/whatsapp/optin` was added because `whatsapp_optin` is **not**
client-writable (security rules), yet TASK 3/4 capture consent from the browser.
The route does the Admin SDK write + `auditLogs` entry. Auth: proxy secret (server)
**or** any signed-in user's Firebase ID token (records their own opt-in).

## Decisions locked (you asked me to drive)
1. **`whatsapp_incoming` read → `isManager()`** (was admin-only) so the Manager-role
   Team Inbox loads. *(firestore.rules updated.)*
2. **Conversation assign/resolve** stored on the latest `whatsapp_incoming` doc per phone.
3. **Tasks 3/4/5 components authored** from `optin-flow.md` + schema (swap in your own
   pre-written versions later if they differ).
4. **`/proxy/whatsapp/optin` route added** (see above).
5. **Everything stays in SR-WABA** (no separate repo); `sr-proxy/` + `apps/platform-web/`
   trees mirror the real destination paths for lift-in.

## Known design notes

- **Service window** is derived from the latest inbound timestamp (`< 24h` = open), avoiding
  a client read of `whatsapp_optin`.
- **8 templates** (v1.1) — the marketing `candidate_job_match_alert` was removed/deferred;
  all opt-in blocks use `showMarketingOption={false}`.
