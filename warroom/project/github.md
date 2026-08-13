repo: shanemccaw/Shane-McCaw-MSP
branch: main
path: artifacts/msp-portal/src/components/msp-portal/views/MapView.tsx

## Last sync
date: 2026-08-01T06:37:22Z

### Updated in this project
- Redrew the topology centre-piece in Canvas.dc.html directly from the TopologyCenterPiece source (zone wedges 160→670, watermark icons at r=410, zone tags at r=640, ring labels at rOuter+42).
- Pulled the full node registry — real x/y coordinates, scores, statuses and cross-pillar links — for all 35 nodes plus hubs and core.
- Ported the three-layer connectors: base line, flowDash overlay, and travelling animateMotion particle; lines redden and thicken as a pillar degrades.
- Canvas-2.dc.html rebuilt as the embeddable map used by the war room, with persona-focus dimming and a core orb showing the overall M365 health score.

## Screen map
| Screen | Built from |
|---|---|
| Canvas.dc.html | MapView.tsx — TopologyCenterPiece, getPieSectorPath, PILLAR_SECTORS, BUSINESS_IMPACT_SEGMENTS, initialNodes registry |
| Canvas-2.dc.html | MapView.tsx — node registry + impact-ring model, re-laid out for small embeds |
| M365 War Room.dc.html | Narrative war-room experience; embeds Canvas-2 as its centre hologram |

## Sync history
- 2026-08-01T06:10:35Z — first rebuild of the centre-piece (impact-ring maths, segment weights, source geometry).
