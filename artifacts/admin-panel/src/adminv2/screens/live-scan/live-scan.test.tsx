// @vitest-environment jsdom
/**
 * Live Scan's own contract + interaction coverage. `Shell.test.tsx` already
 * covers shell-chrome integration; this file covers what's specific to this
 * screen: registration legality, the tenant peek resolver reading back what
 * `LiveScanBody` cached, the live feed rendering real frames, and the
 * recent-results table opening a peek on click.
 *
 * `useLiveStream` is mocked as a controllable frame source — the real hook's
 * EventSource reconnect/backoff is its own tested concern (useAiCostSegments
 * uses the same mocking approach).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LiveStreamFrame } from "@/hooks/useLiveStream";
import { getScreen, resetRegistry } from "../../registry/registry";
import { LiveScanBody } from "./LiveScanBody";
import { resetLiveScanData, setLastProfiles, type ScanProfileRow } from "./liveScanData";

const fetchWithAuth = vi.fn();
const openPeek = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

let liveFrames: LiveStreamFrame[] = [];
let liveConnected = true;
vi.mock("@/hooks/useLiveStream", () => ({
  useLiveStream: () => ({ frames: liveFrames, connected: liveConnected }),
}));

vi.mock("../../shell/ShellContext", () => ({
  useShell: () => ({ openPeek }),
  getShellApi: () => null,
}));

const sampleRow: ScanProfileRow = {
  id: 1,
  tenantId: "tenant-1",
  checkKey: "identity:mfa-registration",
  status: "ok",
  severityMatched: "critical",
  severityLabel: "14 accounts have no MFA",
  errorMessage: null,
  itemCount: 14,
  collectedAt: new Date().toISOString(),
  clientName: "Acme",
  clientCompany: "Acme Corp",
};

beforeEach(() => {
  fetchWithAuth.mockReset().mockResolvedValue({ ok: true, json: async () => ({ profiles: [] }) });
  openPeek.mockReset();
  liveFrames = [];
  liveConnected = true;
  resetLiveScanData();
});

afterEach(cleanup);

describe("registration", () => {
  it("registers on the fixed run tab without violating the open/create/global rule", async () => {
    resetRegistry();
    // No vi.resetModules(): this file's own registry imports must resolve
    // against the same module instance "./index" registers into.
    await import("./index");

    const screenModule = getScreen("live-scan");
    expect(screenModule).toBeTruthy();
    expect(screenModule?.route).toBe("/live-scan");
    const tabs = new Set(screenModule?.ribbon?.map((r) => r.tab));
    expect(tabs).toEqual(new Set(["run"]));
  });

  it("resolves a tenant peek only once LiveScanBody has cached a fetch", async () => {
    // Relies on the previous test's dynamic import — ES modules are cached,
    // so a second `import("./index")` here would not re-run `registerScreen`
    // against a registry that test just cleared, leaving `getScreen` undefined.
    const screenModule = getScreen("live-scan")!;

    expect(screenModule.peeks?.tenant?.("tenant-1")).toBeNull();

    setLastProfiles([sampleRow]);
    const model = screenModule.peeks?.tenant?.("tenant-1");
    expect(model?.kind).toBe("tenant");
    expect(model?.title).toBe("Acme Corp");
    expect(model?.list?.rows[0]?.name).toBe("identity:mfa-registration");
    expect(model?.list?.rows[0]?.mark).toBe("CRITICAL");
  });
});

describe("LiveScanBody", () => {
  it("renders live feed lines from the engine.monitor channel", async () => {
    liveFrames = [
      {
        id: "f1",
        receivedAt: Date.now(),
        data: {
          type: "log",
          level: "warn",
          message: "monitor-executor: check flagged",
          meta: { checkKey: "identity:mfa-registration", tenantId: "tenant-1" },
        },
      },
    ];
    render(<LiveScanBody />);
    expect(
      await screen.findByText(/monitor-executor: check flagged.*checkKey=identity:mfa-registration/),
    ).toBeTruthy();
  });

  it("shows disconnected state while reconnecting", () => {
    liveConnected = false;
    render(<LiveScanBody />);
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
  });

  it("loads recent results and opens a tenant peek on click", async () => {
    fetchWithAuth.mockResolvedValue({ ok: true, json: async () => ({ profiles: [sampleRow] }) });
    render(<LiveScanBody />);

    const row = await screen.findByText("Acme Corp");
    fireEvent.click(row);
    expect(openPeek).toHaveBeenCalledWith("tenant", "tenant-1");
  });

  it("surfaces a load error instead of hanging on 'Loading…'", async () => {
    fetchWithAuth.mockResolvedValue({ ok: false, json: async () => ({ error: "nope" }) });
    render(<LiveScanBody />);
    expect(await screen.findByText("nope")).toBeTruthy();
  });
});
