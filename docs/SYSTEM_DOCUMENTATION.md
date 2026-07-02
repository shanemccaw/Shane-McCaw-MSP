# Shane McCaw Consulting — Full System Documentation

**Version:** 1.0  
**Date:** July 2, 2026  
**Audience:** Developers, Designers, Product Owners, Onboarding Engineers

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Models](#2-data-models)
3. [API Endpoints](#3-api-endpoints)
4. [Admin Panel](#4-admin-panel)
5. [CRM Dashboard (Client Portal)](#5-crm-dashboard-client-portal)
6. [Public Website & Customer Portal](#6-public-website--customer-portal)
7. [Workflow Engine Integration](#7-workflow-engine-integration)
8. [Events and Actions Reference](#8-events-and-actions-reference)
9. [End-to-End Engagement Flow](#9-end-to-end-engagement-flow)

---

## 1. System Overview

Shane McCaw Consulting is a productized Microsoft 365 consultancy platform with four interconnected artifacts running in a pnpm monorepo:

| Artifact | Kind | Preview Path | Purpose |
|---|---|---|---|
| `shane-mccaw-consulting` | web | `/` | Public marketing website, quiz/lead-gen, micro-offer checkout |
| `admin-panel` | web | `/admin-panel/` | Shane's business operations (sales, delivery, finance, marketing) |
| `crm` | web | `/crm/` | Client-facing portal — onboarding, contract signing, project tracking |
| `api-server` | api | `/api` | Shared Express/Node backend serving all three frontends |
| `shane-mobile` | mobile | `/shane-mobile/` | Shane's native Expo app for mobile alerts and management |

### Tech Stack

- **Runtime:** Node.js 24, TypeScript 5.9
- **Frontend:** React + Vite + Wouter routing + Tailwind CSS v4 + shadcn/ui
- **Backend:** Express.js with Pino logging, JWT auth (15-min access tokens + refresh tokens)
- **Database:** PostgreSQL via Drizzle ORM (`lib/db`)
- **AI:** Anthropic Claude (via Replit AI Integrations proxy)
- **Payments:** Stripe (webhooks, checkout sessions, subscriptions)
- **Email:** Microsoft Graph API / Resend
- **SMS:** Twilio
- **Cloud Automation:** Azure Automation Runbooks + Azure Key Vault
- **Push Notifications:** Web Push (VAPID) + Expo Push (mobile)
- **File Storage:** SharePoint (Microsoft Graph) + Replit Object Storage

---

## 2. Data Models

All tables are defined in `lib/db/src/schema/index.ts` unless noted. Field types follow Drizzle ORM conventions (`serial` = auto-increment integer PK, `text`, `integer`, `numeric`, `boolean`, `timestamp`, `jsonb`).

---

### 2.1 users

Core identity record for both admins and clients.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `email` | text UNIQUE NOT NULL | Login identifier |
| `passwordHash` | text | bcrypt hash |
| `role` | text | `"admin"` or `"client"` (default: `"client"`) |
| `name` | text | Display name |
| `company` | text | Client's company name |
| `phone` | text | |
| `address` | text | Street address |
| `addressCity` | text | |
| `addressState` | text | |
| `addressZip` | text | |
| `sharepointSiteUrl` | text | Provisioned SharePoint site URL |
| `sharepointSiteId` | text | Graph API site ID |
| `onboardingWizardCompletedAt` | timestamp | Set when client completes onboarding |
| `linkedLeadId` | integer | FK to leads — connects purchase to original lead |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  email: string;
  passwordHash: string | null;
  role: "admin" | "client";
  name: string | null;
  company: string | null;
  phone: string | null;
  address: string | null;
  addressCity: string | null;
  addressState: string | null;
  addressZip: string | null;
  sharepointSiteUrl: string | null;
  sharepointSiteId: string | null;
  onboardingWizardCompletedAt: string (ISO 8601) | null;
  linkedLeadId: number | null;
  createdAt: string (ISO 8601);
}
```
---

### 2.2 leads

Contact form and lead magnet submissions. The sales top-of-funnel.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text NOT NULL | |
| `email` | text NOT NULL | |
| `company` | text | |
| `companySize` | text | |
| `serviceArea` | text | Interest area |
| `message` | text | Original message body |
| `source` | text | `"contact_form"`, `"lead_magnet"`, `"ai_recommended"`, `"ai_suggested"`, `"purchase"` |
| `status` | text | `"new"`, `"contacted"`, `"qualified"`, `"converted"`, `"archived"` |
| `howFound` | text | Referral source |
| `score` | integer | AI qualification score (0–100) |
| `previousScore` | integer | Score before last re-scoring |
| `stage` | text | `"Lead"`, `"AQL"`, `"SQL"` |
| `lastQualifiedAt` | timestamp | |
| `industry` | text | |
| `employeeCount` | integer | |
| `licenseTier` | text | M365 license tier |
| `tenantAge` | integer | Years on M365 |
| `itTeamSize` | integer | |
| `painPoints` | jsonb | string[] — extracted pain signals |
| `maturityIndicators` | jsonb | string[] |
| `engagementSignals` | jsonb | string[] |
| `urgencySignals` | jsonb | string[] |
| `role` | text | Job title |
| `phone` | text | |
| `location` | text | |
| `notes` | text | Admin notes |
| `deletedAt` | timestamp | Soft-delete flag |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  name: string;
  email: string;
  company: string | null;
  companySize: string | null;
  serviceArea: string | null;
  message: string | null;
  source: "contact_form" | "lead_magnet" | "ai_recommended" | "ai_suggested" | "purchase";
  status: "new" | "contacted" | "qualified" | "converted" | "archived";
  howFound: string | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
  score: number;
  previousScore: number;
  stage: "Lead" | "AQL" | "SQL";
  lastQualifiedAt: string (ISO 8601) | null;
  industry: string | null;
  employeeCount: number | null;
  licenseTier: string | null;
  tenantAge: number | null;
  itTeamSize: number | null;
  painPoints: string[];
  maturityIndicators: string[];
  engagementSignals: string[];
  urgencySignals: string[];
  role: string | null;
  phone: string | null;
  location: string | null;
  notes: string | null;
  deletedAt: string (ISO 8601) | null;
}
```
---

### 2.3 services

Catalog of all micro-offers, projects, and retainer tiers.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `slug` | text UNIQUE | URL-safe identifier |
| `name` | text NOT NULL | |
| `description` | text | |
| `category` | text | |
| `deliverables` | jsonb | string[] |
| `price` | numeric | |
| `basePrice` / `maxPrice` | numeric | For range-priced wizard services |
| `orderWorkflow` | jsonb | Wizard step config |
| `durationDays` | integer | |
| `turnaround` | text | Human-readable e.g. `"5 business days"` |
| `billingType` | text | `"one_time"` or `"recurring_monthly"` |
| `isPublic` / `visibility` | boolean / text | `"public"`, `"private"`, `"landing_page_only"` |
| `serviceType` | text | |
| `tagline` | text | Short marketing hook |
| `targetAudience` | text | |
| `inclusions` / `features` | jsonb | |
| `badge` | text | e.g. `"Most Popular"` |
| `highlighted` | boolean | |
| `hoursPerMonth` | text | For retainer services |
| `iconName` | text | Lucide icon name |
| `pageHref` / `pageSlug` | text | Link to public service page |
| `sortOrder` | integer | |
| `tier` | text | `"entry"`, `"core"`, `"strategic"` |
| `workflowTemplateId` | integer | FK to workflow_templates — auto-assigns a template on purchase |
| `overviewPdfKey` | text | Object storage key for generated PDF |
| `overviewPdfGeneratedAt` | timestamp | |
| `bestFor` | text | |
| `triggers` | jsonb | Service-page trigger keys |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  slug: string | null;
  name: string;
  description: string | null;
  category: string | null;
  deliverables: string[] | null;
  price: string | null;
  basePrice: string | null;
  maxPrice: string | null;
  orderWorkflow: WizardStep[] | null;
  durationDays: number | null;
  turnaround: string | null;
  billingType: "one_time" | "recurring_monthly";
  isPublic: boolean;
  visibility: "public" | "private" | "landing_page_only";
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
  serviceType: string | null;
  tagline: string | null;
  targetAudience: string | null;
  inclusions: string[] | null;
  features: string[] | null;
  badge: string | null;
  highlighted: boolean;
  hoursPerMonth: string | null;
  iconName: string | null;
  pageHref: string | null;
  pageSlug: string | null;
  sortOrder: number;
  tier: string | null;
  workflowTemplateId: number | null;
  overviewPdfKey: string | null;
  overviewPdfGeneratedAt: string (ISO 8601) | null;
  bestFor: string | null;
  triggers: string[] | null;
}
```
---

### 2.4 projects

Active or completed client engagements.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `title` | text NOT NULL | |
| `description` | text | |
| `status` | text | `"active"`, `"on_hold"`, `"completed"` |
| `phase` | text | Current phase name |
| `progress` | integer | 0–100% |
| `clientUserId` | integer FK → users | |
| `startDate` / `endDate` | timestamp | |
| `projectType` | text | `"project"` or `"retainer"` |
| `sharepointFolderUrl` | text | Client's delivery folder |
| `generatedArtifacts` | jsonb | Metadata for all AI-generated docs |
| `signedOffAt` / `signedOffBy` | timestamp / integer | Project closure sign-off |
| `quickWinElapsedSeconds` | integer | Timing for Quick Win runner |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  title: string;
  description: string | null;
  status: "active" | "on_hold" | "completed";
  phase: string | null;
  progress: number;
  clientUserId: number | null;
  startDate: string (ISO 8601) | null;
  endDate: string (ISO 8601) | null;
  projectType: "project" | "retainer";
  sharepointFolderUrl: string | null;
  generatedArtifacts: Array<{ artifactName: string; sharepointUrl: string; generatedAt: string } | null;
  signedOffAt: string (ISO 8601) | null;
  signedOffBy: number | null;
  quickWinElapsedSeconds: number | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
---

### 2.5 client_services

Links a service to a specific client, including subscription state.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientUserId` | integer FK → users | |
| `serviceId` | integer FK → services | |
| `projectId` | integer FK → projects | |
| `status` | text | `"active"`, `"completed"`, `"paused"` |
| `progress` | integer | |
| `startDate` | timestamp | |
| `nextMilestone` | text | |
| `nextMilestoneDate` | timestamp | |
| `purchasedAt` | timestamp | |
| `stripeSubscriptionId` | text | For recurring services |


**JSON shape:**
```typescript
{
  id: number;
  clientUserId: number;
  serviceId: number;
  projectId: number | null;
  status: "active" | "completed" | "paused";
  progress: number;
  startDate: string (ISO 8601) | null;
  nextMilestone: string | null;
  nextMilestoneDate: string (ISO 8601) | null;
  purchasedAt: string (ISO 8601);
  stripeSubscriptionId: string | null;
}
```
---

### 2.6 workflow_templates / workflow_template_steps / workflow_template_step_tasks

Three-tier hierarchy that defines the automation blueprint for a service.

**workflow_templates**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text | |
| `description` | text | |
| `serviceId` | integer FK → services | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  name: string;
  description: string | null;
  serviceId: number | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**workflow_template_steps**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `workflowTemplateId` | integer FK | |
| `title` | text | Phase name (e.g., `"Discovery"`) |
| `description` | text | |
| `order` | integer | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  workflowTemplateId: number;
  title: string;
  description: string | null;
  order: number;
  createdAt: string (ISO 8601);
}
```
**workflow_template_step_tasks**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `workflowTemplateStepId` | integer FK | |
| `title` | text | Task name |
| `description` | text | |
| `groupName` | text | Visual grouping |
| `order` | integer | |
| `instructions` / `checklist` | jsonb | |
| `artifactsProduced` / `clientDeliverables` | jsonb | |
| `instructionSetId` / `checklistId` / `artifactsId` / `deliverablesId` | integer | FK to asset library records |
| `taskType` | text | `"script"`, `"document_generation"`, `"manual"`, `"customer_task"` |
| `taskMetadata` | jsonb | Type-specific config (e.g., runbook name) |
| `requiresManualRun` | boolean | |
| `isCustomerTask` | boolean | Shown in client portal |
| `runbookId` | uuid | Azure Runbook reference |
| `customerDownloadScriptId` | uuid | Script the client downloads and runs |
| `triggersHealthScore` | boolean | Completion updates M365 health scores |


**JSON shape:**
```typescript
{
  id: number;
  workflowTemplateStepId: number;
  title: string;
  description: string | null;
  groupName: string | null;
  order: number;
  createdAt: string (ISO 8601);
  instructions: string[] | null;
  checklist: Array<{ id: string; label: string } | null;
  artifactsProduced: string[] | null;
  clientDeliverables: string[] | null;
  instructionSetId: number | null;
  checklistId: number | null;
  artifactsId: number | null;
  deliverablesId: number | null;
  taskType: string | null;
  taskMetadata: Record<string, unknown> | null
  requiresManualRun: boolean | null;
  isCustomerTask: boolean | null;
  runbookId: string (UUID) | null;
  customerDownloadScriptId: string (UUID) | null;
  triggersHealthScore: boolean;
}
```
---

### 2.7 workflow_steps

Active phase instances inside a live project (spawned from `workflow_template_steps`).

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `projectId` | integer FK | FK → projects (nullable) |
| `clientServiceId` | integer FK | FK → client_services (nullable) |
| `title` | text NOT NULL | Phase display name |
| `description` | text | Admin notes on this phase |
| `status` | text enum | `"pending"`, `"in_progress"`, `"completed"`, `"blocked"` |
| `order` | integer | Sort order |
| `notes` | text | Runtime notes added during delivery |
| `completedAt` | timestamp | When status changed to `"completed"` |
| `dueDate` | timestamp | Target completion date |
| `workflowTemplateStepId` | integer | Source template step (nullable) |
| `createdAt` | timestamp NOT NULL | |


**JSON shape:**
```typescript
{
  id: number;
  projectId: number | null;
  clientServiceId: number | null;
  title: string;
  description: string | null;
  status: "pending" | "in_progress" | "completed" | "blocked";
  order: number;
  notes: string | null;
  completedAt: string (ISO 8601) | null;
  dueDate: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
  workflowTemplateStepId: number | null;
}
```
---

### 2.8 kanban_tasks

Individual task cards inside a project phase.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `projectId` | integer FK → projects | |
| `title` | text NOT NULL | |
| `description` | text | |
| `column` | text | `"backlog"`, `"in_progress"`, `"waiting_on_customer"`, `"completed"` |
| `order` | integer | |
| `assignedTo` | text | |
| `dueDate` | timestamp | |
| `workflowStepId` | integer FK → workflow_steps | |
| `groupName` | text | Phase grouping label |
| `waitingReason` | text | Populated when column = `"waiting_on_customer"` |
| `completionStatus` / `completionNotes` | text | |
| `priority` | text | Default `"medium"` |
| `sourceEmailId` | integer | |
| `statusReportId` | integer | |
| `taskType` | text | `"script"`, `"document_generation"`, `"manual"`, `"customer_task"` |
| `taskMetadata` | jsonb | Runtime metadata |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  projectId: number;
  title: string;
  description: string | null;
  column: "backlog" | "in_progress" | "waiting_on_customer" | "completed";
  order: number;
  assignedTo: string | null;
  dueDate: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
  workflowStepId: number | null;
  groupName: string | null;
  waitingReason: string | null;
  completionStatus: string | null;
  completionNotes: string | null;
  priority: string;
  sourceEmailId: number | null;
  statusReportId: number | null;
  taskType: string | null;
  taskMetadata: object | null;
}
```
---

### 2.9 invoices

Client billing records.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientUserId` | integer | |
| `projectId` | integer | |
| `invoiceNumber` | text | |
| `description` | text | |
| `amount` | numeric | |
| `currency` | text | |
| `status` | text | `"draft"`, `"due"`, `"paid"`, `"overdue"` |
| `dueDate` | timestamp | |
| `paidAt` | timestamp | |
| `pdfFilename` | text | |
| `stripeSessionId` | text | |
| `sharepointFileUrl` | text | |
| `couponCode` | text | |
| `discountAmount` | numeric | |
| `invoiceType` | text | `"instant"` or `"retainer"` |
| `stripeInvoiceId` | text | |
| `billingCycleStart` / `billingCycleEnd` | timestamp | For retainer invoices |
| `stripeSubscriptionId` | text | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  clientUserId: number;
  projectId: number | null;
  invoiceNumber: string;
  description: string | null;
  amount: string;
  currency: string;
  status: "draft" | "due" | "paid" | "overdue";
  dueDate: string (ISO 8601) | null;
  paidAt: string (ISO 8601) | null;
  pdfFilename: string | null;
  stripeSessionId: string | null;
  sharepointFileUrl: string | null;
  couponCode: string | null;
  discountAmount: string | null;
  invoiceType: "instant" | "retainer";
  stripeInvoiceId: string | null;
  billingCycleStart: string (ISO 8601) | null;
  billingCycleEnd: string (ISO 8601) | null;
  stripeSubscriptionId: string | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
---

### 2.10 contracts

Executed legal agreements with digital signature data.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer | |
| `guestEmail` | text | For pre-registration purchasers |
| `serviceId` | integer FK → services | |
| `signedAt` | timestamp | |
| `signatureData` | text | Base64 canvas data |
| `signerName` | text | |
| `ipAddress` | text | |
| `userAgent` | text | |
| `contractVersion` | text | |
| `stripeSessionId` | text | Linked purchase session |
| `projectId` | integer | |
| `pdfFilename` | text | |
| `finalPrice` | numeric | |
| `wizardSelections` | jsonb | OrderWizard selections |
| `agreementBody` | text | Full rendered HTML at time of signing |
| `sharepointFileUrl` / `sharepointFileId` | text | Filed in SharePoint |
| `localFilePath` | text | |
| `appRegPermissionsAgreed` | boolean | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  userId: number | null;
  guestEmail: string | null;
  serviceId: number;
  signedAt: string (ISO 8601);
  signatureData: string | null;
  signerName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  contractVersion: string;
  stripeSessionId: string | null;
  projectId: number | null;
  pdfFilename: string | null;
  finalPrice: string | null;
  wizardSelections: object | null;
  agreementBody: string | null;
  sharepointFileUrl: string | null;
  sharepointFileId: string | null;
  localFilePath: string | null;
  appRegPermissionsAgreed: boolean;
  createdAt: string (ISO 8601);
}
```
---

### 2.11 opportunities

CRM pipeline records linking a qualified lead to a potential deal.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `leadId` | integer FK → leads | |
| `scoreSnapshot` | integer | Score at time of creation |
| `scoreFit` / `scorePain` / `scoreMaturity` / `scoreIntent` / `scoreUrgency` | integer | Dimension scores (0–100) |
| `evidence` | jsonb | AI-extracted evidence map |
| `recommendedNextStep` | text | AI-generated CTA |
| `workflowType` | text | Engagement type recommendation |
| `state` | text | `"new"`, `"contacted"`, `"qualified"`, `"converted"`, `"archived"`, `"deleted"` |
| `projectId` | integer | Set when converted to project |
| `deletedAt` | timestamp | Soft-delete |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  leadId: number;
  scoreSnapshot: number;
  scoreFit: number;
  scorePain: number;
  scoreMaturity: number;
  scoreIntent: number;
  scoreUrgency: number;
  evidence: string[];
  recommendedNextStep: string | null;
  workflowType: string | null;
  state: "new" | "contacted" | "qualified" | "converted" | "archived" | "deleted";
  projectId: number | null;
  deletedAt: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
}
```
---

### 2.12 status_reports

Admin-authored periodic reports sent to clients.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `projectId` / `clientUserId` | integer | |
| `title` | text | |
| `period` | text | `"weekly"`, `"monthly"`, `"executive_summary"`, `"other"` |
| `reportStatus` | text | `"draft"`, `"sent"` |
| `executiveSummary` | text | |
| `completedActivities` | jsonb | string[] |
| `keyOutcomes` | text | |
| `nextSteps` | jsonb | string[] |
| `reportDate` | timestamp | |
| `sentAt` | timestamp | |
| `clientStatus` | text | `"pending"`, `"accepted"`, `"has_questions"` |
| `clientQuestion` / `adminReply` | text | Q&A thread |
| `replyThread` | jsonb | Full conversation thread |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  projectId: number | null;
  clientUserId: number | null;
  title: string;
  period: "weekly" | "monthly" | "executive_summary" | "other";
  reportStatus: "draft" | "sent";
  executiveSummary: string | null;
  completedActivities: Array<{ title: string; description: string };
  keyOutcomes: string | null;
  nextSteps: Array<{ label: string; title: string; description: string; kanbanTaskId?: number | null };
  reportDate: string (ISO 8601) | null;
  sentAt: string (ISO 8601) | null;
  clientStatus: "pending" | "accepted" | "has_questions";
  clientQuestion: string | null;
  adminReply: string | null;
  replyThread: Array<{ sender: "client" | "admin"; content: string; timestamp: string };
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
---

### 2.13 client_app_registrations

Azure App Registration credentials submitted by clients for automation access.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientUserId` | integer UNIQUE | |
| `tenantId` | text | Azure AD tenant ID |
| `azureClientId` | text | App registration client ID |
| `keyVaultSecretName` | text | Where the secret is stored |
| `status` | text | `"pending"`, `"submitted"`, `"verified"` |
| `submittedAt` / `verifiedAt` | timestamp | |
| `connectionTestedAt` | timestamp | |
| `permissionCheck` | jsonb | Results of permission validation |
| `recheckLockedUntil` | timestamp | Rate limiting for rechecks |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  clientUserId: number;
  tenantId: string;
  azureClientId: string;
  keyVaultSecretName: string;
  status: "pending" | "submitted" | "verified";
  submittedAt: string (ISO 8601) | null;
  verifiedAt: string (ISO 8601) | null;
  connectionTestedAt: string (ISO 8601) | null;
  permissionCheck: PermissionCheckResult | null;
  recheckLockedUntil: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
---

### 2.14 insights_generated_documents

AI-generated reports and SOWs for client delivery.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `customerId` / `projectId` | integer | |
| `category` | text | `"report"`, `"consulting"` |
| `docType` | text | `"tenant_health_report"`, `"sow"`, etc. |
| `title` | text | |
| `htmlContent` | text | Full AI-generated HTML |
| `pdfUrl` | text | Object storage URL |
| `status` | text | `"draft"`, `"approved"`, `"delivered"`, `"archived"` |
| `approvedAt` / `deliveredAt` | timestamp | |
| `sowPricingLines` | jsonb | Parsed pricing from SOW |
| `sowTotalPrice` | numeric | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  customerId: number | null;
  projectId: number | null;
  category: "report" | "consulting";
  docType: string;
  title: string;
  htmlContent: string;
  pdfUrl: string | null;
  status: "draft" | "approved" | "delivered" | "archived";
  approvedAt: string (ISO 8601) | null;
  deliveredAt: string (ISO 8601) | null;
  sowPricingLines: object | null;
  sowTotalPrice: string | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
---

### 2.15 quick_win_presentations

Interactive SOW/presentation objects shared with clients for selection and sign-off.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `projectId` / `clientUserId` | integer | |
| `shareToken` | text UNIQUE | Public shareable token |
| `documentsIncluded` | jsonb | number[] — document IDs included |
| `sowPhases` | jsonb | Available phases with pricing |
| `selectedPhaseIds` | jsonb | Client's selections |
| `totalPrice` | numeric | |
| `signatureData` | text | Raw signature canvas data |
| `signedAt` | timestamp | When client signed |
| `signerName` | text | Name as entered by signer |
| `paymentPlan` | text enum | `"full"` or `"phased"` |
| `stripeSessionId` | text | Stripe checkout session ID |
| `paymentSchedule` | jsonb | Phase-based payment schedule array |
| `status` | text enum | `"draft"`, `"signed"`, `"paid"` |
| `createdAt` | timestamp NOT NULL | |
| `updatedAt` | timestamp NOT NULL | |


**JSON shape:**
```typescript
{
  id: number;
  projectId: number | null;
  clientUserId: number | null;
  shareToken: string | null;
  documentsIncluded: number[] | null;
  sowPhases: object | null;
  selectedPhaseIds: string[] | null;
  totalPrice: string | null;
  signatureData: string | null;
  signedAt: string (ISO 8601) | null;
  signerName: string | null;
  paymentPlan: "full" | "phased" | null;
  stripeSessionId: string | null;
  paymentSchedule: object | null;
  status: "draft" | "signed" | "paid";
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
---

### 2.16 powershell_scripts / script_packages / script_modules

Three-tier library of M365 automation scripts uploaded to Azure Automation.

**powershell_scripts**

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` / `description` | text | |
| `category` | text | |
| `scriptBody` | text | Raw PowerShell |
| `permissions` | jsonb | Required M365 permissions |
| `tags` | text[] | |
| `azureRunbookName` | text | Deployed runbook name |
| `azureSyncedAt` | timestamp | When last pushed to Azure |


**JSON shape:**
```typescript
{
  id: string (UUID) | null;
  title: string;
  description: string | null;
  category: string;
  scriptBody: string;
  permissions: PsScriptPermissions;
  tags: string;
  azureRunbookName: string | null;
  azureSyncedAt: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**script_packages** — A named collection of related PowerShell scripts, pushed together to Azure Automation.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `title` | text NOT NULL | Display name |
| `category` | text | Default `"other"` |
| `permissions` | jsonb | `{ appPermissions[], delegatedPermissions[], notes }` |
| `tags` | text[] | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: string (UUID) | null;
  title: string;
  category: string;
  permissions: PsScriptPermissions;
  tags: string;
  createdAt: string (ISO 8601);
}
```
**script_modules** — Individual modular scripts within a package, each mapped to a single Azure Automation runbook.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `packageId` | uuid FK NOT NULL | FK → script_packages (cascade delete) |
| `filename` | text NOT NULL | Runbook filename |
| `description` | text | |
| `content` | text NOT NULL | Raw PowerShell body |
| `sortOrder` | integer | Execution order within package |
| `azureRunbookName` | text | Deployed runbook name in Azure Automation |
| `sourceScriptId` | uuid | Origin powershell_scripts record (nullable) |
| `sourceTaskIds` | integer[] | Workflow template task IDs that generated this module |
| `azureSyncedAt` | timestamp | When last pushed |
| `permissions` | jsonb | `{ appPermissions[], delegatedPermissions[], notes }` |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: string (UUID) | null;
  packageId: string (UUID);
  filename: string;
  description: string | null;
  content: string;
  sortOrder: number;
  azureRunbookName: string | null;
  sourceScriptId: string (UUID) | null;
  sourceTaskIds: number | null;
  azureSyncedAt: string (ISO 8601) | null;
  permissions: PsScriptPermissions | null;
  createdAt: string (ISO 8601);
}
```
**service_script_sets** — Junction table linking a service to one or more script packages. Defines which packages run automatically when a service is activated.

| Field | Type | Notes |
|---|---|---|
| `serviceId` | integer FK NOT NULL | FK → services (cascade delete) |
| `scriptPackageId` | uuid FK NOT NULL | FK → script_packages (cascade delete) |
| `displayOrder` | integer NOT NULL | Run order; default `0` |


**JSON shape:**
```typescript
{
  serviceId: number;
  scriptPackageId: string (UUID);
  displayOrder: number;
}
```
Primary key: `(serviceId, scriptPackageId)`.

---

### 2.17 client_m365_profiles / client_scores / client_health_history

M365 environment intelligence per client.

**client_m365_profiles** — Full JSON snapshot of the client's Microsoft 365 environment.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientId` | integer FK UNIQUE NOT NULL | FK → users (one-to-one; cascade delete) |
| `profile` | jsonb NOT NULL | Freeform M365 environment snapshot: `{ tenantAge, licenseCount, securityDefaults, mfaStatus, ... }`. Default `{}`. |
| `createdAt` | timestamp NOT NULL | |
| `updatedAt` | timestamp NOT NULL | |


**JSON shape:**
```typescript
{
  id: number;
  clientId: number;
  profile: Record<string, unknown>
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**client_scores** — Aggregated category scores, updated after each script run.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientId` | integer FK UNIQUE NOT NULL | FK → users (one-to-one; cascade delete) |
| `identity` | integer NOT NULL | Score 0–100; default 0 |
| `security` | integer NOT NULL | Score 0–100; default 0 |
| `collaboration` | integer NOT NULL | Score 0–100; default 0 |
| `compliance` | integer NOT NULL | Score 0–100; default 0 |
| `copilotReadiness` | integer NOT NULL | Score 0–100; default 0 |
| `updatedAt` | timestamp NOT NULL | |


**JSON shape:**
```typescript
{
  id: number;
  clientId: number;
  identity: number;
  security: number;
  collaboration: number;
  compliance: number;
  copilotReadiness: number;
  updatedAt: string (ISO 8601);
}
```
**client_health_history** — Time-series snapshots of a single category score; used for trend charts.

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientId` | integer FK NOT NULL | FK → users (cascade delete) |
| `category` | text enum NOT NULL | `"governance"`, `"security"`, `"compliance"`, `"copilot"`, `"identity"`, `"collaboration"`, `"productivity"`, `"data"` |
| `score` | integer NOT NULL | Point-in-time score |
| `recordedAt` | timestamp NOT NULL | |
| `sourceKanbanTaskId` | integer FK | FK → kanban_tasks — the task that triggered this snapshot (nullable) |


**JSON shape:**
```typescript
{
  id: number;
  clientId: number;
  category: string | null;
  score: number;
  recordedAt: string (ISO 8601);
  sourceKanbanTaskId: number | null;
}
```
---

### 2.18 Quiz & Lead Data

**quiz_leads** — Full quiz result records (Copilot readiness, governance, M365 health)

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` / `email` / `company` | text | |
| `totalScore` | integer | Aggregate score |
| `tier` | text | `"Beginner"`, `"Developing"`, `"Ready"` etc. |
| `recommendedService` | text | Service slug to upsell |
| `categoryScores` | jsonb | `{ [category]: score }` |
| `analysisText` | jsonb | AI-generated per-category analysis |
| `conversation` | jsonb | Full chat message history |
| `quizType` | text | `"copilot"`, `"governance"`, `"m365_health"`, `"quick_win"` |
| `createdAt` | timestamp | |
| `contactedAt` | timestamp | When Shane followed up |


**JSON shape:**
```typescript
{
  id: number;
  name: string;
  email: string;
  company: string | null;
  totalScore: number;
  tier: string;
  recommendedService: string | null;
  categoryScores: Record<string, number>
  analysisText: QuizAnalysisText | null;
  conversation: QuizConversationEntry[];
  quizType: string;
  createdAt: string (ISO 8601);
  contactedAt: string (ISO 8601) | null;
}
```
**quick_win_quiz_results** — Ranked service recommendations from the Quick Win selector quiz

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `answers` | jsonb | Raw question answers |
| `scores` | jsonb | Per-category weighted scores |
| `rankedSlugs` | jsonb | Ordered service slug array |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  answers: Record<string, number>
  scores: Record<string, number>
  rankedSlugs: string[];
  createdAt: string (ISO 8601);
}
```
**quiz_analytics_events** — Fine-grained quiz funnel events

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `eventName` | text | e.g. `"quiz_started"`, `"question_answered"` |
| `properties` | jsonb | Arbitrary event metadata |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  eventName: string;
  properties: Record<string, string | number | boolean>
  createdAt: string (ISO 8601);
}
```
**quiz_pain_signal_config** — Admin-managed mapping of quiz category scores to CRM pain signals

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `quizTypePainMap` | jsonb | `{ [quizType]: { [score_range]: signal[] } }` |
| `categoryPainMap` | jsonb | `{ [category]: signal[] }` |
| `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  quizTypePainMap: Record<string, string[]>
  categoryPainMap: [string, string][];
  updatedAt: string (ISO 8601);
}
```
---

### 2.19 Analytics

**analytics_sessions**

| Field | Type | Notes |
|---|---|---|
| `sessionId` | text PK | Browser-generated UUID |
| `entryPage` | text | First page visited |
| `referrer` | text | HTTP referrer |
| `utmSource` / `utmMedium` / `utmCampaign` / `utmContent` / `utmTerm` | text | UTM parameters |
| `deviceType` / `browser` / `country` | text | |
| `startedAt` / `lastSeenAt` | timestamp | |
| `totalSeconds` | integer | Session duration |
| `isBounce` | boolean | |
| `identifiedEmail` | text | Set if session is linked to a lead |


**JSON shape:**
```typescript
{
  sessionId: string | null;
  entryPage: string;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  deviceType: string | null;
  browser: string | null;
  country: string | null;
  startedAt: string (ISO 8601);
  lastSeenAt: string (ISO 8601);
  totalSeconds: number;
  isBounce: boolean;
  identifiedEmail: string | null;
}
```
**analytics_pageviews**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `sessionId` | text | FK to analytics_sessions |
| `page` / `title` | text | |
| `enteredAt` / `exitedAt` | timestamp | |
| `durationSeconds` / `maxScrollPct` | integer | |


**JSON shape:**
```typescript
{
  id: number;
  sessionId: string;
  page: string;
  title: string | null;
  enteredAt: string (ISO 8601);
  exitedAt: string (ISO 8601) | null;
  durationSeconds: number | null;
  maxScrollPct: number;
}
```
**analytics_site_events**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `sessionId` | text | |
| `page` | text | |
| `eventType` | text | e.g. `"cta_click"`, `"form_submit"` |
| `elementLabel` / `elementHref` | text | |
| `metadata` | jsonb | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  sessionId: string;
  page: string;
  eventType: string;
  elementLabel: string | null;
  elementHref: string | null;
  metadata: Record<string, unknown> | null
  createdAt: string (ISO 8601);
}
```
---

### 2.20 Email & Communication

**emails** — Microsoft Graph ingested email records

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `messageId` | text UNIQUE | Graph message ID |
| `subject` / `senderAddress` / `senderDomain` | text | |
| `bodyPreview` | text | First 250 chars |
| `receivedAt` | timestamp | |
| `rawFrom` | text | Full From header |
| `linkedUserId` / `linkedProjectId` / `linkedLeadId` | integer | Auto-linked via domain rules |
| `ingestedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  messageId: string;
  subject: string | null;
  senderAddress: string;
  senderDomain: string;
  bodyPreview: string | null;
  receivedAt: string (ISO 8601);
  rawFrom: string | null;
  linkedUserId: number | null;
  linkedProjectId: number | null;
  linkedLeadId: number | null;
  ingestedAt: string (ISO 8601);
}
```
**email_domain_rules** — Mapping rules for auto-assigning emails to CRM entities

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `domain` | text UNIQUE | e.g. `"contoso.com"` |
| `linkedUserId` | integer | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  domain: string;
  linkedUserId: number;
  createdAt: string (ISO 8601);
}
```
**email_templates** — Editable transactional email copy

