import React, { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import Home from "./pages/Home";
import Assessments from "./pages/Assessments";
import AssessmentDetail from "./pages/AssessmentDetail";
import Services from "./pages/Services";
import Projects from "./pages/Projects";
import Monitoring from "./pages/Monitoring";
import Pricing from "./pages/Pricing";
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
import NotFound from "./pages/not-found";
import StubPage from "./pages/StubPage";
import { initTracker, trackPageview } from "./lib/analytics";

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

// Solutions / Topic pages — mirrors the 8 existing quiz categories (website-rebuild-reference-v2.md §5).
// Stage 1: routes resolve to placeholders; real per-topic personalization content is Stage 2/4.
const SOLUTIONS_TOPICS: { slug: string; title: string }[] = [
  { slug: "copilot", title: "Copilot & AI" },
  { slug: "security-compliance", title: "Security & Compliance" },
  { slug: "governance", title: "Governance" },
  { slug: "sharepoint", title: "SharePoint" },
  { slug: "power-platform", title: "Power Platform" },
  { slug: "teams", title: "Teams" },
  { slug: "migration", title: "Migration" },
  { slug: "m365-health", title: "M365 Health" },
];

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
    <>
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
      <Route path="/services" component={Services} />
      <Route path="/projects" component={Projects} />
      <Route path="/monitoring" component={Monitoring} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/about" component={About} />
      <Route path="/contact" component={Contact} />
      <Route path="/book" component={Book} />
      <Route path="/checkout" component={Checkout} />
      <Route path="/how-it-works" component={HowItWorks} />
      <Route path="/technical-overview" component={TechnicalOverview} />
      <Route path="/msp" component={Msp} />
      <Route path="/resources" component={Resources} />
      <Route path="/resources/:slug" component={ArticlePage} />
      <Route path="/onboarding" component={OnboardingLink} />

      {/* New sitemap pages — Stage 1 routing skeleton, placeholder content (website-rebuild-reference-v2.md §5/§7) */}
      {SOLUTIONS_TOPICS.map((t) => (
        <Route key={t.slug} path={`/solutions/${t.slug}`} component={() => <StubPage title={t.title} />} />
      ))}
      <Route path="/solutions" component={() => <StubPage title="Solutions" />} />
      <Route path="/products" component={() => <StubPage title="Quick-Start Packs" />} />
      <Route path="/retainer" component={() => <StubPage title="Fractional Consulting" />} />
      <Route path="/trust-security" component={() => <StubPage title="Trust & Security" />} />
      <Route path="/quiz" component={() => <StubPage title="Free Assessment Quiz" />} />
      <Route path="/login" component={() => <StubPage title="Client Login" />} />

      {/* Legal Routes */}
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />

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
    </>
  );
}