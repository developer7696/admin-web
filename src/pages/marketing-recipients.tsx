import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useCampaignSends } from "@/hooks/use-marketing";
import {
  TRANSPORT_NAMES,
  type Campaign,
  type SendRecord,
} from "@/types/marketing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrap,
} from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/common/states";

/**
 * Everyone a campaign tried to email: whether it went, which service carried
 * it, and the error when it did not. Filter, search, and download as CSV.
 */

type Filter = "all" | "sent" | "failed";

/// Rows drawn at once; the CSV always has them all.
const SHOWN = 500;

const fmtAt = (at: string | null): string =>
  at
    ? new Date(at).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

const via = (r: SendRecord): string => (r.via ? TRANSPORT_NAMES[r.via] : "—");

const csvCell = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const downloadCsv = (campaign: Campaign, list: SendRecord[]): void => {
  const lines = [
    ["email", "status", "service", "time", "error", "message id"].join(","),
    ...list.map((r) =>
      [
        r.email,
        r.status,
        r.via ?? "",
        r.at ?? "",
        r.error ?? "",
        r.messageId ?? "",
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  const url = URL.createObjectURL(
    new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `recipients-${(campaign.subject || campaign.id).replace(/[^\w-]+/g, "-").slice(0, 40)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

export function RecipientsDialog({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  const query = useCampaignSends(campaign);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const all = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => {
    const byVia = new Map<string, number>();
    for (const r of all)
      if (r.status === "sent") byVia.set(via(r), (byVia.get(via(r)) ?? 0) + 1);
    return {
      sent: all.filter((r) => r.status === "sent").length,
      failed: all.filter((r) => r.status === "failed").length,
      byVia: [...byVia.entries()],
    };
  }, [all]);
  const list = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (filter === "all" || r.status === filter) &&
        (!term || r.email.includes(term)),
    );
  }, [all, filter, search]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Recipients</DialogTitle>
          <DialogDescription>
            {campaign.subject || "(no subject)"} — {counts.sent} sent ·{" "}
            {counts.failed} failed
            {counts.byVia.length > 0 &&
              ` (${counts.byVia.map(([name, n]) => `${String(n)} via ${name}`).join(", ")})`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "sent", "failed"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => {
                  setFilter(f);
                }}
              >
                {f === "all"
                  ? `All (${String(all.length)})`
                  : f === "sent"
                    ? `Sent (${String(counts.sent)})`
                    : `Failed (${String(counts.failed)})`}
              </Button>
            ))}
            <Input
              className="h-8 max-w-xs"
              placeholder="Search email"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
            />
          </div>

          {query.isLoading && <LoadingState label="Loading recipients…" />}
          {query.isError && (
            <ErrorState
              error={query.error}
              onRetry={() => {
                void query.refetch();
              }}
            />
          )}
          {query.isSuccess && list.length === 0 && (
            <EmptyState
              title={
                all.length === 0 ? "Nobody emailed yet" : "No recipients match"
              }
            />
          )}
          {list.length > 0 && (
            <TableWrap className="max-h-[55vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.slice(0, SHOWN).map((r) => (
                    <TableRow key={r.contactId}>
                      <TableCell className="font-mono text-xs">
                        {r.email}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === "sent" ? "success" : "destructive"
                          }
                        >
                          {r.status === "sent" ? "Sent" : "Failed"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">{via(r)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {fmtAt(r.at)}
                      </TableCell>
                      <TableCell
                        className="max-w-xs truncate text-xs text-red-600"
                        title={r.error ?? ""}
                      >
                        {r.error ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrap>
          )}
          {list.length > SHOWN && (
            <p className="text-xs text-muted-foreground">
              Showing the first {SHOWN} of {list.length}. Search, or download
              the CSV for all of them.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            disabled={list.length === 0}
            onClick={() => {
              downloadCsv(campaign, list);
            }}
          >
            <Download /> Download CSV
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
