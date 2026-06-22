import { AssessmentCTA } from "@/components/AssessmentCTA";

export function CopilotQuizCTA() {
  return (
    <AssessmentCTA
      label="Free 5-Minute Assessment"
      title="Not Sure Where You Stand?<br class='hidden sm:block' /> Take the Copilot Readiness Quiz."
      description="Before you enable a single Copilot license, you need to know your readiness across five dimensions: governance, identity, data hygiene, change management, and business process maturity."
      supportingCopy="Answer 10 targeted questions — built on the same framework Shane applied at NASA — and receive a personalised readiness score, dimension-by-dimension breakdown, and a recommended service path. Delivered instantly as a PDF. No account required."
      quizUrl="/copilot-quiz"
      ctaLabel="Take the Free Assessment"
      stats={[
        { label: "10 questions · ~5 minutes" },
        { label: "PDF report emailed instantly" },
        { label: "No sales follow-up" },
      ]}
    />
  );
}
