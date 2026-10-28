/// Marketing contacts and campaigns, as `/api/admin/marketing` returns them.

export type Contact = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  status: 'subscribed' | 'unsubscribed';
  createdAt: string | null;
  unsubscribedAt: string | null;
};

export type CampaignStatus = 'draft' | 'scheduled' | 'sending' | 'paused' | 'sent' | 'failed';

export type Campaign = {
  id: string;
  subject: string;
  body: string;
  /// Banner at the top of the email, and where clicking it goes.
  imageUrl: string | null;
  imageLink: string | null;
  /// Inbox sender; null = the server default (hello@aarambh.app).
  fromName: string | null;
  fromEmail: string | null;
  status: CampaignStatus;
  audience: number;
  sent: number;
  failed: number;
  lastError: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
  /// When a scheduled campaign starts.
  scheduledAt: string | null;
  /// Emails per 24 hours; null = no limit.
  dailyLimit: number | null;
  /// When a paused (daily-limited) send continues.
  resumeAt: string | null;
  /// Chosen recipients (contact ids); null = every subscribed contact.
  audienceIds: string[] | null;
};

export type MailTransport = 'smtp' | 'resend' | 'brevo';

export const TRANSPORT_NAMES: Record<MailTransport, string> = { smtp: 'Gmail', resend: 'Resend', brevo: 'Brevo' };

export type MarketingSummary = {
  contacts: { total: number; subscribed: number; unsubscribed: number };
  /// Server settings still missing before anything can be sent.
  missingSetup: string[];
  /// The service sending first: Gmail SMTP (~2,000/day), Resend (100/day free) or Brevo (300/day free).
  transport: MailTransport | null;
  /// Every service in use, in order: each takes over once the one before hits its daily limit.
  transports: MailTransport[];
  /// Emails a day all of them allow together.
  dailyCapacity: number;
  /// The address mail goes out from.
  sender: string | null;
};

export type ImportResult = {
  added: number;
  updated: number;
  stillUnsubscribed: number;
  invalid: number;
  duplicates: number;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export function parseContact(raw: Record<string, unknown>): Contact {
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    email: typeof raw.email === 'string' ? raw.email : '',
    name: str(raw.name),
    phone: str(raw.phone),
    status: raw.status === 'unsubscribed' ? 'unsubscribed' : 'subscribed',
    createdAt: str(raw.createdAt),
    unsubscribedAt: str(raw.unsubscribedAt),
  };
}

const STATUSES: CampaignStatus[] = ['draft', 'scheduled', 'sending', 'paused', 'sent', 'failed'];

export function parseCampaign(raw: Record<string, unknown>): Campaign {
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    body: typeof raw.body === 'string' ? raw.body : '',
    imageUrl: str(raw.imageUrl),
    imageLink: str(raw.imageLink),
    fromName: str(raw.fromName),
    fromEmail: str(raw.fromEmail),
    status: STATUSES.find((s) => s === raw.status) ?? 'draft',
    audience: num(raw.audience),
    sent: num(raw.sent),
    failed: num(raw.failed),
    lastError: str(raw.lastError),
    createdAt: str(raw.createdAt),
    startedAt: str(raw.startedAt),
    finishedAt: str(raw.finishedAt),
    heartbeatAt: str(raw.heartbeatAt),
    scheduledAt: str(raw.scheduledAt),
    dailyLimit: typeof raw.dailyLimit === 'number' && raw.dailyLimit > 0 ? raw.dailyLimit : null,
    resumeAt: str(raw.resumeAt),
    audienceIds: Array.isArray(raw.audienceIds)
      ? raw.audienceIds.filter((x): x is string => typeof x === 'string')
      : null,
  };
}

/// A send whose heartbeat stopped: the server restarted mid-send. Matches the
/// server's two-minute rule, so "Resume" is offered exactly when it is allowed.
export function isStalled(c: Campaign, now = Date.now()): boolean {
  return c.status === 'sending' && (!c.heartbeatAt || now - Date.parse(c.heartbeatAt) > 2 * 60_000);
}