| Field | Type | Notes |
|---|---|---|
| `slug` | text PK | e.g. `"welcome"`, `"status_report"` |
| `name` | text | Human-readable label |
| `subject` | text | Email subject line |
| `bodyHtml` | text | Handlebars-style HTML template |
| `variables` | jsonb | `string[]` — available template variables |
| `recipientType` | text | `"client"` or `"admin"` |
| `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  slug: string | null;
  name: string;
  subject: string;
  bodyHtml: string;
  variables: Array<{ name: string; description: string };
  recipientType: "client" | "admin";
  updatedAt: string (ISO 8601);
}
```
**email_events** — Resend webhook delivery tracking

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `emailId` | text | Resend email ID |
| `eventType` | text | `"sent"`, `"delivered"`, `"opened"`, `"clicked"`, `"bounced"`, `"complained"`, `"unsubscribed"` |
| `recipient` / `subject` | text | |
| `occurredAt` | timestamp | |
| `metadata` | jsonb | |
| `campaignId` / `leadId` | integer | Optional attribution |


**JSON shape:**
```typescript
{
  id: number;
  emailId: string;
  eventType: "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "unsubscribed";
  recipient: string | null;
  subject: string | null;
  occurredAt: string (ISO 8601);
  metadata: Record<string, unknown> | null
  campaignId: number | null;
  leadId: number | null;
}
```
**inbox_message_links** — Links Graph messages to CRM entities

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `graphMessageId` | text UNIQUE | |
| `leadId` / `opportunityId` / `customerId` / `taskId` | integer | Optional FK to each CRM entity |
| `direction` | text | `"inbound"` or `"outbound"` |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  graphMessageId: string;
  leadId: number | null;
  opportunityId: number | null;
  customerId: number | null;
  taskId: number | null;
  direction: "inbound" | "outbound";
  createdAt: string (ISO 8601);
}
```
---

### 2.21 Finance & Coupons

**coupons**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `code` | text UNIQUE | |
| `discountType` | text | `"fixed"` or `"percentage"` |
| `discountValue` | numeric | Amount or percentage |
| `maxUses` | integer | |
| `usesCount` | integer | |
| `active` | boolean | |
| `expiresAt` | timestamp | |
| `requiresTestimonial` | boolean | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  code: string;
  discountType: "fixed" | "percentage";
  discountValue: string;
  maxUses: number | null;
  usesCount: number;
  active: boolean;
  expiresAt: string (ISO 8601) | null;
  requiresTestimonial: boolean;
  createdAt: string (ISO 8601);
}
```
**coupon_redemptions**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `couponCode` | text | |
| `checkoutSessionId` | text UNIQUE | Stripe session |
| `couponId` / `userId` | integer | |
| `purchaseAmount` / `discountAmount` | numeric | |
| `redeemedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  couponCode: string;
  checkoutSessionId: string;
  couponId: number | null;
  userId: number | null;
  purchaseAmount: string | null;
  discountAmount: string | null;
  redeemedAt: string (ISO 8601);
}
```
---

### 2.22 Auth & Security Tokens

**password_reset_tokens**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer | |
| `token` | text UNIQUE | Securely random |
| `expiresAt` / `usedAt` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  userId: number;
  token: string;
  expiresAt: string (ISO 8601);
  usedAt: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
}
```
**account_setup_tokens** — First-time password setup for new client accounts

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer | |
| `token` | text UNIQUE | |
| `expiresAt` / `usedAt` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  userId: number;
  token: string;
  expiresAt: string (ISO 8601);
  usedAt: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
}
```
**impersonation_tokens** — Admin impersonation of client sessions

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `token` | text UNIQUE | |
| `clientUserId` / `adminUserId` | integer | |
| `expiresAt` / `usedAt` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  token: string;
  clientUserId: number;
  adminUserId: number;
  expiresAt: string (ISO 8601);
  usedAt: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
}
```
**mfa_enrollments**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer FK → users | |
| `method` | text | `"totp"`, `"sms"`, `"passkey"` |
| `enabled` | boolean | |
| `encryptedSecret` | text | AES-encrypted TOTP secret |
| `phone` | text | For SMS MFA |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  userId: number;
  method: "totp" | "sms" | "passkey";
  enabled: boolean;
  encryptedSecret: string | null;
  phone: string | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**mfa_challenges** — One-time challenge records

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer FK | FK → users |
| `method` | text enum | `"totp"`, `"sms"`, `"passkey"` |
| `phone` | text | Phone number (SMS method only) |
| `codeHash` | text | bcrypt-hashed one-time code |
| `expiresAt` / `usedAt` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  userId: number;
  method: "totp" | "sms" | "passkey";
  codeHash: string | null;
  phone: string | null;
  expiresAt: string (ISO 8601);
  usedAt: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
}
```
**webauthn_credentials** — Passkey public keys

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer | |
| `credentialId` | text UNIQUE | |
| `publicKey` | text | COSE-encoded public key |
| `counter` | bigint | Replay protection counter |
| `deviceType` | text | |
| `backedUp` | boolean | |
| `transports` | jsonb | string[] |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  userId: number;
  credentialId: string;
  publicKey: string;
  counter: number;
  deviceType: string | null;
  backedUp: boolean;
  transports: string[] | null;
  createdAt: string (ISO 8601);
}
```
**webauthn_challenges**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer | |
| `challenge` | text | Base64url random challenge |
| `purpose` | text | `"registration"` or `"authentication"` |
| `expiresAt` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  userId: number | null;
  challenge: string;
  purpose: "registration" | "authentication";
  expiresAt: string (ISO 8601);
  createdAt: string (ISO 8601);
}
```
---

