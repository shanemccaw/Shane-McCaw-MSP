# Workflow Node Reference

> Standalone catalogue of all workflow node types available in the Admin Panel builder.  
> For builder UX, BFS execution model, and API endpoints, see [admin-panel.md](./admin-panel.md).  
> **Last updated:** 2026-07-09

---

## Contents

1. [Structural / Control Flow](#1-structural--control-flow)
2. [AI & Content](#2-ai--content)
3. [CRM & Project](#3-crm--project)
4. [Communication & Notification](#4-communication--notification)
5. [M365 & Azure](#5-m365--azure)
6. [Finance (Stripe)](#6-finance-stripe)
7. [Social Media](#7-social-media)
8. [Data & Variables](#8-data--variables)
9. [Internal / System](#9-internal--system)
10. [Promoted Action Types](#10-promoted-action-types)

---

## Reading This Reference

Each node entry follows this structure:

- **Node key** — the `type` string used in the graph JSON.
- **Config fields** — fields in `node.data` read by the executor.
- **Outputs** — keys merged into the run's payload map after execution.
- **Dry-run** — behaviour when the run is started with `dryRun: true`.
- **Gotchas** — non-obvious constraints or common mistakes.

All string config fields support `{{variable}}` interpolation unless noted otherwise. Object/array fields (e.g., `cases[]`, `lineItems`) should be provided as JSON strings when interpolation is needed.

---

## 1. Structural / Control Flow

### `start`

Entry point of every workflow graph. Exactly one `start` node per graph is required.

| Config Field | Type | Description |
|---|---|---|
| `label` | string | Display label (no execution effect) |

**Outputs:** `{ started: true, ...runPayload }` — the trigger payload is spread into the output so downstream nodes can reference `{{steps.<startId>.fieldName}}` or just `{{fieldName}}`.

**Dry-run:** Executes normally.

> **Gotcha:** Before 2026, the `start` node's output was hardcoded to `{ started: true }` without spreading the payload. Existing runs that relied on `{{steps.start.*}}` may need updating if they reference specific payload fields through the start node step path.

---

### `end`

Terminal node. Multiple `end` nodes are allowed (different exit paths). Every branch must eventually reach an `end` or the run will hang as incomplete.

| Config Field | Type | Description |
|---|---|---|
| `label` | string | Exit label, e.g. `"Done"`, `"Failed"`, `"Skipped"` |

**Outputs:** `{ finished: true, label }`.

**Dry-run:** Executes normally.

---

### `condition`

Evaluates a boolean expression and routes execution along the `true` or `false` edge handle.

| Config Field | Type | Description |
|---|---|---|
| `expression` | string | Boolean expression (see syntax below) |
| `label` | string | Display label |

**Expression syntax:**

```
path op literal      →  status == 'paid'
boolean path         →  isQualified
logical and/or       →  score >= 80 && status != 'closed_lost'
contains             →  message contains 'urgent'
template reference   →  {{stripeInvoiceId}} && paymentPlan == 'phased'
```

Operators: `==` `!=` `>` `<` `>=` `<=` `contains`. Logical: `&&` `||`.

**Outputs:** `{ conditionResult: boolean }`. Also sets route on `true` or `false` edge handles.

**Dry-run:** Executes normally — condition branches are traced without side effects.

> **Gotcha:** Edge handles must be exactly `"true"` or `"false"` (strings). Old seeded graphs used `"yes"` / `"no"` — the seeder patches these automatically for system workflows, but custom graphs must use the canonical handles.

---

### `switch_case`

Multi-branch router. Evaluates a `switchExpr` against a list of `cases` and routes to the matching case's edge handle, or to `"default"` if no case matches.

| Config Field | Type | Description |
|---|---|---|
| `switchExpr` | string | Expression whose value is matched against case values |
| `cases` | JSON array | Array of `{ id: string, matchValue: string, label: string }` |
| `label` | string | Display label |

**Outputs:** `{ switchValue, chosenBranch, matchedCaseId }`.

**Edge handles:** Each case's `id` is used as the edge `sourceHandle`. The fallthrough handle is `"default"`.

**Dry-run:** Executes normally.

---

### `foreach`

Iterates over an array field in the payload. Executes all downstream nodes once per element. Results are collected and made available as `collectedResults` after the loop completes.

| Config Field | Type | Description |
|---|---|---|
| `arrayPath` | string | Dot-path to the array in the current payload, e.g. `phases` or `steps.getPhases.phases` |
| `itemAlias` | string | Variable name for the current item inside the loop body, e.g. `item` |
| `label` | string | Display label |

**Outputs per iteration:** `{ item, [itemAlias], itemIndex, itemsTotal }`.

**Outputs after loop completes:** `{ collectedResults: unknown[] }` — array of the final payload state from each iteration.

**Dry-run:** Iterates but inner DB-writing nodes are stubbed.

> **Gotcha:** Nodes inside a `foreach` body that run multiple times are stored in `wf_run_node_outputs` with indexed keys (e.g., `node-104[0]`, `node-104[1]`). The run detail viewer shows all iterations; the canvas shows iteration `[0]` data on the plain node key.

---

### `parallel`

Splits execution into N simultaneous branches that run concurrently. Branches to wait on before proceeding are specified in `branchWait`.

| Config Field | Type | Description |
|---|---|---|
| `branchCount` | number | Number of branches to create (1–10) |
| `branchLabels` | string[] | Optional display labels per branch |
| `branchWait` | string[] | Branch handles that must complete before execution continues past the parallel node |

**Outputs:** Each branch's handle routes to the nodes on that branch.

**Dry-run:** Splits and executes all branches normally (DB-writing nodes stubbed within branches).

---

### `join`

Synchronises parallel branches. The run does not proceed past `join` until all incoming branch edges have resolved (BFS convergence). A `join` node is typically placed after a `parallel` node when all branches must finish before continuing.

| Config Field | Type | Description |
|---|---|---|
| `label` | string | Display label |

**Outputs:** `{ joined: true }`.

**Dry-run:** Executes normally.

---

### `delay`

Pauses workflow execution for a fixed or random duration before proceeding.

| Config Field | Type | Description |
|---|---|---|
| `mode` | `"fixed"` \| `"random"` | Delay mode |
| `duration` | number | Delay in `unit` (fixed mode) or maximum delay (random mode) |
| `unit` | `"seconds"` \| `"minutes"` \| `"hours"` | Time unit |
| `label` | string | Display label |

**Outputs:** `{ skipped: boolean }` — `true` in dry-run mode; `false` in live mode after the delay elapses.

**Dry-run:** Always skips the delay immediately (`{ skipped: true }`).

---

### `retry`

Retries a failed upstream node up to a maximum number of attempts. The `retry` node is typically wired to the `onError` handle of another node.

| Config Field | Type | Description |
|---|---|---|
| `maxAttempts` | number | Maximum retry attempts (1–10) |
| `delaySeconds` | number | Seconds to wait between retries |
| `label` | string | Display label |

**Outputs:** Pass-through from the retried node's last output.

**Dry-run:** Executes normally but the upstream node itself is stubbed.

---

### `report_progress`

Broadcasts an SSE progress event to all admin panel tabs that are subscribed to the run's SSE stream. Does not write to the DB.

| Config Field | Type | Description |
|---|---|---|
| `progress` | number | 0–100 completion percentage |
| `message` | string | Human-readable status message |
| `phase` | string | Optional phase label |

**Outputs:** SSE broadcast only — no DB output record is written.

**Dry-run:** Broadcast is still sent (the SSE connection is live during test runs).

---

### `approval_gate`

Pauses the workflow run and creates a `pending_approvals` DB row. The run's status becomes `awaiting_approval`. An admin must approve or reject via `POST /api/admin/workflows/pending-approvals/:id/decide` or the **Pending Approvals** panel in the UI.

- **Approved** → `resumeWorkflowRun()` is called and execution continues from the next node.
- **Rejected** → the run is marked `failed` with the rejection note as the error message.

| Config Field | Type | Description |
|---|---|---|
| `approverRole` | string | Role required to approve, e.g. `"admin"` |
| `label` | string | Display label shown in the approvals panel |
| `expiresInHours` | number | Optional expiry window. Expired approvals are not automatically rejected — they remain pending. |

**Outputs:** `{ approvalId, approverRole, expiresAt }` (emitted when the gate is created, before the run pauses).

**Dry-run:** Approval gate is skipped — execution proceeds as if approved.

---

### `ask_for_input`

Pauses the run and presents a form to the operator launching it via "Run Now". Input values are collected in the modal before the run starts (`inputValues` parameter in the run request body). After the run starts, the node resolves the provided values.

| Config Field | Type | Description |
|---|---|---|
| `fields` | JSON array | Array of `{ variableName, label, type, required, options?, multi? }` |
| `label` | string | Display label |

Field `type` options: `"text"` \| `"number"` \| `"email"` \| `"select"` \| `"multiselect"` \| `"date"` \| `"textarea"`.

**Outputs:** One output key per declared `variableName`, e.g. `{ recipientEmail, targetDate }`.

**Dry-run:** Uses the provided `inputValues` (or empty strings for missing values).

---

## 2. AI & Content

### `ask_ai`

Calls the Anthropic Claude API with a user prompt and optional system prompt. Model is configurable per node. For high-token or long-running requests, use `claude-opus-4-5` with the streaming path (see Gotchas).

| Config Field | Type | Description |
|---|---|---|
| `promptExpr` | string | User message (interpolated) |
| `systemExpr` | string | System message (interpolated, optional) |
| `model` | string | Claude model ID, e.g. `"claude-haiku-4-5"`, `"claude-opus-4-5"` |
| `label` | string | Display label |

**Outputs:** `{ aiResponse: string, model: string }`.

**Dry-run:** Returns a synthetic `aiResponse` string without calling the API.

> **Gotcha:** Claude Haiku sometimes prepends prose before a JSON block. Use a downstream `compose` node with `parseAsJson: true` to extract the JSON array or object — do not regex-parse `aiResponse` directly with a `^`-anchored pattern.

> **Gotcha:** `messages.create()` hard-times out at ~10 minutes. Any high-token generation (Opus, 32k+ output) must use streaming (`messages.stream()` + `finalMessage()`). Haiku is preferred for most workflow nodes.

---

### `compose`

Interpolates a template string and optionally parses the result as JSON. Can validate against a JSON Schema.

| Config Field | Type | Description |
|---|---|---|
| `inputs` | string | Template string, e.g. `"{{aiResponse}}"` |
| `parseAsJson` | boolean | If `true`, parses the interpolated string as JSON and merges the result |
| `jsonSchema` | object | Optional JSON Schema to validate the parsed object against |
| `label` | string | Display label |

**Outputs:** `{ value: string }` — the interpolated string. If `parseAsJson: true` and parsing succeeds, the parsed object's keys are also merged into the payload.

**Dry-run:** Executes normally.

---

### `generate_document`

Generates an AI consulting document or report. For `consolidated_sow` type, delegates to `generateConsolidatedSowDocument()`. On failure, the node emits an `onError` edge so upstream retry nodes can catch it.

| Config Field | Type | Description |
|---|---|---|
| `clientId` | string | Client user ID (interpolated). Also accepts `customerId` as alias. |
| `projectId` | string | Project ID (interpolated, optional) |
| `docType` | string | `consolidated_sow`, `security_report`, `governance_report`, `diff_report`, `readiness_report`, `custom` |
| `docCategory` | string | Document category, e.g. `"consulting"` |
| `title` | string | Document title (interpolated) |
| `sowHtml` | string | SOW HTML body (for `consolidated_sow` type; optional if project has existing SOW) |
| `sowDocumentId` | string | Existing SOW document ID to base the consolidated document on |
| `label` | string | Display label |

**Outputs:** `{ documentId, docType, category, title, clientId }`.

**Dry-run:** Returns synthetic output without writing to DB or calling AI.

> **Gotcha:** The executor resolves `clientId` from `node.data.clientId` or `node.data.customerId`. Do not use `clientUserId` as a field name — the seeder patches this on system workflows but custom graphs must use `clientId`.

---

### `generate_script`

Generates a PowerShell runbook from a service description or an existing document using AI. The generated script is saved to the Script Library under the `Workflow Generated` category.

| Config Field | Type | Description |
|---|---|---|
| `sourceMode` | `"service"` \| `"document"` | What to base the script on |
| `targetId` | string | Service ID or document ID (interpolated) |
| `customInstructions` | string | Additional instructions for the AI (optional) |
| `outputMode` | string | `"runbook"` or `"helper"` |
| `label` | string | Display label |

**Outputs:** `{ scriptId, packageId, title }`.

**Dry-run:** Returns synthetic output without saving.

---

### `generate_article`

Generates a full blog article via Claude Haiku. Does not persist the article — use a downstream `publish_article` node to save it.

| Config Field | Type | Description |
|---|---|---|
| `topic` | string | Article topic (interpolated) |
| `category` | string | Article category, e.g. `"M365 Best Practices"` |
| `tone` | string | Writing tone: `"professional"`, `"conversational"`, `"technical"` (optional) |
| `wordCount` | number | Target word count (optional, default ~800) |
| `label` | string | Display label |

**Outputs:** `{ articleTitle, articleSlug, articleCategory, articleSummary, articleDate, articleContent }`.

**Dry-run:** Returns synthetic article fields without calling AI.

---

### `publish_article`

Saves a generated article to `artifacts/shane-mccaw-consulting/src/content/articles/` as a Markdown `.md` file. The `draftOnly` flag saves the file without a publish date so it does not appear in the public site listing until manually published.

| Config Field | Type | Description |
|---|---|---|
| `titleExpr` | string | Article title expression, e.g. `"{{articleTitle}}"` |
| `draftOnly` | boolean | If `true`, omits `date` from frontmatter so the article is hidden on the site |
| `label` | string | Display label |

**Outputs:** `{ published: boolean, slug, articleId, title }`.

**Dry-run:** Returns synthetic output without writing to disk.

> **Gotcha:** The Weekly Article Generator seeds `draftOnly: true` on its `publish_article` node. A one-time SQL patch in the seeder applies this to existing environments where the node was seeded before the draft-review feature was added.

---

### `topic_picker`

Uses Claude to select the best article topic from a focus area for the current content calendar context.

| Config Field | Type | Description |
|---|---|---|
| `focusArea` | string | General theme, e.g. `"Microsoft 365 governance"` |
| `category` | string | Target article category |
| `label` | string | Display label |

**Outputs:** `{ articleTopic, topicCategory }`.

**Dry-run:** Returns synthetic topic without calling AI.

---

### `generate_image`

Generates an image using OpenAI's `gpt-image-1` model. Saves the result to `/data/uploads/generated-images/`.

| Config Field | Type | Description |
|---|---|---|
| `promptExpr` | string | Image generation prompt (interpolated) |
| `aspectRatio` | string | `"square"` \| `"landscape"` \| `"portrait"` \| `"wide"` |
| `label` | string | Display label |

**Outputs:** `{ imageUrl, revisedPrompt }`.

**Dry-run:** Returns a placeholder `imageUrl` without calling the API.

---

### `generate_pdf`

Converts an HTML string to a PDF via a rendering service. The PDF is returned as base64.

| Config Field | Type | Description |
|---|---|---|
| `htmlTemplate` | string | HTML content (interpolated) |
| `fileName` | string | Output filename (with or without `.pdf`) |
| `label` | string | Display label |

**Outputs:** `{ pdfBase64, pdfDataUri, fileName }`.

**Dry-run:** Returns synthetic base64 data without calling the renderer.

---

### `fetch_news_headlines`

Fetches M365-related news headlines from an external source and generates a campaign brief via Claude.

| Config Field | Type | Description |
|---|---|---|
| `topic` | string | News topic, e.g. `"Microsoft Copilot"` |
| `targetSector` | string | Target industry sector for the brief |
| `label` | string | Display label |

**Outputs:** `{ newsHeadlines[], newsTopic, newsContext, newsArticleSuggestion, hotScore, isHot, campaignBrief, campaignId }`.

**Dry-run:** Returns synthetic headlines without fetching or calling AI.

---

## 3. CRM & Project

### `create_lead`

Inserts a new row into the `leads` table.

| Config Field | Type | Description |
|---|---|---|
| `name` | string | Lead full name |
| `email` | string | Lead email address |
| `company` | string | Company name (optional) |
| `serviceArea` | string | Service interest, e.g. `"Microsoft 365"` (optional) |
| `message` | string | Lead message (optional) |
| `label` | string | Display label |

**Outputs:** `{ leadId, leadEmail, leadName }`.

**Dry-run:** Returns synthetic IDs without writing to DB.

---

### `convert_to_opportunity`

Creates an opportunity record linked to an existing lead. Sets the initial stage based on `workflowType`.

| Config Field | Type | Description |
|---|---|---|
| `leadId` | string | Lead ID (interpolated) |
| `workflowType` | string | Initial stage key, e.g. `"DiscoveryCall"` |
| `label` | string | Display label |

**Outputs:** `{ opportunityId, leadId }`.

**Dry-run:** Returns synthetic IDs.

---

### `create_client`

Creates a user account with `role = "client"`. Used to provision a client after payment.

| Config Field | Type | Description |
|---|---|---|
| `name` | string | Client full name |
| `email` | string | Client email address |
| `label` | string | Display label |

**Outputs:** `{ clientId, clientEmail }`.

**Dry-run:** Returns synthetic IDs.

---

### `create_project`

Creates a project record. If the payload contains `contractId` or `presentationId`, broadcasts a `project_ready` SSE event to the linked presentation's portal tab.

| Config Field | Type | Description |
|---|---|---|
| `title` | string | Project title (interpolated) |
| `description` | string | Project description (optional) |
| `projectType` | string | `"project"`, `"engagement"`, etc. |
| `clientUserId` | string | Client user ID (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ projectId, projectTitle }`.

**Dry-run:** Returns synthetic IDs without SSE broadcast.

---

### `score_lead`

Runs the lead qualification scoring algorithm and updates the `leads` row with the new score.

**Scoring algorithm:**
- Base: **20**
- Company name present: **+20**
- Service area set: **+20**
- Message > 50 characters: **+20**
- Stage ≠ `Cold`: **+20**
- **Maximum: 100**

| Config Field | Type | Description |
|---|---|---|
| `leadId` | string | Lead ID (interpolated) |
| `threshold` | number | Score threshold for `qualified` flag (optional, default 60) |
| `label` | string | Display label |

**Outputs:** `{ leadId, score, scoreLabel, qualified }`.

Score labels: `< 40` → `"Cold"` | `40–59` → `"Warm"` | `60–79` → `"Hot"` | `≥ 80` → `"Qualified"`.

**Dry-run:** Returns synthetic score without DB update.

---

### `assign_pipeline_stage`

Moves a lead or opportunity to a new pipeline stage.

| Config Field | Type | Description |
|---|---|---|
| `leadId` | string | Lead ID (for leads; mutually exclusive with `opportunityId`) |
| `opportunityId` | string | Opportunity ID (for opportunities) |
| `stage` | string | New stage value |
| `targetType` | string | `"lead"` \| `"opportunity"` (auto-detected if not set) |
| `label` | string | Display label |

**Outputs:** `{ targetType, leadId?, opportunityId?, stage }`.

**Dry-run:** Returns synthetic output without DB update.

---

### `create_opportunity`

Creates a new opportunity record linked to a lead.

| Config Field | Type | Description |
|---|---|---|
| `leadId` | string | Lead ID (interpolated) |
| `workflowType` | string | Initial opportunity type/stage |
| `label` | string | Display label |

**Outputs:** `{ opportunityId, leadId }`.

**Dry-run:** Returns synthetic IDs.

---

### `parse_quiz_results`

Parses a quiz lead's answers into a structured assessment object, computing category scores and a recommended service tier.

| Config Field | Type | Description |
|---|---|---|
| `quizLeadId` | string | Quiz lead ID (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ totalScore, tier, recommendedService, leadName, leadEmail, company, categoryScores }`.

**Dry-run:** Returns synthetic assessment without DB read.

---

### `generate_readiness_score`

Computes an M365 adoption readiness score for a client based on their profile data.

| Config Field | Type | Description |
|---|---|---|
| `clientId` | string | Client user ID (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ readinessScore, readinessLabel, recordId }`.

**Dry-run:** Returns synthetic score.

---

### `attach_quiz_insights`

Attaches AI-derived insights from a quiz lead's assessment to an existing document.

| Config Field | Type | Description |
|---|---|---|
| `quizLeadId` | string | Quiz lead ID (interpolated) |
| `documentId` | string | Target document ID (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ insightsAttached: boolean, documentId }`.

**Dry-run:** Returns synthetic output.

---

### `create_kanban_task`

Creates a task card on a kanban board. The `boardId` defaults to `"marketing"` — always set it explicitly in live workflows to avoid landing on the wrong board.

| Config Field | Type | Description |
|---|---|---|
| `boardId` | string | Target board ID (default `"marketing"` in dry-run; required in live runs) |
| `columnId` | string | Target column ID |
| `titleExpr` | string | Card title (interpolated) |
| `descriptionExpr` | string | Card description (interpolated, optional) |
| `priority` | string | `"low"` \| `"medium"` \| `"high"` \| `"urgent"` |
| `phaseId` | string | Linked phase ID (optional) |
| `label` | string | Display label |

**Outputs:** `{ taskId, boardId, columnId, title }`.

**Dry-run:** Returns synthetic IDs.

> **Gotcha:** In live runs `boardId` has no fallback default. Always pass an explicit value — the dry-run default of `"marketing"` does not carry over.

---

### `get_phases`

Fetches SOW phases for a presentation or project.

| Config Field | Type | Description |
|---|---|---|
| `presentationId` | string | Presentation ID (interpolated; preferred) |
| `projectId` | string | Project ID (interpolated; fallback if no presentationId) |
| `label` | string | Display label |

**Outputs:** `{ phases[], phaseCount, presentationId }`.

**Dry-run:** Returns synthetic phase array.

---

### `create_phase`

Creates a project phase (workflow step) record.

| Config Field | Type | Description |
|---|---|---|
| `projectId` | string | Project ID (interpolated) |
| `title` | string | Phase title |
| `description` | string | Phase description (optional) |
| `order` | number | Sort order |
| `sowPhaseId` | string | Linked SOW phase ID (optional) |
| `label` | string | Display label |

**Outputs:** `{ phaseId, phaseTitle }`.

**Dry-run:** Returns synthetic IDs.

---

### `save_presentation_phases`

Saves an AI-generated phase array back to the presentation record. Reads the phase array from the current payload context (set by the upstream `ask_ai` + `compose` chain).

| Config Field | Type | Description |
|---|---|---|
| `label` | string | Display label |

**Outputs:** `{ saved: boolean, phaseCount, resolvedPhases }`.

**Dry-run:** Returns synthetic output.

---

### `build_presentation`

Generates the full proposal/SOW HTML presentation for a client using their M365 data and template.

| Config Field | Type | Description |
|---|---|---|
| `clientId` | string | Client user ID (interpolated) |
| `projectId` | string | Project ID (interpolated) |
| `templateId` | string | Template ID (optional) |
| `label` | string | Display label |

**Outputs:** `{ presentationHtml, presentationUrl, presentationId }`.

**Dry-run:** Returns synthetic URL and ID.

---

### `find_object`

Finds an existing DB or Stripe record by field value. Returns `found: false` without throwing if the record does not exist, making it safe to use before conditional branches.

| Config Field | Type | Description |
|---|---|---|
| `objectType` | string | `lead`, `client`, `project`, `article`, `stripe_invoice`, `insights_document`, `presentation` |
| `fieldName` | string | DB column name to match against |
| `fieldValueExpr` | string | Value expression (interpolated), e.g. `"{{projectId}}"` |
| `label` | string | Display label |

**Outputs:** `{ found: boolean, objectId, objectType, ...objectDetails }`. Specific detail keys vary by `objectType`.

**Dry-run:** Returns `{ found: true, objectId: "dry-run-id" }`.

> **Gotcha:** The executor reads `fieldName` (exact column name) and `fieldValueExpr` (interpolated value). Do not use `fieldValue` — only `fieldValueExpr` is read.

---

## 4. Communication & Notification

### `send_email`

Sends a transactional email via Resend. Supports named template slugs or inline HTML + subject.

| Config Field | Type | Description |
|---|---|---|
| `to` | string | Recipient email address (interpolated) |
| `templateSlug` | string | Named template slug (mutually exclusive with `subject` + `htmlBody`) |
| `subject` | string | Email subject (for inline mode) |
| `htmlBody` | string | HTML email body (interpolated; for inline mode) |
| Template vars | any | Additional keys in `node.data` are passed as template variables |
| `label` | string | Display label |

**Outputs:** `{ sent: boolean, messageId }`.

**Dry-run:** Returns `{ sent: true, messageId: "dry-run" }` without sending.

---

### `send_sms`

Sends an SMS to Shane's configured phone number via Twilio (`sendAdminSms()`). The destination is always `SHANE_PHONE_NUMBER` — this node is not for arbitrary recipient SMS.

| Config Field | Type | Description |
|---|---|---|
| `body` | string | SMS message text (interpolated, max ~1 600 chars) |
| `label` | string | Display label |

**Outputs:** `{ sent: boolean }`.

**Dry-run:** Returns `{ sent: false }` without sending.

> **Gotcha:** Requires four Twilio secrets: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `SHANE_PHONE_NUMBER`. If any is missing, the send is silently skipped (warning logged) and the node completes without error.

---

### `send_campaign_email`

Sends a marketing email from a content asset or template to a specific recipient.

| Config Field | Type | Description |
|---|---|---|
| `recipientExpr` | string | Recipient email (interpolated) |
| `assetId` | string | Content asset ID to use as email body (optional) |
| `templateSlug` | string | Template slug (used if no `assetId`) |
| `label` | string | Display label |

**Outputs:** `{ sent: boolean, recipient, subject, sourceRef }`.

**Dry-run:** Returns synthetic output without sending.

---

### `create_notification`

Inserts a notification record into the `notifications` DB table. Appears in the notification bell drawer in the Admin Panel.

| Config Field | Type | Description |
|---|---|---|
| `title` | string | Notification title (interpolated) |
| `body` | string | Notification body text (interpolated) |
| `linkPath` | string | Optional admin-panel path to link to, e.g. `"/admin-panel/projects/123"` |
| `type` | string | `"general"` \| `"warning"` \| `"error"` \| `"success"` |
| `label` | string | Display label |

**Outputs:** `{ notificationCount: number }` — the new total unread notification count.

**Dry-run:** Returns `{ notificationCount: 0 }` without writing to DB.

---

### `send_browser_notification`

Sends a Web Push notification to all subscribed admin browser sessions via VAPID. Delivered by the browser vendor's push service — works even when the Admin Panel tab is closed, as long as the browser is running.

| Config Field | Type | Description |
|---|---|---|
| `title` | string | Push notification title (interpolated) |
| `body` | string | Notification body text (interpolated) |
| `linkPath` | string | URL to open when the notification is clicked (optional) |
| `label` | string | Display label |

**Outputs:** `{ notificationSent: boolean }`.

**Dry-run:** Returns `{ notificationSent: false }` without dispatching.

> **Gotcha:** Requires `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` secrets. If either is missing, all calls are silently skipped and a warning is logged at server startup.

---

### `send_mobile_push`

Sends a push notification to the Expo mobile app (all enrolled admin device tokens).

| Config Field | Type | Description |
|---|---|---|
| `title` | string | Notification title (interpolated) |
| `body` | string | Notification body (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ sent: boolean, sentCount: number }`.

**Dry-run:** Returns `{ sent: false, sentCount: 0 }` without dispatching.

---

### `play_sound`

Plays an audio alert. Two targets are supported:
- `"browser"` — sends an SSE event to the open Admin Panel tab via `GET /api/admin/workflows/sound-events`.
- `"desktop"` — sends a Web Push → service worker → `postMessage` chain so the sound plays even when the tab is in the background.

Custom audio can be a URL to a file or Web Audio API synthesis parameters generated by `POST /api/admin/workflows/synthesise-sound`.

| Config Field | Type | Description |
|---|---|---|
| `target` | `"browser"` \| `"desktop"` | Delivery target |
| `sound` | string | Named preset: `"ping"`, `"chime"`, `"alert"`, `"success"`, `"error"` |
| `url` | string | Custom audio file URL (optional; overrides `sound`) |
| `synthParams` | object | Web Audio API synthesis parameters (optional; overrides `sound` and `url`) |
| `label` | string | Display label |

**Outputs:** `{ soundPlayed: boolean, soundTarget }`.

**Dry-run:** Returns `{ soundPlayed: false }` without dispatching.

---

## 5. M365 & Azure

### `execute_runbook`

Submits a named Azure Automation runbook job. Polls for completion and returns the job status. Requires all seven Azure secrets to be configured.

| Config Field | Type | Description |
|---|---|---|
| `runbookName` | string | Azure Automation runbook name |
| `runbookParams` | string | JSON object string of runbook parameters (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ jobId, jobStatus, runbookName }`.

**Dry-run:** Returns synthetic job ID and `jobStatus: "dry-run"` without submitting.

> **Gotcha:** The ARM SDK's `runbookDraft.replaceContent` method treats the content as an LRO and JSON-parses the PowerShell script body, causing a crash. Bypass this by using raw fetch + bearer token for script upload operations — do not use the SDK method directly.

---

### `update_m365_profile`

Same execution path as `execute_runbook` but automatically injects `ClientId` as a runbook parameter sourced from `node.data.clientId`. Used to refresh a specific client's M365 profile data.

| Config Field | Type | Description |
|---|---|---|
| `runbookName` | string | Azure Automation runbook name (e.g. `"Update-M365-Profile"`) |
| `clientId` | string | Client user ID (interpolated) — injected as `ClientId` parameter |
| `runbookParams` | string | Additional JSON runbook parameters (optional) |
| `label` | string | Display label |

**Outputs:** `{ jobId, jobStatus, runbookName }`.

**Dry-run:** Returns synthetic job ID.

---

### `validate_m365_permissions`

Verifies that required Microsoft Graph API permissions are present for a tenant.

| Config Field | Type | Description |
|---|---|---|
| `clientId` | string | Client user ID (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ permissionsValid: boolean, missingCount: number, jobId }`.

**Dry-run:** Returns synthetic result.

---

### `update_intelligence_tables`

Refreshes the M365 intelligence tables from the latest profile data for a client.

| Config Field | Type | Description |
|---|---|---|
| `clientId` | string | Client user ID (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ updated: boolean, recordId, jobId }`.

**Dry-run:** Returns synthetic result.

---

### `generate_diff_report`

Generates a diff report comparing the current M365 profile state against the previous snapshot for a client.

| Config Field | Type | Description |
|---|---|---|
| `clientId` | string | Client user ID (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ documentId, changesFound: boolean, changeCount: number }`.

**Dry-run:** Returns synthetic document ID.

---

### `notify_major_changes`

Sends an alert (via `create_notification`) when a significant number of M365 configuration changes are detected for a client. The `changeThreshold` config field controls when to fire.

| Config Field | Type | Description |
|---|---|---|
| `clientId` | string | Client user ID (interpolated) |
| `changeCount` | number | Number of detected changes (from `generate_diff_report` output) |
| `changeThreshold` | number | Minimum change count to trigger notification (default 15) |
| `label` | string | Display label |

**Outputs:** `{ notified: boolean, skipped: boolean }`.

**Dry-run:** Returns `{ notified: false, skipped: true }`.

---

### `save_to_sharepoint`

Uploads a file to a SharePoint document library via the Microsoft Graph API.

| Config Field | Type | Description |
|---|---|---|
| `siteId` | string | SharePoint site ID |
| `driveId` | string | Drive ID within the site |
| `folderPath` | string | Target folder path, e.g. `"Documents/Reports"` |
| `fileName` | string | File name including extension |
| `fileContentBase64` | string | File content as base64 string (use for binary files) |
| `fileContentText` | string | File content as plain text (use for text files; mutually exclusive with base64) |
| `contentType` | string | MIME type, e.g. `"application/pdf"` |
| `label` | string | Display label |

**Outputs:** `{ sharePointItemId, sharePointWebUrl, sharePointDownloadUrl }`.

**Dry-run:** Returns synthetic SharePoint URLs.

---

### `get_from_sharepoint`

Downloads a file from SharePoint via the Microsoft Graph API.

| Config Field | Type | Description |
|---|---|---|
| `siteId` | string | SharePoint site ID |
| `driveId` | string | Drive ID |
| `itemId` | string | SharePoint item ID (preferred) |
| `itemPath` | string | Item path within the drive (fallback if no `itemId`) |
| `label` | string | Display label |

**Outputs:** `{ fileContentBase64, fileName, mimeType, sharePointWebUrl }`.

**Dry-run:** Returns synthetic file content.

---

### `check_exchange_calendar_availability`

Checks free/busy status on a mailbox via the Microsoft Graph API.

| Config Field | Type | Description |
|---|---|---|
| `userUpn` | string | Mailbox UPN, e.g. `"shane@contoso.com"` |
| `startDateTime` | string | ISO 8601 start, e.g. `"2026-07-10T09:00:00Z"` |
| `endDateTime` | string | ISO 8601 end |
| `label` | string | Display label |

**Outputs:** `{ isBusy: boolean, availableSlots[], busySlots[] }`.

**Dry-run:** Returns `{ isBusy: false, availableSlots: [], busySlots: [] }`.

---

### `create_exchange_calendar_event`

Creates a calendar event via the Microsoft Graph API.

| Config Field | Type | Description |
|---|---|---|
| `userUpn` | string | Organiser mailbox UPN |
| `subject` | string | Event subject (interpolated) |
| `body` | string | Event body HTML (interpolated) |
| `startDateTime` | string | ISO 8601 start |
| `endDateTime` | string | ISO 8601 end |
| `attendees` | string | JSON array of `{ email, name }` objects |
| `label` | string | Display label |

**Outputs:** `{ eventId, eventUrl, eventWebLink }`.

**Dry-run:** Returns synthetic event IDs.

---

## 6. Finance (Stripe)

### `generate_invoice_stripe_payment`

Creates a Stripe invoice, adds line items, finalises it, and returns a hosted invoice URL for manual payment.

| Config Field | Type | Description |
|---|---|---|
| `customerEmail` | string | Customer email for Stripe customer lookup/creation |
| `customerName` | string | Customer name |
| `daysUntilDue` | number | Days until invoice is due |
| `lineItems` | string | JSON array of `{ description, amount, currency, quantity }` |
| `label` | string | Display label |

**Outputs:** `{ invoiceId, invoiceUrl, invoicePdfUrl, amountDue, currency }`.

**Dry-run:** Returns synthetic invoice IDs.

---

### `generate_stripe_payment_link`

Creates a Stripe Payment Link for a product.

| Config Field | Type | Description |
|---|---|---|
| `productName` | string | Product name (creates or reuses a Stripe product) |
| `amount` | number | Amount in cents |
| `currency` | string | Currency code, e.g. `"usd"` |
| `quantity` | number | Quantity (default 1) |
| `metadata` | string | JSON object of Stripe metadata (optional) |
| `label` | string | Display label |

**Outputs:** `{ paymentLinkId, paymentLinkUrl }`.

**Dry-run:** Returns synthetic payment link.

---

### `create_phased_invoices`

Creates one draft Stripe invoice per SOW phase (covering the ~80% balance after the deposit). Stores the deposit session's payment method as the customer default for future auto-charges. Writes `stripeInvoiceId` back to each `workflow_steps` row.

| Config Field | Type | Description |
|---|---|---|
| `projectId` | string | Project ID (interpolated) |
| `clientEmail` | string | Client email (interpolated) |
| `clientName` | string | Client name (interpolated) |
| `depositSessionId` | string | Stripe Checkout Session ID from the deposit (interpolated) |
| `label` | string | Display label |

**Outputs:** `{ invoiceIds[], phaseCount, totalScheduled }`.

**Dry-run:** Returns synthetic invoice IDs and phase count.

---

### `charge_stripe_invoice`

Finalises and immediately charges a draft Stripe invoice. Does not throw on payment failure — instead returns `chargeStatus: "failed"` so a downstream condition node can branch to a failure notification.

| Config Field | Type | Description |
|---|---|---|
| `invoiceId` | string | Stripe invoice ID (reads from `node.data.invoiceId` or the payload's `stripeInvoiceId`) |
| `label` | string | Display label |

**Outputs:** `{ chargeStatus: "succeeded" | "failed" | "pending", amountCharged, stripePaymentIntentId }`.

**Dry-run:** Returns `{ chargeStatus: "dry-run", amountCharged: 0 }`.

---

### `edit_stripe_invoice`

Updates a draft Stripe invoice's due date, description, or footer without finalising it.

| Config Field | Type | Description |
|---|---|---|
| `stripeInvoiceIdExpr` | string | Stripe invoice ID expression (interpolated) |
| `dueDateExpr` | string | New due date as ISO string or Unix timestamp (interpolated) |
| `descriptionExpr` | string | Updated description (optional) |
| `footerExpr` | string | Updated footer note (optional) |
| `label` | string | Display label |

**Outputs:** `{ invoiceId, status, dueDate }`.

**Dry-run:** Returns synthetic output.

---

## 7. Social Media

### `post_linkedin`

Posts to LinkedIn as an organisation via the UGC Posts API. Text-only in this iteration.

| Config Field | Type | Description |
|---|---|---|
| `postBody` | string | Post text (interpolated) |
| `imageUrl` | string | Optional image URL to attach |
| `orgId` | string | Per-node org ID override; falls back to `LINKEDIN_ORG_ID` secret |
| `label` | string | Display label |

**Outputs:** `{ linkedinPostId, linkedinPostUrl, preview }`.

**Dry-run:** Returns synthetic post IDs without publishing.

> **Gotcha:** Requires `LINKEDIN_ACCESS_TOKEN` (60-day OAuth 2.0 token with `w_organization_social` scope) and `LINKEDIN_ORG_ID`. Token expiry is silent — if posts stop working, refresh the access token in Secrets.

---

### `post_twitter`

Posts a tweet via Twitter API v2 using OAuth 1.0a HMAC-SHA1 signing.

| Config Field | Type | Description |
|---|---|---|
| `postBody` | string | Tweet text (interpolated, max 280 chars) |
| `imageUrl` | string | Optional image URL to attach |
| `label` | string | Display label |

**Outputs:** `{ twitterTweetId, twitterTweetUrl, preview }`.

**Dry-run:** Returns synthetic IDs without posting.

> **Gotcha:** Requires four secrets: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`. Signing is done server-side with no external library.

---

### `post_facebook`

Posts to a Facebook Page via Graph API v19.

| Config Field | Type | Description |
|---|---|---|
| `postBody` | string | Post text (interpolated) |
| `imageUrl` | string | Optional image URL to attach |
| `pageId` | string | Per-node page ID override; falls back to `FACEBOOK_PAGE_ID` secret |
| `label` | string | Display label |

**Outputs:** `{ facebookPostId, facebookPostUrl, preview }`.

**Dry-run:** Returns synthetic IDs without posting.

> **Gotcha:** Requires `FACEBOOK_PAGE_ACCESS_TOKEN` (with `pages_manage_posts` and `publish_pages` permissions) and `FACEBOOK_PAGE_ID`.

---

## 8. Data & Variables

### `set_variable`

Declares a new variable in the run's payload with an optional type coercion.

| Config Field | Type | Description |
|---|---|---|
| `variableName` | string | Variable name to set |
| `valueExpr` | string | Value expression (interpolated) |
| `variableType` | string | Type coercion: `"string"` \| `"int"` \| `"float"` \| `"boolean"` \| `"null"` \| `"array"` \| `"object"` \| `"json"` |
| `label` | string | Display label |

**Outputs:** `{ value, variables, [variableName] }` — the variable is also set as a top-level key so it can be referenced as `{{variableName}}` in downstream nodes.

**Dry-run:** Executes normally.

---

### `update_variable`

Updates an existing variable in the payload. Identical inputs and outputs to `set_variable`.

**Dry-run:** Executes normally.

---

### `http_request`

Makes an outbound HTTP request to any URL. Response body is merged into the payload.

| Config Field | Type | Description |
|---|---|---|
| `url` | string | Request URL (interpolated) |
| `method` | string | HTTP method: `GET`, `POST`, `PUT`, `PATCH`, `DELETE` |
| `headers` | string | JSON object of request headers (optional) |
| `body` | string | Request body (optional; interpolated) |
| `label` | string | Display label |

**Outputs:** `{ status: number, ok: boolean, errorDetail?: string }`. Response body fields are merged into the payload if the response is JSON.

**Dry-run:** Returns `{ status: 200, ok: true }` without making the request.

---

### `sql_query`

Executes a raw SQL SELECT against the application database. The first result row's columns are merged into the payload.

| Config Field | Type | Description |
|---|---|---|
| `query` | string | Parameterised SELECT statement. `{{variable}}` references are substituted as positional parameters. |
| `label` | string | Display label |

**Outputs:** All columns from the first result row, merged as top-level payload keys.

**Dry-run:** Returns `{ rows: [] }` without executing.

> **Gotcha:** Only SELECT statements are permitted. The executor blocks DML statements. Use `{{variable}}` substitution for user-controlled values — never string-interpolate user data directly into SQL.

---

### `run_workflow`

Fires another workflow definition synchronously within the current execution context, subject to the `maxRunDepth` limit. The child workflow receives a clean payload (not spread from the parent) — only `inputMapping` keys plus `_parentRunId` and `_depth` are passed through.

| Config Field | Type | Description |
|---|---|---|
| `definitionId` | number | Target workflow definition ID |
| `inputMapping` | object | Key-value pairs to pass to the child workflow as its trigger payload |
| `label` | string | Display label |

**Outputs:** The output of the target workflow's terminal node, merged into the parent payload.

**Dry-run:** Executes the child workflow also in dry-run mode.

> **Gotcha:** `interp()` always stringifies arrays and objects. If `inputMapping` values must be native types (integers, arrays), use `resolveExprNative()` for those fields. If the child workflow's graph is empty or contains no real action nodes, it completes instantly and the parent sees it as auto-completed.

---

### `emit_event`

Broadcasts a named event on the internal workflow event bus. Any other workflow with a matching event trigger will fire asynchronously. This enables **workflow-to-workflow chaining** without direct coupling.

| Config Field | Type | Description |
|---|---|---|
| `eventName` | string | Event name to broadcast |
| `extraPayload` | string | JSON object string of additional payload fields (interpolated; optional) |
| `label` | string | Display label |

**Outputs:** Broadcast only — no payload keys added to the current run.

**Dry-run:** Event broadcast is suppressed to avoid triggering real side effects.

---

### `cancel_workflow`

Cancels the current workflow run immediately.

| Config Field | Type | Description |
|---|---|---|
| `label` | string | Display label |

**Outputs:** `{ cancelled: true }`.

**Dry-run:** Returns `{ cancelled: true }` without modifying the run status.

---

### `create_marketing_campaign`

Creates a new marketing campaign record in the `marketing_campaigns` table.

| Config Field | Type | Description |
|---|---|---|
| `nameExpr` | string | Campaign name (interpolated) |
| `campaignType` | string | `"email"`, `"sms"`, `"linkedin"`, `"twitter"`, `"facebook"`, `"mixed"` |
| `label` | string | Display label |

**Outputs:** `{ campaignId, campaignName, campaignStatus }`.

**Dry-run:** Returns synthetic IDs.

---

### `publish_landing_page`

Publishes a landing page draft to live status.

| Config Field | Type | Description |
|---|---|---|
| `landingPageId` | string | Landing page ID (preferred) |
| `slugExpr` | string | Landing page slug (fallback lookup) |
| `label` | string | Display label |

**Outputs:** `{ landingPageId, slug, published: boolean }`.

**Dry-run:** Returns synthetic output.

---

### `generate_landing_page`

AI-generates a full landing page for a campaign including headline, subheadline, body copy, and CTA sections.

| Config Field | Type | Description |
|---|---|---|
| `campaignBrief` | string | Campaign brief text (interpolated) |
| `targetAudience` | string | Target audience description |
| `service` | string | Service being promoted |
| `label` | string | Display label |

**Outputs:** `{ landingPageId, slug, headline, subheadline, published: boolean }`.

**Dry-run:** Returns synthetic output.

---

## 9. Internal / System

These node types are used internally by the executor and seeded system workflows. They are not available in the builder's node palette for custom workflows.

### `system_action`

Executes a named server-side task registered in the executor. Used exclusively by system workflows. The `task` field maps to an internal function.

| Config Field | Type | Description |
|---|---|---|
| `task` | string | Internal task name: `reconcile_orphaned_runs`, `cleanup_old_runs`, `check_escalations`, `run_monthly_insights`, `auto_fire_kanban`, `save_presentation_phases`, `save_presentation_title` |
| `label` | string | Display label |

**Outputs:** Task-dependent.

**Dry-run:** Task is executed normally (system tasks are non-destructive reads/cleanup operations).

---

### `error`

A visual error handler node. Placed on `onError` edges. Has no special execution logic — it is a structural marker node that the builder uses to render error paths clearly. Execution falls through to any downstream nodes.

| Config Field | Type | Description |
|---|---|---|
| `label` | string | Display label |

**Outputs:** Pass-through.

**Dry-run:** Executes normally.

---

### `annotation`

A non-executing documentation node. Renders a text annotation card on the canvas. Never executed by the workflow engine — it is skipped entirely.

| Config Field | Type | Description |
|---|---|---|
| `text` | string | Annotation text |
| `label` | string | Display label |

**Outputs:** None.

**Dry-run:** Skipped.

---

## 10. Promoted Action Types

The following node `type` values are **first-class aliases** for the generic `action` node with a matching `actionType`. They appear as distinct node types in the graph JSON and in the builder palette, but share the same executor logic as their `action` counterpart.

When adding these nodes via AI generation or manual graph authoring, use the node `type` directly (no `actionType` field required).

| Promoted Type | Equivalent `action` + `actionType` | Notes |
|---|---|---|
| `http_request` | `action` + `actionType: "http_request"` | |
| `sql_query` | `action` + `actionType: "sql_query"` | |
| `send_email` | `action` + `actionType: "send_email"` | |
| `send_sms` | `action` + `actionType: "send_sms"` | |
| `emit_event` | `action` + `actionType: "emit_event"` | |
| `cancel_workflow` | `action` + `actionType: "cancel_workflow"` | |
| `create_lead` | `action` + `actionType: "create_lead"` | |
| `convert_to_opportunity` | `action` + `actionType: "convert_to_opportunity"` | |
| `create_client` | `action` + `actionType: "create_client"` | |
| `create_project` | `action` + `actionType: "create_project"` | |
| `update_m365_profile` | `action` + `actionType: "update_m365_profile"` | Also injects `ClientId` runbook param |
| `execute_runbook` | `action` + `actionType: "execute_runbook"` | |
| `generate_document` | `action` + `actionType: "generate_document"` | |
| `calculate_pricing` | `action` + `actionType: "calculate_pricing"` | Writes SOW pricing lines from a document |
| `run_workflow` | `action` + `actionType: "run_workflow"` | Synchronous child workflow execution |

> **Note:** `calculate_pricing` does not appear in the standard node palette but is used in seeded system workflows (SOW Generation Auto-Retry). It reads `documentId` from `node.data.documentId` and writes computed pricing line items back to the document record.
