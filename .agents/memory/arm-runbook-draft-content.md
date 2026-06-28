---
name: ARM SDK runbookDraft.replaceContent JSON crash
description: @azure/arm-automation v10's replaceContent treats the endpoint as an LRO and JSON-parses the response body, which is raw PS text — causing "Unexpected token 'C'" crashes.
---

## Rule
Never call `client.runbookDraft.replaceContent()` from the ARM SDK. Use a raw `fetch` with a bearer token from `ClientSecretCredential.getToken()` instead.

**Why:** The ARM SDK marks `runbookDraft.replaceContent` as a Long Running Operation. It reads the response body to build a PollingState, and tries to `JSON.parse` it. The response body is the uploaded PowerShell script text (starting with `[CmdletBinding...]`), which is not JSON — causing `SyntaxError: Unexpected token 'C', "[CmdletBind"... is not valid JSON`.

**How to apply:** In `azure-automation.ts`, the `upsertRunbookContent` function does step 2 (content upload) via:
```
PUT https://management.azure.com/subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.Automation/automationAccounts/{acct}/runbooks/{name}/draft/content?api-version=2019-06-01
Authorization: Bearer <token from credential.getToken("https://management.azure.com/.default")>
Content-Type: text/powershell
Body: <raw PS script string>
```
A non-2xx response is surfaced as a descriptive Error. The SDK is still used for step 1 (runbook createOrUpdate) and step 3 (publish) — only the content upload needs the raw fetch workaround.
