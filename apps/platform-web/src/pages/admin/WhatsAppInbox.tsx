// apps/platform-web/src/pages/admin/WhatsAppInbox.tsx
// WhatsApp Team Inbox — Admin + Manager only. Mount at /admin/whatsapp.
//
// INTEGRATION POINTS (wire these to SR-Web-AS):
//   1. `@/lib/firebase`     → must export `db` (Firestore) and `auth` (Firebase Auth).
//   2. VITE_SR_PROXY_URL    → sr-proxy base URL (e.g. https://proxy.sunriserecruit.com).
//   3. Route guard          → mount behind your existing Admin/Manager route guard.
//
// DESIGN NOTE: styles are inline with the CP4U brand tokens so the file is portable
// (no dependency on a Tailwind config this repo can't see). Refactor to Tailwind
// classes in SR-Web-AS if preferred.
//
// DATA MODEL NOTES:
//   - A "conversation" = one phone number. Assignment/resolution is tracked on the
//     most-recent whatsapp_incoming doc for that phone (see assignConversation /
//     resolveConversation).
//   - The 24h service window is derived from the latest INBOUND message timestamp
//     (window open === now - lastInbound < 24h). This avoids a client read of
//     whatsapp_optin (admin-only) and is exactly how the server resets the window.
//   - whatsapp_incoming reads are admin-only per firestore.rules. For Manager-role
//     access to the live list, relax that read rule to isManager() (see README).

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  collection, query, orderBy, limit, onSnapshot, doc, updateDoc,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';

// ---------------------------------------------------------------------------
// Brand tokens
// ---------------------------------------------------------------------------
const NAVY = '#0E2A4A';
const GOLD = '#D4A24C';
const TEAL = '#1A8A8C';
const CREAM = '#F7F3EB';
const CHARCOAL = '#1a1a1a';
const CHARCOAL_2 = '#242424';
const CHARCOAL_3 = '#2e2e2e';
const TEXT_DIM = '#9aa0a6';
const SERIF = "'IBM Plex Serif', Georgia, serif";
const MONO = "'JetBrains Mono', 'Courier New', monospace";
const SANS = "'IBM Plex Sans', system-ui, sans-serif";

const PROXY_BASE = (import.meta as any).env?.VITE_SR_PROXY_URL || '';
const WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface IncomingDoc {
  id: string;
  phoneE164: string;
  body: string;
  type: string;
  contactName: string | null;
  receivedAt: Timestamp | null;
  assignedTo: string | null;
  resolved: boolean;
  linkedEntityType: 'candidate' | 'application' | 'referral' | null;
  linkedEntityId: string | null;
}

interface Conversation {
  phoneE164: string;
  contactName: string | null;
  lastMessage: string;
  lastActivity: number;          // ms epoch of latest inbound
  resolved: boolean;
  assignedTo: string | null;
  latestDocId: string;           // doc we mutate for assign/resolve
  linkedEntityType: 'candidate' | 'application' | 'referral' | null;
  linkedEntityId: string | null;
}

interface ThreadMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  timestamp: string | null;
  type?: string;
  status?: string;
  actorUserId?: string | null;
}

interface StaffUser { uid: string; displayName: string; role: string; }
interface TemplateOption { name: string; language: string; }

type FilterKey = 'all' | 'unresolved' | 'mine' | 'resolved';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function authHeaders(): Promise<Record<string, string>> {
  const token = await auth.currentUser?.getIdToken();
  return token
    ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    : { 'Content-Type': 'application/json' };
}

function windowMsLeft(lastActivity: number): number {
  return lastActivity + WINDOW_MS - Date.now();
}

