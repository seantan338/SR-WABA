// apps/platform-web/src/components/settings/WhatsAppConsentSettings.tsx
// User-facing WhatsApp consent manager (TASK 4). Lets a user view + revoke/restore
// consent. Behaviour per docs/optin-flow.md Location 6.
//
// Reads the user's own whatsapp_optin doc (firestore.rules allows: own userId).
// Writes go through POST /proxy/whatsapp/optin (whatsapp_optin is not
// client-writable) with source 'user_settings'.

import { useEffect, useState } from 'react';
import { doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

const PROXY_BASE = (import.meta as any).env?.VITE_SR_PROXY_URL || '';
const GOLD = '#D4A24C';
const TEAL = '#1A8A8C';
const NAVY = '#0E2A4A';
const SANS = "'IBM Plex Sans', system-ui, sans-serif";
const MONO = "'JetBrains Mono', monospace";

type Locale = 'en' | 'zh' | 'ms';

interface Props {
  userId: string;
  phoneE164: string;
  userRole: 'candidate' | 'employer' | 'partner' | 'admin' | 'manager' | 'recruiter';
  locale?: Locale;
}

interface OptinDoc {
  status: 'active' | 'opted_out' | 'pending_verification';
  marketingOptin: boolean;
  optinAt: Timestamp | null;
}

const T = {
  en: {
    heading: 'WhatsApp notifications', status: 'Status', number: 'Number',
    active: 'Active', optedOut: 'Unsubscribed', pending: 'Not yet confirmed',
    txnTitle: 'Transactional updates', txnDesc: 'Application updates, interviews, offers, placements',
    mktTitle: 'Job match alerts', mktDesc: 'New jobs matching your profile (weekly)',
    turnOn: 'Turn on', turnOff: 'Turn off', on: 'ON', off: 'OFF',
    unsubAll: 'Unsubscribe from all WhatsApp messages', since: 'since',
    noPhone: 'No phone number on file. Add one in your profile to manage WhatsApp consent.',
  },
  zh: {
    heading: 'WhatsApp 通知', status: '状态', number: '号码',
    active: '已启用', optedOut: '已退订', pending: '尚未确认',
    txnTitle: '事务性通知', txnDesc: '申请进度、面试、Offer、入职',
    mktTitle: '职位匹配提醒', mktDesc: '每周匹配您档案的新职位',
    turnOn: '开启', turnOff: '关闭', on: '开', off: '关',
    unsubAll: '退订所有 WhatsApp 消息', since: '自',
    noPhone: '未登记电话号码。请先在个人资料中添加，以管理 WhatsApp 授权。',
  },
} as const;

export default function WhatsAppConsentSettings({ userId, phoneE164, userRole, locale = 'en' }: Props) {
  const t = T[locale === 'zh' ? 'zh' : 'en'];
  const [optin, setOptin] = useState<OptinDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!phoneE164) return;
    const unsub = onSnapshot(
      doc(db, 'whatsapp_optin', phoneE164),
      (snap) => {
        const d = snap.data() as Record<string, unknown> | undefined;
        setOptin(
          d
            ? {
                status: (d.status as OptinDoc['status']) || 'pending_verification',
                marketingOptin: Boolean(d.marketingOptin),
                optinAt: (d.optinAt as Timestamp) ?? null,
              }
            : null,
        );
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, [phoneE164]);

  async function update(body: Record<string, unknown>) {
    if (!phoneE164 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${PROXY_BASE}/proxy/whatsapp/optin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          phoneE164, userId, source: 'user_settings',
          consentLocale: locale, actorUserId: userId, actorRole: userRole, ...body,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const setTransactional = (on: boolean) =>
    update({ status: on ? 'active' : 'opted_out', marketingOptin: on ? (optin?.marketingOptin ?? false) : false,
             consentText: '[user_settings] transactional ' + (on ? 'enabled' : 'disabled') });
  const setMarketing = (on: boolean) =>
    update({ status: 'active', marketingOptin: on, consentText: '[user_settings] marketing ' + (on ? 'enabled' : 'disabled') });
  const unsubscribeAll = () =>
    update({ status: 'opted_out', marketingOptin: false, consentText: '[user_settings] unsubscribed from all' });

  if (!phoneE164) return <div style={S.card}><p style={S.dim}>{t.noPhone}</p></div>;

  const status = optin?.status ?? 'pending_verification';
  const txnOn = status === 'active';
  const mktOn = optin?.marketingOptin ?? false;
  const statusLabel = status === 'active' ? `✅ ${t.active}` : status === 'opted_out' ? `🚫 ${t.optedOut}` : `⏳ ${t.pending}`;
  const sinceStr = optin?.optinAt?.toDate ? optin.optinAt.toDate().toLocaleDateString() : '';

  return (
    <div style={S.card}>
      <h3 style={S.heading}>{t.heading}</h3>
      <div style={S.metaRow}><span style={S.dim}>{t.status}:</span><span>{statusLabel}{sinceStr && status === 'active' ? `  (${t.since} ${sinceStr})` : ''}</span></div>
      <div style={S.metaRow}><span style={S.dim}>{t.number}:</span><span style={S.mono}>{phoneE164}</span></div>

      <Toggle title={t.txnTitle} desc={t.txnDesc} on={txnOn} disabled={busy}
        onLabel={t.on} offLabel={t.off} actionLabel={txnOn ? t.turnOff : t.turnOn}
        onToggle={() => setTransactional(!txnOn)} />

      <Toggle title={t.mktTitle} desc={t.mktDesc} on={mktOn} disabled={busy || !txnOn}
        onLabel={t.on} offLabel={t.off} actionLabel={mktOn ? t.turnOff : t.turnOn}
        onToggle={() => setMarketing(!mktOn)} />

      <button style={S.unsubBtn} disabled={busy || status === 'opted_out'} onClick={unsubscribeAll}>
        {t.unsubAll}
      </button>
      {error && <p style={S.error}>{error}</p>}
    </div>
  );
}

function Toggle(props: {
  title: string; desc: string; on: boolean; disabled: boolean;
  onLabel: string; offLabel: string; actionLabel: string; onToggle: () => void;
}) {
  return (
    <div style={S.toggleRow}>
      <div style={{ flex: 1 }}>
        <div style={S.toggleTitle}>{props.title}</div>
        <div style={S.dim}>{props.desc}</div>
      </div>
      <span style={{ ...S.statePill, background: props.on ? TEAL : '#ccc' }}>{props.on ? props.onLabel : props.offLabel}</span>
      <button style={S.actionBtn} disabled={props.disabled} onClick={props.onToggle}>{props.actionLabel}</button>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  card: { fontFamily: SANS, border: '1px solid #e3ddd0', borderRadius: 12, padding: 20, maxWidth: 560, background: '#fff', color: '#222' },
  heading: { fontFamily: "'IBM Plex Serif', serif", color: NAVY, fontSize: 18, margin: '0 0 14px' },
  metaRow: { display: 'flex', gap: 10, fontSize: 14, marginBottom: 6 },
  dim: { color: '#777', fontSize: 13 },
  mono: { fontFamily: MONO, fontSize: 13 },
  toggleRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0', borderTop: '1px solid #eee', marginTop: 10 },
  toggleTitle: { fontWeight: 600, fontSize: 14 },
  statePill: { color: '#fff', fontFamily: MONO, fontSize: 11, padding: '3px 8px', borderRadius: 10, fontWeight: 700 },
  actionBtn: { background: NAVY, color: '#fff', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: 13, cursor: 'pointer' },
  unsubBtn: { marginTop: 18, background: 'transparent', color: '#b3503f', border: '1px solid #d9b8b0', borderRadius: 8, padding: '9px 14px', fontSize: 13, cursor: 'pointer', width: '100%' },
  error: { color: '#b3503f', fontSize: 12, marginTop: 8 },
};

export const __WA_CONSENT_ACCENT = GOLD;
