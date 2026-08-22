import { MarketingLayout, PageStub } from "../components/MarketingLayout";

// Route /quick-start — recreated from Marketing Quick-Start Packs.dc.html.
// Part 0 scaffold: the shell is real, the body is a placeholder. Later parts replace the
// PageStub below with the real page content, keeping this file and its route wiring.
export default function QuickStart() {
  return (
    <MarketingLayout current="quickstart">
      {/* Part 7 — Marketing Quick-Start Packs.dc.html: real content replaces this PageStub. */}
      <PageStub title="Quick-Start Packs" route="/quick-start" />
    </MarketingLayout>
  );
}
