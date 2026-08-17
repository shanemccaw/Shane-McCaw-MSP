import React, { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import Home from "./pages/Home";
import CopilotAssessmentLanding from "./pages/CopilotAssessmentLanding";
import Assessments from "./pages/Assessments";
import AssessmentDetail from "./pages/AssessmentDetail";
import Monitoring from "./pages/Monitoring";
import Status from "./pages/Status";
import Checkout from "./pages/Checkout";
import HowItWorks from "./pages/HowItWorks";
import TechnicalOverview from "./pages/TechnicalOverview";
import Resources from "./pages/Resources";
import ArticlePage from "./pages/ArticlePage";
import OnboardingLink from "./pages/OnboardingLink";
import Pricing from "./pages/Pricing";
import Terms from "./pages/legal/Terms";
import Privacy from "./pages/legal/Privacy";
import Dpa from "./pages/legal/Dpa";
import NotFound from "./pages/not-found";
import { trackPageview } from "./lib/analytics";
import { PersonalizationProvider } from "./hooks/PersonalizationProvider";

import Services from "./pages/Services";
import Microsoft365 from "./pages/services/Microsoft365";
import M365Training from "./pages/services/M365Training";
import SharePointService from "./pages/services/SharePoint";
import PowerPlatformService from "./pages/services/PowerPlatform";
import GovernanceService from "./pages/services/Governance";
import CloudMigration from "./pages/services/CloudMigration";
import SecurityHardening from "./pages/services/SecurityHardening";
import CopilotAI from "./pages/services/CopilotAI";

import Solutions from "./pages/Solutions";
import SolutionTopicPage from "./pages/solutions/SolutionTopicPage";
import Products from "./pages/Products";
import TrustSecurity from "./pages/TrustSecurity";
import QuizHub from "./pages/QuizHub";
import RetainersOverview from "./pages/retainers/RetainersOverview";
import ArchitectEssentials from "./pages/retainers/ArchitectEssentials";
import ArchitectGrowth from "./pages/retainers/ArchitectGrowth";
import ArchitectEnterprise from "./pages/retainers/ArchitectEnterprise";

import QuickWinQuiz from "./pages/QuickWinQuiz";
import QuickWinResultsPage from "./pages/QuickWinResultsPage";
import QuizResultsPage from "./pages/QuizResultsPage";

// Helper for Legacy Route Redirects.
function RedirectToHome() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/", { replace: true });
  }, [setLocation]);
  return null;
}

// /login used to render its own form here, but real client login lives in the genuinely
// separate msp-portal SPA. A wouter <Redirect> can't reach it (different app, different
// bundle) — this needs a full browser navigation.
function RedirectToPortalLogin() {
  useEffect(() => {
    window.location.replace("/portal/login");
  }, []);
  return null;
}

// wouter's client-side navigation doesn't reset scroll position — without this, navigating
// away from a page scrolled halfway down (e.g. an assessment CTA mid-article) lands the next
// page at that same scroll offset instead of the top. Takes over from the browser's native
// scroll restoration so a client-side route change and a real page reload don't fight over it.
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
    <PersonalizationProvider>
      <ScrollRestoration />
      <AnalyticsBoundary />
      <Switch>
      {/* Primary Routes */}
      <Route path="/" component={Home} />
      <Route path="/LP/copilot-assessment" component={CopilotAssessmentLanding} />
      <Route path="/assessments" component={Assessments} />
      <Route path="/assessments/all" component={Assessments} />
      <Route path="/assessments/start" component={Assessments} />
      <Route path="/assessments/premium" component={Assessments} />
      <Route path="/assessments/:slug" component={AssessmentDetail} />
      {/* Sitemap-canonical singular alias (website-rebuild-reference-v2.md §5) — same real page, no new content */}
      <Route path="/assessment" component={Assessments} />
      <Route path="/monitoring" component={Monitoring} />
      <Route path="/status" component={Status} />
      <Route path="/checkout/:slug" component={Checkout} />
      <Route path="/how-it-works" component={HowItWorks} />
      <Route path="/technical-overview" component={TechnicalOverview} />
      <Route path="/resources" component={Resources} />
      <Route path="/resources/:slug" component={ArticlePage} />
      <Route path="/onboarding" component={OnboardingLink} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/login" component={RedirectToPortalLogin} />

      {/* Services — restored verticals + overview */}
      <Route path="/services" component={Services} />
      <Route path="/services/microsoft-365" component={Microsoft365} />
      <Route path="/services/m365-training" component={M365Training} />
      <Route path="/services/sharepoint" component={SharePointService} />
      <Route path="/services/power-platform" component={PowerPlatformService} />
      <Route path="/services/governance" component={GovernanceService} />
      <Route path="/services/cloud-migration" component={CloudMigration} />
      <Route path="/services/security-hardening" component={SecurityHardening} />
      <Route path="/services/copilot-ai" component={CopilotAI} />

      {/* Sitemap pages */}
      <Route path="/projects/:slug" component={SolutionTopicPage} />
      <Route path="/projects" component={Solutions} />
      <Route path="/platform/quick-start" component={Products} />
      <Route path="/platform/retainer" component={RetainersOverview} />
      <Route path="/retainers/architect-essentials" component={ArchitectEssentials} />
      <Route path="/retainers/architect-growth" component={ArchitectGrowth} />
      <Route path="/retainers/architect-enterprise" component={ArchitectEnterprise} />
      <Route path="/trust-security" component={TrustSecurity} />
      <Route path="/quiz" component={QuizHub} />

      {/* Legal Routes */}
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/dpa" component={Dpa} />

      {/* Decommissioned Routes -> Redirects to / */}
      <Route path="/micro-offers" component={RedirectToHome} />

      {/* Quizzes & Lead Capture */}
      <Route path="/quick-win-quiz" component={QuickWinQuiz} />
      <Route path="/quick-win-results" component={QuickWinResultsPage} />
      <Route path="/quiz-results" component={QuizResultsPage} />

      {/* 404 Fallback */}
      <Route component={NotFound} />
      </Switch>
    </PersonalizationProvider>
  );
}