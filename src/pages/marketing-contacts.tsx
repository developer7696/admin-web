import { useRef, useState } from 'react';
import { AlertTriangle, FileSpreadsheet, Loader2, Trash2, Upload, Users } from 'lucide-react';
import { toast } from 'sonner';
import { ApiException } from '@/lib/api-client';
import { useCan } from '@/auth/auth-context';
import { readContactSheet, type SheetReadout } from '@/lib/contact-sheet';
import { fmtDateShort } from '@/lib/format';
import { useMarketingContacts, useMarketingMutation, useMarketingSummary } from '@/hooks/use-marketing';
import { marketingService } from '@/services/marketing-service';
import type { Contact } from '@/types/marketing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableWrap } from '@/components/ui/table';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { PageBar } from '@/components/common/page-header';
import { SearchInput } from '@/components/common/search-input';
import { EmptyState, ErrorState, LoadingState } from '@/components/common/states';

/**
 * The marketing mailing list. People get on it by spreadsheet upload; they
 * get off it by the unsubscribe link in every email, and an upload never
 * puts them back.
 */

const errorText = (e: unknown, fallback: string): string => (e instanceof ApiException ? e.message : fallback);

/// Settings the server still needs - shown on both marketing pages.
export function MarketingSetupBanner({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
      <p>
        Emails cannot be sent yet: the server is missing <code>{missing.join(', ')}</code>. You can still
        upload contacts and write campaigns.
      </p>
    </div>
  );
}

