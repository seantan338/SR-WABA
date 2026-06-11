// apps/platform-web/src/types/whatsapp.ts
// TypeScript type definitions for the WhatsApp Cloud API integration.
// Source of truth: firestore-schema.md (5 collections) + Team Inbox extensions (TASK 6b).
// Copy this file into SR-Web-AS at the path above.

import type { Timestamp } from 'firebase/firestore';

// ============================================================================
// /whatsapp_optin/{phoneE164}
// Document ID = phone in E.164 format (e.g. +60123456789).
// ============================================================================

export interface WhatsAppOptin {
  phoneE164: string;                    // matches doc ID
  userId: string | null;                // linked CP4U user if any
  status: 'active' | 'opted_out' | 'pending_verification';
  source:
    | 'candidate_signup'
    | 'employer_signup'
    | 'partner_signup'
    | 'jd_upload_form'
    | 'career_fair_rsvp'
    | 'manual_admin'                    // requires actorAdminId
    | 'imported_with_consent';          // legacy — requires consentEvidence
  consentText: string;                  // exact wording shown at opt-in
  consentLocale: 'en' | 'zh' | 'ms';
  consentEvidence?: string;             // URL/path to evidence file if imported
  optinAt: Timestamp;
  optoutAt: Timestamp | null;
  optoutMessage?: string;               // the actual STOP message text if user-initiated
  lastTemplateAt: Timestamp | null;
  serviceWindowExpiresAt: Timestamp | null;  // 24h from last incoming message
  marketingOptin: boolean;              // separate consent for MARKETING category
  marketingOptinAt: Timestamp | null;
  actorAdminId?: string;                // if source = manual_admin
}

// ============================================================================
// /whatsapp_send_log/{logId}
// Append-only log of every outbound attempt — successes, failures, blocked.
// ============================================================================

export interface WhatsAppSendLog {
  // identifiers
  phoneE164: string;
  metaMessageId: string | null;         // null if blocked before send

  // template
  templateName: string;
  templateCategory: 'utility' | 'marketing' | 'authentication';
  language: 'en' | 'zh_CN' | 'ms';
  variables: string[];

  // status lifecycle
  status:
    | 'queued'
    | 'sent'        // accepted by Meta
    | 'delivered'   // delivered to handset
    | 'read'        // user opened
    | 'failed'      // Meta returned error
    | 'blocked';    // our pre-flight rejected (opt-in / quality / cap)
  errorCode: string | null;
  errorDetail: string | null;
  metaRawError?: any;                   // full Meta error object if failed
  statusUpdatedAt: Timestamp | null;

  // context
  actorUserId: string | null;           // user who triggered (admin/recruiter/system)
  actorRole: 'admin' | 'manager' | 'recruiter' | 'system' | 'n8n' | null;
  relatedEntityType: 'candidate' | 'application' | 'referral' | 'job' | null;
  relatedEntityId: string | null;

  createdAt: Timestamp;
}

// ============================================================================
// /whatsapp_quality/{snapshotId}
// Time-series snapshots of Meta-reported quality + tier.
// ============================================================================

export interface WhatsAppQuality {
  phoneNumberId: string;
  qualityRating: 'green' | 'yellow' | 'red' | 'unknown';
  messagingLimitTier:
    | 'tier_250'
    | 'tier_1k'
    | 'tier_10k'
    | 'tier_100k'
    | 'unlimited'
    | 'unknown';
  throughputTier: 'standard' | 'high';
  rawEvent?: any;                       // raw Meta webhook payload if available
  capturedAt: Timestamp;
}

// ============================================================================
// /whatsapp_incoming/{msgId}
// All incoming messages from users. Maintains 24h service window + captures replies.
// Extended (TASK 6b) with Team Inbox assignment / resolution fields.
// ============================================================================

export interface WhatsAppIncoming {
  phoneE164: string;
  metaMessageId: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'location' | 'sticker' | 'interactive' | 'button';
  body: string;                         // text body or empty for non-text
  contactName: string | null;           // from Meta contact profile
  matched: boolean;                     // did our app process this (e.g. linked to candidate)?
  linkedEntityType: 'candidate' | 'application' | 'referral' | null;
  linkedEntityId: string | null;
  receivedAt: Timestamp;

  // --- Team Inbox extensions (TASK 6b) ---
  assignedTo: string | null;            // userId of assigned recruiter/admin
  resolved: boolean;                    // true when conversation is closed
  resolvedAt: Timestamp | null;
  resolvedByUserId: string | null;
}

// ============================================================================
// /whatsapp_templates/{templateName}
// Mirror of Meta's template approval status. Populated by webhook + manual sync.
// ============================================================================

export interface WhatsAppTemplate {
  name: string;                         // doc ID
  language: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  event:
    | 'APPROVED'
    | 'REJECTED'
    | 'PAUSED'
    | 'DISABLED'
    | 'PENDING'
    | 'IN_APPEAL';
  reason: string | null;                // rejection reason from Meta
  updatedAt: Timestamp;
}
