// apps/platform-web/src/components/forms/WhatsAppOptInBlock.tsx
// Reusable WhatsApp opt-in consent block for signup / lead-capture forms (TASK 3).
// Consent copy is sourced verbatim from docs/optin-flow.md (bilingual EN/ZH).
//
// Exports:
//   - default WhatsAppOptInBlock        the checkbox UI block
//   - writeWhatsAppOptIn(params)        async; records consent via sr-proxy
//   - normalizePhoneToE164(raw, country) phone normalization helper
//   - OptInState                        emitted via onChange
//
// NOTE: whatsapp_optin is NOT client-writable (firestore.rules). writeWhatsAppOptIn
// posts to POST /proxy/whatsapp/optin, which performs the Admin SDK write + audit log.

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';

const PROXY_BASE = (import.meta as any).env?.VITE_SR_PROXY_URL || '';

const GOLD = '#D4A24C';
const TEAL = '#1A8A8C';
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

export type OptInLocale = 'en' | 'zh' | 'ms';

export type OptInSource =
  | 'candidate_signup'
  | 'employer_signup'
  | 'partner_signup'
  | 'jd_upload_form'
  | 'career_fair_rsvp';

export interface OptInState {
  transactional: boolean;
  marketing: boolean;
  consentText: string;   // exact wording shown, persisted for PDPA audit
  locale: OptInLocale;
}

// ---------------------------------------------------------------------------
// Phone normalization — Malaysia / Singapore aware (mirrors wa-proxy.js)
// ---------------------------------------------------------------------------
export function normalizePhoneToE164(raw: string, country: 'MY' | 'SG' = 'MY'): string | null {
  if (!raw) return null;
  const s = String(raw).replace(/[\s\-()]/g, '');
  let e164: string | null = null;
  if (s.startsWith('+')) e164 = s;
  else if (country === 'MY') {
    if (s.startsWith('0')) e164 = '+6' + s;
    else if (s.startsWith('60')) e164 = '+' + s;
    else if (s.startsWith('6')) e164 = '+' + s;
    else e164 = '+' + s;
  } else if (country === 'SG') {
    if (/^\d{8}$/.test(s)) e164 = '+65' + s;
    else if (s.startsWith('65')) e164 = '+' + s;
    else e164 = '+' + s;
  } else {
    e164 = '+' + s;
  }
  return e164 && /^\+\d{8,15}$/.test(e164) ? e164 : null;
}

// ---------------------------------------------------------------------------
// Consent copy (verbatim from docs/optin-flow.md)
// ---------------------------------------------------------------------------
interface CopyEntry { transactional: string; marketing?: string; }

function consentCopy(source: OptInSource, locale: OptInLocale, phone: string): CopyEntry {
  const p = phone || '+60XXXXXXXXX';
  const zh = locale === 'zh';
  switch (source) {
    case 'candidate_signup':
      return zh
        ? {
            transactional: `我同意接收 Sunrise Recruit 通过 WhatsApp 发送的事务性消息，包括简历接收确认、面试邀约、Offer 通知和入职确认。号码：${p}。我可以随时回复 STOP 退订。`,
            marketing: `我同时希望接收 WhatsApp 职位匹配提醒（可选）。即使不勾选，您仍会收到关于您主动申请职位的更新。`,
          }
        : {
            transactional: `I agree to receive transactional WhatsApp messages from Sunrise Recruit about my CV submissions, interviews, offers and placements at ${p}. I can reply STOP at any time to unsubscribe.`,
            marketing: `I'd also like to receive WhatsApp job alerts when new openings match my profile. (Optional — you'll still hear from us about your active applications.)`,
          };
    case 'employer_signup':
      return {
        transactional: `Send transactional WhatsApp updates to my number ${p} about job orders, candidate submissions and platform activity. Reply STOP at any time to unsubscribe.`,
      };
    case 'partner_signup':
      return zh
        ? {
            transactional: `我同意接收 Sunrise Recruit 通过 WhatsApp 发送的事务性消息，包括推荐进度、佣金、级别变化和平台通知。号码：${p}。我可以随时回复 STOP 退订。`,
            marketing: `我希望在我专长领域有新职位空缺时收到 WhatsApp 提醒（可选）。`,
          }
        : {
            transactional: `Send transactional WhatsApp updates to my number ${p} about my referrals, commissions, tier changes and platform notifications. Reply STOP at any time to unsubscribe.`,
            marketing: `Send WhatsApp alerts when new jobs in my specialty open up. (Optional — helps you act on opportunities faster.)`,
          };
    case 'jd_upload_form':
      return {
        transactional: `Send a WhatsApp confirmation to ${p} when we receive your JD. We'll never share your number or send promotional messages.`,
      };
    case 'career_fair_rsvp':
      return {
        transactional: `Send WhatsApp reminders to ${p} (24h before + 1h before). Email reminders will be sent regardless.`,
      };
    default:
      return { transactional: '' };
  }
}

function composeConsentText(copy: CopyEntry, transactional: boolean, marketing: boolean): string {
  const parts: string[] = [];
  if (transactional) parts.push(copy.transactional);
  if (marketing && copy.marketing) parts.push(copy.marketing);
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// writeWhatsAppOptIn — records consent through sr-proxy
// ---------------------------------------------------------------------------
export interface WriteOptInParams {
  phoneE164: string;
  userId: string | null;
  source: OptInSource;
  state: OptInState;
  actorUserId?: string | null;
}

export async function writeWhatsAppOptIn(params: WriteOptInParams): Promise<boolean> {
  const { phoneE164, userId, source, state, actorUserId } = params;
  const token = await auth.currentUser?.getIdToken().catch(() => null);
  try {
    const res = await fetch(`${PROXY_BASE}/proxy/whatsapp/optin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        phoneE164,
        userId,
        source,
        transactional: state.transactional,
        status: state.transactional ? 'active' : 'pending_verification',
        marketingOptin: state.marketing,
        consentText: state.consentText,
        consentLocale: state.locale,
        actorUserId: actorUserId ?? userId ?? null,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface Props {
  source: OptInSource;
  phone: string;
  locale?: OptInLocale;
  showMarketingOption?: boolean;
  onChange?: (state: OptInState) => void;
}

export default function WhatsAppOptInBlock({
  source,
  phone,
  locale = 'en',
  showMarketingOption = false,
  onChange,
}: Props) {
  const [transactional, setTransactional] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const copy = consentCopy(source, locale, phone);

  useEffect(() => {
    onChange?.({
      transactional,
      marketing,
      consentText: composeConsentText(copy, transactional, marketing),
      locale,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactional, marketing, phone, locale]);

  return (
    <div style={styles.block}>
      <label style={styles.row}>
        <input
          type="checkbox"
          checked={transactional}
          onChange={(e) => setTransactional(e.target.checked)}
          style={styles.checkbox}
        />
        <span style={styles.text}>{copy.transactional}</span>
      </label>

      {showMarketingOption && copy.marketing && (
        <label style={styles.row}>
          <input
            type="checkbox"
            checked={marketing}
            onChange={(e) => setMarketing(e.target.checked)}
            style={styles.checkbox}
          />
          <span style={styles.text}>{copy.marketing}</span>
        </label>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  block: { display: 'flex', flexDirection: 'column', gap: 10, fontFamily: SANS, margin: '12px 0' },
  row: { display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13, lineHeight: 1.5, color: '#333' },
  checkbox: { marginTop: 3, accentColor: TEAL, width: 16, height: 16, flexShrink: 0 },
  text: { flex: 1 },
};

// Brand accent kept referenced for theming consistency.
export const __WA_OPTIN_ACCENT = GOLD;
