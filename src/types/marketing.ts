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

export type CampaignStatus = 'draft' | 'sending' | 'sent' | 'failed';

export type Campaign = {
  id: string;
  subject: string;
  body: string;
  status: CampaignStatus;
  audience: number;
  sent: number;
  failed: number;
  lastError: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt: string | null;
};

export type MarketingSummary = {
  contacts: { total: number; subscribed: number; unsubscribed: number };
  /// Server settings still missing before anything can be sent.
  missingSetup: string[];
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

const STATUSES: CampaignStatus[] = ['draft', 'sending', 'sent', 'failed'];

export function parseCampaign(raw: Record<string, unknown>): Campaign {
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    subject: typeof raw.subject === 'string' ? raw.subject : '',
    body: typeof raw.body === 'string' ? raw.body : '',
    status: STATUSES.find((s) => s === raw.status) ?? 'draft',
    audience: num(raw.audience),
    sent: num(raw.sent),
    failed: num(raw.failed),
    lastError: str(raw.lastError),
    createdAt: str(raw.createdAt),
    startedAt: str(raw.startedAt),
    finishedAt: str(raw.finishedAt),
    heartbeatAt: str(raw.heartbeatAt),
  };
}

/// A send whose heartbeat stopped: the server restarted mid-send. Matches the
/// server's two-minute rule, so "Resume" is offered exactly when it is allowed.
export function isStalled(c: Campaign, now = Date.now()): boolean {
  return c.status === 'sending' && (!c.heartbeatAt || now - Date.parse(c.heartbeatAt) > 2 * 60_000);
}
