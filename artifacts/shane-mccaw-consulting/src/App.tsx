import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { useEffect } from "react";
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
import Privacy from "@/pages/Privacy";
import ArticlePage from "@/pages/ArticlePage";

const queryClient = new QueryClient();

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function Router() {
  return (
    <>
      <ScrollToTop />
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
      <Route path="/micro-offers" component={MicroOffers} />
      <Route path="/pricing" component={Pricing} />
      <Route path="/resources" component={Resources} />
      <Route path="/resources/:slug" component={ArticlePage} />
      <Route path="/contact" component={Contact} />
      <Route path="/book" component={Book} />
      <Route path="/privacy" component={Privacy} />
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
