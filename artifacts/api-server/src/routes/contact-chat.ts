import { Router, type IRouter, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

const SYSTEM_PROMPT = `You are an AI intake assistant on the website of Shane McCaw Consulting. Shane is NASA's Lead Microsoft 365 Architect with 30 years of Microsoft ecosystem experience. Your only job is to have a warm, natural conversation with a website visitor to collect their contact and qualifying information — one question at a time.

Collect these fields in this rough order (adapt naturally if the visitor volunteers info early):
1. name (first and last)
2. email address
3. company name
4. company size (approximate employee count)
5. service area of interest (e.g. M365, Copilot AI, SharePoint, Power Platform, Governance, Cloud Migration, Retainer, or Not Sure)
6. how they found Shane (Google, LinkedIn, referral, Microsoft community, other)
7. a brief description of what they're looking to accomplish or the problem they need solved

Keep responses SHORT — one conversational sentence or two at most. Be warm but professional. Do not answer general questions about pricing, availability, or Shane's services — politely redirect: "Great question — Shane will cover that personally when he follows up."

Once you have collected all seven fields, include EXACTLY this JSON block somewhere in your reply (do not add backticks or markdown fences, just raw JSON on its own line):
{"leadReady":true,"lead":{"name":"FULL_NAME","email":"EMAIL","company":"COMPANY","companySize":"SIZE","serviceArea":"SERVICE","howFound":"HOW","message":"MESSAGE"}}

After that JSON line, tell the visitor that their information has been sent to Shane and he'll personally follow up within one business day.

Important: Only include the leadReady JSON once, after all fields are collected. Never include it early.`;

const LEAD_JSON_RE = /\{"leadReady"\s*:\s*true[^}]*"lead"\s*:\s*\{[^}]*\}\s*\}/;

router.post("/contact-chat", async (req: Request, res: Response) => {
  const { messages } = req.body as {
    messages?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  const anthropicMessages = messages.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );

  let fullText: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages:
        anthropicMessages.length === 0
          ? [{ role: "user", content: "__init__" }]
          : anthropicMessages,
    });

    const block = response.content[0];
    fullText = block.type === "text" ? block.text : "";
  } catch (err) {
    req.log.error({ err }, "contact-chat: Anthropic call failed");
    res.status(503).json({ error: "AI assistant is temporarily unavailable. Please try again or email info@shanemccaw.com directly." });
    return;
  }

  const match = LEAD_JSON_RE.exec(fullText);
  let lead: object | undefined;

  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as { leadReady: boolean; lead: object };
      if (parsed.leadReady) {
        lead = parsed.lead;
      }
    } catch {
      req.log.warn("contact-chat: Failed to parse lead JSON from AI reply");
    }
  }

  const reply = fullText.replace(LEAD_JSON_RE, "").trim();

  res.json({ reply, lead });
});

export default router;
