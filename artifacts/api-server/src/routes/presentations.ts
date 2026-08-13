import { Router } from "express";
import { db } from "@workspace/db";
import { clientPresentationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/presentations/:id", async (req, res) => {
  const { id } = req.params;
  const [pres] = await db
    .select()
    .from(clientPresentationsTable)
    .where(eq(clientPresentationsTable.id, id))
    .limit(1);

  if (!pres) {
    res.status(404).send("<html><body><h1>Proposal Not Found</h1><p>This proposal link may have expired or does not exist.</p></body></html>");
    return;
  }

  if (pres.expiresAt && pres.expiresAt < new Date()) {
    res.status(410).send("<html><body><h1>Proposal Expired</h1><p>This proposal link has expired. Please contact Shane for an updated proposal.</p></body></html>");
    return;
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(pres.html);
});

export default router;
