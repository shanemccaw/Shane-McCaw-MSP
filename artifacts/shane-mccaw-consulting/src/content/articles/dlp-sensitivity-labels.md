---
slug: dlp-sensitivity-labels
category: Governance & Compliance
title: "DLP and Sensitivity Labels: The Governance Stack Every Organization Needs"
summary: "Data loss prevention and sensitivity labeling are the foundation of a secure Microsoft 365 environment — especially with Copilot in the picture. Here's how to build and govern them correctly."
date: April 10, 2025
---

Copilot changes the stakes for data governance fundamentally. In a traditional M365 environment, a user can only access content they navigate to. With Copilot, the AI can surface and summarize content from across the tenant — limited only by the user's permissions. If your permissions are sloppy and your data classification is nonexistent, Copilot will eagerly expose things that should never be surfaced.

This is why I tell every organization: before you turn on Copilot, get your sensitivity labels and DLP policies right. Here's how.

## Start With a Data Classification Framework

Sensitivity labels are only as good as the classification framework behind them. Before you configure anything in the Microsoft Purview compliance portal, spend time defining your data classification taxonomy. Most organizations need four to five levels: something like Public, Internal, Confidential, Highly Confidential, and Restricted.

Each level should have a clear definition that any employee can understand. 'Confidential' means something specific about who can access it, how it can be shared, and what controls apply. That definition drives the label configuration — it's not the other way around.

> Critical: Your classification framework must be built with your Legal, HR, and Information Security teams — not just IT. The definitions of 'Confidential' and 'Restricted' have legal implications that IT cannot define unilaterally.

## Sensitivity Label Configuration

Once the framework is defined, configure the labels in Microsoft Purview. Key decisions for each label include: Does it apply encryption? Does it add visual markings (headers, footers, watermarks)? Does it restrict copying, printing, or forwarding? Does it prevent sharing outside the organization?

- Start with labels that apply markings only, before adding encryption — this builds the habit without disrupting workflows
- Use sublabels for use-case-specific variants (e.g., Confidential > HR Only, Confidential > Legal Only)
- Configure label inheritance for Teams and SharePoint sites — container labels apply to all content within
- Test encryption labels thoroughly with cross-tenant and external sharing scenarios before rolling out broadly

## Auto-Labeling Policies

Manual labeling by users is valuable but insufficient. Users are busy and inconsistent. Auto-labeling policies in Microsoft Purview can automatically apply or recommend labels based on content detected in documents and emails — credit card numbers, Social Security numbers, medical record numbers, passport numbers, and hundreds of other sensitive information types.

Run auto-labeling in simulation mode first. Before you turn on automatic enforcement, run policies in 'simulation' mode for at least two weeks. The simulation report shows you how many items would be labeled and lets you tune the policies to reduce false positives before enforcement begins.

## Data Loss Prevention Policies

DLP policies are the enforcement layer. They detect sensitive content in SharePoint, OneDrive, Exchange, Teams, and endpoint devices, and take action — blocking sharing, generating alerts, requiring user justification — based on rules you configure.

The most important DLP policies to get right are those governing external sharing of sensitive content. A policy that prevents a user from emailing a document labeled 'Highly Confidential' to an external address is one of the highest-impact controls you can put in place.

- Block external sharing of Highly Confidential and Restricted labeled content
- Require business justification for sharing Confidential content externally
- Alert the compliance team when labeled content is accessed from unmanaged devices
- Configure endpoint DLP to control copying sensitive content to USB drives or personal cloud storage

## Governing the Governance

The final piece is often the most neglected: label and DLP policy governance. Your taxonomy needs a review cadence. New data types, regulatory changes, and business evolution all require updates to your classification framework. Assign a data governance committee that meets at least annually to review and update the framework. Without this, labels become stale and users stop trusting them.

Building a mature sensitivity labeling and DLP posture is one of the most complex compliance initiatives an M365 organization can undertake — and one of the most important. If you're starting from scratch or trying to remediate a messy existing implementation, a structured Governance & Compliance Sprint is usually the right starting point.
