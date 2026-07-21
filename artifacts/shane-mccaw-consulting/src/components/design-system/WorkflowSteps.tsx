interface WorkflowStep {
  title: string;
  description: string;
}

interface WorkflowStepsProps {
  steps: WorkflowStep[];
}

const GRADIENT_BG = { background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" };
const CONNECTOR_BG = { background: "linear-gradient(180deg, var(--accent-blue), rgba(255,255,255,0.08))" };

/**
 * Process/pipeline content ("How This Product Works" style) — numbered steps joined by a
 * visible vertical connector, so it reads as a sequence rather than a numbered list that
 * happens to be about a process.
 */
export function WorkflowSteps({ steps }: WorkflowStepsProps) {
  return (
    <ol className="relative">
      {steps.map((step, i) => (
        <li key={step.title} className="relative flex gap-4 pb-8 last:pb-0">
          {i < steps.length - 1 && (
            <span
              className="absolute left-5 top-10 bottom-0 w-px"
              style={CONNECTOR_BG}
              aria-hidden="true"
            />
          )}
          <span
            className="relative z-10 shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold font-numeric"
            style={GRADIENT_BG}
          >
            {i + 1}
          </span>
          <div className="pt-1.5">
            <p className="text-text-primary font-semibold mb-1">{step.title}</p>
            <p className="text-text-secondary leading-relaxed">{step.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
