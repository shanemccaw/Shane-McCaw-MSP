/**
 * portal-v2-ownership.tsx — the Ownership page.
 *
 * Thin by design. `OwnershipMatrix` is the module, exactly as the prototype
 * treats it: the shell mounts it with data and callbacks as props
 * (`<dc-import name="Ownership" type-filter="{{ ownType }}" people="{{ ownPeople }}"
 * on-people-change="{{ onOwnPeopleChange }}">`, Customer Portal Shell.dc.html
 * 1629). This page is that mount point, and it supplies the same three things
 * from real sources:
 *
 *   • `objects`        — the tenant’s OWN rows, from
 *                        `GET /api/portal/ownership`. The design fixture is
 *                        still what renders until that read lands, and if it
 *                        fails — see `ownershipWire.ts`.
 *   • `typeFilter`     — from the URL, which is where the shell's sub-nav
 *                        selection lives here rather than `state.ownType`.
 *   • `people`         — the shell-owned list, shared with Settings.
 *   • `onPeopleChange` — its writer.
 *
 * Plus `escDays`, which the prototype reads off the shell's own state and which
 * Settings → Ownership routing sets. The module keeps its standalone fallback
 * for all four, so it still renders if mounted with no props at all.
 */

import { useRoute } from "wouter";

import { PortalV2Shell, SIDEBAR_WASH } from "@/components/portal-v2/PortalV2Shell";
import { OwnershipMatrix } from "@/components/portal-v2/OwnershipMatrix";
import { PortalV2LoadingState } from "@/components/portal-v2/PortalV2LoadingState";
import { NoScanDataState } from "@/components/portal-v2/NoScanDataState";
import { OBJECT_TYPES } from "@/components/portal-v2/ownershipData";
import {
  usePortalV2EscDays,
  usePortalV2OwnershipObjects,
  usePortalV2OwnershipPersist,
  usePortalV2People,
} from "@/components/portal-v2/portalV2People";

const TYPE_KEYS = new Set<string>(["all", ...OBJECT_TYPES.map((t) => t.key)]);

export default function PortalV2OwnershipPage() {
  const [, params] = useRoute("/portal-v2/ownership/:type");
  const typeFilter = params?.type && TYPE_KEYS.has(params.type) ? params.type : "all";

  const { people, setPeople } = usePortalV2People();
  const { escDays } = usePortalV2EscDays();
  const { objects, overlay, dataState } = usePortalV2OwnershipObjects();
  const persist = usePortalV2OwnershipPersist();

  return (
    <PortalV2Shell eyebrow="Governance" title="Ownership">
      <div style={{ minHeight: "100%", background: SIDEBAR_WASH }}>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "26px 28px 110px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            boxSizing: "border-box",
          }}
        >
          {dataState === "loading" ? (
            // Real read in flight: honest skeleton, never the design's 24 fixture
            // objects — showing them then swapping to the tenant's real matrix
            // flickers confident-but-fake ownership (Git #1343).
            <PortalV2LoadingState rows={8} label="Loading your ownership matrix…" testId="pv2-own-loading" />
          ) : dataState === "fixture" ? (
            // Read failed or returned nothing. The module's `OWNERSHIP_FIXTURE`
            // fallback is the prototype's fictional Halden Materials estate AND
            // its invented staff roster (Priya Raman, Aisha Bello, …). Rendering
            // that on a real customer's page leaked fictional people as fact —
            // the exact class as #1213-1216. Show the platform's honest no-data
            // state instead of the fictional matrix (Git #1342).
            <NoScanDataState
              testId="pv2-own-no-data"
              label="No ownership data available"
              detail="We couldn't load your ownership matrix, or nothing has been assigned yet. No example data is shown."
            />
          ) : (
            <OwnershipMatrix
              objects={objects}
              people={people}
              onPeopleChange={setPeople}
              typeFilter={typeFilter}
              escDays={escDays}
              overlay={overlay}
              overlayLive={dataState === "live"}
              persist={persist}
            />
          )}
        </div>
      </div>
    </PortalV2Shell>
  );
}
