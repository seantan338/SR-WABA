// apps/platform-web/src/pages/signup/CandidateSignup.tsx
// STUB — canonical example of integrating WhatsAppOptInBlock into a signup form (TASK 3a).
// In SR-Web-AS, merge this wiring into the REAL candidate signup form instead of
// shipping this page. The other sources are identical except for the `source` prop:
//   3b employer_signup · 3c partner_signup · 3d jd_upload_form · 3e career_fair_rsvp
// (partner additionally may pass showMarketingOption — deferred per v1.1, kept false).
//
// Brand rule compliance: no <form> tag; submit via onClick.

import { useState } from 'react';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import WhatsAppOptInBlock, {
  writeWhatsAppOptIn,
  normalizePhoneToE164,
  type OptInState,
} from '@/components/forms/WhatsAppOptInBlock';

export default function CandidateSignup() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', locale: 'en' as 'en' | 'zh' });
  const [waOptInState, setWaOptInState] = useState<OptInState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      // 1. Create the Firebase user (your real flow also writes the users/ doc).
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password);
      const newUser = cred.user;

      // 2. Record WhatsApp opt-in (optional — never blocks signup).
      if (waOptInState && form.phone) {
        const phoneE164 = normalizePhoneToE164(form.phone, 'MY');
        if (phoneE164) {
          await writeWhatsAppOptIn({
            phoneE164,
            userId: newUser.uid,
            source: 'candidate_signup',
            state: waOptInState,
            actorUserId: newUser.uid,
          });
        }
      }
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <div style={{ padding: 24 }}>Account created. Welcome to Sunrise Recruit.</div>;

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <h1 style={{ fontFamily: "'IBM Plex Serif', serif", color: '#0E2A4A' }}>Create your candidate account</h1>

      <Field label="Full name" value={form.name} onChange={set('name')} />
      <Field label="Email" type="email" value={form.email} onChange={set('email')} />
      <Field label="Phone (+60…)" value={form.phone} onChange={set('phone')} />
      <Field label="Password" type="password" value={form.password} onChange={set('password')} />

      {/* Opt-in block immediately after the phone field */}
      <WhatsAppOptInBlock
        source="candidate_signup"
        phone={form.phone}
        locale={form.locale}
        showMarketingOption={false}
        onChange={setWaOptInState}
      />

      {error && <p style={{ color: '#b3503f', fontSize: 13 }}>{error}</p>}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{ background: '#D4A24C', color: '#1a1a1a', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: 'pointer', width: '100%' }}
      >
        {submitting ? 'Creating…' : 'Create account'}
      </button>
    </div>
  );
}

function Field(props: { label: string; value: string; type?: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span style={{ display: 'block', fontSize: 13, color: '#555', marginBottom: 4 }}>{props.label}</span>
      <input
        type={props.type || 'text'}
        value={props.value}
        onChange={props.onChange}
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', border: '1px solid #d8d2c4', borderRadius: 8, fontSize: 14 }}
      />
    </label>
  );
}
