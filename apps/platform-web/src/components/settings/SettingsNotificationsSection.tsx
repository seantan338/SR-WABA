// apps/platform-web/src/components/settings/SettingsNotificationsSection.tsx
// STUB — reusable "Notifications" settings section wrapping WhatsAppConsentSettings (TASK 4).
// Drop into each settings page with the appropriate userRole:
//   4a /dashboard/settings  → userRole="candidate"
//   4b /employer/settings   → userRole="employer"
//   4c /partner/settings    → userRole="partner"
//
// Example usage in a settings page:
//   <SettingsNotificationsSection
//     userId={currentUser.uid}
//     phone={currentUser.phone}
//     userRole="candidate"
//     locale={currentUser.locale || 'en'}
//   />

import WhatsAppConsentSettings from '@/components/settings/WhatsAppConsentSettings';
import { normalizePhoneToE164 } from '@/components/forms/WhatsAppOptInBlock';

interface Props {
  userId: string;
  phone: string;                 // raw phone from the user profile
  userRole: 'candidate' | 'employer' | 'partner';
  locale?: 'en' | 'zh' | 'ms';
}

export default function SettingsNotificationsSection({ userId, phone, userRole, locale = 'en' }: Props) {
  const phoneE164 = normalizePhoneToE164(phone || '', 'MY') || '';
  return (
    <section style={{ margin: '24px 0' }}>
      <h2 style={{ fontFamily: "'IBM Plex Serif', serif", color: '#0E2A4A', fontSize: 20 }}>Notifications</h2>
      <WhatsAppConsentSettings userId={userId} phoneE164={phoneE164} userRole={userRole} locale={locale} />
    </section>
  );
}
