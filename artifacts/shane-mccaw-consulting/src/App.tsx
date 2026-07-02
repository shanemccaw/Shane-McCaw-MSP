import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect, useRef } from "react";
import { initTracker, trackPageview } from "@/lib/analytics";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import About from "@/pages/About";
import Services from "@/pages/Services";
import MicroOffers from "@/pages/MicroOffers";
import Pricing from "@/pages/Pricing";
import Resources from "@/pages/Resources";
import Contact from "@/pages/Contact";
import Book from "@/pages/Book";
import Microsoft365 from "@/pages/services/Microsoft365";
import CopilotAI from "@/pages/services/CopilotAI";
import SharePoint from "@/pages/services/SharePoint";
import PowerPlatform from "@/pages/services/PowerPlatform";
import Governance from "@/pages/services/Governance";
import CloudMigration from "@/pages/services/CloudMigration";
import M365Training from "@/pages/services/M365Training";
import SecurityHardening from "@/pages/services/SecurityHardening";
import Privacy from "@/pages/Privacy";
import ArticlePage from "@/pages/ArticlePage";
import Admin from "@/pages/Admin";
import CustomerCommandCenter from "@/pages/CustomerCommandCenter";
import CopilotQuiz from "@/pages/CopilotQuiz";
import M365HealthQuiz from "@/pages/quizzes/M365HealthQuiz";
import SharePointQuiz from "@/pages/quizzes/SharePointQuiz";
import PowerPlatformQuiz from "@/pages/quizzes/PowerPlatformQuiz";
import SecurityQuiz from "@/pages/quizzes/SecurityQuiz";
import TeamsQuiz from "@/pages/quizzes/TeamsQuiz";
import MigrationQuiz from "@/pages/quizzes/MigrationQuiz";
import GovernanceQuiz from "@/pages/quizzes/GovernanceQuiz";
import QuizResultsPage from "@/pages/QuizResultsPage";
import ArchitectEssentials from "@/pages/retainers/ArchitectEssentials";
import ArchitectGrowth from "@/pages/retainers/ArchitectGrowth";
import ArchitectEnterprise from "@/pages/retainers/ArchitectEnterprise";
import RetainersOverview from "@/pages/retainers/RetainersOverview";
import RetainerQuiz from "@/pages/retainers/RetainerQuiz";
import MicroOfferDetail from "@/pages/micro-offers/MicroOfferDetail";
import QuickWinQuiz from "@/pages/QuickWinQuiz";
import QuickWinResultsPage from "@/pages/QuickWinResultsPage";
import HowItWorks from "@/pages/HowItWorks";
import TechnicalOverview from "@/pages/TechnicalOverview";
import LandingPage from "@/pages/LandingPage";

const queryClient = new QueryClient();

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo(0, 0);
    }
  }, [location]);
  return null;
}

function AnalyticsTracker() {
  const [location] = useLocation();
  const initialized = useRef(false);
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      initTracker();
    }
  }, []);
  useEffect(() => {
    void trackPageview(location);
  }, [location]);
  return null;
}

function Router() {
  return (
    <>
      <ScrollToTop />
      <AnalyticsTracker />
      <Switch>
      <Route path="/" component={Home} />
      <Route path="/about" component={About} />
      <Route path="/services" component={Services} />
      <Route path="/services/microsoft-365" component={Microsoft365} />
      <Route path="/services/copilot-ai" component={CopilotAI} />
      <Route path="/services/sharepoint" component={SharePoint} />
      <Route path="/services/power-platform" component={PowerPlatform} />
      <Route path="/services/governance" component={Governance} />
      <Route path="/services/cloud-migration" component={CloudMigration} />
      <Route path="/services/m365-training" component={M365Training} />
      <Route path="/services/security-hardening" component={SecurityHardening} />
      <Route path="/micro-offers" component={MicroOffers} />
      <Route path="/micro-offers/:slug" component={MicroOfferDetail} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/resources" component={Resources} />
      <Route path="/resources/:slug" component={ArticlePage} />
      <Route path="/contact" component={Contact} />
      <Route path="/book" component={Book} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/admin" component={Admin} />
      <Route path="/customer-command-center" component={CustomerCommandCenter} />
      <Route path="/copilot-quiz" component={CopilotQuiz} />
      <Route path="/m365-health-quiz" component={M365HealthQuiz} />
      <Route path="/sharepoint-readiness-quiz" component={SharePointQuiz} />
      <Route path="/power-platform-quiz" component={PowerPlatformQuiz} />
      <Route path="/security-compliance-quiz" component={SecurityQuiz} />
      <Route path="/teams-maturity-quiz" component={TeamsQuiz} />
      <Route path="/migration-readiness-quiz" component={MigrationQuiz} />
      <Route path="/governance-maturity-quiz" component={GovernanceQuiz} />
      <Route path="/quiz/results/:leadId" component={QuizResultsPage} />
      <Route path="/retainers" component={RetainersOverview} />
      <Route path="/quick-win-quiz" component={QuickWinQuiz} />
      <Route path="/quick-win/results/:resultId" component={QuickWinResultsPage} />
      <Route path="/retainer-quiz" component={RetainerQuiz} />
      <Route path="/retainers/architect-essentials" component={ArchitectEssentials} />
      <Route path="/retainers/architect-growth" component={ArchitectGrowth} />
      <Route path="/retainers/architect-enterprise" component={ArchitectEnterprise} />
      <Route path="/how-it-works/technical" component={TechnicalOverview} />
      <Route path="/how-it-works" component={HowItWorks} />
      <Route path="/lp/:slug" component={LandingPage} />
      <Route component={NotFound} />
    </Switch>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
