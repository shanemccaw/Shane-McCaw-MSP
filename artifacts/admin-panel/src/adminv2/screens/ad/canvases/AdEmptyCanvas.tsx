import { Users } from "lucide-react";
import { TEXT } from "../../../theme";
import { AdCanvasColumn } from "../adKit";

/** What the centre column shows before any Active Directory record is open. */
export function AdEmptyCanvas() {
  return (
    <AdCanvasColumn>
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 40,
          textAlign: "center",
        }}
      >
        <Users size={22} color={TEXT.faint} />
        <div style={{ fontSize: 14, fontWeight: 700, color: TEXT.primary }}>Nothing selected</div>
        <div style={{ fontSize: 12.5, color: TEXT.caption, textWrap: "pretty", maxWidth: 320 }}>
          Pick an MSP, tenant, user, group or organizational unit from the Explorer, or press Ctrl K.
        </div>
      </div>
    </AdCanvasColumn>
  );
}
