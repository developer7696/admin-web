import { adminApi, ApiException, type Json } from '@/lib/api-client';
import { putToAzure } from './exercise-catalog-repository';
import type { SheetContact } from '@/lib/contact-sheet';
import {
  parseCampaign,
  parseContact,
  type Campaign,
  type Contact,
  type ImportResult,
  type MarketingSummary,
} from '@/types/marketing';

/// Marketing contacts and campaigns, as data. Every function throws
/// `ApiException` and nothing else.

async function guard<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (e) {
    if (e instanceof ApiException) throw e;
    throw new ApiException(
      0,
      'unexpected',
      `Unexpected problem with marketing: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const rows = (value: unknown): Record<string, unknown>[] =>
  (Array.isArray(value) ? (value as unknown[]) : []).filter(
    (r): r is Record<string, unknown> => typeof r === 'object' && r !== null,
  );

const campaignOf = (json: Json): Campaign =>
  parseCampaign((json.campaign ?? {}) as Record<string, unknown>);

const n = (v: unknown): number => (typeof v === 'number' ? v : 0);

/// What the editor saves. Empty strings clear a field on the server.
export type CampaignDraft = {
  subject: string;
  body: string;
  imageLink: string;
  fromName: string;
  fromEmail: string;
};

/// Rows per import request - the server's limit.
const IMPORT_CHUNK = 2000;

export const marketingService = {
  summary: (): Promise<MarketingSummary> =>
    guard(async () => {
      const json = await adminApi.marketingSummary();
      const c = (json.contacts ?? {}) as Record<string, unknown>;
      return {
        contacts: { total: n(c.total), subscribed: n(c.subscribed), unsubscribed: n(c.unsubscribed) },
        missingSetup: Array.isArray(json.missingSetup)
          ? json.missingSetup.filter((m): m is string => typeof m === 'string')
          : [],
      };
    }),

  contacts: (args: { search?: string; after?: string }): Promise<{ contacts: Contact[]; next: string | null }> =>
    guard(async () => {
      const json = await adminApi.marketingContacts({ ...args, limit: 50 });
      return {
        contacts: rows(json.contacts).map(parseContact),
        next: typeof json.next === 'string' ? json.next : null,
      };
    }),

  /// Upload in chunks; [onProgress] gets the rows done so far.
  importContacts: (contacts: SheetContact[], onProgress?: (done: number) => void): Promise<ImportResult> =>
    guard(async () => {
      const total: ImportResult = { added: 0, updated: 0, stillUnsubscribed: 0, invalid: 0, duplicates: 0 };
      for (let i = 0; i < contacts.length; i += IMPORT_CHUNK) {
        const chunk = contacts.slice(i, i + IMPORT_CHUNK);
        const json = await adminApi.importMarketingContacts(chunk);
        total.added += n(json.added);
        total.updated += n(json.updated);
        total.stillUnsubscribed += n(json.stillUnsubscribed);
        total.invalid += n(json.invalid);
        total.duplicates += n(json.duplicates);
        onProgress?.(Math.min(contacts.length, i + chunk.length));
      }
      return total;
    }),

  deleteContact: (id: string): Promise<void> =>
    guard(async () => {
      await adminApi.deleteMarketingContact(id);
    }),

  campaigns: (): Promise<Campaign[]> =>
    guard(async () => rows((await adminApi.marketingCampaigns()).campaigns).map(parseCampaign)),

  campaign: (id: string): Promise<Campaign> => guard(async () => campaignOf(await adminApi.marketingCampaign(id))),

  create: (draft: CampaignDraft): Promise<Campaign> =>
    guard(async () => campaignOf(await adminApi.createMarketingCampaign(draft))),

  update: (id: string, draft: CampaignDraft): Promise<Campaign> =>
    guard(async () => campaignOf(await adminApi.updateMarketingCampaign(id, draft))),

  /// Upload [file] as the campaign's banner, replacing any earlier one.
  uploadImage: (id: string, file: File): Promise<Campaign> =>
    guard(async () => {
      const extension = (file.name.split('.').pop() ?? '').toLowerCase();
      const ticket = await adminApi.marketingImageUploadUrl(id, extension);
      const uploadUrl = String(ticket.uploadUrl ?? '');
      const path = String(ticket.path ?? '');
      if (!uploadUrl || !path) throw new ApiException(0, 'upload_ticket', 'The server did not return an upload URL.');
      await putToAzure(uploadUrl, String(ticket.contentType ?? file.type), file);
      return campaignOf(await adminApi.marketingImageConfirm(id, path));
    }),

  removeImage: (id: string): Promise<Campaign> =>
    guard(async () => campaignOf(await adminApi.removeMarketingImage(id))),

  remove: (id: string): Promise<void> =>
    guard(async () => {
      await adminApi.deleteMarketingCampaign(id);
    }),

  test: (id: string, to: string): Promise<void> =>
    guard(async () => {
      await adminApi.testMarketingCampaign(id, to);
    }),

  send: (id: string): Promise<Campaign> => guard(async () => campaignOf(await adminApi.sendMarketingCampaign(id))),
};
