/**
 * Unit tests for hasPsKeywords() in ps-guard.ts.
 *
 * hasPsKeywords() is the exact guard used by both the /generate and /fix
 * endpoints to detect prose-only AI responses. When it returns false the
 * endpoints respond with HTTP 500 and "AI returned a summary instead of a
 * script. Please try again."
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasPsKeywords } from "./ps-guard.ts";

// ── Prose-only inputs (guard must reject these) ───────────────────────────────

describe("hasPsKeywords() — prose-only responses that the guard must reject", () => {
  it("returns false for a plain English explanation with no PS keywords", () => {
    const prose =
      "This script will connect to your Microsoft 365 tenant and apply " +
      "the required policies. Please ensure you have the correct admin " +
      "permissions before proceeding. Contact your administrator if needed.";
    assert.equal(hasPsKeywords(prose), false);
  });

  it("returns false when prose exactly fills the 200-char window", () => {
    const prose = "A".repeat(200);
    assert.equal(hasPsKeywords(prose), false);
  });

  it("returns false when a PS keyword appears only after the 200-char boundary", () => {
    const prefix = "A".repeat(200);
    const text = prefix + " $variable = 'value'";
    assert.equal(hasPsKeywords(text), false);
  });

  it("returns false for an empty string", () => {
    assert.equal(hasPsKeywords(""), false);
  });

  it("returns false for whitespace-only text", () => {
    assert.equal(hasPsKeywords("   \n\t  "), false);
  });

  it("returns false for a markdown summary with no PS keywords", () => {
    const markdown =
      "## Summary\n\nThe script connects to Exchange Online and lists all " +
      "mailboxes. It requires the Exchange Administrator role. Run it in " +
      "PowerShell 7 or later for best compatibility.";
    assert.equal(hasPsKeywords(markdown), false);
  });
});

// ── Valid PowerShell inputs (guard must accept these) ─────────────────────────

describe("hasPsKeywords() — valid PowerShell responses that the guard must accept", () => {
  it("returns true when the script starts with a dollar-sign variable", () => {
    const script = "$ErrorActionPreference = 'Stop'\n\nConnect-MgGraph";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true when the script starts with a Param block", () => {
    const script = "Param(\n  [string]$TenantId\n)\n\nConnect-ExchangeOnline";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true when the script starts with a function keyword", () => {
    const script = "function Invoke-M365Audit {\n  [CmdletBinding()]\n  param()";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true for Write- cmdlets", () => {
    const script = "Write-Host 'Starting audit...'";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true for Get- cmdlets", () => {
    const script = "Get-MgUser -All";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true for Set- cmdlets", () => {
    const script = "Set-ExecutionPolicy RemoteSigned";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true for New- cmdlets", () => {
    const script = "New-MgGroup -DisplayName 'Test Group'";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true for Remove- cmdlets", () => {
    const script = "Remove-MgUser -UserId $userId";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true for #Requires directive", () => {
    const script = "#Requires -Version 7\n\nGet-MgUser";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true when a PS keyword appears within the first 199 chars", () => {
    const prefix = "A".repeat(199);
    const text = prefix + "$";
    assert.equal(hasPsKeywords(text), true);
  });

  it("returns true for keyword matching case-insensitively (WRITE-HOST)", () => {
    const script = "WRITE-HOST 'hello'";
    assert.equal(hasPsKeywords(script), true);
  });

  it("returns true for a real-world PowerShell script header", () => {
    const script = `[CmdletBinding()]
Param(
  [Parameter(Mandatory)][string]$TenantId,
  [Parameter(Mandatory)][string]$ClientId,
  [Parameter(Mandatory)][string]$ClientSecret
)
$ErrorActionPreference = "Stop"`;
    assert.equal(hasPsKeywords(script), true);
  });
});
