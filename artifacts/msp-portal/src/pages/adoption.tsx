import React, { useState } from 'react';
import { 
  TimeFrame, 
  Department, 
  Opportunity, 
  AutomationAction 
} from './types';
import { 
  INITIAL_HEATMAP_DATA, 
  COLLABORATION_TREND_DATA, 
  COPILOT_USAGE_DATA, 
  TOP_OPPORTUNITIES, 
  AUTOMATION_ACTIONS 
} from './data/mockData';

import { Header } from './components/Header';
import { HeroBand } from './components/HeroBand';
import { TeamsHeatMap } from './components/TeamsHeatMap';
import { CollaborationTrend } from './components/CollaborationTrend';
import { EmailProductivity } from './components/EmailProductivity';
import { CopilotUsage } from './components/CopilotUsage';
import { TopOpportunities } from './components/TopOpportunities';
import { AutomationPotential } from './components/AutomationPotential';
import { ActionModal } from './components/ActionModal';
import { NotificationToast, ToastMessage } from './components/NotificationToast';

export default function App() {
  const [timeframe, setTimeframe] = useState<TimeFrame>('30d');
  const [selectedDepartment, setSelectedDepartment] = useState<Department>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedModalItem, setSelectedModalItem] = useState<Opportunity | AutomationAction | null>(null);
  const [activeExecutingActionId, setActiveExecutingActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Timeframe scaled metric overrides
  const getMetrics = () => {
    switch (timeframe) {
      case '7d':
        return {
          score: 65,
          scoreChange: '+1.8% from last week',
          teamsUsers: 11890,
          sharepointSites: 812,
          copilotUsers: 1020,
          emailScore: 82,
          sent: 1120,
          received: 2240,
          unread: 380,
          inactiveSites: 18,
          lowCollab: 64,
          highCollab: 712,
        };
      case '90d':
        return {
          score: 59,
          scoreChange: '+8.5% from last quarter',
          teamsUsers: 13150,
          sharepointSites: 890,
          copilotUsers: 1280,
          emailScore: 74,
          sent: 12840,
          received: 24300,
          unread: 3950,
          inactiveSites: 68,
          lowCollab: 195,
          highCollab: 580,
        };
      case '30d':
      default:
        return {
          score: 62,
          scoreChange: '+4.2% from last month',
          teamsUsers: 12402,
          sharepointSites: 842,
          copilotUsers: 1105,
          emailScore: 78,
          sent: 4203,
          received: 8110,
          unread: 1452,
          inactiveSites: 42,
          lowCollab: 128,
          highCollab: 672,
        };
    }
  };

  const currentMetrics = getMetrics();

  // Filtered opportunities by search or department
  const filteredOpportunities = TOP_OPPORTUNITIES.filter((opp) => {
    const matchesSearch = 
      opp.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      opp.severity.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (opp.department && opp.department.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesDept = 
      selectedDepartment === 'All' || 
      !opp.department || 
      opp.department.toLowerCase().includes(selectedDepartment.toLowerCase()) ||
      opp.department.includes('All');

    return matchesSearch && matchesDept;
  });

  // Handlers
  const handleRefreshData = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setToast({
        id: Date.now().toString(),
        type: 'info',
        title: 'Tenant Telemetry Synchronized',
        message: 'Successfully polled latest Microsoft Graph API adoption events across 12,402 active users.'
      });
    }, 1000);
  };

  const handleExportReport = () => {
    // Generate simple CSV download for user
    const csvContent = "data:text/csv;charset=utf-8," 
      + "Metric,Value,Timeframe\n"
      + `Adoption Health Score,${currentMetrics.score},${timeframe}\n`
      + `Active Teams Users,${currentMetrics.teamsUsers},${timeframe}\n`
      + `Active SharePoint Sites,${currentMetrics.sharepointSites},${timeframe}\n`
      + `Copilot Active Users,${currentMetrics.copilotUsers},${timeframe}\n`
      + `Email Productivity Score,${currentMetrics.emailScore},${timeframe}\n`;
      
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Adoption_Intelligence_Report_${timeframe}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setToast({
      id: Date.now().toString(),
      type: 'success',
      title: 'Report Downloaded',
      message: `Exported Adoption_Intelligence_Report_${timeframe}.csv to your local downloads.`
    });
  };

  const handleTriggerAutomation = (action: AutomationAction) => {
    setActiveExecutingActionId(action.id);
    setTimeout(() => {
      setActiveExecutingActionId(null);
      setToast({
        id: Date.now().toString(),
        type: 'success',
        title: `${action.title} Executed`,
        message: action.successMessage
      });
    }, 800);
  };

  const handleModalConfirm = (item: Opportunity | AutomationAction) => {
    setToast({
      id: Date.now().toString(),
      type: 'success',
      title: 'Remediation Command Dispatched',
      message: `Action confirmed for "${item.title}". Microsoft 365 workflow initiated.`
    });
  };

  return (
    <div className="grid-overlay min-h-screen p-4 sm:p-6 lg:p-8 font-body">
      <main className="max-w-[1440px] mx-auto space-y-6">
        {/* Header */}
        <Header
          timeframe={timeframe}
          setTimeframe={setTimeframe}
          selectedDepartment={selectedDepartment}
          setSelectedDepartment={setSelectedDepartment}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onRefreshData={handleRefreshData}
          onExportReport={handleExportReport}
          isRefreshing={isRefreshing}
        />

        {/* SECTION 1: HERO BAND */}
        <HeroBand
          score={currentMetrics.score}
          scoreChange={currentMetrics.scoreChange}
          teamsUsers={currentMetrics.teamsUsers}
          sharepointSites={currentMetrics.sharepointSites}
          copilotUsers={currentMetrics.copilotUsers}
        />

        {/* SECTION 2 & 3: HEAT MAP & COLLABORATION TREND */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <TeamsHeatMap
            data={INITIAL_HEATMAP_DATA}
            selectedDepartment={selectedDepartment}
            onSelectDepartment={setSelectedDepartment}
          />

          <CollaborationTrend
            data={COLLABORATION_TREND_DATA}
            inactiveSites={currentMetrics.inactiveSites}
            lowCollabSites={currentMetrics.lowCollab}
            highCollabSites={currentMetrics.highCollab}
          />
        </div>

        {/* SECTION 4 & 5: EMAIL PRODUCTIVITY & COPILOT USAGE */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          <div className="lg:col-span-5">
            <EmailProductivity
              score={currentMetrics.emailScore}
              sentMessages={currentMetrics.sent}
              receivedMessages={currentMetrics.received}
              unreadBacklog={currentMetrics.unread}
            />
          </div>

          <div className="lg:col-span-7">
            <CopilotUsage data={COPILOT_USAGE_DATA} />
          </div>
        </div>

        {/* SECTION 6: TOP 5 OPPORTUNITIES */}
        <TopOpportunities
          opportunities={filteredOpportunities}
          onSelectOpportunity={(opp) => setSelectedModalItem(opp)}
        />

        {/* SECTION 7: AUTOMATION POTENTIAL */}
        <AutomationPotential
          actions={AUTOMATION_ACTIONS}
          onTriggerAction={(action) => handleTriggerAutomation(action)}
          activeActionId={activeExecutingActionId}
        />
      </main>

      {/* Action Detail Modal */}
      <ActionModal
        isOpen={!!selectedModalItem}
        onClose={() => setSelectedModalItem(null)}
        item={selectedModalItem}
        onConfirm={handleModalConfirm}
      />

      {/* Toast Feedback */}
      <NotificationToast
        toast={toast}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
