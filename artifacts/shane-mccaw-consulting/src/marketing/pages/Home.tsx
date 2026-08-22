import { MarketingLayout, PageStub } from "../components/MarketingLayout";

// Route / — recreated from Marketing Home.dc.html.
// Part 0 scaffold: the shell is real, the body is a placeholder. Later parts replace the
// PageStub below with the real page content, keeping this file and its route wiring.
export default function Home() {
  return (
    <MarketingLayout current="home">
      {/* Part 1 — Marketing Home.dc.html: real content replaces this PageStub. */}
      <PageStub title="Home" route="/" />
    </MarketingLayout>
  );
}
