import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { trackPageview } from "./lib/analytics";

// New marketing site — a full replacement of the previous shane-mccaw-consulting pages, built from
// Design/design_handoff_marketing/ (dark slate canvas, Electric Blue / Bright Teal accents, Inter).
// Do not blend with the old look — this replaces it. Pages are built in parts per
// Design/design_handoff_marketing/MARKETING_PARALLEL_PLAN.md; Part 0 wires every route below to a
// real (stub) page rendered inside the shared Nav/Footer shell, so later parts can build each page
// in parallel without colliding. The old pages/components still live under src/ but are no longer
// routed (unbundled), pending a later cleanup pass.
import Home from "./marketing/pages/Home";
import FreeScan from "./marketing/pages/FreeScan";
import SolutionsIndex from "./marketing/pages/SolutionsIndex";
import Monitoring from "./marketing/pages/Monitoring";
import QuickStart from "./marketing/pages/QuickStart";
import Retainers from "./marketing/pages/Retainers";
import Pricing from "./marketing/pages/Pricing";
import Buy from "./marketing/pages/Buy";
import ChangeRecord from "./marketing/pages/ChangeRecord";

import PillarGovernance from "./marketing/pages/pillars/Governance";
import PillarSecurity from "./marketing/pages/pillars/Security";
import PillarCompliance from "./marketing/pages/pillars/Compliance";
import PillarLicensing from "./marketing/pages/pillars/Licensing";
import PillarAdoption from "./marketing/pages/pillars/Adoption";
import PillarHealth from "./marketing/pages/pillars/Health";

import SolutionCopilot from "./marketing/pages/solutions/Copilot";
import SolutionGovernance from "./marketing/pages/solutions/Governance";
import SolutionSharePoint from "./marketing/pages/solutions/SharePoint";
import SolutionPowerPlatform from "./marketing/pages/solutions/PowerPlatform";
import SolutionTeams from "./marketing/pages/solutions/Teams";
import SolutionMigration from "./marketing/pages/solutions/Migration";
import SolutionM365Health from "./marketing/pages/solutions/M365Health";

import NotFound from "./marketing/pages/NotFound";

// Infrastructure (not marketing content): /login used to render its own form here, but real client
// login lives in the genuinely separate msp-portal SPA. A wouter <Redirect> can't reach it
// (different app, different bundle) — this needs a full browser navigation.
function RedirectToPortalLogin() {
  useEffect(() => {
    window.location.replace("/portal/login");
  }, []);
  return null;
}

// wouter's client-side navigation doesn't reset scroll position — without this, a client-side route
// change lands the next page at the previous scroll offset. Takes over the browser's native scroll
// restoration so an SPA route change and a real reload don't fight over it.
function ScrollRestoration() {
  const [location] = useLocation();

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  return null;
}

// Forwards every SPA route change to GA4 as a page_view event.
function AnalyticsBoundary() {
  const [location] = useLocation();

  useEffect(() => {
    trackPageview(location);
  }, [location]);

  return null;
}

export default function App() {
  return (
    <>
      <ScrollRestoration />
      <AnalyticsBoundary />
      <Switch>
        {/* Infrastructure redirect — marketing domain /login goes to the portal SPA */}
        <Route path="/login" component={RedirectToPortalLogin} />

        {/* Entry and core */}
        <Route path="/" component={Home} />
        <Route path="/scan" component={FreeScan} />
        <Route path="/solutions" component={SolutionsIndex} />

        {/* The six pillars */}
        <Route path="/pillars/governance" component={PillarGovernance} />
        <Route path="/pillars/security" component={PillarSecurity} />
        <Route path="/pillars/compliance" component={PillarCompliance} />
        <Route path="/pillars/licensing" component={PillarLicensing} />
        <Route path="/pillars/adoption" component={PillarAdoption} />
        <Route path="/pillars/health" component={PillarHealth} />

        {/* The seven workload deep-dives */}
        <Route path="/solutions/copilot" component={SolutionCopilot} />
        <Route path="/solutions/governance" component={SolutionGovernance} />
        <Route path="/solutions/sharepoint" component={SolutionSharePoint} />
        <Route path="/solutions/power-platform" component={SolutionPowerPlatform} />
        <Route path="/solutions/teams" component={SolutionTeams} />
        <Route path="/solutions/migration" component={SolutionMigration} />
        <Route path="/solutions/m365-health" component={SolutionM365Health} />

        {/* Offerings */}
        <Route path="/monitoring" component={Monitoring} />
        <Route path="/quick-start" component={QuickStart} />
        <Route path="/retainers" component={Retainers} />
        <Route path="/pricing" component={Pricing} />

        {/* Checkout and post-purchase */}
        <Route path="/buy" component={Buy} />
        <Route path="/records/:id" component={ChangeRecord} />

        {/* ═══════════════════════════════════════════════════════════════════
            MARKETING ROUTE INSERTION POINT — ADD NEW MARKETING ROUTES ABOVE.

            Every route above already renders a real page (a Part-0 stub inside
            the shared Nav/Footer shell until its Part fills the body in). Later
            parts of MARKETING_PARALLEL_PLAN.md build into the page component
            each route already points to — they do NOT touch this file except to
            add a genuinely new route, which goes ABOVE this marker so the
            NotFound fallback below always stays last.

            Do NOT route Marketing Checkout.dc.html — it is reference-only,
            superseded by Marketing Buy (/buy above).

            This marker exists so the parts of the marketing build running as
            concurrent agents all append at ONE known line instead of each
            choosing its own and conflicting.
            ═══════════════════════════════════════════════════════════════════ */}

        {/* 404 fallback */}
        <Route component={NotFound} />
      </Switch>
    </>
  );
}
