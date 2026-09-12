import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAdmin } from "../middlewares/requireAuth.ts";

const router = Router();

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