### 2.23 Script Execution

**runbook_job_history** — Azure Automation job audit trail

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `jobId` | text UNIQUE | Azure job GUID |
| `runbookName` | text | |
| `credentialId` | integer | FK to azure_tenant_credentials |
| `customerName` | text | |
| `status` | text | `"running"`, `"completed"`, `"failed"` |
| `output` | text | Raw script output |
| `startedAt` / `completedAt` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  jobId: string;
  runbookName: string;
  credentialId: number | null;
  customerName: string;
  status: string;
  output: string | null;
  startedAt: string (ISO 8601);
  completedAt: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
}
```
**script_run_results** — Parsed output and scoring from each script execution

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `customerId` | integer | |
| `scriptId` | integer | Legacy script ID reference |
| `libraryScriptId` | uuid FK | FK → powershell_scripts (nullable) |
| `packageId` | integer FK | FK → services — the service that triggered this run (nullable) |
| `jobId` | text | Azure job ID |
| `rawOutput` | jsonb | Raw output lines |
| `parsedFindings` | jsonb | Structured findings array |
| `recommendations` | jsonb | AI-generated recommendations |
| `scoreImpact` | jsonb | `{ [category]: delta }` |
| `profileUpdates` | jsonb | Updates to apply to client_m365_profiles |
| `status` | text | `"running"`, `"completed"`, `"failed"`, `"awaiting_upload"` |
| `executionSource` | text | `"automated"`, `"manual"`, `"customer_upload"` |
| `kanbanTaskId` | integer | |
| `uploadedBy` / `scriptName` | text | |
| `uploadedAt` / `reviewedAt` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  customerId: number | null;
  scriptId: number | null;
  libraryScriptId: string (UUID) | null;
  packageId: number | null;
  jobId: string | null;
  rawOutput: Record<string, unknown>
  parsedFindings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>
  profileUpdates: Record<string, unknown>
  status: "running" | "completed" | "failed" | "awaiting_upload";
  executionSource: "automated" | "manual" | "customer_upload";
  kanbanTaskId: number | null;
  uploadedBy: string | null;
  uploadedAt: string (ISO 8601) | null;
  reviewedAt: string (ISO 8601) | null;
  scriptName: string | null;
  createdAt: string (ISO 8601);
}
```
**client_automation_runs** — Live status of a multi-module automation sequence

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientUserId` | integer FK → users | |
| `triggeredAt` | timestamp | |
| `status` | text | `"pending"`, `"running"`, `"completed"`, `"failed"` |
| `currentPackageId` / `currentModuleId` | uuid | Active package/module |
| `modulesCompleted` / `modulesTotal` | integer | Progress counters |
| `lastLogSnippet` / `errorMessage` | text | |
| `finishedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  clientUserId: number;
  triggeredAt: string (ISO 8601);
  status: "pending" | "running" | "completed" | "failed";
  currentPackageId: string (UUID) | null;
  currentModuleId: string (UUID) | null;
  modulesCompleted: number;
  modulesTotal: number;
  lastLogSnippet: string | null;
  errorMessage: string | null;
  finishedAt: string (ISO 8601) | null;
}
```
**client_callback_tokens** — Secure one-time tokens for script post-back from client machines

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `tokenHash` | text UNIQUE | SHA-256 hash of bearer token |
| `label` | text | Human-readable label |
| `clientUserId` / `projectId` / `scriptRunResultId` | integer | |
| `createdAt` / `revokedAt` / `lastUsedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  tokenHash: string;
  label: string;
  clientUserId: number;
  projectId: number | null;
  scriptRunResultId: number | null;
  createdAt: string (ISO 8601);
  revokedAt: string (ISO 8601) | null;
  lastUsedAt: string (ISO 8601) | null;
}
```
**azure_tenant_credentials** — Admin-managed Azure credentials per client (secrets in Key Vault)

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientUserId` | integer | |
| `displayName` | text | |
| `tenantId` / `clientId` | text | Azure AD identifiers |
| `credentialType` | text | `"secret"` or `"certificate"` |
| `keyVaultSecretName` | text | Key Vault reference (secret never stored in DB) |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  clientUserId: number | null;
  displayName: string;
  tenantId: string;
  clientId: string;
  credentialType: "secret" | "certificate";
  keyVaultSecretName: string;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
---

### 2.24 Marketing & CRM Pipeline

**engagement_projects** — Public-facing engagement model templates

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `title` | text | |
| `priceRange` | text | e.g. `"$7,500 – $15,000"` |
| `description` | text | |
| `triggeredBy` | jsonb | string[] — signals that trigger this offer |
| `sowItems` | jsonb | string[] — default SOW line items |
| `pages` | jsonb | string[] — linked public pages |
| `sortOrder` | integer | |
| `isVisible` | boolean | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  title: string;
  priceRange: string;
  description: string | null;
  triggeredBy: string[];
  sowItems: string[];
  pages: string[];
  sortOrder: number;
  isVisible: boolean;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**campaigns**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` / `goal` / `audience` / `offer` | text | |
| `status` | text | `"draft"`, `"active"`, `"paused"`, `"completed"` |
| `startDate` / `endDate` | timestamp | |
| `offerId` | integer | |
| `leadsGenerated` / `emailsSent` | integer | |
| `revenueAttributed` | numeric | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  name: string;
  goal: string;
  audience: string;
  offer: string;
  status: "draft" | "active" | "paused" | "completed";
  startDate: string (ISO 8601) | null;
  endDate: string (ISO 8601) | null;
  offerId: number | null;
  leadsGenerated: number;
  emailsSent: number;
  revenueAttributed: string;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**campaign_assets**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `campaignId` | integer FK → campaigns | |
| `assetType` | text | `"landing_copy"`, `"email_sequence"`, `"social_post"`, `"follow_up_task"`, etc. |
| `title` / `content` | text | |
| `metadata` | jsonb | |
| `generatedWithOfferIds` | jsonb | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  campaignId: number | null;
  assetType: "landing_copy" | "email_sequence" | "social_post" | "follow_up_task" | "blog_post" | "linkedin_post" | "newsletter" | "seo_keywords" | "lead_magnet" | "ad_google" | "ad_linkedin" | "ad_retargeting" | "ad_creative" | "landing_page";
  title: string;
  content: string;
  metadata: Record<string, unknown> | null
  generatedWithOfferIds: number[] | null | null;
  createdAt: string (ISO 8601);
}
```
**offers**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` / `goal` / `audience` / `pricing` / `cta` | text | |
| `deliverables` / `outcomes` | jsonb | string[] |
| `campaignId` | integer | |
| `metadata` | jsonb | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  name: string;
  goal: string;
  audience: string;
  pricing: string | null;
  deliverables: string[];
  outcomes: string[];
  cta: string | null;
  campaignId: number | null;
  metadata: Record<string, unknown> | null
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**landing_pages** — Dynamic campaign landing page records

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `slug` | text UNIQUE | URL path |
| `title` | text | |
| `campaignId` | integer | |
| `headline` / `subheadline` | text | |
| `valuePropBlocks` / `socialProof` / `cta` / `layoutBlocks` | jsonb | Page content blocks |
| `linkedServiceId` | integer | |
| `published` | boolean | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  slug: string;
  title: string;
  campaignId: number | null;
  headline: string | null;
  subheadline: string | null;
  valuePropBlocks: Array<{ icon?: string; heading: string; body: string };
  socialProof: Array<{ quote: string; author: string; role?: string };
  cta: { buttonText: string; href: string; subtext?: string } | null;
  layoutBlocks: Array<{ blockType: string; content: unknown };
  linkedServiceId: number | null;
  published: boolean;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**recommended_leads** — AI-generated ideal prospect profiles

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` / `company` / `role` / `email` / `phone` / `industry` / `companySize` / `location` | text | |
| `painPoints` | jsonb | string[] |
| `whyFit` | text | AI rationale |
| `recommendedService` | text | |
| `confidence` | integer | 0–100 |
| `status` | text | `"pending"`, `"converted"`, `"dismissed"` |
| `convertedLeadId` | integer | |
| `lastOutreachDraft` | text | |
| `generatedAt` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  name: string;
  company: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
  companySize: string | null;
  location: string | null;
  painPoints: string[];
  whyFit: string | null;
  recommendedService: string | null;
  confidence: number;
  status: "pending" | "converted" | "dismissed";
  convertedLeadId: number | null;
  lastOutreachDraft: string | null;
  generatedAt: string (ISO 8601);
  createdAt: string (ISO 8601);
}
```
**outreach_templates**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text | |
| `templateType` | text | `"cold_email"`, `"linkedin"`, `"followup"`, `"cold_call"` |
| `subject` / `body` | text | |
| `leadId` | integer | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  name: string;
  templateType: "cold_email" | "linkedin" | "followup" | "cold_call";
  subject: string | null;
  body: string;
  leadId: number | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**marketing_tasks**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `title` / `description` | text | |
| `status` | text | `"ideas"`, `"in_progress"`, `"scheduled"`, `"published"`, `"completed"`, `"money_task"` |
| `order` | integer | Sort order in the task board |
| `dueDate` | timestamp | Optional due date |
| `relatedLeadId` / `relatedCampaignId` | integer | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  title: string;
  description: string | null;
  status: "ideas" | "in_progress" | "scheduled" | "published" | "completed" | "money_task";
  order: number;
  dueDate: string (ISO 8601) | null;
  relatedLeadId: number | null;
  relatedCampaignId: number | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**follow_up_events**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `leadId` / `campaignId` | integer | |
| `scheduledAt` / `completedAt` | timestamp | |
| `channel` | text | `"email"`, `"linkedin"`, `"phone"`, `"other"` |
| `subject` / `aiDraftContent` | text | |
| `status` | text | `"pending"`, `"completed"`, `"overdue"`, `"skipped"` |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  leadId: number | null;
  campaignId: number | null;
  scheduledAt: string (ISO 8601);
  completedAt: string (ISO 8601) | null;
  channel: "email" | "linkedin" | "phone" | "other";
  subject: string | null;
  aiDraftContent: string | null;
  status: "pending" | "completed" | "overdue" | "skipped";
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**lead_qualifications** — AI-generated qualification recommendations pending admin approval

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `stage` | text | `"AQL"` or `"SQL"` |
| `recommendedNextStep` / `workflowType` | text | |
| `evidence` | jsonb | Supporting evidence map |
| `scoreFit` / `scorePain` / `scoreMaturity` / `scoreIntent` / `scoreUrgency` | integer | |
| `status` | text | `"pending"`, `"approved"`, `"rejected"`, `"snoozed"` |
| `snoozedUntil` | timestamp | |
| `opportunityId` | integer | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  leadId: number;
  newScore: number;
  previousScore: number;
  stage: "AQL" | "SQL";
  recommendedNextStep: string | null;
  workflowType: string | null;
  evidence: string[];
  scoreFit: number;
  scorePain: number;
  scoreMaturity: number;
  scoreIntent: number;
  scoreUrgency: number;
  status: "pending" | "approved" | "rejected" | "snoozed";
  snoozedUntil: string (ISO 8601) | null;
  opportunityId: number | null;
  createdAt: string (ISO 8601);
}
```
**lead_intent_events** — Behavioral signal stream

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `leadId` | integer FK → leads | |
| `eventType` | text | `"email_open"`, `"link_click"`, `"cta_click"`, `"site_visit"`, `"form_submit"`, `"reply"` |
| `metadata` | jsonb | |
| `occurredAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  leadId: number;
  eventType: "email_open" | "link_click" | "cta_click" | "site_visit" | "form_submit" | "reply";
  metadata: Record<string, unknown> | null
  occurredAt: string (ISO 8601);
}
```
**opportunity_tasks**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `opportunityId` | integer FK → opportunities | |
| `title` / `description` | text | |
| `dueDate` | timestamp | |
| `assignedTo` | text | |
| `status` | text | `"todo"`, `"in_progress"`, `"done"` |
| `kanbanTaskId` | integer | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  opportunityId: number;
  title: string;
  description: string | null;
  dueDate: string (ISO 8601) | null;
  assignedTo: string;
  status: "todo" | "in_progress" | "done";
  kanbanTaskId: number | null;
  createdAt: string (ISO 8601);
}
```
---

### 2.25 AI Intelligence

**next_best_actions** — AI-generated action recommendations per entity

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `entityType` | text | `"client"`, `"project"`, `"lead"`, `"opportunity"`, `"general"` |
| `entityId` / `entityName` | integer / text | |
| `action` | text | Recommended action |
| `rationale` | text | |
| `confidence` | integer | 0–100 |
| `linkPath` | text | Deep link in Admin Panel |
| `resolvedAt` / `generatedAt` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  entityType: "client" | "project" | "lead" | "opportunity" | "general";
  entityId: number | null;
  entityName: string | null;
  action: string;
  rationale: string | null;
  confidence: number;
  linkPath: string | null;
  resolvedAt: string (ISO 8601) | null;
  generatedAt: string (ISO 8601);
  createdAt: string (ISO 8601);
}
```
**revenue_forecasts** — AI-generated revenue predictions

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `period` | text | e.g. `"2026-07"` |
| `forecast` / `lowerBound` / `upperBound` | numeric | |
| `narrative` | text | AI explanation |
| `generatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  period: string;
  forecast: string;
  lowerBound: string;
  upperBound: string;
  narrative: string | null;
  generatedAt: string (ISO 8601);
}
```
**ai_prompts** — Centralised AI prompt library (admin-editable)

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `key` | text UNIQUE | Machine identifier |
| `name` / `description` | text | |
| `category` | text | `"scripting"`, `"marketing"`, `"advisory"`, etc. |
| `featureArea` / `featureRoute` | text | Which Admin Panel page uses this |
| `model` | text | Claude model string |
| `promptBody` | text | Live prompt (editable) |
| `defaultBody` | text | Factory reset value |
| `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  key: string;
  systemPrompt: string;
  userTemplate: string | null;
  updatedAt: string (ISO 8601);
}
```
**insights_automations** — Recurring report schedule configs

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text | |
| `customerId` / `projectId` | integer | |
| `automationType` | text | `"monthly_tenant_health_report"`, `"quarterly_governance_review"`, etc. |
| `cronExpression` | text | |
| `enabled` | boolean | |
| `linkedRunbookScriptId` | text | |
| `generateDocument` | boolean | |
| `lastRunAt` / `nextRunAt` / `runningAt` | timestamp | |
| `lastRunLog` | jsonb | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  pageSlug: string;
  triggerKeys: string[];
  updatedAt: string (ISO 8601);
}
```
---

### 2.26 Content & SEO

**insights_automations** — Scheduled automation rules for AI insights delivery

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text | |
| `customerId` / `projectId` | integer | Scope |
| `automationType` | text | |
| `cronExpression` | text | |
| `enabled` | boolean | |
| `linkedRunbookScriptId` | text | |
| `generateDocument` | boolean | |
| `lastRunAt` / `nextRunAt` | timestamp | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  name: string;
  customerId: number | null;
  projectId: number | null;
  automationType: string | null;
  cronExpression: string;
  enabled: boolean;
  linkedRunbookScriptId: string | null;
  generateDocument: boolean;
  lastRunAt: string (ISO 8601) | null;
  nextRunAt: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```

**articles** — Blog articles (DB-backed; also exported as Markdown files for the public website)

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `slug` | text UNIQUE | |
| `category` | text | Service area category |
| `title` / `summary` | text | |
| `date` | text | Publication date |
| `content` | text | Markdown body |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  slug: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  content: string;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**seo_rankings**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `keyword` | text | |
| `position` / `previousPosition` | integer | |
| `url` | text | |
| `searchVolume` | integer | |
| `notes` | text | |
| `checkedAt` / `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  keyword: string;
  position: number;
  previousPosition: number | null;
  url: string | null;
  searchVolume: number | null;
  notes: string | null;
  checkedAt: string (ISO 8601);
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**service_page_trigger_keys** — Admin-managed quiz-to-service routing keys per public page

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `pageSlug` | text UNIQUE | |
| `triggerKeys` | jsonb | string[] of trigger identifiers |
| `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  pageSlug: string;
  triggerKeys: string[];
  updatedAt: string (ISO 8601);
}
```
---

### 2.27 Asset Library (Task Template Building Blocks)

**asset_library_categories**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text UNIQUE | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  name: string;
  createdAt: string (ISO 8601);
}
```
**instruction_sets** — Reusable step-by-step instructions for task templates

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `title` / `description` | text | |
| `instructions` | jsonb | Ordered instruction steps |
| `category` | text | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  title: string;
  description: string | null;
  instructions: string[];
  category: string;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**checklists** — Reusable completion checklists

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `title` | text | |
| `items` | jsonb | string[] checklist items |
| `category` | text | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  title: string;
  items: Array<{ id: string; label: string };
  category: string;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**artifact_sets** — Reusable lists of artifacts produced by a task

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `title` | text | |
| `artifacts` | jsonb | string[] artifact names |
| `category` | text | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  title: string;
  artifacts: string[];
  category: string;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**deliverable_sets** — Reusable lists of client deliverables per task

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `title` | text | |
| `deliverables` | jsonb | string[] deliverable names |
| `category` | text | |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  title: string;
  deliverables: string[];
  category: string;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
---

### 2.28 Notifications & Devices

**notifications** — In-app notification feed (admin and client)

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer | |
| `title` / `body` | text | |
| `type` | text | `"project_update"`, `"message"`, `"invoice"`, `"document"`, `"general"`, `"lead_created"`, `"quiz_lead_created"`, `"purchase_created"` |
| `read` | boolean | |
| `linkPath` | text | Deep link |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  userId: number;
  title: string;
  body: string | null;
  type: "project_update" | "message" | "invoice" | "document" | "general" | "lead_created" | "quiz_lead_created" | "purchase_created";
  read: boolean;
  linkPath: string | null;
  createdAt: string (ISO 8601);
}
```
**device_tokens** — Expo push notification tokens for mobile app

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `token` | text UNIQUE | Expo push token |
| `platform` | text | `"ios"` or `"android"` |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  token: string;
  platform: string;
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**push_subscriptions** — Web Push (VAPID) subscriptions for browser notifications

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | integer FK → users | |
| `endpoint` | text | Push service URL |
| `p256dh` / `auth` | text | VAPID key material |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  createdAt: string (ISO 8601);
}
```
---

### 2.29 Audit, Settings, and Miscellaneous

