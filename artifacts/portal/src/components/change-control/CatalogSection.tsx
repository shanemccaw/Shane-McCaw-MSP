/**
 * "Standard changes you can run" — the pre-approved catalogue (#1498).
 * Executing one still raises a real, auto-approved change request; the item
 * itself is revoked/approved state, checked live on every run (#1555).
 */
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useChangeCatalog, useExecuteCatalogItem } from "@/lib/change-control-api";
import { toast } from "sonner";

export function CatalogSection() {
  const { data, isLoading, isError } = useChangeCatalog(true);
  const executeMutation = useExecuteCatalogItem();

  if (isLoading) return null;
  if (isError) {
    return <p className="text-[11.5px] text-destructive">Could not load the standard change catalogue.</p>;
  }
  if (!data) return null;

  return (
    <div className="flex flex-col gap-2.5" data-testid="change-control-catalog">
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="text-[13.5px] font-semibold text-foreground">Standard changes you can run</span>
        <span className="text-[11px] text-muted-foreground">
          pre-approved catalogue items · running one still produces a real, auto-approved change request
        </span>
      </div>
      {data.items.length === 0 ? (
        <p className="text-[11.5px] text-muted-foreground">
          {data.scoped ? "Your MSP has not published any pre-approved standard changes yet." : "No tenant resolved — nothing to show."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-2 pt-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-foreground">{item.title}</span>
                  <Badge variant="outline" className="ml-auto border-status-green/35 text-status-green">
                    PRE-APPROVED
                  </Badge>
                </div>
                <span className="text-[11.5px] leading-relaxed text-muted-foreground">{item.description}</span>
                <span className="text-[11px] text-muted-foreground/80">
                  {item.category} · no human approval stage · revocable
                  {item.approvedByName ? ` · approved by ${item.approvedByName}` : ""}
                </span>
                <Button
                  size="sm"
                  className="mt-1 w-fit"
                  disabled={executeMutation.isPending}
                  onClick={() =>
                    executeMutation.mutate(item.id, {
                      onSuccess: (res) => toast.success(`${res.code} raised — auto-approved change request.`),
                      onError: (e) => toast.error((e as Error).message),
                    })
                  }
                >
                  {executeMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Run it — raises an auto-approved change
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <span className="text-[10.5px] leading-relaxed text-muted-foreground/70">
        A standard change needs no human approval stage: the ledger records one inherited approval,
        whose approver is the real party that catalogued it, never &ldquo;the system&rdquo;. One gap
        is on record: running a catalogue item currently skips the freeze, maintenance-window and
        collision checks an ordinary change goes through (#3044), so until that is fixed a standard
        change can run inside a freeze.
      </span>
    </div>
  );
}
