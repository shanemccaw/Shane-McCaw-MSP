import React, { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import Home from "./pages/Home";
import Status from "./pages/Status";
import About from "./pages/About";
import Resources from "./pages/Resources";
import ArticlePage from "./pages/ArticlePage";
import Terms from "./pages/legal/Terms";
import Privacy from "./pages/legal/Privacy";
import Dpa from "./pages/legal/Dpa";
import NotFound from "./pages/not-found";
import Contact from "./pages/Contact";
import { trackPageview } from "./lib/analytics";
import { PersonalizationProvider } from "./hooks/PersonalizationProvider";

import Login from "./pages/Login";

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
      <Route path="/status" component={Status} />
      <Route path="/about" component={About} />
      <Route path="/resources" component={Resources} />
      <Route path="/resources/:slug" component={ArticlePage} />
      <Route path="/contact" component={Contact} />
      <Route path="/login" component={Login} />

      {/* Legal Routes */}
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
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