**audit_logs**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `actorUserId` | integer FK | FK → users (nullable if system action) |
| `actorName` | text NOT NULL | Display name at time of action |
| `actorRole` | text enum | `"admin"` or `"client"` |
| `actionType` | text | e.g. `"kanban_card_moved"` |
| `entityType` / `entityId` / `entityLabel` | text | What was acted on |
| `clientId` / `projectId` | integer | |
| `metadata` | jsonb | Action-specific context |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  actorUserId: number | null;
  actorName: string;
  actorRole: "admin" | "client";
  actionType: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  clientId: number | null;
  projectId: number | null;
  metadata: Record<string, unknown> | null
  createdAt: string (ISO 8601);
}
```
**settings** — Global key-value configuration store

| Field | Type | Notes |
|---|---|---|
| `key` | text PK | Setting identifier |
| `value` | text | String-encoded value |
| `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  key: string | null;
  value: string | null;
  updatedAt: string (ISO 8601);
}
```
**graph_subscriptions** — Microsoft Graph change notification subscriptions

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `subscriptionId` | text UNIQUE | Graph subscription ID |
| `resource` | text | Watched Graph resource path |
| `expirationDateTime` | timestamp | Must be renewed periodically |
| `createdAt` / `updatedAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  subscriptionId: string;
  resource: string;
  expirationDateTime: string (ISO 8601);
  createdAt: string (ISO 8601);
  updatedAt: string (ISO 8601);
}
```
**project_closures** — Project close-out sign-off records

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `projectId` | integer UNIQUE | |
| `requestedAt` | timestamp | |
| `feedback` | text | Client testimonial |
| `permissionGranted` | boolean | Consent to publish testimonial |
| `signatureDataUrl` | text | Base64 data URL of client signature |
| `signedAt` | timestamp | When close-out was signed |
| `signerUserId` | integer | |


**JSON shape:**
```typescript
{
  id: number;
  projectId: number;
  requestedAt: string (ISO 8601);
  feedback: string | null;
  permissionGranted: boolean;
  signatureDataUrl: string | null;
  signedAt: string (ISO 8601) | null;
  signerUserId: number | null;
}
```
**project_updates** — Communication log for projects

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `projectId` | integer | |
| `content` | text | |
| `authorUserId` | integer | |
| `type` | text | `"update"`, `"milestone"`, `"message"`, `"file"` |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  projectId: number;
  content: string;
  authorUserId: number | null;
  type: "update" | "milestone" | "message" | "file";
  createdAt: string (ISO 8601);
}
```
**documents** — Project-scoped file references

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `projectId` | integer FK → projects | |
| `name` / `filename` / `mimeType` | text | |
| `sizeBytes` | integer | |
| `uploadedBy` | integer FK → users | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  projectId: number;
  name: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: number | null;
  createdAt: string (ISO 8601);
}
```
**reports** — Client report file references

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientUserId` / `projectId` | integer | |
| `title` | text | |
| `period` | text | `"weekly"`, `"monthly"`, `"executive_summary"`, `"other"` |
| `filename` / `mimeType` | text | |
| `sizeBytes` | integer | |
| `reportDate` / `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  clientUserId: number;
  projectId: number | null;
  title: string;
  period: "weekly" | "monthly" | "executive_summary" | "other";
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  reportDate: string (ISO 8601) | null;
  createdAt: string (ISO 8601);
}
```
**client_documents** — Client-scoped (non-project) document vault records

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientUserId` | integer FK → users | |
| `name` | text | |
| `category` | text | `"contracts"`, `"reports"`, `"proposals"`, `"deliverables"`, `"assessments"`, `"misc"` |
| `description` | text | |
| `fileUrl` / `filename` / `mimeType` | text | |
| `sizeBytes` | integer | |
| `uploadedBy` | integer | |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  clientUserId: number;
  name: string;
  category: "contracts" | "reports" | "proposals" | "deliverables" | "assessments" | "misc";
  description: string | null;
  fileUrl: string | null;
  filename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: number | null;
  createdAt: string (ISO 8601);
}
```
**share_events** — Blog/article social share tracking

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `slug` | text | Article or page slug |
| `platform` | text | `"linkedin"` or `"x"` |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  slug: string;
  platform: "linkedin" | "x";
  createdAt: string (ISO 8601);
}
```
**checklist_downloads** — Lead magnet download tracking

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `asset` | text | Asset identifier |
| `createdAt` | timestamp | |


**JSON shape:**
```typescript
{
  id: number;
  asset: string;
  createdAt: string (ISO 8601);
}
```
**client_health_history** — Historical M365 health score snapshots

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `clientId` | integer FK → users | |
| `category` | text | `"governance"`, `"security"`, `"compliance"`, `"copilot"`, `"identity"`, `"collaboration"`, `"productivity"`, `"data"` |
| `score` | integer | |
| `recordedAt` | timestamp | |
| `sourceKanbanTaskId` | integer | Task that triggered this snapshot |


**JSON shape:**
```typescript
{
  id: number;
  clientId: number;
  category: string | null;
  score: number;
  recordedAt: string (ISO 8601);
  sourceKanbanTaskId: number | null;
}
```
---

### 2.30 Conversations (lib/db/src/schema/conversations.ts + messages.ts)

Used by the AI assistant contact chat feature.

**conversations**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `title` | text NOT NULL | |
| `createdAt` | timestamp NOT NULL | |


**JSON shape:**
```typescript
{
  id: number;
  title: string;
  createdAt: string (ISO 8601);
}
```
**messages**

| Field | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `conversationId` | integer NOT NULL FK → conversations (CASCADE DELETE) | |
| `role` | text NOT NULL | `"user"` or `"assistant"` |
| `content` | text NOT NULL | |
| `createdAt` | timestamp NOT NULL | |


**JSON shape:**
```typescript
{
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string (ISO 8601);
}
```
---

## 3. API Endpoints

All routes are prefixed `/api` and served by `artifacts/api-server`. Auth via JWT bearer token. Convention: `requireAdmin` = role `"admin"` required; `requireAuth` = any authenticated user; `Public` = no token required.

All 614 routes are listed below, organized by source file. Auth column defaults: all `/admin/*` and `/inbox/*` paths require `requireAdmin`; all `/portal/*` paths require `requireAuth`; all other paths are `Public` unless noted.

---

### 3.1 Authentication (`auth.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/auth/login` | Public (rate-limited) | { email, password } | { accessToken, refreshToken, user } |
| POST | `/auth/refresh` | Public | { refreshToken? } | { accessToken, refreshToken, user } |
| POST | `/auth/logout` | Public | none | `{ success: true }` |
| POST | `/auth/register` | Public | { email, password, name } | creates client account |
| POST | `/auth/setup-password` | Public | { token, password } | activates new account |
| POST | `/auth/forgot-password` | Public (rate-limited) | { email } | sends reset email |
| POST | `/auth/reset-password` | Public | { token, password } | resets password |
| POST | `/auth/impersonate-exchange` | Public | { token } | returns short-lived client session token |

---

### 3.2 MFA (`mfa.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/auth/mfa/enrollments` | `requireAuth` | none | `MfaEnrollment[]` |
| POST | `/auth/mfa/verify` | `requireAuth` | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/totp/setup` | `requireAuth` | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/totp/verify-setup` | `requireAuth` | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/totp/challenge` | Public | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| DELETE | `/auth/mfa/totp` | `requireAuth` | none | `{ deleted: true }` |
| POST | `/auth/mfa/sms/setup` | `requireAuth` | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/sms/send` | `requireAuth` | `{ to, subject, body }` | `MfaEnrollment` |
| POST | `/auth/mfa/sms/challenge` | Public | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/sms/verify` | Public | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/sms/verify-setup` | `requireAuth` | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| DELETE | `/auth/mfa/sms` | `requireAuth` | none | `{ deleted: true }` |
| POST | `/auth/mfa/passkey/registration-options` | `requireAuth` | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/passkey/verify-registration` | `requireAuth` | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/passkey/authentication-options` | Public | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/passkey/verify-authentication` | Public | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/passkey/admin-registration-options` | `requireAdmin` | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| POST | `/auth/mfa/passkey/admin-authentication-options` | `requireAdmin` | `Partial<MfaEnrollment>` | `MfaEnrollment` |
| DELETE | `/auth/mfa/passkey` | `requireAuth` | none | `{ deleted: true }` |

---

### 3.3 Portal — Admin CRUD (`portal.ts`, admin section)

`portal.ts` is the largest route file and contains both `/admin/*` management routes and `/portal/*` client-facing routes.

**Admin: Clients**

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/clients` | `requireAdmin` | none | `User[]` |
| POST | `/admin/clients` | `requireAdmin` | `{ email, name, company, ... }` | `User` |
| GET | `/admin/clients/:id` | `requireAdmin` | none | `User` |
| PATCH | `/admin/clients/:id` | `requireAdmin` | `{ field?: value }` | `User` |
| DELETE | `/admin/clients/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/clients/:id/delete-preview` | `requireAdmin` | none | `User[]` |
| GET | `/admin/clients/:id/app-registration` | `requireAdmin` | none | `User[]` |
| PATCH | `/admin/clients/:id/app-registration` | `requireAdmin` | `{ field?: value }` | `User` |
| GET | `/admin/clients/:id/m365-profile` | `requireAdmin` | none | `User[]` |
| PUT | `/admin/clients/:id/m365-profile` | `requireAdmin` | `{ field?: value }` | `User` |
| GET | `/admin/clients/:id/m365-profile/pdf` | `requireAdmin` | none | `User[]` |
| GET | `/admin/clients/:id/mfa-status` | `requireAdmin` | none | `User[]` |
| POST | `/admin/clients/:id/mfa-reset` | `requireAdmin` | `Partial<User>` | `User` |
| POST | `/admin/clients/:id/resend-invite` | `requireAdmin` | `{ to, subject, body }` | `User` |
| POST | `/admin/impersonate/:userId` | `requireAdmin` | { token } | { token } |

**Admin: Projects**

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/projects` | `requireAdmin` | none | `Project[]` |
| POST | `/admin/projects` | `requireAdmin` | `Partial<Project>` | `Project` |
| GET | `/admin/projects/:id` | `requireAdmin` | none | `Project` |
| PATCH | `/admin/projects/:id` | `requireAdmin` | `{ field?: value }` | `Project` |
| DELETE | `/admin/projects/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/projects/:id/kanban-events` | `requireAdmin` | none | `Project[]` |
| GET | `/admin/projects/:id/contracts` | `requireAdmin` | none | `Project[]` |
| GET | `/admin/projects/:id/closure` | `requireAdmin` | none | `Project[]` |
| POST | `/admin/projects/:id/closure-request` | `requireAdmin` | `Partial<Project>` | `Project` |
| POST | `/admin/projects/:id/sharepoint-folder` | `requireAdmin` | `Partial<Project>` | `Project` |
| GET | `/admin/projects/:id/report-autofill` | `requireAdmin` | none | `Project[]` |
| GET | `/admin/projects/:id/emails` | `requireAdmin` | none | `Project[]` |
| POST | `/admin/projects/:projectId/generate-artifacts` | `requireAdmin` | `{ prompt?, context? }` | `Project` |
| POST | `/admin/projects/:projectId/draft-artifacts` | `requireAdmin` | `Partial<Project>` | `Project` |
| POST | `/admin/projects/:projectId/finalize-artifact` | `requireAdmin` | `{ artifactType }` | `Project` |

**Admin: Kanban Tasks**

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/kanban-tasks` | `requireAdmin` | none | `KanbanTask[]` |
| POST | `/admin/kanban-tasks` | `requireAdmin` | `Partial<KanbanTask>` | `KanbanTask` |
| PATCH | `/admin/kanban-tasks/:id` | `requireAdmin` | `{ field?: value }` | `KanbanTask` |
| DELETE | `/admin/kanban-tasks/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/kanban-tasks/:id/checklist/:itemId/completion-schema` | `requireAdmin` | `Partial<KanbanTask>` | `KanbanTask` |
| PATCH | `/admin/kanban-tasks/:id/checklist/:itemId` | `requireAdmin` | `{ field?: value }` | `KanbanTask` |

**Admin: Workflow Steps**

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/workflow-steps` | `requireAdmin` | none | `WorkflowStep[]` |
| POST | `/admin/workflow-steps` | `requireAdmin` | `Partial<WorkflowStep>` | `WorkflowStep` |
| POST | `/admin/workflow-steps/bulk` | `requireAdmin` | `Partial<WorkflowStep>` | `WorkflowStep` |
| PATCH | `/admin/workflow-steps/:id` | `requireAdmin` | `{ field?: value }` | `WorkflowStep` |
| DELETE | `/admin/workflow-steps/:id` | `requireAdmin` | none | `{ deleted: true }` |

**Admin: Services (portal.ts)**

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| PATCH | `/admin/services/:id` | `requireAdmin` | `{ field?: value }` | `Service` |
| GET | `/admin/services/:id/workflow` | `requireAdmin` | none | `Service[]` |
| PUT | `/admin/services/:id/workflow` | `requireAdmin` | `{ field?: value }` | `Service` |
| POST | `/admin/client-services` | `requireAdmin` | `Partial<ClientService>` | `ClientService` |

**Admin: Contracts, Invoices, Documents, Reports**

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/contracts` | `requireAdmin` | none | `Contract[]` |
| GET | `/admin/contracts/:id/pdf` | `requireAdmin` | none | `Contract[]` |
| DELETE | `/admin/contracts/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/invoices` | `requireAdmin` | none | `Invoice[]` |
| POST | `/admin/invoices` | `requireAdmin` | `Partial<Invoice>` | `Invoice` |
| PATCH | `/admin/invoices/:id` | `requireAdmin` | `{ field?: value }` | `Invoice` |
| DELETE | `/admin/invoices/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/documents` | `requireAdmin` | none | `Document[]` |
| POST | `/admin/documents` | `requireAdmin` | `Partial<Document>` | `Document` |
| DELETE | `/admin/documents/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/reports` | `requireAdmin` | none | `Report[]` |
| POST | `/admin/reports` | `requireAdmin` | `Partial<Report>` | `Report` |
| DELETE | `/admin/reports/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/purchases` | `requireAdmin` | none | `Invoice[]` |
| GET | `/admin/purchases/:id` | `requireAdmin` | none | `Invoice` |
| DELETE | `/admin/purchases/:id` | `requireAdmin` | none | `{ deleted: true }` |

**Admin: Status Reports**

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/status-reports` | `requireAdmin` | none | `StatusReport[]` |
| POST | `/admin/status-reports` | `requireAdmin` | `Partial<StatusReport>` | `StatusReport` |
| PATCH | `/admin/status-reports/:id` | `requireAdmin` | `{ field?: value }` | `StatusReport` |
| DELETE | `/admin/status-reports/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/status-reports/:id/send` | `requireAdmin` | `{ to, subject, body }` | `StatusReport` |
| POST | `/admin/status-reports/:id/reply` | `requireAdmin` | `Partial<StatusReport>` | `StatusReport` |
| POST | `/admin/status-reports/:id/thread` | `requireAdmin` | `Partial<StatusReport>` | `StatusReport` |
| POST | `/admin/status-reports/:id/next-steps/:index/push-to-kanban` | `requireAdmin` | `Partial<StatusReport>` | `StatusReport` |
| POST | `/admin/status-reports/:id/push-all-to-kanban` | `requireAdmin` | `Partial<StatusReport>` | `StatusReport` |
| POST | `/admin/status-reports/ai-draft` | `requireAdmin` | `{ prompt?, context? }` | `StatusReport` |
| POST | `/admin/ai/suggest` | `requireAdmin` | `{ prompt?, context? }` | `AiGenerationResult` |

**Admin: Misc (portal.ts)**

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/m365-profiles` | `requireAdmin` | none | `ClientM365Profile[]` |
| GET | `/admin/messages/clients` | `requireAdmin` | none | `Message[]` |
| GET | `/admin/closures/approved` | `requireAdmin` | none | `ProjectClosure[]` |
| GET | `/admin/closures/signed` | `requireAdmin` | none | `ProjectClosure[]` |
| GET | `/admin/services/:id/workflow` | `requireAdmin` | none | `Service[]` |
| POST | `/admin/engagements/:id/send-presentation` | `requireAdmin` | `{ to, subject, body }` | `EngagementProject` |
| POST | `/admin/stripe/replay-session` | `requireAdmin` | `Partial<StripeSession>` | `StripeSession` |
| POST | `/admin/project-updates` | `requireAdmin` | `Partial<ProjectUpdate>` | `ProjectUpdate` |
| GET | `/public/testimonials` | Public | none | `Testimonial[]` |
| GET | `/testimonials` | `requireAdmin` | none | `Testimonial[]` |

---

### 3.4 Portal — Client-Facing (`portal.ts`, portal section)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/portal/profile` | `requireAuth` | none | `User[]` |
| PATCH | `/portal/profile` | `requireAuth` | `{ field?: value }` | `User` |
| GET | `/portal/dashboard` | `requireAuth` | none | `DashboardStats[]` |
| GET | `/portal/projects` | `requireAuth` | none | `Project[]` |
| GET | `/portal/projects/:id` | `requireAuth` | none | `Project` |
| GET | `/portal/projects/:id/kanban-events` | `requireAuth` | none | `Project[]` |
| PATCH | `/portal/projects/:id/timing` | `requireAuth` | `{ field?: value }` | `Project` |
| GET | `/portal/projects/:id/closure` | `requireAuth` | none | `Project[]` |
| POST | `/portal/projects/:id/signoff` | `requireAuth` | `Partial<Project>` | `Project` |
| POST | `/portal/projects/:id/closure/sign` | `requireAuth` | `Partial<Project>` | `Project` |
| GET | `/portal/projects/:id/audit-logs` | `requireAuth` | none | `Project[]` |
| GET | `/portal/projects/:id/audit-pdf` | `requireAuth` | none | `Project[]` |
| GET | `/portal/projects/:id/sharepoint-documents` | `requireAuth` | none | `Project[]` |
| GET | `/portal/projects/:id/sharepoint-file/:itemId` | `requireAuth` | none | `Project` |
| GET | `/portal/projects/:projectId/manual-scripts` | `requireAuth` | none | `Project[]` |
| GET | `/portal/projects/:projectId/manual-scripts/:runResultId/download` | `requireAuth` | none | `Project[]` |
| POST | `/portal/projects/:projectId/documents` | `requireAuth` | `Partial<Project>` | `Project` |
| GET | `/portal/tasks/:taskId/download-script` | `requireAuth` | none | `T[]` |
| GET | `/portal/status-reports` | `requireAuth` | none | `StatusReport[]` |
| GET | `/portal/status-reports/:id` | `requireAuth` | none | `StatusReport` |
| PATCH | `/portal/status-reports/:id/acknowledge` | `requireAuth` | `{ field?: value }` | `StatusReport` |
| POST | `/portal/status-reports/:id/resolve` | `requireAuth` | `Partial<StatusReport>` | `StatusReport` |
| POST | `/portal/status-reports/:id/thread` | `requireAuth` | `Partial<StatusReport>` | `StatusReport` |
| GET | `/portal/messages` | `requireAuth` | none | `Message[]` |
| POST | `/portal/messages` | `requireAuth` | `Partial<Message>` | `Message` |
| GET | `/portal/notifications` | `requireAuth` | none | `Notification[]` |
| PATCH | `/portal/notifications/:id/read` | `requireAuth` | `{ field?: value }` | `Notification` |
| POST | `/portal/notifications/read-all` | `requireAuth` | `Partial<Notification>` | `Notification` |
| GET | `/portal/invoices` | `requireAuth` | none | `Invoice[]` |
| GET | `/portal/invoices/:id` | `requireAuth` | none | `Invoice` |
| GET | `/portal/invoices/:id/download` | `requireAuth` | none | `Invoice[]` |
| POST | `/portal/invoices/:id/pay` | `requireAuth` | `Partial<Invoice>` | `Invoice` |
| GET | `/portal/contracts/:id` | `requireAuth` | none | `Contract` |
| GET | `/portal/contracts/:id/pdf` | `requireAuth` | none | `Contract[]` |
| GET | `/portal/contracts/:id/download` | `requireAuth` | none | `Contract[]` |
| GET | `/portal/documents/:id/download` | `requireAuth` | none | `Document[]` |
| GET | `/portal/reports` | `requireAuth` | none | `T[]` |
| GET | `/portal/reports/:id/download` | `requireAuth` | none | `T[]` |
| GET | `/portal/quiz-results` | `requireAuth` | none | `QuizLead[]` |
| GET | `/portal/m365-profile` | `requireAuth` | none | `T[]` |
| PUT | `/portal/m365-profile` | `requireAuth` | `{ field?: value }` | `T` |
| GET | `/portal/m365-scorecard-history` | `requireAuth` | none | `T[]` |
| GET | `/portal/health/summary` | `requireAuth` | none | `T[]` |
| GET | `/portal/automation-progress` | `requireAuth` | none | `T[]` |
| GET | `/portal/automation-history` | `requireAuth` | none | `T[]` |
| GET | `/portal/app-registration` | `requireAuth` | none | `ClientAppRegistration[]` |
| PUT | `/portal/app-registration` | `requireAuth` | `{ field?: value }` | `ClientAppRegistration` |
| POST | `/portal/app-registration/recheck` | `requireAuth` | `Partial<ClientAppRegistration>` | `ClientAppRegistration` |
| GET | `/portal/required-permissions` | `requireAuth` | none | `T[]` |
| GET | `/portal/services` | `requireAuth` | none | `ClientService[]` |
| GET | `/portal/onboarding/services` | `requireAuth` | none | `OnboardingState[]` |
| GET | `/portal/onboarding/service/:id` | `requireAuth` | none | `OnboardingState` |
| GET | `/portal/onboarding/wizard-status` | `requireAuth` | none | `OnboardingState[]` |
| POST | `/portal/onboarding/complete` | `requireAuth` | `Partial<OnboardingState>` | `OnboardingState` |
| POST | `/portal/onboarding/wizard-reset` | `requireAuth` | `Partial<OnboardingState>` | `OnboardingState` |
| GET | `/portal/onboarding/contract/:id` | `requireAuth` | none | `OnboardingState` |
| POST | `/portal/onboarding/contract` | `requireAuth` | `Partial<OnboardingState>` | `OnboardingState` |
| GET | `/portal/onboarding/session/:sessionId` | `requireAuth` | none | `OnboardingState` |
| POST | `/portal/onboarding/provision/:sessionId` | `requireAuth` | `Partial<OnboardingState>` | `OnboardingState` |
| GET | `/portal/coupons/available/:code` | `requireAuth` | none | `T` |
| POST | `/portal/coupons/validate` | `requireAuth` | `{ ...fields }` | `T` |
| POST | `/portal/checkout/create-session` | `requireAuth` | `Partial<CheckoutSession>` | `CheckoutSession` |
| POST | `/portal/services/checkout` | `requireAuth` | `Partial<ClientService>` | `ClientService` |
| GET | `/portal/presentations/:id` | `requireAuth` | none | `T` |
| POST | `/portal/presentations` | `requireAuth` | `{ ...fields }` | `T` |
| PATCH | `/portal/presentations/:id/selections` | `requireAuth` | `{ field?: value }` | `T` |
| POST | `/portal/presentations/:id/sign` | `requireAuth` | `{ ...fields }` | `T` |
| POST | `/portal/presentations/:id/checkout` | `requireAuth` | `{ ...fields }` | `T` |
| POST | `/portal/manual-scripts/:scriptRunId/upload` | `requireAuth` | `{ ...fields }` | `T` |
| POST | `/portal/billing/customer-portal` | `requireAuth` | `{ ...fields }` | `T` |
| GET | `/portal/billing/subscriptions` | `requireAuth` | none | `T[]` |
| POST | `/portal/billing/subscriptions/:id/cancel` | `requireAuth` | `{ ...fields }` | `T` |
| POST | `/portal/billing/subscriptions/:id/resubscribe` | `requireAuth` | `{ ...fields }` | `T` |
| POST | `/portal/billing/subscriptions/:id/resume` | `requireAuth` | `{ ...fields }` | `T` |
| GET | `/portal/billing/stripe-receipts` | `requireAuth` | none | `T[]` |
| POST | `/portal/stripe/webhook` | `requireAuth` | Stripe/Graph webhook payload | `200 OK` |
| GET | `/portal/insights-documents` | `requireAuth` | none | `T[]` |
| GET | `/portal/insights-documents/:id/view` | `requireAuth` | none | `T[]` |
| PATCH | `/portal/kanban-tasks/:id` | `requireAuth` | `{ field?: value }` | `KanbanTask` |

---

### 3.5 Leads (`leads.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/leads` | Public | `{ name, email, company, source, message, ... }` | `Lead` |
| GET | `/leads` | `requireAdmin` | query params (see Notes) | `Lead[]` |
| GET | `/leads/stats` | `requireAdmin` | none | `Lead[]` |
| GET | `/leads/:id` | `requireAdmin` | none | `Lead` |
| PATCH | `/leads/:id` | `requireAdmin` | `{ field?: value }` | `Lead` |
| DELETE | `/leads/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/leads/:id/merge` | `requireAdmin` | `{ targetLeadId }` | `Lead` |
| GET | `/leads/:id/derive-signals` | `requireAdmin` | none | `Lead[]` |
| GET | `/leads/:id/emails` | `requireAdmin` | none | `Lead[]` |
| GET | `/leads/:id/qualifications` | `requireAdmin` | none | `Lead[]` |
| GET | `/leads/:id/quiz-matches` | `requireAdmin` | none | `Lead[]` |

---

### 3.6 Opportunities (`opportunities.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/opportunities` | `requireAdmin` | none | `Opportunity[]` |
| GET | `/opportunities/:id` | `requireAdmin` | none | `Opportunity` |
| PATCH | `/opportunities/:id` | `requireAdmin` | `{ field?: value }` | `Opportunity` |
| DELETE | `/opportunities/:id` | `requireAdmin` | none | `{ deleted: true }` |
| DELETE | `/opportunities/:id/purge` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/opportunities/:id/restore` | `requireAdmin` | `Partial<Opportunity>` | `Opportunity` |
| PATCH | `/opportunities/:id/tasks/:taskId` | `requireAdmin` | `{ field?: value }` | `Opportunity` |
| GET | `/leads/qualification/pending` | `requireAdmin` | none | `Lead[]` |
| POST | `/leads/qualification/:id/approve` | `requireAdmin` | `Partial<Lead>` | creates opportunity |
| POST | `/leads/qualification/:id/reject` | `requireAdmin` | `Partial<Lead>` | `Lead` |
| POST | `/leads/qualification/:id/snooze` | `requireAdmin` | `Partial<Lead>` | `Lead` |

---

### 3.7 Quiz (`quiz.ts`, `quiz-quick-win.ts`, `quiz-selector.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/quiz/chat` | Public (rate-limited) | `{ messages[], quizType, leadId? }` | `QuizLead` |
| POST | `/quiz/submit` | Public (rate-limited) | `{ name, email, company, quizType, totalScore, categoryScores, conversation }` | `QuizLead` |
| GET | `/quiz/results/:leadId` | Public (token-verified) | query params (see Notes) | `QuizLead` |
| POST | `/quiz/resend-pdf` | Public | `{ to, subject, body }` | `QuizLead` |
| POST | `/quiz/analytics-event` | Public | `Partial<QuizLead>` | `QuizLead` |
| POST | `/quiz/quick-win/submit` | Public | `{ answers, scores, rankedSlugs }` | `QuizLead` |
| GET | `/quiz/quick-win/results/:resultId` | Public | none | `QuizLead` |
| POST | `/quiz-selector/result` | Public | `Partial<QuizLead>` | `QuizLead` |
| GET | `/admin/quiz-selector/stats` | `requireAdmin` | none | `T[]` |

---

### 3.8 Analytics (`analytics.ts`, `analytics-forecast.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/analytics/session` | Public | `Partial<AnalyticsData>` | `AnalyticsData` |
| POST | `/analytics/pageview` | Public | `Partial<AnalyticsData>` | `AnalyticsData` |
| POST | `/analytics/event` | Public | `Partial<AnalyticsData>` | `AnalyticsData` |
| POST | `/analytics/identify` | Public | `Partial<AnalyticsData>` | `AnalyticsData` |
| POST | `/analytics/batch` | Public | `Partial<AnalyticsData>` | `AnalyticsData` |
| GET | `/admin/analytics/kpis` | `requireAdmin` | none | `T[]` |
| GET | `/admin/analytics/live` | `requireAdmin` | none | `T[]` |
| GET | `/admin/analytics/live-stream` | `requireAdmin` | none | `T[]` |
| GET | `/admin/analytics/top-pages` | `requireAdmin` | none | `T[]` |
| GET | `/admin/analytics/top-referrers` | `requireAdmin` | none | `T[]` |
| GET | `/admin/analytics/top-ctas` | `requireAdmin` | none | `T[]` |
| GET | `/admin/analytics/top-events` | `requireAdmin` | none | `T[]` |
| GET | `/admin/analytics/top-links` | `requireAdmin` | none | `T[]` |
| GET | `/admin/analytics/pageviews-series` | `requireAdmin` | none | `T[]` |
| GET | `/analytics/revenue/forecast` | `requireAdmin` | none | `AnalyticsData[]` |
| POST | `/analytics/revenue/forecast/generate` | `requireAdmin` | `{ prompt?, context? }` | `AnalyticsData` |

---

### 3.9 Admin: Quiz Leads & Pain Config

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/quiz-leads` | `requireAdmin` | none | `QuizLead[]` |
| GET | `/admin/quiz-leads/stats` | `requireAdmin` | none | `QuizLead[]` |
| GET | `/admin/quiz-leads/download-stats` | `requireAdmin` | none | `QuizLead[]` |
| GET | `/admin/quiz-leads/:id` | `requireAdmin` | none | `QuizLead` |
| PATCH | `/admin/quiz-leads/:id/contacted` | `requireAdmin` | `{ field?: value }` | `QuizLead` |
| DELETE | `/admin/quiz-leads/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/quiz-pain-config` | `requireAdmin` | none | `QuizPainSignalConfig[]` |
| PUT | `/admin/quiz-pain-config` | `requireAdmin` | `{ field?: value }` | `QuizPainSignalConfig` |
| POST | `/admin/quiz-pain-config/recalculate` | `requireAdmin` | `{ prompt?, context? }` | `QuizPainSignalConfig` |
| DELETE | `/admin/quiz-pain-config` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/quiz-pain-map` | `requireAdmin` | none | `T[]` |
| PUT | `/admin/quiz-pain-map` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/quiz-pain-map` | `requireAdmin` | none | `{ deleted: true }` |

---

### 3.10 Admin: AI (`admin-ai-prompts.ts`, `admin-ai-draft.ts`, `ai-next-best-actions.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/ai-prompts` | `requireAdmin` | none | `AiPrompt[]` |
| GET | `/admin/ai-prompts/:id` | `requireAdmin` | none | `AiPrompt` |
| PUT | `/admin/ai-prompts/:id` | `requireAdmin` | `{ field?: value }` | `AiPrompt` |
| POST | `/admin/ai-prompts/:id/reset` | `requireAdmin` | `{ prompt?, context? }` | `AiPrompt` |
| POST | `/admin/status-reports/ai-draft` | `requireAdmin` | `{ prompt?, context? }` | `StatusReport` |
| POST | `/admin/ai/suggest` | `requireAdmin` | `{ prompt?, context? }` | `AiGenerationResult` |
| GET | `/ai/next-best-actions` | `requireAdmin` | none | `T[]` |
| POST | `/ai/next-best-actions` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/ai/next-best-actions/generate` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/ai/next-best-actions/:id/resolve` | `requireAdmin` | `{ prompt?, context? }` | `T` |

---

### 3.11 Admin: Overview, Insights & Documents (`admin-overview.ts`, `admin-insights.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/overview` | `requireAdmin` | none | `DashboardStats[]` |
| POST | `/admin/insights` | `requireAdmin` | `Partial<InsightDocument>` | `InsightDocument` |
| GET | `/admin/insights/documents` | `requireAdmin` | none | `InsightDocument[]` |
| GET | `/admin/insights/documents/:id` | `requireAdmin` | none | `InsightDocument` |
| GET | `/admin/insights/documents/:id/download` | `requireAdmin` | none | `InsightDocument[]` |
| POST | `/admin/insights/documents/generate` | `requireAdmin` | `{ docType, projectId, clientUserId }` | `InsightDocument` |
| PUT | `/admin/insights/documents/:id` | `requireAdmin` | `{ field?: value }` | `InsightDocument` |
| POST | `/admin/insights/documents/:id/send` | `requireAdmin` | `{ to, subject, body }` | `InsightDocument` |
| DELETE | `/admin/insights/documents/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/insights/consulting/generate` | `requireAdmin` | `{ prompt?, context? }` | `InsightDocument` |
| POST | `/admin/insights/consulting/:id/send` | `requireAdmin` | `{ to, subject, body }` | `InsightDocument` |
| GET | `/admin/insights/automations` | `requireAdmin` | none | `InsightDocument[]` |
| POST | `/admin/insights/automations` | `requireAdmin` | `Partial<InsightDocument>` | `InsightDocument` |
| PATCH | `/admin/insights/automations/:id` | `requireAdmin` | `{ field?: value }` | `InsightDocument` |
| DELETE | `/admin/insights/automations/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/insights/automations/:id/run` | `requireAdmin` | `Partial<InsightDocument>` | `InsightDocument` |
| GET | `/admin/insights/customers` | `requireAdmin` | none | `InsightDocument[]` |
| GET | `/admin/insights/projects` | `requireAdmin` | none | `InsightDocument[]` |
| GET | `/admin/insights/scores` | `requireAdmin` | none | `InsightDocument[]` |
| GET | `/admin/insights/heatmap` | `requireAdmin` | none | `InsightDocument[]` |
| GET | `/admin/insights/telemetry-summary` | `requireAdmin` | none | `InsightDocument[]` |

---

### 3.12 Admin: Articles & Content (`admin-articles.ts`, `admin-email-templates.ts`, `admin-contract-templates.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/articles` | `requireAdmin` | none | `Article[]` |
| POST | `/admin/articles` | `requireAdmin` | `Partial<Article>` | `Article` |
| GET | `/admin/articles/:slug` | `requireAdmin` | none | `Article` |
| PUT | `/admin/articles/:slug` | `requireAdmin` | `{ field?: value }` | `Article` |
| DELETE | `/admin/articles/:slug` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/email-templates` | `requireAdmin` | none | `EmailTemplate[]` |
| GET | `/admin/email-templates/:slug` | `requireAdmin` | none | `EmailTemplate` |
| PUT | `/admin/email-templates/:slug` | `requireAdmin` | `{ field?: value }` | `EmailTemplate` |
| POST | `/admin/email-templates/:slug/ai-generate` | `requireAdmin` | `{ prompt?, context? }` | `EmailTemplate` |
| POST | `/admin/email-templates/:slug/test` | `requireAdmin` | `{ prompt?, context? }` | `EmailTemplate` |
| GET | `/admin/contract-templates` | `requireAdmin` | none | `T[]` |
| GET | `/admin/contract-templates/:serviceId` | `requireAdmin` | none | `T` |
| PUT | `/admin/contract-templates/:serviceId` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/contract-templates/:serviceId` | `requireAdmin` | none | `{ deleted: true }` |

---

### 3.13 Admin: Services (`admin-services.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/services` | `requireAdmin` | none | `Service[]` |
| POST | `/admin/services` | `requireAdmin` | `Partial<Service>` | `Service` |
| GET | `/admin/services/:id` | `requireAdmin` | none | `Service` |
| PUT | `/admin/services/:id` | `requireAdmin` | `{ field?: value }` | `Service` |
| DELETE | `/admin/services/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/services/:id/overview-pdf` | `requireAdmin` | none | `Service[]` |
| GET | `/admin/services/:id/pdf-url` | `requireAdmin` | none | `Service[]` |
| POST | `/admin/services/:id/generate-pdf` | `requireAdmin` | `{ prompt?, context? }` | `Service` |
| POST | `/admin/services/generate-all-pdfs` | `requireAdmin` | `{ prompt?, context? }` | `Service` |

---

### 3.14 Admin: Workflow Templates (`admin-workflow-templates.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/workflow-templates` | `requireAdmin` | none | `WorkflowTemplate[]` |
| GET | `/admin/workflow-templates/export` | `requireAdmin` | none | `WorkflowTemplate[]` |
| POST | `/admin/workflow-templates` | `requireAdmin` | `Partial<WorkflowTemplate>` | `WorkflowTemplate` |
| GET | `/admin/workflow-templates/:id` | `requireAdmin` | none | `WorkflowTemplate` |
| PUT | `/admin/workflow-templates/:id` | `requireAdmin` | `{ field?: value }` | `WorkflowTemplate` |
| DELETE | `/admin/workflow-templates/:id` | `requireAdmin` | none | `{ deleted: true }` |
| PUT | `/admin/workflow-templates/:id/service-link` | `requireAdmin` | `{ field?: value }` | `WorkflowTemplate` |
| POST | `/admin/workflow-templates/:id/steps` | `requireAdmin` | `Partial<WorkflowTemplate>` | `WorkflowTemplate` |
| PATCH | `/admin/workflow-templates/:id/steps/reorder` | `requireAdmin` | `{ field?: value }` | `WorkflowTemplate` |
| PUT | `/admin/workflow-templates/:id/steps/:stepId` | `requireAdmin` | `{ field?: value }` | `WorkflowTemplate` |
| DELETE | `/admin/workflow-templates/:id/steps/:stepId` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/workflow-templates/:id/steps/:stepId/tasks` | `requireAdmin` | none | `WorkflowTemplate[]` |
| POST | `/admin/workflow-templates/:id/steps/:stepId/tasks` | `requireAdmin` | `Partial<WorkflowTemplate>` | `WorkflowTemplate` |
| PUT | `/admin/workflow-templates/:id/steps/:stepId/tasks/:taskId` | `requireAdmin` | `{ field?: value }` | `WorkflowTemplate` |
| DELETE | `/admin/workflow-templates/:id/steps/:stepId/tasks/:taskId` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/workflow-templates/:id/ai-generate` | `requireAdmin` | `{ prompt?, context? }` | `WorkflowTemplate` |
| POST | `/admin/workflow-templates/:id/generate-asset-sets` | `requireAdmin` | `{ prompt?, context? }` | `WorkflowTemplate` |
| POST | `/admin/workflow-templates/:id/steps/:stepId/generate-scripts` | `requireAdmin` | `{ prompt?, context? }` | `WorkflowTemplate` |

---

### 3.15 Admin: Engagement Projects (`admin-engagement-projects.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/engagement-projects` | `requireAdmin` | none | `EngagementProject[]` |
| POST | `/admin/engagement-projects` | `requireAdmin` | `Partial<EngagementProject>` | `EngagementProject` |
| GET | `/admin/engagement-projects/:id` | `requireAdmin` | none | `EngagementProject` |
| PUT | `/admin/engagement-projects/:id` | `requireAdmin` | `{ field?: value }` | `EngagementProject` |
| DELETE | `/admin/engagement-projects/:id` | `requireAdmin` | none | `{ deleted: true }` |

---

### 3.16 Admin: Asset Library (`admin-asset-library.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/asset-library/categories` | `requireAdmin` | none | `AssetLibraryItem[]` |
| POST | `/admin/asset-library/categories` | `requireAdmin` | `Partial<AssetLibraryItem>` | `AssetLibraryItem` |
| PUT | `/admin/asset-library/categories/:id` | `requireAdmin` | `{ field?: value }` | `AssetLibraryItem` |
| DELETE | `/admin/asset-library/categories/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/asset-library/instruction-sets` | `requireAdmin` | none | `AssetLibraryItem[]` |
| GET | `/admin/asset-library/instruction-sets/:id` | `requireAdmin` | none | SSE stream |
| GET | `/admin/asset-library/instruction-sets/:id/export` | `requireAdmin` | none | `AssetLibraryItem[]` |
| POST | `/admin/asset-library/instruction-sets` | `requireAdmin` | `Partial<AssetLibraryItem>` | `AssetLibraryItem` |
| PUT | `/admin/asset-library/instruction-sets/:id` | `requireAdmin` | `{ field?: value }` | `AssetLibraryItem` |
| DELETE | `/admin/asset-library/instruction-sets/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/asset-library/checklists` | `requireAdmin` | none | `AssetLibraryItem[]` |
| GET | `/admin/asset-library/checklists/:id` | `requireAdmin` | none | SSE stream |
| GET | `/admin/asset-library/checklists/:id/export` | `requireAdmin` | none | `AssetLibraryItem[]` |
| POST | `/admin/asset-library/checklists` | `requireAdmin` | `Partial<AssetLibraryItem>` | `AssetLibraryItem` |
| PUT | `/admin/asset-library/checklists/:id` | `requireAdmin` | `{ field?: value }` | `AssetLibraryItem` |
| DELETE | `/admin/asset-library/checklists/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/asset-library/artifact-sets` | `requireAdmin` | none | `AssetLibraryItem[]` |
| GET | `/admin/asset-library/artifact-sets/:id` | `requireAdmin` | none | SSE stream |
| GET | `/admin/asset-library/artifact-sets/:id/export` | `requireAdmin` | none | `AssetLibraryItem[]` |
| POST | `/admin/asset-library/artifact-sets` | `requireAdmin` | `Partial<AssetLibraryItem>` | `AssetLibraryItem` |
| PUT | `/admin/asset-library/artifact-sets/:id` | `requireAdmin` | `{ field?: value }` | `AssetLibraryItem` |
| DELETE | `/admin/asset-library/artifact-sets/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/asset-library/deliverable-sets` | `requireAdmin` | none | `AssetLibraryItem[]` |
| GET | `/admin/asset-library/deliverable-sets/:id` | `requireAdmin` | none | SSE stream |
| GET | `/admin/asset-library/deliverable-sets/:id/export` | `requireAdmin` | none | `AssetLibraryItem[]` |
| POST | `/admin/asset-library/deliverable-sets` | `requireAdmin` | `Partial<AssetLibraryItem>` | `AssetLibraryItem` |
| PUT | `/admin/asset-library/deliverable-sets/:id` | `requireAdmin` | `{ field?: value }` | `AssetLibraryItem` |
| DELETE | `/admin/asset-library/deliverable-sets/:id` | `requireAdmin` | none | `{ deleted: true }` |

---

### 3.17 Admin: Clients — Enriched & Health (`admin-clients.ts`, `client-health-trends.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/clients/enriched` | `requireAdmin` | none | `User[]` |
| GET | `/admin/clients/with-azure-credentials` | `requireAdmin` | none | `User[]` |
| GET | `/admin/clients/:id/command-center` | `requireAdmin` | none | `User[]` |
| GET | `/admin/clients/:id/health/summary` | `requireAdmin` | none | `User[]` |
| GET | `/admin/clients/:id/quiz-results` | `requireAdmin` | none | `User[]` |
| GET | `/admin/health/alerts` | `requireAdmin` | none | `T[]` |
| POST | `/admin/health/snapshot-all` | `requireAdmin` | `{ ...fields }` | `T` |
| GET | `/clients/:id/health/trends` | `requireAdmin` | none | `T[]` |
| POST | `/clients/:id/health/record` | `requireAdmin` | `{ ...fields }` | `T` |

---

### 3.18 Admin: Finance (`admin-finance.ts`, `admin-coupons.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/finance/summary` | `requireAdmin` | none | `Invoice[]` |
| GET | `/admin/invoices/:id` | `requireAdmin` | none | `Invoice` |
| POST | `/admin/invoices/:id/ai-summary` | `requireAdmin` | `{ prompt?, context? }` | `Invoice` |
| GET | `/admin/coupons` | `requireAdmin` | none | `Coupon[]` |
| POST | `/admin/coupons` | `requireAdmin` | `Partial<Coupon>` | `Coupon` |
| PATCH | `/admin/coupons/:id` | `requireAdmin` | `{ field?: value }` | `Coupon` |
| DELETE | `/admin/coupons/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/coupons/:id/redemptions` | `requireAdmin` | none | `Coupon[]` |

---

### 3.19 Admin: Emails (`admin-emails.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/emails` | `requireAdmin` | none | `Email[]` |
| GET | `/admin/emails/unread-count` | `requireAdmin` | none | `Email[]` |
| GET | `/admin/emails/:id` | `requireAdmin` | none | `Email` |
| PATCH | `/admin/emails/:id` | `requireAdmin` | `{ field?: value }` | `Email` |
| POST | `/admin/emails/:id/rematch` | `requireAdmin` | `{ prompt?, context? }` | `Email` |
| POST | `/admin/emails/:id/tasks` | `requireAdmin` | `{ prompt?, context? }` | `Email` |
| GET | `/admin/projects/:id/emails` | `requireAdmin` | none | `Project[]` |
| GET | `/admin/email-domain-rules` | `requireAdmin` | none | `T[]` |
| POST | `/admin/email-domain-rules` | `requireAdmin` | `{ domain, linkedUserId }` | `T` |
| DELETE | `/admin/email-domain-rules/:id` | `requireAdmin` | none | `{ deleted: true }` |

---

### 3.20 Inbox (`inbox.ts`)

All routes require `requireAdmin`.

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/inbox/status` | `requireAdmin` | none | `Email[]` |
| GET | `/inbox/folders` | `requireAdmin` | none | `Email[]` |
| GET | `/inbox/messages` | `requireAdmin` | query params (see Notes) | `Email[]` |
| GET | `/inbox/messages/:id` | `requireAdmin` | none | `Email` |
| GET | `/inbox/messages/:id/thread` | `requireAdmin` | none | `Email[]` |
| PATCH | `/inbox/messages/:id/read` | `requireAdmin` | `{ field?: value }` | `Email` |
| PATCH | `/inbox/messages/:id/flag` | `requireAdmin` | `{ field?: value }` | `Email` |
| PATCH | `/inbox/messages/:id/move` | `requireAdmin` | `{ destinationFolder }` | `Email` |
| POST | `/inbox/send` | `requireAdmin` | `{ to, subject, body }` | `Email` |
| POST | `/inbox/messages/:id/reply` | `requireAdmin` | `{ body }` | `Email` |
| POST | `/inbox/messages/:id/forward` | `requireAdmin` | `{ to, body }` | `Email` |
| POST | `/inbox/drafts` | `requireAdmin` | `Partial<Email>` | `Email` |
| PATCH | `/inbox/drafts/:id` | `requireAdmin` | `{ field?: value }` | `Email` |
| GET | `/inbox/search` | `requireAdmin` | query params (see Notes) | `Email[]` |
| GET | `/inbox/messages/:id/links` | `requireAdmin` | none | `Email[]` |
| POST | `/inbox/messages/:id/links` | `requireAdmin` | `Partial<Email>` | `Email` |
| DELETE | `/inbox/messages/:id/links` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/inbox/messages/:id/convert-to-task` | `requireAdmin` | `Partial<Email>` | `Email` |
| POST | `/inbox/messages/:id/extract-tasks` | `requireAdmin` | `Partial<Email>` | `Email` |
| POST | `/inbox/ai` | `requireAdmin` | `{ prompt, messageId? }` | `Email` |
| GET | `/inbox/messages/:id/crm` | `requireAdmin` | none | `Email[]` |
| GET | `/inbox/crm-view/:type/:id` | `requireAdmin` | none | `Email` |
| GET | `/inbox/crm-counts` | `requireAdmin` | none | `Email[]` |
| GET | `/inbox/crm-messages` | `requireAdmin` | none | `Email[]` |
| GET | `/inbox/linked-ids` | `requireAdmin` | none | `Email[]` |
| POST | `/inbox/messages/:id/suggest-updates` | `requireAdmin` | `{ prompt?, context? }` | `Email` |
| POST | `/inbox/messages/:id/create-opportunity` | `requireAdmin` | `Partial<Email>` | `Email` |
| PATCH | `/inbox/leads/:leadId/score-stage` | `requireAdmin` | `{ field?: value }` | `Email` |

---

### 3.21 Admin: PowerShell Scripts (`admin-ps-scripts.ts`)

All routes require `requireAdmin`.

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/ps-scripts` | `requireAdmin` | none | `PowershellScript[]` |
| POST | `/admin/ps-scripts` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| GET | `/admin/ps-scripts/published` | `requireAdmin` | none | `PowershellScript[]` |
| POST | `/admin/ps-scripts/generate` | `requireAdmin` | `{ prompt?, context? }` | `PowershellScript` |
| POST | `/admin/ps-scripts/generate-from-service` | `requireAdmin` | `{ prompt?, context? }` | `PowershellScript` |
| POST | `/admin/ps-scripts/generate-from-task` | `requireAdmin` | `{ prompt?, context? }` | `PowershellScript` |
| POST | `/admin/ps-scripts/explain` | `requireAdmin` | `{ prompt?, context? }` | `PowershellScript` |
| POST | `/admin/ps-scripts/modularize` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| POST | `/admin/ps-scripts/fix` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| GET | `/admin/ps-scripts/:id` | `requireAdmin` | none | `PowershellScript` |
| PUT | `/admin/ps-scripts/:id` | `requireAdmin` | `{ field?: value }` | `PowershellScript` |
| DELETE | `/admin/ps-scripts/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/ps-scripts/:id/push-to-azure` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| POST | `/admin/ps-scripts/:id/analyze-permissions` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| POST | `/admin/ps-scripts/:id/associate-to-package` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| POST | `/admin/ps-scripts/:id/assign-task` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| GET | `/admin/ps-scripts/packages` | `requireAdmin` | none | `PowershellScript[]` |
| POST | `/admin/ps-scripts/packages` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| PATCH | `/admin/ps-scripts/packages/:id` | `requireAdmin` | `{ field?: value }` | `PowershellScript` |
| DELETE | `/admin/ps-scripts/packages/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/ps-scripts/packages/:id/inherited-permissions` | `requireAdmin` | none | `PowershellScript[]` |
| POST | `/admin/ps-scripts/packages/:id/modules` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| POST | `/admin/ps-scripts/packages/:id/push-to-azure` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| POST | `/admin/ps-scripts/packages/:packageId/push-module` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| PUT | `/admin/ps-scripts/modules/:id` | `requireAdmin` | `{ field?: value }` | `PowershellScript` |
| POST | `/admin/ps-scripts/modules/:id/assign-tasks` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| POST | `/admin/ps-scripts/modules/:moduleId/push-to-azure` | `requireAdmin` | `Partial<PowershellScript>` | `PowershellScript` |
| DELETE | `/admin/ps-scripts/modules/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/script-packages/:id/modules` | `requireAdmin` | `Partial<ScriptPackage>` | `ScriptPackage` |
| DELETE | `/admin/script-packages/:id/modules/:moduleId` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/services/:id/script-sets` | `requireAdmin` | none | `Service[]` |
| POST | `/admin/services/:id/script-sets` | `requireAdmin` | `Partial<Service>` | `Service` |
| DELETE | `/admin/services/:id/script-sets/:packageId` | `requireAdmin` | none | `{ deleted: true }` |
| PATCH | `/admin/services/:id/script-sets/reorder` | `requireAdmin` | `{ field?: value }` | `Service` |
| POST | `/admin/services/:id/run-script-sets` | `requireAdmin` | `Partial<Service>` | `Service` |

---

### 3.22 Admin: Script Runner & Job History (`admin-script-runner.ts`)

All routes require `requireAdmin`.

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/runbooks` | `requireAdmin` | none | `T[]` |
| POST | `/admin/runbook-jobs` | `requireAdmin` | `{ runbookName, credentialId, parameters? }` | `T` |
| GET | `/admin/runbook-jobs/output` | `requireAdmin` | query params (see Notes) | `T[]` |
| GET | `/admin/runbook-jobs/history` | `requireAdmin` | none | `T[]` |
| POST | `/admin/runbook-jobs/:jobId/refetch-output` | `requireAdmin` | `{ ...fields }` | `T` |
| GET | `/admin/runbook-jobs/:jobId/replay` | `requireAdmin` | none | `T[]` |
| POST | `/admin/scripts/validate-syntax` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/scripts/analyze-output` | `requireAdmin` | `{ ...fields }` | `T` |
| GET | `/admin/script-runs` | `requireAdmin` | none | `T[]` |
| GET | `/admin/script-runs/:id` | `requireAdmin` | none | `T` |
| POST | `/admin/test-sms` | `requireAdmin` | `{ ...fields }` | `T` |

---

### 3.23 Admin: Callback Tokens & M365 Run (`admin-callback-tokens.ts`, `admin-m365-run.ts`, `admin-m365-scripts.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/callback-tokens` | `requireAdmin` | none | `ClientCallbackToken[]` |
| DELETE | `/admin/callback-tokens/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/projects/:projectId/customer-upload-task-ids` | `requireAdmin` | none | `Project[]` |
| POST | `/script-callback` | Public (token-verified) | `Partial<ScriptRunResult>` | `ScriptRunResult` |
| POST | `/admin/run-script` | `requireAdmin` | `{ credentialId, scriptId }` | `RunbookJobHistory` |
| GET | `/admin/run-script/:jobRef/status` | `requireAdmin` | none | `RunbookJobHistory[]` |
| GET | `/admin/script-run-results` | `requireAdmin` | none | `T[]` |
| PATCH | `/admin/script-run-results/:id/mark-reviewed` | `requireAdmin` | `{ field?: value }` | `T` |
| POST | `/admin/script-run-results/:id/apply-to-client` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/script-run-results/:id/apply-raw-to-profile` | `requireAdmin` | `{ ...fields }` | `T` |
| GET | `/admin/clients/:id/scores` | `requireAdmin` | none | `User[]` |
| POST | `/admin/profile/update` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/scores/update` | `requireAdmin` | `{ ...fields }` | `T` |
| GET | `/admin/appreg/requirements` | `requireAdmin` | none | `T[]` |

---

### 3.24 Admin: Azure Credentials (`admin-azure-credentials.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/azure-credentials` | `requireAdmin` | none | `AzureTenantCredential[]` |
| POST | `/admin/azure-credentials` | `requireAdmin` | `Partial<AzureTenantCredential>` | `AzureTenantCredential` |
| PUT | `/admin/azure-credentials/:id` | `requireAdmin` | `{ field?: value }` | `AzureTenantCredential` |
| DELETE | `/admin/azure-credentials/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/azure-credentials/expiring-summary` | `requireAdmin` | none | `AzureTenantCredential[]` |
| GET | `/admin/clients/:id/azure-credential` | `requireAdmin` | none | `User[]` |
| POST | `/admin/clients/:id/azure-credential` | `requireAdmin` | `Partial<User>` | `User` |
| DELETE | `/admin/clients/:id/azure-credential` | `requireAdmin` | none | `{ deleted: true }` |

---

### 3.25 Admin: SharePoint (`admin-sharepoint.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/sharepoint/hub-config` | `requireAdmin` | none | `SharePointItem[]` |
| POST | `/admin/sharepoint/hub-config` | `requireAdmin` | `Partial<SharePointItem>` | `SharePointItem` |
| GET | `/admin/sharepoint/hub/items` | `requireAdmin` | none | `SharePointItem[]` |
| GET | `/admin/sharepoint/template-site` | `requireAdmin` | none | `SharePointItem[]` |
| PUT | `/admin/sharepoint/template-site` | `requireAdmin` | `{ field?: value }` | `SharePointItem` |
| GET | `/admin/sharepoint/templates/items` | `requireAdmin` | none | `SharePointItem[]` |
| PATCH | `/admin/clients/:id/sharepoint` | `requireAdmin` | `{ field?: value }` | `User` |
| POST | `/admin/clients/:id/sharepoint/provision` | `requireAdmin` | `Partial<User>` | `User` |
| POST | `/admin/clients/:id/sharepoint/add-owner` | `requireAdmin` | `Partial<User>` | `User` |

---

### 3.26 Admin: Marketing (`admin-marketing.ts`)

All routes require `requireAdmin`.

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/marketing/kpi` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/analytics` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/analytics/insights` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/ai-insights` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/daily-command` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/email-stats` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/hot-leads` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/hot-leads/:leadId/intent-timeline` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/next-best-action/:leadId` | `requireAdmin` | none | `T` |
| POST | `/admin/marketing/intent-events` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/marketing/leads/:id/intent-event` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/marketing/leads/:id/next-best-action` | `requireAdmin` | `{ ...fields }` | `T` |
| GET | `/admin/marketing/leads/:id/emails` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/leads/:id/intent-events` | `requireAdmin` | none | `T[]` |
| POST | `/admin/leads` | `requireAdmin` | `Partial<Lead>` | `Lead` |
| GET | `/admin/marketing/recommended-leads` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/recommended-leads` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/marketing/recommended-leads/generate` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| PATCH | `/admin/marketing/recommended-leads/:id` | `requireAdmin` | `{ field?: value }` | `T` |
| PATCH | `/admin/marketing/recommended-leads/:id/dismiss` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/marketing/recommended-leads/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/marketing/recommended-leads/:id/convert` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/marketing/generate/outreach` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/outreach-suggest` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/content` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/content-suggest` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/task-suggestions` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/campaign-topics` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/campaign-suggest` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/audience-topics` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/offer-topics` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/email-copy` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/landing-copy` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/landing-page` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/lead-magnet` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/offer` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/money-tasks` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/generate/follow-up-draft` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/send-outreach` | `requireAdmin` | `{ to, subject, body }` | `T` |
| GET | `/admin/marketing/outreach-templates` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/outreach-templates` | `requireAdmin` | `{ to, subject, body }` | `T` |
| PATCH | `/admin/marketing/outreach-templates/:id` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/marketing/outreach-templates/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/marketing/tasks` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/tasks` | `requireAdmin` | `{ ...fields }` | `T` |
| PATCH | `/admin/marketing/tasks/:id` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/marketing/tasks/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/marketing/follow-ups` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/follow-ups` | `requireAdmin` | `{ ...fields }` | `T` |
| PATCH | `/admin/marketing/follow-ups/:id` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/marketing/follow-ups/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/marketing/follow-ups/:id/complete` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/marketing/follow-ups/:id/generate-copy` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| GET | `/admin/marketing/campaigns` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/campaigns` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| GET | `/admin/marketing/campaigns/:id` | `requireAdmin` | none | `T` |
| PATCH | `/admin/marketing/campaigns/:id` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/marketing/campaigns/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/marketing/campaigns/build-from-prompt` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/campaigns/preview-assets` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/campaigns/generate-ads` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/campaigns/save-ads` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/campaigns/save-assets` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| GET | `/admin/marketing/campaigns/:id/assets` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/campaigns/:id/landing-pages` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/campaigns/:id/offers` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/campaigns/:id/landing-pages/:pageId/link` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| DELETE | `/admin/marketing/campaigns/:id/landing-pages/:pageId/link` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/marketing/campaigns/:id/offers/:offerId/link` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| DELETE | `/admin/marketing/campaigns/:id/offers/:offerId/link` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/marketing/campaign-assets` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/campaign-assets` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| PATCH | `/admin/marketing/campaign-assets/:id` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/marketing/campaign-assets/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/marketing/offers` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/offers` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/marketing/offers/generate` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| PATCH | `/admin/marketing/offers/:id` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/marketing/offers/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/marketing/landing-pages` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/landing-pages` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/marketing/landing-pages/generate` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/suggest/landing-page` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| POST | `/admin/marketing/suggest/offer` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| PATCH | `/admin/marketing/landing-pages/:id` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/marketing/landing-pages/:id` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/marketing/seo-rankings` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/seo-rankings` | `requireAdmin` | `{ ...fields }` | `T` |
| PATCH | `/admin/marketing/seo-rankings/:id` | `requireAdmin` | `{ field?: value }` | `T` |
| DELETE | `/admin/marketing/seo-rankings/:id` | `requireAdmin` | none | `{ deleted: true }` |
| POST | `/admin/marketing/seo-rankings/sync-search-console` | `requireAdmin` | `{ ...fields }` | `T` |
| GET | `/admin/marketing/active-campaign-badges` | `requireAdmin` | none | `T[]` |
| GET | `/admin/marketing/campaign-badges-stream` | `requireAdmin` | none | `T[]` |
| POST | `/admin/marketing/lead-magnets/generate` | `requireAdmin` | `{ prompt?, context? }` | `T` |
| GET | `/admin/site-config` | `requireAdmin` | none | `T[]` |
| GET | `/landing-pages/:slug` | Public | none | `T` |
| GET | `/landing-pages/:slug/gate-status` | Public | none | `T[]` |
| POST | `/landing-pages/:slug/token` | Public | `{ ...fields }` | `T` |

---

### 3.27 Admin: Client Documents (`admin-client-documents.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/clients/:clientId/documents` | `requireAdmin` | none | `User[]` |
| POST | `/admin/clients/:clientId/documents` | `requireAdmin` | `Partial<User>` | `User` |
| DELETE | `/admin/clients/:clientId/documents/:docId` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/clients/:clientId/status-reports` | `requireAdmin` | none | `User[]` |

---

### 3.28 Admin: Service Page Triggers, DB Status & Dev Seed

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/admin/service-page-triggers` | `requireAdmin` | none | `T[]` |
| PUT | `/admin/service-page-triggers/:pageSlug` | `requireAdmin` | `{ field?: value }` | `T` |
| GET | `/admin/db-status` | `requireAdmin` | none | `T[]` |
| POST | `/admin/db-migrate` | `requireAdmin` | `{ ...fields }` | `T` |
| POST | `/admin/dev/seed-result` | `requireAdmin` | `{ ...fields }` | `T` |

---

### 3.29 Admin: Kanban Escalation, Mobile & Misc

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/admin/kanban/check-escalations` | `requireAdmin` | `{}` | { alerted, cardIds[] } |
| POST | `/admin/kanban/trigger-auto-fire` | `requireAdmin` | `{ clientUserId }` | `KanbanTask` |
| POST | `/admin/kanban/reconcile-stalled-phases` | `requireAdmin` | `Partial<KanbanTask>` | `KanbanTask` |
| GET | `/admin/conversations` | `requireAdmin` | none | `T[]` |
| POST | `/admin/device-tokens` | `requireAdmin` | `{ ...fields }` | `T` |
| DELETE | `/admin/device-tokens/:token` | `requireAdmin` | none | `{ deleted: true }` |
| GET | `/admin/overview` | `requireAdmin` | none | `DashboardStats[]` |
| POST | `/admin/insights` | `requireAdmin` | `Partial<InsightDocument>` | `InsightDocument` |

---

### 3.30 Portal: Quick Win Scoring (`portal-quick-win-scoring.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/portal/quick-win/catalog` | `requireAuth` | none | `QuickWinPresentation[]` |
| GET | `/portal/quick-win/scorecard` | `requireAuth` | none | `QuickWinPresentation[]` |
| POST | `/portal/quick-win/escalate` | `requireAuth` | `Partial<QuickWinPresentation>` | `QuickWinPresentation` |

---

### 3.31 Notifications & Push (`notifications.ts`, `push.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/notifications` | `requireAdmin` | none | `Notification[]` |
| PATCH | `/notifications/:id/read` | `requireAdmin` | `{ field?: value }` | `Notification` |
| PATCH | `/notifications/read-all` | `requireAdmin` | `{ field?: value }` | `Notification` |
| GET | `/push/vapid-public-key` | Public | none | `WebPushSubscription[]` |
| POST | `/push/subscribe` | `requireAdmin` | `Partial<WebPushSubscription>` | `WebPushSubscription` |
| DELETE | `/push/subscribe` | `requireAdmin` | none | `{ deleted: true }` |

---

### 3.32 Audit Logs (`audit-logs.ts`)

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/audit-logs` | `requireAdmin` | none | `T[]` |
| GET | `/audit-logs/clients` | `requireAdmin` | none | `T[]` |
| GET | `/audit-logs/me` | `requireAuth` | none | `T[]` |

---

### 3.33 Public Routes

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/healthz` | Public | none | `HealthStatus[]` |
| GET | `/services` | Public | query params (see Notes) | `Service[]` |
| GET | `/public/engagement-projects` | Public | none | `EngagementProject[]` |
| GET | `/public/service-page-triggers` | Public | none | `T[]` |
| POST | `/contact-chat` | Public | `{ ...fields }` | `T` |
| GET | `/booking/slots` | Public | none | `BookingSlot[]` |
| POST | `/booking` | Public (rate-limited) | `Partial<BookingSlot>` | `BookingSlot` |
| POST | `/shares` | Public | `Partial<ShareEvent>` | `ShareEvent` |
| GET | `/shares` | Public | none | `ShareEvent[]` |
| POST | `/downloads/checklist` | Public | `Partial<ChecklistDownload>` | `ChecklistDownload` |
| GET | `/downloads/checklist/stats` | `requireAdmin` | none | `ChecklistDownload[]` |
| GET | `/graph/webhook` | Public (Graph validation) | none | `GraphEvent[]` |
| POST | `/graph/webhook` | Public (Graph-verified) | Stripe/Graph webhook payload | `200 OK` |
| GET | `/public/testimonials` | Public | none | `Testimonial[]` |
| GET | `/landing-pages/:slug` | Public | none | `T` |
| GET | `/landing-pages/:slug/gate-status` | Public | none | `T[]` |
| POST | `/landing-pages/:slug/token` | Public | `{ ...fields }` | `T` |


---

## 4. Admin Panel

**Path:** `/admin-panel/`  
**Artifact:** `artifacts/admin-panel`  
**Auth:** Admin JWT (role `"admin"`) — login via `/admin-panel/login`

The Admin Panel is Shane's full business operating system. It is organized into five primary workspaces, each grouping related functional pages under a common sidebar.

---

### 4.1 Command Workspace (`/admin-panel/command/*`)

**Purpose:** Centralized business intelligence, AI orchestration, and automation control.

| Screen | Path | What it does |
|---|---|---|
| Overview | `/command/overview` | Business KPIs, revenue, active projects, AI next-best-actions |
| Messages | `/command/messages` | CRM-linked email/message inbox |
| Analytics | `/command/analytics` | Session counts, page views, revenue forecast |
| Script Generator | `/command/scripts` | AI-powered PowerShell script authoring and Azure sync |
| Running Scripts | `/command/running-scripts` | Live Azure Automation job monitor |
| AI Prompt Center | `/command/prompts` | View and edit all AI prompts used across the system |
| Marketing | `/command/marketing` | Campaign management, outreach, LinkedIn content, SEO |
| AI Insights | `/command/insights` | AI-generated business health narratives |

**Key API calls:** `GET /admin/overview`, `GET /ai/next-best-actions`, `GET /analytics/revenue/forecast`, `POST /admin/scripts/generate`, `POST /admin/runbook-jobs`, `POST /admin/ai-prompts`

---

### 4.2 Pipeline Workspace (`/admin-panel/pipeline/*`)

**Purpose:** Manage the sales funnel from first contact to client conversion.

| Screen | Path | What it does |
|---|---|---|
| Leads | `/pipeline/leads` | Full lead list; AI qualification scores; merge, archive, convert |
| Quiz Leads | `/pipeline/quiz-leads` | Leads captured from website quizzes with quiz results |
| Opportunities | `/pipeline/opportunities` | CRM pipeline board with deal stages and opportunity tasks |
| Clients | `/pipeline/clients` | Active client list with health scores and project counts |
| M365 Intelligence | `/pipeline/m365-intelligence` | Tenant environment snapshots per client |

**Key API calls:** `GET /leads`, `PATCH /leads/:id`, `GET /leads/:id/derive-signals`, `GET /admin/quiz-leads`, `GET /opportunities`, `GET /admin/clients/enriched`

---

### 4.3 Delivery Workspace (`/admin-panel/delivery/*`)

**Purpose:** Post-sale project execution, Kanban management, automation monitoring, and document storage.

| Screen | Path | What it does |
|---|---|---|
| Projects | `/delivery/projects` | Active project board with phase/progress indicators |
| Clients (Delivery) | `/delivery/clients` | Client detail with delivery-focused tabs |
| Engagement Projects | `/delivery/engagement-projects` | Public-facing engagement model templates |
| Workflows | `/delivery/workflows` | Kanban board per project with drag-to-move, SSE live updates |
| Activity Logs | `/delivery/activity-logs` | System-wide audit log |
| Hub Storage | `/delivery/hub-storage` | SharePoint file browser and upload |

**Key API calls:** `GET /admin/engagement-projects`, `GET /admin/workflow-templates`, `POST /admin/kanban/trigger-auto-fire`, `GET /audit-logs`, `GET /admin/sharepoint/hub/items`, `POST /admin/status-reports`

---

### 4.4 Finance Workspace (`/admin-panel/finance/*`)

**Purpose:** Billing, revenue tracking, legal agreements, and discount management.

| Screen | Path | What it does |
|---|---|---|
| Invoices | `/finance/invoices` | Invoice list; create, send, PDF download, Stripe status |
| Purchases | `/finance/purchases` | Stripe checkout session history |
| Contracts | `/finance/contracts` | Signed contract list; PDF download; SharePoint link |
| Coupons | `/finance/coupons` | Create and manage discount codes |
| Reports | `/finance/reports` | Financial and project report uploads |

**Key API calls:** `GET /admin/finance/summary`, `GET /admin/invoices`, `POST /admin/invoices`, `GET /admin/purchases`, `GET /admin/contracts`, `POST /admin/coupons`

---

### 4.5 Marketing/SEO (Content Workspace) (`/admin-panel/content/*`, `/admin-panel/command/marketing`)

**Purpose:** Content publishing, campaign management, SEO performance tracking, and outreach.

| Screen | Path | What it does |
|---|---|---|
| Articles | `/content/articles` | Blog article CRUD, Markdown editor |
| Services | `/content/services` | Public service catalog editor |
| Service Triggers | `/content/service-triggers` | Quiz → service routing config |
| Email Templates | `/content/email-templates` | Edit transactional email copy |
| Contract Templates | `/content/contract-templates` | Edit service-specific legal agreement bodies |
| Template Library | `/content/template-library` | Instruction sets, checklists, artifact sets, deliverable sets |
| Asset Library | `/content/asset-library` | Reusable content assets |
| Marketing Center | `/command/marketing` | Campaigns, AI outreach drafts, SEO rankings, recommended leads |

**Key API calls:** `GET /admin/articles`, `POST /admin/articles`, `GET /admin/services`, `GET /admin/email-templates`, `GET /admin/marketing/campaigns`, `POST /admin/marketing/generate/outreach`, `GET /admin/marketing/seo-rankings`, `POST /admin/marketing/seo-rankings/sync`

---

### 4.6 System Workspace (`/admin-panel/system/*`)

| Screen | Path | What it does |
|---|---|---|
| Inbox | `/system/inbox` | Full email inbox linked to Graph API subscriptions |
| Security | `/system/security` | Admin MFA enrollment and WebAuthn passkey management |
| Signal Mappings | `/system/signal-mappings` | Configure quiz pain signal → CRM mapping rules |

---

## 5. CRM Dashboard (Client Portal)

**Path:** `/crm/`  
**Artifact:** `artifacts/crm`  
**Auth:** Client JWT (role `"client"`) — login via `/crm/login`

The CRM Dashboard is the client-facing delivery portal. Clients access it after purchasing a service, completing onboarding, and establishing Azure credentials.

---

### 5.1 Authentication Screens

| Screen | Path | Notes |
|---|---|---|
| Login | `/crm/login` | Email/password + MFA challenge |
| Setup Password | `/crm/setup-password?token=` | First-time password setup from account setup token |
| Forgot/Reset Password | `/crm/forgot-password`, `/crm/reset-password` | Standard password reset flow |

---

### 5.2 Onboarding Wizard

A multi-step wizard that new clients complete before the portal unlocks.

| Step | Screen | What happens |
|---|---|---|
| 1 | SOW Selector (`OnboardingSelect.tsx`) | Client selects Quick Win or Retainer package; `OrderWizard` for custom-priced options; coupon validation |
| 2 | App Registration (`OnboardingWizard.tsx`) | Client provides Azure Tenant ID, Client ID, and Client Secret; stored in Azure Key Vault via `PUT /portal/app-registration` |
| 3 | Contract Signing (`OnboardingContract.tsx`) | Dynamic contract generated from `contract_templates`; client signs via canvas; submitted to `POST /portal/onboarding/contract` |
| 4 | Completion | `POST /portal/onboarding/complete` marks wizard done; project is created; kanban auto-fires |

---

### 5.3 Client Project Dashboard (`/crm/portal`)

The main post-onboarding hub.

**Components:**
- **Activity Feed** — Recent project updates, completed tasks, document deliveries
- **M365 Health Score Ring** — Animated ring chart showing overall M365 health (0–100)
- **Kanban Preview** — Tasks in `"waiting_on_customer"` column highlighted for client action
- **Automation Banner** — Live status of any running automation sequences
- **Manual Script Section** — Scripts the client can download and run themselves
- **Script Progress Widget** — Real-time progress of automated script runs (polling `/portal/automation-progress`)
- **Retainer Detail** (`PortalRetainerDetail.tsx`) — For retainer clients: current month plan, hours, deliverables
- **Project Close-Out** (`PortalProjectCloseOut.tsx`) — Closure sign-off and testimonial form

**Key API calls:** `GET /portal/dashboard`, `GET /portal/health/summary`, `GET /portal/automation-progress`, `GET /portal/messages`

---

### 5.4 Quick Win Runner (`/crm/portal/quick-win`)

A full-screen automated execution experience for one-time diagnostic services.

- Launches the `FullScreenWrapper` component
- Real-time terminal output streamed from Azure Automation via SSE
- Progresses through script modules with a progress bar
- On completion, transitions to the Deliverables screen where AI-generated reports appear
- Timing recorded in `projects.quickWinElapsedSeconds`

**Key API calls:** `POST /admin/run-script`, `GET /admin/run-script/:jobRef/status`, `GET /portal/projects/:id/kanban-events` (SSE)

---

### 5.5 Insights Hub (`/crm/portal/insights`)

Analytics and AI-driven intelligence for the client.

- **Radar Chart** — M365 environment health across 8 categories vs. industry benchmark
- **Category Score History** — Time-series charts per category (security, compliance, etc.)
- **Benchmarking** — Compares client scores against industry averages
- **AI Next Best Actions** — Recommended improvements surfaced from script findings
- **Generated Documents** — Delivered reports and SOWs visible here

**Key API calls:** `GET /portal/health/summary`, `GET /portal/m365-scorecard-history`, `GET /portal/m365-profile`, `GET /ai/next-best-actions`

---

### 5.6 SOW & Presentation (`/crm/portal/presentation/:token`)

The post-Quick Win discovery presentation flow.

- Client reviews AI-generated readiness report
- Selects SOW phases they want to proceed with (interactive phase picker)
- Sees live price total update based on selections
- Chooses `"full"` or `"phased"` payment plan
- Signs the updated SOW agreement
- Proceeds to Stripe checkout via `POST /portal/presentations/:id/checkout`

**Key API calls:** `GET /portal/presentations/:token`, `POST /portal/presentations/:id/checkout`

---

### 5.7 Other Portal Screens

| Screen | Path | Purpose |
|---|---|---|
| Projects List | `/crm/portal/projects` | All client projects with phase indicators |
| Project Detail | `/crm/portal/projects/:id` | Full project view: kanban, docs, status reports |
| Invoices | `/crm/portal/invoices` | Invoice list with Stripe pay button |
| Messages | `/crm/portal/messages` | Direct messaging with Shane |
| Profile | `/crm/portal/profile` | Edit contact details |

---

## 6. Public Website & Customer Portal

**Path:** `/`  
**Artifact:** `artifacts/shane-mccaw-consulting`  
**Auth:** None (public) except `/admin` (admin password)

---

### 6.1 Home & Landing Pages

- **Home (`/`)** — Positions Shane McCaw as "NASA's Lead M365 Architect." Features hero, "Who I Work With" (Mid-Market, Regulated, Startups), 3-step engagement process (Discover → Diagnose → Architect & Execute), live-fetched Micro-Offers and Retainer listings via `GET /services`.
- **LandingPage (`/lp/:slug`)** — Dynamic campaign landing page rendering blocks (Authority, Why This Matters, Process, Testimonials, FAQ) from `landing_pages` records. Includes a gating mechanism that generates an `onboardingLpToken` and redirects to `/crm/portal/onboarding/select` to begin purchase.

---

### 6.2 Service Pages (`/services/*`)

Deep-dive technical service pages for each offering:

| Route | Service |
|---|---|
| `/services/microsoft-365` | Microsoft 365 Architecture |
| `/services/copilot-ai` | Copilot & AI Readiness |
| `/services/sharepoint` | SharePoint & Teams |
| `/services/power-platform` | Power Platform |
| `/services/governance` | Governance & Compliance |
| `/services/cloud-migration` | Cloud Migration |

Each maps specific client problems to NASA-grade outcomes and links to fixed-price packages.

---

### 6.3 Quiz & Lead-Gen

| Route | Component | Mechanism |
|---|---|---|
| `/quiz` | `CopilotQuiz.tsx` | AI chat (Anthropic streaming) — 10 questions across 5 dimensions → maturity score → recommended upsell |
| `/quick-win-quiz` | `QuickWinQuiz.tsx` | 10-question selector quiz → ranked Quick Win package recommendations |
| `/quiz/governance` | `GovernanceQuiz.tsx` | Governance-specific scored assessment |
| `/quiz/m365-health` | `M365HealthQuiz.tsx` | M365 environment health quiz |

**Flow:** Quiz completion → `POST /quiz/submit` → scored result with `leadId` → redirect to `/quiz/results/:leadId?token=` showing tier/score + upsell CTA.

---

### 6.4 Micro-Offers & Pricing

- **`/micro-offers`** — Catalogs fixed-price Quick Win packages in three tiers: Entry (Audits, ~$3K), Core (Quick-Starts, ~$5K–$8K), Strategic (Foundations, ~$10K–$15K). Each links to the checkout flow.
- **`/pricing`** — Transparent pricing for all three tracks: Entry (fixed-price Quick Wins), Core (project-based $7.5K–$35K+), Strategic (monthly fractional retainers $2.5K–$11K/mo).

---

### 6.5 Retainer Pages (`/retainers/*`)

| Route | Plan | Hours/mo |
|---|---|---|
| `/retainers` | Overview | Comparison of all three |
| `/retainers/essentials` | Architect Essentials | 10 hrs |
| `/retainers/growth` | Architect Growth | 25 hrs (most popular) |
| `/retainers/enterprise` | Architect Enterprise | 50 hrs |

Each page describes a "Typical Month" breakdown with weekly milestones.

---

### 6.6 Book & Contact

- **`/book`** — High-intent scheduling page. `CalendarBooking` component reads Shane's real Exchange Online calendar via Microsoft Graph (`GET /booking`) to show available slots. Prompts for "real decision-makers only."
- **`/contact`** — AI assistant chat (`POST /contact-chat`) that collects name, email, company, and service area before creating a lead. Shows estimated response time.

---

### 6.7 Resources & Content

- **`/resources`** — Blog index sourced from the local `@/data/articles` static data module (`artifacts/shane-mccaw-consulting/src/content/articles/` Markdown files). No API call; content is bundled at build time. Articles are categorized by service area.
- **`/resources/:slug`** — Individual article page with Markdown rendering from the same local data module.

---

### 6.8 Customer Command Center (`/customer-command-center`)

Public-facing walkthrough of what clients get access to in the portal: project lifecycle phases, Kanban board visibility, Document Vault, invoice management, and status reports.

---

### 6.9 Admin (`/admin`)

Password-protected local admin for managing articles. Uses `sessionStorage` for the password — not a full user account system. Routes to CRUD endpoints at `/api/admin/articles`.

---

## 7. Workflow Engine Integration

The system uses an event-driven automation model. There is no separate workflow service — automation logic lives in `artifacts/api-server/src/lib/` and is triggered by API route handlers.

---

### 7.1 Trigger Points

| Trigger | Location | What fires |
|---|---|---|
| `checkout.session.completed` (Stripe webhook) | `portal.ts` → `stripe.ts:processStripeEvent` | Creates user account (or links existing), creates `client_service`, creates `project`, spawns first `workflow_step`, seeds first-phase `kanban_tasks`, sends welcome email, sends SMS to Shane, sends push notification |
| `customer.subscription.deleted` (Stripe webhook) | `stripe.ts:processStripeEvent` | Updates `client_service.status = "paused"`, sends retention SMS to Shane |
| App Registration submitted | `PUT /portal/app-registration` | Saves credentials to Azure Key Vault, calls `autoFireFirstBacklogScript()`, calls `autoFireDocumentCard()` |
| App Registration re-verified | `POST /portal/app-registration/recheck` | Re-runs permission check, updates `client_app_registrations.permissionCheck` |
| Kanban card moved to `"completed"` | Admin Panel drag-drop → `PATCH /admin/kanban-tasks/:id` | Calls `advancePhaseIfComplete()` — checks if all phase tasks done, unlocks next phase, seeds new tasks |
| Script job polled to completion | `kanban-auto-fire.ts:pollJobToCompletion` | Updates `script_run_results`, calls `parse-m365-script-output.ts`, updates health scores, moves kanban card to `"completed"`, fires `autoFireDocumentCard()` for next document task |
| Document generation task auto-fires | `kanban-auto-fire.ts:autoFireDocumentCard` | Calls `generateAndDeliverDocument()` |
| Kanban escalation cron | `POST /admin/kanban/check-escalations` | Identifies overdue tasks, sends admin push notification |
| Graph email webhook | `POST /graph/webhook` | Ingests email, auto-links to lead/project/client via domain rules |

---

### 7.2 Kanban Auto-Fire (`kanban-auto-fire.ts`)

```
autoFireFirstBacklogScript(projectId)
  → Find first "backlog" kanban_task where taskType = "script"
  → Resolve runbookId from taskMetadata
  → Move card to "in_progress"
  → POST to Azure Automation → create job
  → Store jobId in taskMetadata
  → pollJobToCompletion(jobId, cardId)

pollJobToCompletion(jobId, cardId)
  → Poll Azure Automation every 10s
  → On completion: parse output → update script_run_results
  → Update client_scores if triggersHealthScore = true
  → Move kanban card to "completed"
  → Call autoFireDocumentCard(projectId)

autoFireDocumentCard(projectId)
  → Find first "backlog" kanban_task where taskType = "document_generation"
  → Move card to "in_progress"
  → Call generateAndDeliverDocument(docType, projectId, clientUserId)
  → Move card to "completed" on success
```

---

### 7.3 Phase Advancement (`kanban-phase-advance.ts`)

```
advancePhaseIfComplete(projectId, workflowStepId)
  → Count incomplete tasks in current step
  → If all completed:
      → Set workflowStep.status = "completed"
      → Find next workflowStep (by order)
      → Set next step status = "in_progress"
      → Seed new kanban_tasks from workflowTemplateStepTasks
      → Notify client via push/email if new customer tasks created
      → autoFireFirstBacklogScript() for new script tasks
```

---

### 7.4 Document Generation (`document-generator.ts`)

```
generateAndDeliverDocument(docType, projectId, clientUserId)
  → Fetch client M365 profile, script findings, health scores
  → Build context prompt
  → Call Anthropic Claude (claude-3-5-haiku) via AI Integrations proxy
  → Extract JSON structure from response (using extractJson())
  → Save htmlContent to insights_generated_documents
  → If docType = "sow": call parseSowPricing() → create quick_win_presentations
  → If docType = "sow": call ensureOpportunityForSow() → transition lead to Opportunity
  → Set document status = "delivered" → visible in client portal immediately
  → Send push notification to admin
```

---

### 7.5 Stripe Integration (`stripe.ts`)

**Checkout session types created:**
- `service_purchase` — one-time Quick Win or project purchase (metadata: `purchaseType = "service_purchase"`)
- `onboarding_purchase` — retainer subscription setup (metadata: `purchaseType = "onboarding_purchase"`)
- `presentation_checkout` — SOW phase payment after presentation sign-off

**Webhook events handled:**

| Event | Action |
|---|---|
| `checkout.session.completed` | Full project provisioning (see §7.1) |
| `invoice.payment_succeeded` | Creates `invoices` record with `status = "paid"` for recurring billing |
| `customer.subscription.deleted` | Marks client service as paused; sends SMS alert to Shane |
| `charge.refunded` | Logs refund to audit log |

---

### 7.6 Communication Dispatch

| Channel | Library | When triggered |
|---|---|---|
| Email | `mailer.ts` (Graph / Resend) | Welcome email on purchase; onboarding confirmation; status report sent; closure request; reply to client question |
| SMS (Twilio) | `sms.ts` | New purchase; subscription cancelled; subscription resumed |
| Web Push (VAPID) | `web-push.ts` | New lead; new quiz lead; new purchase; kanban escalation; script completion |
| Mobile Push (Expo) | `push.ts` | New purchase; new client message; project update |

---

### 7.7 Azure Automation Integration (`azure-automation.ts`)

The API server acts as an orchestrator for Azure Automation:

1. Credentials for each client are stored in **Azure Key Vault** (never in the database).
2. The admin triggers a runbook job via `POST /admin/runbook-jobs` or the system auto-fires via `kanban-auto-fire.ts`.
3. The runbook is polled until it completes. Output is parsed by `parse-m365-script-output.ts`.
4. Parsed findings update `script_run_results`, `client_m365_profiles`, and `client_scores`.

---

## 8. Events and Actions Reference

### 8.1 System Events (with payload shapes)

| Event | Payload | Emitted When |
|---|---|---|
| `lead.created` | `{ leadId, email, name, source }` | Contact form submit, quiz submission, AI recommendation |
| `lead.scored` | `{ leadId, score, previousScore, stage }` | AI qualification runs |
| `lead.converted` | `{ leadId, userId }` | Client account created from lead |
| `quiz.submitted` | `{ quizLeadId, quizType, tier, totalScore, email }` | Quiz form submit |
| `purchase.completed` | `{ sessionId, purchaseType, clientUserId, serviceId, amount }` | Stripe `checkout.session.completed` |
| `subscription.cancelled` | `{ stripeSubscriptionId, clientUserId }` | Stripe `customer.subscription.deleted` |
| `app_registration.submitted` | `{ clientUserId, tenantId, clientId }` | Client submits app reg credentials |
| `app_registration.verified` | `{ clientUserId, permissionCheck }` | Permission check passes |
| `script.started` | `{ jobId, runbookName, clientUserId, projectId, kanbanTaskId }` | Azure Automation job created |
| `script.completed` | `{ jobId, status, scoreImpact, projectId, kanbanTaskId }` | Azure job polled to completion |
| `script.failed` | `{ jobId, errorMessage, projectId, kanbanTaskId }` | Azure job failed or timed out |
| `document.generated` | `{ documentId, docType, projectId, clientUserId }` | AI document generation completes |
| `document.delivered` | `{ documentId, clientUserId }` | Document status set to "delivered" |
| `sow.created` | `{ documentId, projectId, totalPrice, phases[] }` | SOW document generated |
| `presentation.signed` | `{ presentationId, signerName, selectedPhaseIds, totalPrice }` | Client signs SOW presentation |
| `presentation.paid` | `{ presentationId, stripeSessionId, paymentPlan }` | Stripe payment for presentation |
| `kanban.phase_completed` | `{ projectId, workflowStepId, nextStepId }` | All tasks in a phase completed |
| `kanban.task_escalated` | `{ kanbanTaskId, projectId, daysOverdue }` | Task overdue escalation check |
| `contract.signed` | `{ contractId, userId, serviceId, finalPrice }` | Client signs onboarding contract |
| `invoice.created` | `{ invoiceId, clientUserId, amount }` | Invoice record created |
| `invoice.paid` | `{ invoiceId, paidAt, stripeSessionId }` | Stripe confirms payment |
| `opportunity.created` | `{ opportunityId, leadId, workflowType }` | Lead promoted to opportunity |
| `opportunity.converted` | `{ opportunityId, projectId }` | Opportunity linked to active project |
| `project.created` | `{ projectId, clientUserId, serviceId, projectType }` | Project provisioned after purchase |
| `project.completed` | `{ projectId, signedOffAt }` | Project signed off / closed out |
| `email.ingested` | `{ emailId, senderAddress, linkedUserId?, linkedLeadId? }` | Graph webhook email received |
| `status_report.sent` | `{ reportId, projectId, clientUserId }` | Admin sends status report |
| `status_report.acknowledged` | `{ reportId, clientStatus, question? }` | Client acknowledges/questions |

---

### 8.2 System Actions (with inputs and side-effects)

| Action | Inputs | Side-effects |
|---|---|---|
| **Provision Client Project** | `stripeSessionId`, `serviceId`, `email` | Creates/links `users`, `client_services`, `projects`, `workflow_steps`, `kanban_tasks` |
| **Auto-fire Script** | `projectId` | Moves kanban card to `in_progress`; creates Azure Automation job; begins polling |
| **Auto-fire Document** | `projectId` | Moves kanban card to `in_progress`; calls Anthropic API; saves document; delivers to portal |
| **Advance Phase** | `projectId`, `workflowStepId` | Closes current step; opens next step; seeds new kanban tasks; notifies client/admin |
| **Generate SOW** | `projectId`, `clientUserId` | Calls Anthropic; parses pricing; creates `quick_win_presentations`; promotes lead to Opportunity |
| **Send Welcome Email** | `clientUserId`, `serviceId` | Renders email template `"welcome"` and sends via Graph/Resend |
| **Send SMS Alert** | `eventType`, `clientUserId` | Posts Twilio message to `SHANE_PHONE_NUMBER` |
| **Send Web Push** | `title`, `body`, `adminUserIds[]` | Delivers browser push to all subscribed admin endpoints |
| **Send Mobile Push** | `title`, `body` | Delivers Expo push to `device_tokens` |
| **Provision SharePoint Site** | `clientUserId`, `companyName` | Creates M365 Group + SharePoint site; sets `users.sharepointSiteUrl`; adds Shane as owner |
| **Score Lead** | `leadId` | Calls Claude with lead data; updates `leads.score`, `stage`, pain point arrays |
| **Qualify Lead** | `leadId` | Creates `lead_qualifications` record; may create `opportunities` |
| **Generate Outreach Draft** | `leadId`, `templateType` | Calls Claude; saves to `outreach_templates` |
| **Send Outreach Email** | `leadId`, `content` | Sends via Graph API; creates `email_events`; updates `follow_up_events` |
| **Sync SEO Rankings** | _(none — runs on demand)_ | Calls Google Search Console API; upserts `seo_rankings` |
| **Impersonate Client** | `adminUserId`, `clientUserId` | Creates `impersonation_tokens`; returns short-lived token for client session |
| **Sync Azure Runbook** | `scriptId` | Pushes PowerShell body to Azure Automation; updates `powershell_scripts.azureSyncedAt` |
| **Parse Script Output** | `jobId`, `rawOutput` | Extracts findings; calculates `scoreImpact`; updates `client_scores` and `client_m365_profiles` |
| **Escalate Kanban Task** | `kanbanTaskId` | Sends push notification; logs to `audit_logs` |
| **Sign Contract** | `serviceId`, `signatureData`, `userId` | Creates `contracts` record; generates PDF; files to SharePoint |
| **Validate Coupon** | `code`, `serviceId` | Checks `coupons.active`, expiry, max uses; returns discount amount |
| **Create Stripe Session** | `priceInCents`, `serviceId`, `userId` | Returns Stripe checkout URL; sets session metadata for webhook processing |
| **AI Generate Workflow** | `workflowTemplateId` | Calls Claude; creates `workflow_template_steps` and `workflow_template_step_tasks` |

---

## 9. End-to-End Engagement Flow

### 9.1 Narrative

The full client lifecycle moves through six major stages:

**Stage 1 — Discovery (Website)**

A prospect arrives at `shanemccawconsulting.com` from SEO, LinkedIn, or a referral. They read service pages, potentially take a free quiz (`/quiz` or `/quick-win-quiz`), and either book a discovery call (`/book` via Graph calendar) or reach out via the AI chat contact form (`/contact`). The contact form creates a `leads` record. Quiz completion creates both a `quiz_leads` record and a `leads` record. Shane sees these immediately in the Admin Panel Pipeline Workspace.

**Stage 2 — Qualification (Admin Panel)**

Shane reviews the lead in the Pipeline Workspace. The AI scoring engine runs automatically (Anthropic Claude analyzes all lead fields) and produces a score (0–100) with dimension breakdowns (Fit, Pain, Maturity, Intent, Urgency). Shane reviews the qualification record and either converts the lead to an Opportunity or archives it. For hot leads, Shane uses the AI-generated outreach draft to send a personalized email directly from the Admin Panel.

**Stage 3 — Purchase (Website → Stripe)**

For Quick Wins, the prospect clicks "Get Started" on a micro-offer. This generates a session token and redirects to `/crm/portal/onboarding/select`. The client picks a service, optionally applies a coupon, and proceeds to Stripe checkout via `POST /portal/checkout/create-session`. Stripe processes the payment and fires `checkout.session.completed`.

For Retainers/Projects, Shane scopes work during the discovery call and then creates the client account manually from the Admin Panel or sends an account setup email.

**Stage 4 — Onboarding (CRM Portal)**

On their first CRM login, clients enter the onboarding wizard:
1. **Select Service** — confirm or upgrade their package
2. **App Registration** — provide Azure credentials (stored securely in Key Vault)
3. **Sign Contract** — review and e-sign the service agreement

On contract signing, the project is provisioned and the first automation phase begins.

**Stage 5 — Execution (CRM Portal + Azure Automation)**

The Kanban engine drives delivery:

1. **Phase 1 (Discovery)** — The first backlog script fires automatically after app registration. Azure Automation runs M365 diagnostic PowerShell scripts. Output is parsed, findings are saved, health scores update.
2. **Document Generation** — When all scripts in a phase complete, the document auto-fire triggers. Claude generates an AI-written Tenant Health Report with findings and recommendations. This appears immediately in the client's Insights Hub.
3. **Quick Win Runner** — For Quick Win purchases, the client watches the full-screen terminal execution in real time. On completion, they see their deliverables and the next-step offer.
4. **Phase Advance** — Shane marks tasks complete in the Admin Panel Kanban. When all phase tasks are done, the next phase unlocks automatically and the client receives a notification.
5. **SOW & Presentation** — After the diagnostic phase, Claude generates an SOW. Shane reviews it in the Admin Panel, marks it approved, and shares a presentation link with the client. The client selects SOW phases, reviews the price, and signs.
6. **Payment** — Client pays for the selected SOW phases via Stripe (full or phased payment plan).

**Stage 6 — Ongoing Delivery & Close-out (CRM Portal)**

For project-based engagements, phases 2–6 (Preparation → Execution → Delivery → Review → Handoff) follow the same Kanban cycle. For retainer clients, the monthly cycle repeats: strategy call, deep dive, execution, status report, review.

Status reports are authored by Shane in the Delivery Workspace, sent to the client portal, and the client acknowledges or asks questions. The reply thread is tracked in `status_reports.replyThread`.

At project completion, Shane triggers a project close-out. The client signs off, optionally grants testimonial permission, and the project is archived.

---

### 9.2 ASCII Flow Diagram

```
Website Visitor
     │
     ├─ Takes Quiz (/quiz, /quick-win-quiz)
     │       │
     │       └─ quiz_leads + leads created
     │               │
     ├─ Contact Form / AI Chat ─────────────┐
     │       │                              │
     │       └─ leads record created        │
     │                                      │
     │   [Admin Panel: Pipeline Workspace]  │
     │       │                              │
     │       ├─ AI Lead Scoring (Claude) ◄──┘
     │       │       score, stage, signals
     │       │
     │       └─ Shane Qualifies → Opportunity
     │               │
     │               └─ AI Outreach Draft → Send Email
     │
     ▼
Click "Get Started" (micro-offer) OR Invited by Shane
     │
     ▼
/crm/portal/onboarding/select  (SOW Selector)
     │
     ├─ Select Service (OrderWizard if custom pricing)
     ├─ Apply Coupon (optional)
     └─ Stripe Checkout (POST /portal/checkout/create-session)
             │
             ▼
     Stripe: checkout.session.completed
             │
             ▼
     stripe.ts: processStripeEvent()
     ├─ Create/link users record
     ├─ Create client_services
     ├─ Create projects
     ├─ Seed workflow_steps (Phase 1)
     ├─ Seed kanban_tasks
     ├─ Send welcome email
     ├─ Send SMS to Shane
     └─ Send push notification
             │
             ▼
/crm/portal/onboarding (Wizard)
Step 1: Service Confirmation
Step 2: App Registration
     │   PUT /portal/app-registration
     │   → Azure Key Vault stores secret
     │   → autoFireFirstBacklogScript()
     │           │
     │           └─ Azure Automation: run diagnostic runbook
     │                   │
     │                   └─ pollJobToCompletion()
     │                           │
     │                           ├─ parse output
     │                           ├─ update client_scores
     │                           └─ autoFireDocumentCard()
     │                                   │
     │                                   └─ generateAndDeliverDocument()
     │                                           │
     │                                           └─ Claude → htmlContent
     │                                               → insights_generated_documents
     │                                               → (if SOW) quick_win_presentations
     │                                               → (if SOW) ensureOpportunityForSow()
Step 3: Contract Signing
     │   POST /portal/onboarding/contract
     │   → contracts record + PDF → SharePoint
Step 4: Complete
     │   POST /portal/onboarding/complete
             │
             ▼
Client Portal: Project Dashboard
     │
     ├─ Quick Win Runner (full-screen terminal)
     │   → real-time Azure Automation output (SSE)
     │   → On complete: Deliverables screen
     │           │
     │           └─ SOW Presentation (/portal/presentation/:token)
     │                   │
     │                   ├─ Client selects phases
     │                   ├─ Signs SOW
     │                   └─ Stripe payment → project phases unlock
     │
     ├─ Kanban Board (wait tasks, download scripts)
     │
     ├─ Status Reports (acknowledge / ask questions)
     │
     ├─ Insights Hub (health scores, reports, AI actions)
     │
     └─ Project Close-Out (sign-off + testimonial)

[Admin Panel: Delivery Workspace runs in parallel]
     │
     ├─ Move Kanban cards → advancePhaseIfComplete()
     │       → Next phase unlocks, new tasks seeded
     │
     ├─ Send Status Reports
     │
     └─ Finance: Invoice, Coupon, Contract management
```

---

### 3.34 Stripe & Payments

All Stripe-integrated routes — checkout session creation, billing management, webhook ingestion, and admin tooling. Routes are grouped here for reference; they also appear in §3.3 and §3.4.

#### Checkout

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/portal/checkout/create-session` | `requireAuth` | `{ priceId: string; successUrl: string; cancelUrl: string }` | `{ sessionUrl: string; sessionId: string }` |
| POST | `/portal/services/checkout` | `requireAuth` | `{ serviceId: number; priceId: string }` | `{ sessionUrl: string }` |
| POST | `/portal/presentations/:id/checkout` | `requireAuth` | `{ selectedPhaseIds: number[]; paymentPlan: "full" \| "phased" }` | `{ sessionUrl: string }` |

#### Billing Management

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| GET | `/portal/billing/subscriptions` | `requireAuth` | none | `Subscription[]` |
| POST | `/portal/billing/subscriptions/:id/cancel` | `requireAuth` | `{ cancelAtPeriodEnd?: boolean }` | `{ canceled: true }` |
| POST | `/portal/billing/subscriptions/:id/resume` | `requireAuth` | none | `{ resumed: true }` |
| POST | `/portal/billing/subscriptions/:id/resubscribe` | `requireAuth` | `{ priceId: string }` | `{ sessionUrl: string }` |
| POST | `/portal/billing/customer-portal` | `requireAuth` | `{ returnUrl: string }` | `{ portalUrl: string }` |
| GET | `/portal/billing/stripe-receipts` | `requireAuth` | none | `StripeReceipt[]` |

#### Webhook

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/portal/stripe/webhook` | Public (Stripe-signed) | Raw Stripe webhook payload | `200 OK` |

#### Admin Tooling

| Method | Path | Auth | Request Body | Response |
|---|---|---|---|---|
| POST | `/admin/stripe/replay-session` | `requireAdmin` | `{ sessionId: string }` | `{ replayed: true }` |

**Notes:**
- All checkout session responses include a `sessionUrl` (redirect target) and optionally `sessionId`.
- Webhook endpoint verifies Stripe signature using `STRIPE_WEBHOOK_SECRET` (dev) or `STRIPE_WEBHOOK_SECRET_PROD` (production). Unverified requests are rejected with `400`.
- On successful `checkout.session.completed`, the server: creates/updates `client_services`, fires a `service_purchase` or `onboarding_purchase` event, sends an SMS to Shane (if Twilio secrets set), and optionally sends a welcome email via Resend.
- `customer-portal` returns a short-lived Stripe Billing Portal URL for self-service subscription management.

---

*End of System Documentation*
