import { Link, useSearch } from "wouter";
import { Construction } from "lucide-react";

/**
 * Honest landing for a destination that hasn't shipped yet under #1485 (Git
 * #1827). Every customer-tenant alert rule's deep_link_path still points at
 * a portal-v2 page that was deleted wholesale under #1673; the api-server's
 * resolvePortalDeepLink() (portal-deep-links.ts) sends those clicks here
 * instead of at a dead /portal-v2/* URL, carrying the destination's real
 * label via ?feature=. This is not a stand-in for the destination page —
 * it's the honest "not built yet, here's what you clicked" state so the
 * click is never dead and the notification is never hidden.
 */
export default function ComingSoon() {
  const search = useSearch();
  const feature = new URLSearchParams(search).get("feature") || "This page";

  return (
    <div className="py-24 text-center">
      <Construction className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-foreground">
        {feature} isn't built yet
      </h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        This part of the portal is being rebuilt. Check back soon, or reach out to your
        Shane McCaw Consulting contact if you need this now.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block text-sm font-medium text-foreground underline underline-offset-4"
      >
        Back to portal
      </Link>
    </div>
  );
}