function ImportDialog({ file, readout, onClose }: { file: File; readout: SheetReadout; onClose: () => void }) {
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const upload = useMarketingMutation((rows: SheetReadout['contacts']) =>
    marketingService.importContacts(rows, setDone),
  );

  async function submit() {
    setError(null);
    try {
      const r = await upload.mutateAsync(readout.contacts);
      const parts = [`${r.added} added`, `${r.updated} updated`];
      if (r.stillUnsubscribed > 0) parts.push(`${r.stillUnsubscribed} already unsubscribed (left unsubscribed)`);
      toast.success(`Imported: ${parts.join(', ')}`);
      onClose();
    } catch (e) {
      setError(errorText(e, 'The upload failed part-way. Uploading the same file again is safe.'));
    }
  }

  const preview = readout.contacts.slice(0, 5);
  return (
    <Dialog open onOpenChange={(open) => !upload.isPending && !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import {file.name}</DialogTitle>
          <DialogDescription>
            Columns found: Email{readout.columns.name ? ', Name' : ''}
            {readout.columns.phone ? ', Phone' : ''}. Other columns are ignored.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border p-3">
              <p className="text-2xl font-semibold tabular-nums">{readout.contacts.length}</p>
              <p className="text-xs text-muted-foreground">to import</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-2xl font-semibold tabular-nums">{readout.invalid}</p>
              <p className="text-xs text-muted-foreground">invalid email (skipped)</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-2xl font-semibold tabular-nums">{readout.duplicates}</p>
              <p className="text-xs text-muted-foreground">repeated (merged)</p>
            </div>
          </div>
          {preview.length > 0 && (
            <TableWrap>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.map((c) => (
                    <TableRow key={c.email}>
                      <TableCell className="break-all">{c.email}</TableCell>
                      <TableCell>{c.name ?? '—'}</TableCell>
                      <TableCell>{c.phone ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          )}
          <p className="text-xs text-muted-foreground">
            Existing contacts get the sheet&apos;s name and phone. Anyone who unsubscribed stays unsubscribed.
          </p>
          {upload.isPending && (
            <p className="text-sm">
              Uploading… {done} of {readout.contacts.length}
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={upload.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={upload.isPending || readout.contacts.length === 0} onClick={() => void submit()}>
            {upload.isPending && <Loader2 className="animate-spin" />} Import {readout.contacts.length} contacts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MarketingContactsPage() {
  const canWrite = useCan('marketing:write');
  const summary = useMarketingSummary();
  const [search, setSearch] = useState('');
  const query = useMarketingContacts(search.trim().toLowerCase());
  const contacts = query.data?.pages.flatMap((p) => p.contacts) ?? [];
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState<{ file: File; readout: SheetReadout } | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const remove = useMarketingMutation((id: string) => marketingService.deleteContact(id));

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    try {
      const readout = await readContactSheet(file);
      if (readout.contacts.length === 0 && readout.invalid === 0) {
        toast.error('No email column found. Add a header row with an "Email" column.');
      } else {
        setImporting({ file, readout });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read the file.');
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const counts = summary.data?.contacts;
  return (
    <div className="scrollbar-thin h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-3">
        <PageBar
          title="Contacts"
          status={counts ? `${counts.subscribed} subscribed · ${counts.unsubscribed} unsubscribed` : undefined}
        >
          {canWrite && (
            <>
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                className="hidden"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <Button size="sm" disabled={reading} onClick={() => fileInput.current?.click()}>
                {reading ? <Loader2 className="animate-spin" /> : <Upload />} Upload sheet
              </Button>
            </>
          )}
        </PageBar>

        <MarketingSetupBanner missing={summary.data?.missingSetup ?? []} />

        <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <FileSpreadsheet className="mt-0.5 size-4 shrink-0" />
          <p>
            Upload an Excel (.xlsx) or CSV file with an <strong>Email</strong> column, and optionally{' '}
            <strong>Name</strong> and <strong>Phone</strong>. Uploading the same people again updates them.
            Only add people who agreed to hear from Aarambh.
          </p>
        </div>

        <SearchInput value={search} onChange={setSearch} placeholder="Search by email…" />

        {query.isLoading && <LoadingState label="Loading contacts…" />}
        {query.isError && (
          <ErrorState
            error={query.error}
            onRetry={() => {
              void query.refetch();
            }}
          />
        )}
        {query.isSuccess && contacts.length === 0 && (
          <EmptyState
            icon={<Users />}
            title={search ? 'No contact with that email' : 'No contacts yet'}
            hint={search ? undefined : 'Upload a spreadsheet to start your mailing list.'}
          />
        )}
        {contacts.length > 0 && (
          <TableWrap>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden md:table-cell">Added</TableHead>
                  {canWrite && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="break-all">{c.email}</TableCell>
                    <TableCell>{c.name ?? '—'}</TableCell>
                    <TableCell className="hidden sm:table-cell">{c.phone ?? '—'}</TableCell>
                    <TableCell>
                      {c.status === 'subscribed' ? (
                        <Badge variant="success">Subscribed</Badge>
                      ) : (
                        <Badge variant="outline">Unsubscribed</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {c.createdAt ? fmtDateShort(new Date(c.createdAt)) : '—'}
                    </TableCell>
                    {canWrite && (
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${c.email}`}
                          onClick={() => {
                            setDeleting(c);
                          }}
                        >
                          <Trash2 />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrap>
        )}
        {query.hasNextPage && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {query.isFetchingNextPage && <Loader2 className="animate-spin" />} Load more
            </Button>
          </div>
        )}
      </div>

      {importing && (
        <ImportDialog
          file={importing.file}
          readout={importing.readout}
          onClose={() => {
            setImporting(null);
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete ${deleting?.email ?? ''}?`}
        description={
          deleting?.status === 'unsubscribed'
            ? 'They unsubscribed. Deleting forgets that - a later upload would add them back as subscribed. Usually keep unsubscribed contacts.'
            : 'They are removed from the list. A later upload adds them back.'
        }
        confirmLabel="Delete contact"
        destructive
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await remove.mutateAsync(deleting.id);
            toast.success(`${deleting.email} deleted`);
          } catch (e) {
            toast.error(errorText(e, 'Could not delete the contact.'));
          }
        }}
      />
    </div>
  );
}
