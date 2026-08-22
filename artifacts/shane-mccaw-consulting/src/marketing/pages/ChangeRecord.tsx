import { MarketingLayout, PageStub } from "../components/MarketingLayout";

// Route /records/:id — recreated from Quick-Start Change Record.dc.html.
// Part 0 scaffold: the shell is real, the body is a placeholder. Later parts replace the
// PageStub below with the real page content, keeping this file and its route wiring.
export default function ChangeRecord() {
  return (
    <MarketingLayout current="none">
      {/* Part 11 — Quick-Start Change Record.dc.html: real content replaces this PageStub. */}
      <PageStub title="Change Record" route="/records/:id" />
    </MarketingLayout>
  );
}
