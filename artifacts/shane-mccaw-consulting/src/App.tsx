import React, { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import Home from "./pages/Home";
import Assessments from "./pages/Assessments";
import AssessmentDetail from "./pages/AssessmentDetail";
import Monitoring from "./pages/Monitoring";
import Status from "./pages/Status";
import About from "./pages/About";
import Contact from "./pages/Contact";
import Book from "./pages/Book";
import Checkout from "./pages/Checkout";
import HowItWorks from "./pages/HowItWorks";
import TechnicalOverview from "./pages/TechnicalOverview";
import Msp from "./pages/Msp";
import Resources from "./pages/Resources";
import ArticlePage from "./pages/ArticlePage";
import OnboardingLink from "./pages/OnboardingLink";
import Terms from "./pages/legal/Terms";
import Privacy from "./pages/legal/Privacy";
import MspPartnerTerms from "./pages/legal/MspPartnerTerms";
import Dpa from "./pages/legal/Dpa";
import NotFound from "./pages/not-found";
import { initTracker, trackPageview } from "./lib/analytics";
import { PersonalizationProvider } from "./hooks/usePersonalizationState";

// Stage 2 — real sitemap pages replacing Stage 1's StubPage placeholders (website-rebuild-reference-v2.md §7)
import Solutions from "./pages/Solutions";
import SolutionTopicPage from "./pages/solutions/SolutionTopicPage";
import GovernancePage from "./pages/solutions/GovernancePage";
import Products from "./pages/Products";
import TrustSecurity from "./pages/TrustSecurity";
import QuizHub from "./pages/QuizHub";
import Login from "./pages/Login";
import RetainersOverview from "./pages/retainers/RetainersOverview";
import ArchitectEssentials from "./pages/retainers/ArchitectEssentials";
import ArchitectGrowth from "./pages/retainers/ArchitectGrowth";
import ArchitectEnterprise from "./pages/retainers/ArchitectEnterprise";

// Legacy Quiz Pages
import CopilotQuiz from "./pages/CopilotQuiz";
import M365HealthQuiz from "./pages/quizzes/M365HealthQuiz";
import MigrationQuiz from "./pages/quizzes/MigrationQuiz";
import SecurityQuiz from "./pages/quizzes/SecurityQuiz";
import GovernanceQuiz from "./pages/quizzes/GovernanceQuiz";
import PowerPlatformQuiz from "./pages/quizzes/PowerPlatformQuiz";
import SharePointQuiz from "./pages/quizzes/SharePointQuiz";
import TeamsQuiz from "./pages/quizzes/TeamsQuiz";
import RetainerQuiz from "./pages/retainers/RetainerQuiz";
import RetainerQuizResults from "./pages/retainers/RetainerQuizResults";
import QuickWinQuiz from "./pages/QuickWinQuiz";
import QuickWinResultsPage from "./pages/QuickWinResultsPage";
import QuizResultsPage from "./pages/QuizResultsPage";

// Helper for Legacy Route Redirects
function RedirectToAssessments() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/assessments", { replace: true });
  }, [setLocation]);
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

// Fires once on mount (durable cookie session + global capture listeners) and on every
// route change (pageview + dwell/scroll flush of the previous page) — shared layout
// instrumentation per website-rebuild-reference-v2.md §4.
function AnalyticsBoundary() {
  const [location] = useLocation();

  useEffect(() => {
    initTracker();
  }, []);

  useEffect(() => {
    void trackPageview(location);
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
      <Route path="/assessments" component={Assessments} />
      <Route path="/assessments/all" component={Assessments} />
      <Route path="/assessments/start" component={Assessments} />
      <Route path="/assessments/premium" component={Assessments} />
      <Route path="/assessments/:slug" component={AssessmentDetail} />
      {/* Sitemap-canonical singular alias (website-rebuild-reference-v2.md §5) — same real page, no new content */}
      <Route path="/assessment" component={Assessments} />
      <Route path="/monitoring" component={Monitoring} />
      <Route path="/status" component={Status} />
      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />
      <Route path="/book" component={Book} />
      <Route path="/checkout/:slug" component={Checkout} />
      <Route path="/how-it-works" component={HowItWorks} />
      <Route path="/technical-overview" component={TechnicalOverview} />
      <Route path="/msp" component={Msp} />
      <Route path="/resources" component={Resources} />
      <Route path="/resources/:slug" component={ArticlePage} />
      <Route path="/onboarding" component={OnboardingLink} />

      {/* Stage 2 sitemap pages — real content, replacing Stage 1's StubPage skeleton (website-rebuild-reference-v2.md §5/§7) */}
      {/* Governance has its own dedicated Standard SaaS Section Structure page (8 sections,
          not the shared 4-section SolutionTopicPage template) — must be matched before the
          generic /solutions/:slug wildcard below, or wouter's Switch would never reach it. */}
      <Route path="/solutions/governance" component={GovernancePage} />
      <Route path="/solutions/:slug" component={SolutionTopicPage} />
      <Route path="/solutions" component={Solutions} />
      <Route path="/products" component={Products} />
      <Route path="/retainer" component={RetainersOverview} />
      <Route path="/retainers" component={RetainersOverview} />
      <Route path="/retainers/architect-essentials" component={ArchitectEssentials} />
      <Route path="/retainers/architect-growth" component={ArchitectGrowth} />
      <Route path="/retainers/architect-enterprise" component={ArchitectEnterprise} />
      <Route path="/trust-security" component={TrustSecurity} />
      <Route path="/quiz" component={QuizHub} />
      <Route path="/login" component={Login} />

      {/* Legal Routes */}
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/msp-terms" component={MspPartnerTerms} />
      <Route path="/dpa" component={Dpa} />

      {/* Decommissioned Routes -> Redirects to /assessments */}
      <Route path="/micro-offers" component={RedirectToAssessments} />

      {/* Quizzes & Lead Capture */}
      <Route path="/copilot-quiz" component={CopilotQuiz} />
      <Route path="/m365-health-quiz" component={M365HealthQuiz} />
      <Route path="/migration-quiz" component={MigrationQuiz} />
      <Route path="/security-quiz" component={SecurityQuiz} />
      <Route path="/governance-quiz" component={GovernanceQuiz} />
      <Route path="/power-platform-quiz" component={PowerPlatformQuiz} />
      <Route path="/sharepoint-quiz" component={SharePointQuiz} />
      <Route path="/teams-quiz" component={TeamsQuiz} />
      <Route path="/retainer-quiz" component={RetainerQuiz} />
      <Route path="/retainer-quiz-results" component={() => <RetainerQuizResults />} />
      <Route path="/quick-win-quiz" component={QuickWinQuiz} />
      <Route path="/quick-win-results" component={QuickWinResultsPage} />
      <Route path="/quiz-results" component={QuizResultsPage} />

      {/* 404 Fallback */}
      <Route component={NotFound} />
      </Switch>
    </PersonalizationProvider>
  );
}