import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAdmin } from "../middlewares/requireAuth";
import { getPrompt } from "../lib/prompt-loader";

const router = Router();

interface Activity {
  title: string;
  description?: string;
  completionStatus?: string | null;
  completionNotes?: string | null;
}

interface NextStepItem {
  label: string;
  title: string;
  description?: string;
}

interface AiDraftBody {
  section: "executive_summary" | "key_outcomes" | "next_steps" | "all";
  project?: { title?: string; status?: string; progress?: number; description?: string | null };
  client?: { name?: string | null; company?: string | null } | null;
  activities?: Activity[];
  nextSteps?: NextStepItem[];
  blockedCount?: number;
  progress?: number;
  period?: string;
  extraContext?: string;
}

function buildContext(body: AiDraftBody): string {
  const { project, client, activities = [], nextSteps = [], blockedCount = 0, progress = 0, period, extraContext } = body;

  const periodLabel = { weekly: "weekly", monthly: "monthly", executive_summary: "executive summary", other: "custom" }[period ?? "monthly"] ?? "monthly";
  const clientLabel = client ? `${client.name ?? "the client"}${client.company ? ` (${client.company})` : ""}` : "the client";

  const activitiesText = activities.length > 0
    ? activities.map(a => {
      let line = `• ${a.title}`;
      if (a.description) line += ` — ${a.description}`;
      if (a.completionNotes) line += `\n  Notes: ${a.completionNotes}`;
      return line;
    }).join("\n")
    : "No completed activities recorded.";

  const nextStepsText = nextSteps.length > 0
    ? nextSteps.map(s => `• [${s.label}] ${s.title}${s.description ? ` — ${s.description}` : ""}`).join("\n")
    : "No upcoming steps defined.";

  return `PROJECT: ${project?.title ?? "Untitled Project"}
CLIENT: ${clientLabel}
REPORT PERIOD: ${periodLabel}
PROGRESS: ${Math.round(progress)}% complete
BLOCKED/RAISED ISSUES: ${blockedCount}

COMPLETED ACTIVITIES THIS PERIOD:
${activitiesText}

UPCOMING NEXT STEPS:
${nextStepsText}
${extraContext ? `\nADDITIONAL CONTEXT PROVIDED BY ADVISOR:\n${extraContext}` : ""}`;
}

const PERSONA = `You are Shane McCaw, a senior Microsoft 365 architect and consultant with 30 years of experience in the Microsoft ecosystem. You are writing a professional client status report. Your writing style is:
- Confident, clear, and executive-level (non-technical where possible)
- Results-oriented: focus on what was achieved and what it means for the client's business
- Warm but professional — you're a trusted advisor, not a vendor
- Concise: 2-4 sentences per paragraph, no bullet points in the executive summary or key outcomes
- Do not use filler phrases like "I hope this finds you well" or "As always"
- Do not use markdown headers or formatting in your output — plain prose only`;

router.post("/admin/status-reports/ai-draft", requireAdmin, async (req: Request, res: Response) => {
  const body = req.body as AiDraftBody;
  const { section } = body;
  const persona = await getPrompt("status-report-persona", PERSONA);

  if (!["executive_summary", "key_outcomes", "next_steps", "all"].includes(section)) {
    res.status(400).json({ error: "Invalid section. Must be one of: executive_summary, key_outcomes, next_steps, all" });
    return;
  }

  const context = buildContext(body);

  try {
    const result: { executiveSummary?: string; keyOutcomes?: string; nextSteps?: NextStepItem[] } = {};

    const shouldWrite = (s: string) => section === "all" || section === s;

    const EXEC_SUMMARY_DEFAULT = `Write a concise Executive Summary for this status report. Focus on overall progress, key achievements this period, and current project health. Keep it to 2-3 sentences. Do not use bullet points. Do not include headers.`;
    const KEY_OUTCOMES_DEFAULT = `Write a Key Outcomes section for this status report. Describe the business or technical value delivered this period — what these activities mean for the client in terms of efficiency, risk reduction, compliance, or strategic progress. Keep it to 2-4 sentences. Plain prose only, no bullet points, no headers.`;
    const NEXT_STEPS_DEFAULT = `Based on the project context below, suggest 3-5 concrete next steps for the upcoming period. Return ONLY a JSON array in this exact format, nothing else:\n[{"label":"Phase or category","title":"Short action title","description":"One sentence detail"}]`;

    const [execSummaryInstr, keyOutcomesInstr, nextStepsInstr] = await Promise.all([
      getPrompt("status-report-exec-summary", EXEC_SUMMARY_DEFAULT),
      getPrompt("status-report-key-outcomes", KEY_OUTCOMES_DEFAULT),
      getPrompt("status-report-next-steps", NEXT_STEPS_DEFAULT),
    ]);

    if (shouldWrite("executive_summary")) {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: `${persona}

${execSummaryInstr}

${context}

Executive Summary:`,
          },
        ],
      });
      const block = msg.content[0];
      if (block.type === "text") result.executiveSummary = block.text.trim();
    }

    if (shouldWrite("key_outcomes")) {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: `${persona}

${keyOutcomesInstr}

${context}

Key Outcomes:`,
          },
        ],
      });
      const block = msg.content[0];
      if (block.type === "text") result.keyOutcomes = block.text.trim();
    }

    if (shouldWrite("next_steps")) {
      const msg = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 8192,
        messages: [
          {
            role: "user",
            content: `${persona}

${nextStepsInstr}

${context}

JSON:`,
          },
        ],
      });
      const block = msg.content[0];
      if (block.type === "text") {
        try {
          const text = block.text.trim();
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            result.nextSteps = JSON.parse(jsonMatch[0]) as NextStepItem[];
          }
        } catch {
          // fallback: return raw text as description of first step
          result.nextSteps = [{ label: "Next Period", title: "Review AI suggestions", description: block.text.trim().slice(0, 200) }];
        }
      }
    }

    res.json(result);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "AI generation failed";
    res.status(500).json({ error: errMsg });
  }
});

interface AiSuggestBody {
  output: string;
  taskTitle?: string;
  taskType?: string;
}

router.post("/admin/ai/suggest", requireAdmin, async (req: Request, res: Response) => {
  const { output, taskTitle, taskType } = req.body as AiSuggestBody;

  if (!output?.trim()) {
    res.status(400).json({ error: "output is required" });
    return;
  }

  const contextLines = [
    taskTitle ? `Task: ${taskTitle}` : null,
    taskType ? `Type: ${taskType}` : null,
    `\nOutput:\n${output.slice(0, 8000)}`,
  ].filter(Boolean).join("\n");

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: `You are a Microsoft 365 infrastructure expert reviewing task output for a consulting engagement.

${contextLines}

Analyze the output and return ONLY a JSON object with this exact structure, nothing else:
{
  "analysis": "2-3 sentence summary of what the output indicates",
  "risks": ["identified risk 1", "identified risk 2"],
  "remediationSteps": ["concrete step 1", "concrete step 2"],
  "nextActions": ["recommended next action 1", "recommended next action 2"]
}`,
      }],
    });

    const textBlock = msg.content.find(b => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      res.status(500).json({ error: "No response from AI" });
      return;
    }

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Could not parse AI response" });
      return;
    }

    const result = JSON.parse(jsonMatch[0]) as {
      analysis: string;
      risks: string[];
      remediationSteps: string[];
      nextActions: string[];
    };

    res.json(result);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "AI analysis failed";
    res.status(500).json({ error: errMsg });
  }
});

export default router;
