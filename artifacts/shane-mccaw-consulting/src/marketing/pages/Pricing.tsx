import { MarketingLayout, PageStub } from "../components/MarketingLayout";

// Route /pricing — recreated from Marketing Pricing.dc.html.
// Part 0 scaffold: the shell is real, the body is a placeholder. Later parts replace the
// PageStub below with the real page content, keeping this file and its route wiring.
export default function Pricing() {
  return (
    <MarketingLayout current="pricing">
      {/* Part 9 — Marketing Pricing.dc.html: real content replaces this PageStub. */}
      <PageStub title="Pricing" route="/pricing" />
    </MarketingLayout>
  );
}
