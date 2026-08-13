/**
 * Message Center — Microsoft 365 Message Center posts
 *
 * Read-only view of Graph service announcement posts (product updates,
 * plan-for-change, prevent-or-fix-issues) synced daily across every
 * consented tenant in the caller's MSP. Operational awareness for MSP
 * staff — not customer-facing.
 */

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Megaphone, ChevronRight, ChevronLeft, ChevronDown, ChevronUp } from "lucide-react";

interface MessageCenterItem {
  id: number;
  tenantId: string;
  customerId: number | null;
  graphMessageId: string;
  title: string;
  category: string | null;
  severity: string | null;
  isMajorChange: boolean;
  services: string[];
  bodyContentType: string | null;
  bodyContent: string | null;
  startDateTime: string | null;
  actionRequiredByDateTime: string | null;
  lastModifiedDateTime: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  planForChange: "Plan for Change",
  stayInformed: "Stay Informed",
  preventOrFixIssues: "Prevent or Fix Issues",
};

const PAGE_SIZE = 25;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export default function MessageCenterPage() {
  const { fetchWithAuth } = useAuth();

  const [items, setItems] = useState<MessageCenterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));

      const res = await fetchWithAuth(`/api/msp/message-center?${params.toString()}`);
      if (!res.ok) {
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items: MessageCenterItem[] };
      setItems(data.items || []);
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, category, offset]);

  useEffect(() => { void fetchItems(); }, [fetchItems]);

  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))) as string[];

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Megaphone className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Message Center</h1>
            <p className="text-sm text-muted-foreground">
              Microsoft 365 Message Center posts across every consented tenant in your book —
              synced daily.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Select
            value={category}
            onValueChange={(v) => { setCategory(v); setOffset(0); }}
          >
            <SelectTrigger className="w-[220px]"><SelectValue placeholder="Category" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {loading ? "Loading…" : `${items.length} item${items.length === 1 ? "" : "s"}`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
            ) : items.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No Message Center posts synced yet.
              </div>
            ) : (
              items.map((item) => {
                const expanded = expandedId === item.id;
                return (
                  <div key={item.id} className="rounded-md border p-3">
                    <button
                      type="button"
                      className="flex items-center justify-between gap-4 w-full text-left"
                      onClick={() => setExpandedId(expanded ? null : item.id)}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <Megaphone className="h-4 w-4 mt-1 flex-shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {item.isMajorChange && (
                              <Badge className="bg-amber-500/15 text-amber-400">Major Change</Badge>
                            )}
                            {item.category && (
                              <Badge variant="outline">{CATEGORY_LABELS[item.category] ?? item.category}</Badge>
                            )}
                            <span className="font-medium truncate">{item.title}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {item.services.join(", ") || "All services"} ·{" "}
                            {new Date(item.lastModifiedDateTime).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      {expanded ? <ChevronUp className="h-4 w-4 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 flex-shrink-0" />}
                    </button>
                    {expanded && item.bodyContent && (
                      <div className="mt-3 pl-7 text-sm text-muted-foreground whitespace-pre-wrap">
                        {item.bodyContentType === "Html" ? stripHtml(item.bodyContent) : item.bodyContent}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous
          </Button>
          <span className="text-sm text-muted-foreground">
            {offset + 1}–{offset + items.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={items.length < PAGE_SIZE}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Next <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
