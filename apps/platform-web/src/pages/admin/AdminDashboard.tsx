// apps/platform-web/src/pages/admin/AdminDashboard.tsx
// STUB — shows where the WhatsApp Operations section + Quality tile mount (TASK 5)
// and the link into the Team Inbox (TASK 6 / 7). In SR-Web-AS, merge the
// "WhatsApp Operations" <section> into the real admin dashboard grid rather than
// shipping this page.

import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import WhatsAppQualityTile from '@/components/admin/WhatsAppQualityTile';

export default function AdminDashboard() {
  const [unresolved, setUnresolved] = useState(0);

  // Unread/unresolved badge count (also used by the sidebar nav — TASK 7)
  useEffect(() => {
    const q = query(collection(db, 'whatsapp_incoming'), where('resolved', '==', false));
    const unsub = onSnapshot(q, (s) => setUnresolved(s.size), () => setUnresolved(0));
    return () => unsub();
  }, []);

  return (
    <div style={{ padding: 24, fontFamily: "'IBM Plex Sans', system-ui, sans-serif" }}>
      <h1 style={{ fontFamily: "'IBM Plex Serif', serif", color: '#0E2A4A' }}>Admin Dashboard</h1>

      {/* ... existing dashboard sections ... */}

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontFamily: "'IBM Plex Serif', serif", color: '#0E2A4A', fontSize: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
          WhatsApp Operations
          <a
            href="/admin/whatsapp"
            style={{ fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif", color: '#1A8A8C', textDecoration: 'none', fontWeight: 600 }}
          >
            💬 Open Inbox{unresolved > 0 ? ` (${unresolved})` : ''} →
          </a>
        </h2>
        <WhatsAppQualityTile dailyCap={200} />
      </section>
    </div>
  );
}
