import React, { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import Home from "./pages/Home";
import About from "./pages/About";
import Status from "./pages/Status";
import Resources from "./pages/Resources";
import ArticlePage from "./pages/ArticlePage";
import Terms from "./pages/legal/Terms";
import Privacy from "./pages/legal/Privacy";
import Dpa from "./pages/legal/Dpa";
import NotFound from "./pages/not-found";
import { trackPageview } from "./lib/analytics";
import { PersonalizationProvider } from "./hooks/PersonalizationProvider";

import Login from "./pages/Login";

import QuickWinQuiz from "./pages/QuickWinQuiz";
import QuickWinResultsPage from "./pages/QuickWinResultsPage";
import QuizResultsPage from "./pages/QuizResultsPage";

// Helper for Legacy Route Redirects. /assessments was unregistered in #382, so legacy
// entry points land on the home page rather than the 404 fallback.
function RedirectToHome() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/", { replace: true });
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
      <Route path="/about" component={About} />
      <Route path="/status" component={Status} />
      <Route path="/resources" component={Resources} />
      <Route path="/resources/:slug" component={ArticlePage} />
      <Route path="/login" component={Login} />

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