function humanCountdown(ms: number): string {
  if (ms <= 0) return 'closed';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h left` : `${m}m left`;
}

function timeAgo(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function initials(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0]?.[0] || '' + (parts[1]?.[0] || '')).toUpperCase().slice(0, 2);
  }
  return phone.slice(-2);
}

function statusIcon(status?: string): { glyph: string; color: string } {
  switch (status) {
    case 'read': return { glyph: '✓✓', color: GOLD };
    case 'delivered': return { glyph: '✓✓', color: TEXT_DIM };
    case 'sent': return { glyph: '✓', color: TEXT_DIM };
    case 'failed': return { glyph: '✗', color: '#e06c6c' };
    default: return { glyph: '·', color: TEXT_DIM };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function WhatsAppInbox() {
  const [incoming, setIncoming] = useState<IncomingDoc[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [filter, setFilter] = useState<FilterKey>('unresolved');
  const [search, setSearch] = useState('');
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [, forceTick] = useState(0); // re-render countdowns each minute
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  const myUid = auth.currentUser?.uid || null;

  // Live conversation list (real-time)
  useEffect(() => {
    const q = query(
      collection(db, 'whatsapp_incoming'),
      orderBy('receivedAt', 'desc'),
      limit(200),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs: IncomingDoc[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            phoneE164: (data.phoneE164 as string) || '',
            body: (data.body as string) || '',
            type: (data.type as string) || 'text',
            contactName: (data.contactName as string) ?? null,
            receivedAt: (data.receivedAt as Timestamp) ?? null,
            assignedTo: (data.assignedTo as string) ?? null,
            resolved: Boolean(data.resolved),
            linkedEntityType: (data.linkedEntityType as IncomingDoc['linkedEntityType']) ?? null,
            linkedEntityId: (data.linkedEntityId as string) ?? null,
          };
        });
        setIncoming(docs);
      },
      (err) => setError(`Inbox feed error: ${err.message}`),
    );
    return () => unsub();
  }, []);

  // Staff list for the Assign dropdown
  useEffect(() => {
    const q = query(collection(db, 'users'), limit(500));
    const unsub = onSnapshot(q, (snap) => {
      const list: StaffUser[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        const role = (data.role as string) || '';
        if (['admin', 'manager', 'recruiter'].includes(role)) {
          list.push({
            uid: d.id,
            displayName: (data.displayName as string) || (data.email as string) || d.id,
            role,
          });
        }
      });
      setStaff(list);
    });
    return () => unsub();
  }, []);

  // Approved templates for the closed-window selector
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'whatsapp_templates'), (snap) => {
      const list: TemplateOption[] = [];
      snap.forEach((d) => {
        const data = d.data() as Record<string, unknown>;
        if (data.event === 'APPROVED') {
          list.push({ name: (data.name as string) || d.id, language: (data.language as string) || 'en' });
        }
      });
      setTemplates(list);
    });
    return () => unsub();
  }, []);

  // Tick every 60s so window countdowns stay fresh
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Collapse incoming docs into one conversation per phone (newest first)
  const conversations = useMemo<Conversation[]>(() => {
    const byPhone = new Map<string, Conversation>();
    for (const d of incoming) {
      if (!d.phoneE164) continue;
      const ms = d.receivedAt?.toMillis?.() ?? 0;
      const existing = byPhone.get(d.phoneE164);
      if (!existing) {
        byPhone.set(d.phoneE164, {
          phoneE164: d.phoneE164,
          contactName: d.contactName,
          lastMessage: d.body || `[${d.type}]`,
          lastActivity: ms,
          resolved: d.resolved,
          assignedTo: d.assignedTo,
          latestDocId: d.id,
          linkedEntityType: d.linkedEntityType,
          linkedEntityId: d.linkedEntityId,
        });
      } else if (ms > existing.lastActivity) {
        // newer doc wins for last activity + conversation state
        existing.lastMessage = d.body || `[${d.type}]`;
        existing.lastActivity = ms;
        existing.resolved = d.resolved;
        existing.assignedTo = d.assignedTo;
        existing.latestDocId = d.id;
        if (d.contactName) existing.contactName = d.contactName;
        if (d.linkedEntityType) { existing.linkedEntityType = d.linkedEntityType; existing.linkedEntityId = d.linkedEntityId; }
      }
    }
    let list = Array.from(byPhone.values());

    // Filter
    const s = search.trim().toLowerCase();
    list = list.filter((c) => {
      if (filter === 'unresolved' && c.resolved) return false;
      if (filter === 'resolved' && !c.resolved) return false;
      if (filter === 'mine' && c.assignedTo !== myUid) return false;
      if (s && !(`${c.contactName || ''} ${c.phoneE164}`.toLowerCase().includes(s))) return false;
      return true;
    });

    // Sort: unresolved first, then by last activity desc
    list.sort((a, b) => {
      if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
      return b.lastActivity - a.lastActivity;
    });
    return list;
  }, [incoming, filter, search, myUid]);

  const selected = useMemo(
    () => conversations.find((c) => c.phoneE164 === selectedPhone) || null,
    [conversations, selectedPhone],
  );
  const windowOpen = selected ? windowMsLeft(selected.lastActivity) > 0 : false;

  // Fetch full thread for the selected conversation through sr-proxy
  const loadThread = useCallback(async (phone: string) => {
    setThreadLoading(true);
    setError(null);
    try {
      const res = await fetch(`${PROXY_BASE}/proxy/whatsapp/conversation/${encodeURIComponent(phone)}`, {
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // server returns newest-first; show oldest-first (newest at bottom)
      setThread((data.messages || []).slice().reverse());
    } catch (e) {
      setError(`Could not load conversation: ${(e as Error).message}`);
      setThread([]);
    } finally {
      setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPhone) loadThread(selectedPhone);
  }, [selectedPhone, loadThread]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread]);

  // --- Actions ---
  async function sendFreeform() {
    if (!selected || !draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${PROXY_BASE}/proxy/whatsapp/send-freeform`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          to: selected.phoneE164,
          text: draft.trim(),
          relatedEntityType: selected.linkedEntityType,
          relatedEntityId: selected.linkedEntityId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail?.error || data?.error || `HTTP ${res.status}`);
      setDraft('');
      await loadThread(selected.phoneE164);
    } catch (e) {
      setError(`Send failed: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  async function sendTemplate() {
    if (!selected || !selectedTemplate || sending) return;
    const tpl = templates.find((t) => `${t.name}|${t.language}` === selectedTemplate);
    if (!tpl) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${PROXY_BASE}/proxy/whatsapp/send`, {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          to: selected.phoneE164,
          templateName: tpl.name,
          language: tpl.language,
          templateCategory: 'utility',
          variables: [],
          relatedEntityType: selected.linkedEntityType,
          relatedEntityId: selected.linkedEntityId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
      setSelectedTemplate('');
      await loadThread(selected.phoneE164);
    } catch (e) {
      setError(`Template send failed: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  async function assignConversation(uid: string) {
    if (!selected) return;
    try {
      await updateDoc(doc(db, 'whatsapp_incoming', selected.latestDocId), {
        assignedTo: uid || null,
      });
    } catch (e) {
      setError(`Assign failed: ${(e as Error).message}`);
    }
  }

  async function toggleResolved() {
    if (!selected) return;
    try {
      await updateDoc(doc(db, 'whatsapp_incoming', selected.latestDocId), {
        resolved: !selected.resolved,
        resolvedAt: !selected.resolved ? serverTimestamp() : null,
        resolvedByUserId: !selected.resolved ? myUid : null,
      });
    } catch (e) {
      setError(`Resolve failed: ${(e as Error).message}`);
    }
  }

  function staffName(uid: string | null): string {
    if (!uid) return 'Unassigned';
    return staff.find((s) => s.uid === uid)?.displayName || uid;
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div style={S.root}>
      {/* LEFT PANEL — conversation list */}
      <aside style={S.listPanel}>
        <header style={S.listHeader}>
          <h1 style={S.h1}>WhatsApp Inbox</h1>
          <div style={S.filters}>
            {(['all', 'unresolved', 'mine', 'resolved'] as FilterKey[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{ ...S.filterBtn, ...(filter === f ? S.filterBtnActive : {}) }}
              >
                {f === 'mine' ? 'Assigned to me' : f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone…"
            style={S.search}
          />
        </header>

        <div style={S.listScroll}>
          {conversations.length === 0 && (
            <p style={S.empty}>No conversations.</p>
          )}
          {conversations.map((c) => {
            const left = windowMsLeft(c.lastActivity);
            const open = left > 0;
            const isSel = c.phoneE164 === selectedPhone;
            return (
              <button
                key={c.phoneE164}
                onClick={() => setSelectedPhone(c.phoneE164)}
                style={{ ...S.convRow, ...(isSel ? S.convRowActive : {}) }}
              >
                <div style={S.avatar}>{initials(c.contactName, c.phoneE164)}</div>
                <div style={S.convBody}>
                  <div style={S.convTop}>
                    <span style={S.convName}>{c.contactName || c.phoneE164}</span>
                    <span style={S.convTime}>{c.lastActivity ? timeAgo(c.lastActivity) : ''}</span>
                  </div>
                  <div style={S.convPreview}>{c.lastMessage}</div>
                  <div style={S.badges}>
                    <span style={{ ...S.pill, ...(open ? S.pillOpen : S.pillClosed) }}>
                      {open ? humanCountdown(left) : 'TEMPLATE ONLY'}
                    </span>
                    {!c.resolved && <span title="Unresolved" style={{ ...S.dot, background: GOLD }} />}
                    {c.assignedTo === myUid && <span title="Assigned to me" style={{ ...S.dot, background: '#4a90d9' }} />}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* RIGHT PANEL — chat view */}
      <section style={S.chatPanel}>
        {!selected ? (
          <div style={S.chatEmpty}>Select a conversation</div>
        ) : (
          <>
            <header style={S.chatHeader}>
              <div>
                <div style={S.chatName}>{selected.contactName || 'Unknown contact'}</div>
                <div style={S.chatPhone}>{selected.phoneE164}</div>
              </div>
              <div style={S.chatActions}>
                <select
                  value={selected.assignedTo || ''}
                  onChange={(e) => assignConversation(e.target.value)}
                  style={S.assignSelect}
                  title="Assign to"
                >
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.uid} value={s.uid}>{s.displayName} ({s.role})</option>
                  ))}
                </select>
                <button onClick={toggleResolved} style={S.resolveBtn}>
                  {selected.resolved ? 'Reopen' : 'Mark Resolved'}
                </button>
              </div>
            </header>

            {selected.linkedEntityType && selected.linkedEntityId && (
              <a href={`/admin/${selected.linkedEntityType}s/${selected.linkedEntityId}`} style={S.entityLink}>
                → View {selected.linkedEntityType} profile
              </a>
            )}

            <div style={S.thread}>
              {threadLoading && <p style={S.empty}>Loading…</p>}
              {!threadLoading && thread.length === 0 && <p style={S.empty}>No messages yet.</p>}
              {thread.map((m) => {
                const inbound = m.direction === 'inbound';
                const isTemplate = !inbound && m.body.startsWith('[template:');
                return (
                  <div key={m.id} style={{ ...S.msgRow, justifyContent: inbound ? 'flex-start' : 'flex-end' }}>
                    <div
                      style={{
                        ...S.bubble,
                        ...(inbound
                          ? S.bubbleIn
                          : isTemplate
                            ? S.bubbleTemplate
                            : S.bubbleOut),
                      }}
                    >
                      {inbound && selected.contactName && (
                        <div style={S.bubbleAuthor}>{selected.contactName}</div>
                      )}
                      <div style={S.bubbleBody}>{isTemplate ? `📋 ${m.body}` : m.body}</div>
                      <div style={S.bubbleMeta}>
                        <span>{m.timestamp ? new Date(m.timestamp).toLocaleString() : ''}</span>
                        {!inbound && (
                          <span style={{ color: statusIcon(m.status).color, marginLeft: 6 }}>
                            {statusIcon(m.status).glyph}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={threadEndRef} />
            </div>

            {error && <div style={S.errorBar}>{error}</div>}

            {/* Composer */}
            {windowOpen ? (
              <div style={S.composer}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 4096))}
                  placeholder="Type a message…"
                  style={S.textarea}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendFreeform();
                  }}
                />
                <div style={S.composerFooter}>
                  <span style={S.charCount}>{draft.length} / 4096</span>
                  <button onClick={sendFreeform} disabled={sending || !draft.trim()} style={S.sendBtn}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={S.templateBar}>
                <div style={S.templateHint}>⏱ Service window closed. Send a template:</div>
                <div style={S.templateRow}>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    style={S.assignSelect}
                  >
                    <option value="">Select template…</option>
                    {templates.map((t) => (
                      <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                        {t.name} ({t.language})
                      </option>
                    ))}
                  </select>
                  <button onClick={sendTemplate} disabled={sending || !selectedTemplate} style={S.sendBtn}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const S: Record<string, React.CSSProperties> = {
  root: { display: 'flex', height: '100%', minHeight: '100vh', background: CHARCOAL, color: '#e8e8e8', fontFamily: SANS },
  listPanel: { width: 360, minWidth: 280, borderRight: `1px solid ${CHARCOAL_3}`, display: 'flex', flexDirection: 'column' },
  listHeader: { padding: 16, borderBottom: `1px solid ${CHARCOAL_3}` },
  h1: { fontFamily: SERIF, fontSize: 20, margin: '0 0 12px', color: CREAM },
  filters: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  filterBtn: { background: CHARCOAL_2, color: TEXT_DIM, border: `1px solid ${CHARCOAL_3}`, borderRadius: 14, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  filterBtnActive: { background: GOLD, color: CHARCOAL, borderColor: GOLD, fontWeight: 600 },
  search: { width: '100%', boxSizing: 'border-box', background: CHARCOAL_2, border: `1px solid ${CHARCOAL_3}`, borderRadius: 8, padding: '8px 10px', color: '#e8e8e8', fontFamily: MONO, fontSize: 13 },
  listScroll: { overflowY: 'auto', flex: 1 },
  empty: { color: TEXT_DIM, padding: 16, fontSize: 13 },
  convRow: { display: 'flex', gap: 10, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: `1px solid ${CHARCOAL_2}`, padding: 12, cursor: 'pointer', color: 'inherit' },
  convRowActive: { background: CHARCOAL_2 },
  avatar: { width: 38, height: 38, borderRadius: '50%', background: NAVY, color: CREAM, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MONO, fontSize: 13, flexShrink: 0 },
  convBody: { flex: 1, minWidth: 0 },
  convTop: { display: 'flex', justifyContent: 'space-between', gap: 8 },
  convName: { fontFamily: SERIF, fontSize: 14, color: CREAM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  convTime: { fontFamily: MONO, fontSize: 11, color: TEXT_DIM, flexShrink: 0 },
  convPreview: { fontSize: 12, color: TEXT_DIM, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', margin: '2px 0 6px' },
  badges: { display: 'flex', alignItems: 'center', gap: 6 },
  pill: { fontFamily: MONO, fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600 },
  pillOpen: { background: 'rgba(26,138,140,0.2)', color: '#5fd0d2' },
  pillClosed: { background: CHARCOAL_3, color: TEXT_DIM },
  dot: { width: 8, height: 8, borderRadius: '50%', display: 'inline-block' },
  chatPanel: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  chatEmpty: { margin: 'auto', color: TEXT_DIM, fontFamily: SERIF, fontSize: 18 },
  chatHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottom: `1px solid ${CHARCOAL_3}` },
  chatName: { fontFamily: SERIF, fontSize: 18, color: CREAM },
  chatPhone: { fontFamily: MONO, fontSize: 13, color: TEXT_DIM },
  chatActions: { display: 'flex', gap: 8, alignItems: 'center' },
  assignSelect: { background: CHARCOAL_2, color: '#e8e8e8', border: `1px solid ${CHARCOAL_3}`, borderRadius: 8, padding: '7px 10px', fontSize: 13 },
  resolveBtn: { background: GOLD, color: CHARCOAL, border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 13 },
  entityLink: { display: 'block', padding: '8px 16px', color: TEAL, fontSize: 13, textDecoration: 'none', borderBottom: `1px solid ${CHARCOAL_2}` },
  thread: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 },
  msgRow: { display: 'flex' },
  bubble: { maxWidth: '70%', borderRadius: 12, padding: '8px 12px', fontSize: 14 },
  bubbleIn: { background: CREAM, color: '#222', borderTopLeftRadius: 2 },
  bubbleOut: { background: NAVY, color: CREAM, borderTopRightRadius: 2 },
  bubbleTemplate: { background: 'transparent', border: `1px solid ${TEAL}`, color: '#cfeded', borderTopRightRadius: 2 },
  bubbleAuthor: { fontFamily: SERIF, fontSize: 11, color: NAVY, marginBottom: 2 },
  bubbleBody: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  bubbleMeta: { fontFamily: MONO, fontSize: 10, opacity: 0.7, marginTop: 4, textAlign: 'right' },
  errorBar: { background: 'rgba(224,108,108,0.15)', color: '#f0a0a0', padding: '8px 16px', fontSize: 13 },
  composer: { borderTop: `1px solid ${CHARCOAL_3}`, padding: 12 },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: 60, resize: 'vertical', background: CHARCOAL_2, color: '#e8e8e8', border: `1px solid ${CHARCOAL_3}`, borderRadius: 8, padding: 10, fontFamily: SANS, fontSize: 14 },
  composerFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  charCount: { fontFamily: MONO, fontSize: 11, color: TEXT_DIM },
  sendBtn: { background: GOLD, color: CHARCOAL, border: 'none', borderRadius: 8, padding: '8px 18px', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  templateBar: { borderTop: `1px solid ${CHARCOAL_3}`, padding: 12 },
  templateHint: { color: TEXT_DIM, fontSize: 13, marginBottom: 8 },
  templateRow: { display: 'flex', gap: 8 },
};
