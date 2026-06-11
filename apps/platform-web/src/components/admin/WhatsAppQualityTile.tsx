// apps/platform-web/src/components/admin/WhatsAppQualityTile.tsx
// Admin dashboard health tile (TASK 5). Shows current Meta quality rating + tier,
// today's send count vs cap, and the latest blocked/failed counts.
//
// Reads the latest whatsapp_quality snapshot + today's whatsapp_send_log entries
// (firestore.rules allows admin + manager). Fresh quality snapshots are produced by
// the daily n8n quality-poll workflow (n8n-workflow-5) — the tile does NOT call
// Meta directly (that route needs the proxy secret, which never reaches the browser).

import { useEffect, useMemo, useState } from 'react';
import { collection, query, orderBy, limit, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const GOLD = '#D4A24C';
const NAVY = '#0E2A4A';
const SERIF = "'IBM Plex Serif', serif";
const MONO = "'JetBrains Mono', monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

interface Props {
  dailyCap?: number; // mirror of WHATSAPP_DAILY_SEND_CAP (env on sr-proxy); default 200
}

interface QualitySnap {
  qualityRating: 'green' | 'yellow' | 'red' | 'unknown';
  messagingLimitTier: string;
  capturedAt: Timestamp | null;
}

const RATING_COLOR: Record<string, string> = {
  green: '#2e9e5b', yellow: '#d9a441', red: '#d14b4b', unknown: '#888',
};

export default function WhatsAppQualityTile({ dailyCap = 200 }: Props) {
  const [snap, setSnap] = useState<QualitySnap | null>(null);
  const [sentToday, setSentToday] = useState(0);
  const [failedToday, setFailedToday] = useState(0);
  const [blockedToday, setBlockedToday] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Latest quality snapshot
  useEffect(() => {
    const q = query(collection(db, 'whatsapp_quality'), orderBy('capturedAt', 'desc'), limit(1));
    const unsub = onSnapshot(
      q,
      (s) => {
        const d = s.docs[0]?.data() as Record<string, unknown> | undefined;
        setSnap(d ? {
          qualityRating: (d.qualityRating as QualitySnap['qualityRating']) || 'unknown',
          messagingLimitTier: (d.messagingLimitTier as string) || 'unknown',
          capturedAt: (d.capturedAt as Timestamp) ?? null,
        } : null);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, []);

  // Today's sends (since local midnight)
  useEffect(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, 'whatsapp_send_log'),
      where('createdAt', '>=', Timestamp.fromDate(start)),
      orderBy('createdAt', 'desc'),
      limit(1000),
    );
    const unsub = onSnapshot(
      q,
      (s) => {
        let sent = 0, failed = 0, blocked = 0;
        s.forEach((d) => {
          const st = (d.data() as Record<string, unknown>).status;
          if (st === 'failed') failed++;
          else if (st === 'blocked') blocked++;
          else sent++; // queued|sent|delivered|read
        });
        setSentToday(sent); setFailedToday(failed); setBlockedToday(blocked);
      },
      (err) => setError(err.message),
    );
    return () => unsub();
  }, []);

  const rating = snap?.qualityRating ?? 'unknown';
  const pct = useMemo(() => Math.min(100, Math.round((sentToday / dailyCap) * 100)), [sentToday, dailyCap]);
  const capturedStr = snap?.capturedAt?.toDate ? snap.capturedAt.toDate().toLocaleString() : '—';

  return (
    <div style={S.tile}>
      <div style={S.header}>
        <h3 style={S.title}>WhatsApp Health</h3>
        <span style={{ ...S.ratingPill, background: RATING_COLOR[rating] }}>{rating.toUpperCase()}</span>
      </div>

      <div style={S.grid}>
        <Metric label="Quality" value={rating.toUpperCase()} color={RATING_COLOR[rating]} />
        <Metric label="Tier" value={snap?.messagingLimitTier ?? '—'} />
        <Metric label="Sent today" value={`${sentToday} / ${dailyCap}`} />
        <Metric label="Blocked" value={String(blockedToday)} />
        <Metric label="Failed" value={String(failedToday)} color={failedToday > 0 ? RATING_COLOR.red : undefined} />
      </div>

      <div style={S.barOuter}>
        <div style={{ ...S.barInner, width: `${pct}%`, background: pct >= 90 ? RATING_COLOR.red : GOLD }} />
      </div>
      <div style={S.foot}>
        <span>{pct}% of daily cap</span>
        <span style={S.mono}>captured {capturedStr}</span>
      </div>
      {rating === 'red' && <div style={S.halt}>🚨 Outbound halted — quality is RED. Investigate before resuming.</div>}
      {rating === 'yellow' && <div style={S.warn}>⚠️ Quality is YELLOW — slow down outbound; pause non-essential sends.</div>}
      {error && <div style={S.error}>{error}</div>}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={S.metric}>
      <div style={S.metricLabel}>{label}</div>
      <div style={{ ...S.metricValue, ...(color ? { color } : {}) }}>{value}</div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  tile: { fontFamily: SANS, background: '#fff', border: '1px solid #e3ddd0', borderRadius: 12, padding: 18, maxWidth: 520, color: '#222' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontFamily: SERIF, color: NAVY, fontSize: 17, margin: 0 },
  ratingPill: { color: '#fff', fontFamily: MONO, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 10 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 10, marginBottom: 14 },
  metric: { background: '#faf7f0', borderRadius: 8, padding: '10px 12px' },
  metricLabel: { fontSize: 11, color: '#888', marginBottom: 3 },
  metricValue: { fontFamily: MONO, fontSize: 16, fontWeight: 600, color: NAVY },
  barOuter: { height: 8, background: '#eee', borderRadius: 4, overflow: 'hidden' },
  barInner: { height: '100%', borderRadius: 4, transition: 'width .3s' },
  foot: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#888', marginTop: 6 },
  mono: { fontFamily: MONO },
  halt: { marginTop: 12, background: '#fbe8e8', color: '#a3302f', padding: '8px 12px', borderRadius: 8, fontSize: 13 },
  warn: { marginTop: 12, background: '#fdf4e3', color: '#9a6b16', padding: '8px 12px', borderRadius: 8, fontSize: 13 },
  error: { marginTop: 10, color: '#a3302f', fontSize: 12 },
};
