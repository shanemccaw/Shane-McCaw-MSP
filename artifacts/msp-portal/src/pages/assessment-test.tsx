import React, { useState } from 'react';
import { AppShell } from '@/components/app-shell';
import { AssessmentHero } from '@/components/assessment-test/AssessmentHero';
import { ScoreGaugeGrid } from '@/components/assessment-test/ScoreGaugeGrid';
import { TelemetryBriefing } from '@/components/assessment-test/TelemetryBriefing';
import { AssessmentPipeline } from '@/components/assessment-test/AssessmentPipeline';
import { SneakPeekInsights } from '@/components/assessment-test/SneakPeekInsights';
import { TelemetryDetailModal } from '@/components/assessment-test/TelemetryDetailModal';
import { MetricGaugeModal } from '@/components/assessment-test/MetricGaugeModal';
import { ExportReportModal } from '@/components/assessment-test/ExportReportModal';
import { PipelineDocumentModal } from '@/components/assessment-test/PipelineDocumentModal';

import {
  initialAssessmentStages,
  initialGauges,
  initialTelemetryItems,
  mockSecurityCoverage,
  mockTenantHealth,
  mockLicenseOptimization,
  mockCopilotReadiness,
} from '@/components/assessment-test/mockData';
import { MetricGauge, TelemetryItem, AssessmentStage } from '@/components/assessment-test/types';

export default function AssessmentTestPage() {
  const [stages, setStages] = useState<AssessmentStage[]>(initialAssessmentStages);
  const [gauges, setGauges] = useState<MetricGauge[]>(initialGauges);
  const [telemetryItems, setTelemetryItems] = useState<TelemetryItem[]>(initialTelemetryItems);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [activeStageId, setActiveStageId] = useState('stage-4');

  const [selectedTelemetryItem, setSelectedTelemetryItem] = useState<TelemetryItem | null>(null);
  const [selectedGauge, setSelectedGauge] = useState<MetricGauge | null>(null);
  const [selectedPipelineStage, setSelectedPipelineStage] = useState<AssessmentStage | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);

  // Filter telemetry items by search query and category
  const filteredTelemetry = telemetryItems.filter((item) => {
    const matchesCategory = selectedCategory === 'all' || item.type === selectedCategory;
    const matchesQuery =
      searchQuery.trim() === '' ||
      item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.architectSays.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesQuery;
  });

  const handleRefreshScan = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      // Slightly fluctuate scores to simulate a live rescan
      setGauges((prev) =>
        prev.map((g) => ({
          ...g,
          score: Math.min(100, Math.max(50, g.score + Math.floor(Math.random() * 5 - 2))),
        }))
      );
    }, 1500);
  };

  const handleRemediateItem = (remediatedItem: TelemetryItem) => {
    setTelemetryItems((prev) => prev.filter((item) => item.id !== remediatedItem.id));
  };

  const handleOpenSneakPeekDetail = (cardName: string) => {
    if (cardName === 'security') {
      const g = gauges.find((item) => item.id === 'sec-score') || gauges[0];
      setSelectedGauge(g);
    } else if (cardName === 'licenses') {
      const g = gauges.find((item) => item.id === 'license-roi') || gauges[3];
      setSelectedGauge(g);
    } else {
      setSelectedCategory(cardName);
    }
  };

  const currentStage = stages.find((s) => s.id === activeStageId) || stages[3];

  return (
    <AppShell title="Assessment Test">
    <div className="min-h-screen flex flex-col bg-[#101419] text-[#e0e2ea] antialiased">

      {/* Main Content Layout */}
      <main className="flex-grow pb-12 px-4 md:px-8 w-full max-w-[1440px] mx-auto py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          
          {/* Left/Main Column (8 of 12 cols) */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            
            {/* 1. Hero / Progress Section */}
            <AssessmentHero
              progressPercentage={42}
              activeStageTitle={currentStage.title}
              isScanning={isRefreshing}
              onTriggerScan={handleRefreshScan}
            />

            {/* 2. Score Gauges Grid (4 Cards) */}
            <ScoreGaugeGrid
              gauges={gauges}
              onSelectGauge={(gauge) => setSelectedGauge(gauge)}
            />

            {/* 3. Telemetry Briefing (Live Auto-scroll Feed) */}
            <TelemetryBriefing
              items={filteredTelemetry}
              onSelectItem={(item) => setSelectedTelemetryItem(item)}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
            />

          </div>

          {/* Right Column (4 of 12 cols) Sticky Sidebar */}
          <div className="lg:col-span-4 sticky top-20 flex flex-col gap-4">
            
            {/* Assessment Pipeline Progress */}
            <AssessmentPipeline
              stages={stages}
              activeStageId={activeStageId}
              onSelectStage={(stage) => {
                setActiveStageId(stage.id);
                setSelectedPipelineStage(stage);
              }}
            />

            {/* Sneak Peek Insights */}
            <SneakPeekInsights
              security={mockSecurityCoverage}
              tenantHealth={mockTenantHealth}
              licenseOpt={mockLicenseOptimization}
              copilotReadiness={mockCopilotReadiness}
              onOpenCardDetail={handleOpenSneakPeekDetail}
            />

          </div>

        </div>
      </main>

      {/* Modals & Dialogs */}
      <TelemetryDetailModal
        item={selectedTelemetryItem}
        onClose={() => setSelectedTelemetryItem(null)}
        onRemediate={handleRemediateItem}
      />

      <MetricGaugeModal
        gauge={selectedGauge}
        onClose={() => setSelectedGauge(null)}
      />

      <ExportReportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
      />

      <PipelineDocumentModal
        stage={selectedPipelineStage}
        onClose={() => setSelectedPipelineStage(null)}
        onAcceptPlan={(stageId) => {
          setStages((prev) =>
            prev.map((s) => (s.id === stageId ? { ...s, status: 'done', completedAt: 'Just now' } : s))
          );
        }}
      />

    </div>
    </AppShell>
  );
}
