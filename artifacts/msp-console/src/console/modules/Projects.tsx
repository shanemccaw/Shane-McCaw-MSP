/**
 * Projects — Simple Kanban (Phase 1, Git #3773; typed cards Phase 2, Git
 * #4240), MSP-wide (Operations) module page (#2621, Feature #2561). Mounts
 * at `/ops/projects` (`Design/MSP_Console/design_handoff_msp_console/Projects.dc.html`,
 * `MSP Console.dc.html`'s own `mspSel === "projects"` placement between
 * Offboarding and Retainer hours in the Operations tree).
 *
 * Wired against `artifacts/api-server/src/routes/msp-kanban.ts` (7 Phase 1
 * routes) plus `msp-automation-registry.ts` (1 Phase 2 read-only route) via
 * `src/api/msp-kanban-api.ts` — see that file's header and
 * `docs/msp-console/projects-msp-console-contract-pack.md` for the Phase 1
 * wire contract (not yet re-extracted for Phase 2's typed-card fields).
 *
 * Real, load-bearing facts this page is built around: every board is
 * genuinely empty in every environment today (no fixture ever substitutes
 * for that); a card can only move to a bucket on the *same* customer's
 * board, enforced server-side even for a PlatformAdmin; and position is
 * never renumbered by the server, which is why this UI only ever appends
 * (new bucket/card go to the end) and never offers drag-reorder — a "just
 * save the one I moved" write would leave duplicate positions among
 * untouched siblings.
 *
 * Phase 2: a card optionally carries a real `type` — `communications_push`
 * and `training_session` cards create their real underlying row inline (the
 * operator fills the standalone entity's own real fields right here);
 * `automation_registry` cards can only link an existing entry (MSP operators
 * have no write access to that table — see `msp-automation-registry.ts`'s
 * header). Every field a typed card shows comes straight off the real linked
 * row (`kanban-api.ts`'s `CommunicationsPushSummary` /
 * `TrainingSessionSummary` / `AutomationRegistrySummary`), never duplicated
 * or fabricated.
 *
 * `embedded` suppresses this module's own header and the illustrative-board
 * toggle (the shell already renders eyebrow/title/note from the tree node,
 * and a demo toggle has no place in the shipped product) — every real
 * caller is `ConsoleShell`, which always mounts embedded. The illustrative
 * board this page can show when *not* embedded is a labelled, static
 * example, ported from the design's own `DEMO_BOARD_FOR_CUSTOMER_1` — it is
 * never presented as real data and never reachable from the real console.
 */
import { useState } from "react";
import { Icon } from "@/console/icons";
import { border, signal, surface, text } from "@/console/tokens";
import type { DirectoryCustomer } from "@/api/console-api";
import {
  useAutomationRegistryEntries,
  useCreateBucket, useCreateCard, useDeleteBucket, useDeleteCard,
  useKanbanBoard, usePatchBucket, usePatchCard,
  type CreateCardPayload, type KanbanBucket, type KanbanCard, type KanbanCardType,
} from "@/api/msp-kanban-api";

/**
 * Card types (Git #4240, Phase 2). A card either has no `type` (plain task —
 * Phase 1 shape, unchanged) or links to one of three real standalone
 * entities. `communications_push` and `training_session` can be created
 * inline (the operator fills the underlying entity's own real fields right
 * here); `automation_registry` can only be *linked* to an entry that already
 * exists — MSP operators have no write access to that table (see
 * `msp-automation-registry.ts`'s header for why), so its "add card" flow is
 * a picker over `useAutomationRegistryEntries`, not a form.
 */
const CARD_TYPE_CONFIG: Record<KanbanCardType, { label: string; icon: string; color: { strong: string; tint: string; border: string } }> = {
  communications_push: { label: "Communications push", icon: "message-square", color: signal.info },
  training_session: { label: "Training session", icon: "book-open", color: signal.notice },
  automation_registry: { label: "Automation", icon: "workflow", color: signal.ok },
};

const TRAINING_SESSION_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "lunch_and_learn", label: "Lunch & Learn" },
  { value: "how_to", label: "How-To session" },
  { value: "prompt_a_thon", label: "Prompt-A-Thon" },
  { value: "ask_me_anything", label: "Ask Me Anything" },
];

function formatDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function TypedCardBadge({ card }: { card: KanbanCard }) {
  if (!card.type) return null;
  const cfg = CARD_TYPE_CONFIG[card.type];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4, height: 18, padding: "0 7px", borderRadius: 999,
      background: cfg.color.tint, border: `1px solid ${cfg.color.border}`, color: cfg.color.strong,
      fontSize: 9.5, fontWeight: 700, letterSpacing: ".02em", width: "fit-content",
    }}>
      <Icon name={cfg.icon} size={11} />
      {cfg.label}
    </span>
  );
}

function TypedCardSummary({ card }: { card: KanbanCard }) {
  if (card.type === "communications_push" && card.communicationsPush) {
    const p = card.communicationsPush;
    return (
      <span style={{ fontSize: 10.5, color: text.muted }}>
        {p.title} · effective {formatDate(p.effectiveDate)} · {p.checkpointsDone}/{p.checkpointsTotal} reminders done
      </span>
    );
  }
  if (card.type === "training_session" && card.trainingSession) {
    const s = card.trainingSession;
    const typeLabel = TRAINING_SESSION_TYPE_OPTIONS.find((o) => o.value === s.sessionType)?.label ?? s.sessionType;
    return (
      <span style={{ fontSize: 10.5, color: text.muted }}>
        {typeLabel} · {s.topic} · {formatDate(s.sessionDate)}
      </span>
    );
  }
  if (card.type === "automation_registry" && card.automationRegistry) {
    const a = card.automationRegistry;
    return (
      <span style={{ fontSize: 10.5, color: text.muted }}>
        {a.name} · {a.type === "power_automate_flow" ? "Power Automate flow" : "AI Studio agent"} · {a.status}
      </span>
    );
  }
  return null;
}

const ILLUSTRATIVE_CARD_DEFAULTS = {
  type: null, communicationsPushId: null, trainingSessionId: null, automationRegistryId: null,
  communicationsPush: null, trainingSession: null, automationRegistry: null,
} as const;

const ILLUSTRATIVE_BOARD: KanbanBucket[] = [
  {
    id: -1, customerId: -1, name: "Backlog", position: 0, createdAt: "", updatedAt: "",
    cards: [
      { ...ILLUSTRATIVE_CARD_DEFAULTS, id: -1, bucketId: -1, title: "Migrate legacy DLP policies", description: "Carry over the three custom rules before the old tenant is decommissioned.", position: 0, createdAt: "", updatedAt: "" },
      { ...ILLUSTRATIVE_CARD_DEFAULTS, id: -2, bucketId: -1, title: "Confirm Teams retention labels", description: null, position: 1, createdAt: "", updatedAt: "" },
    ],
  },
  {
    id: -2, customerId: -1, name: "In progress", position: 1, createdAt: "", updatedAt: "",
    cards: [
      { ...ILLUSTRATIVE_CARD_DEFAULTS, id: -3, bucketId: -2, title: "Conditional Access pilot group", description: "Rolling out to IT first, per the customer's own request.", position: 0, createdAt: "", updatedAt: "" },
    ],
  },
  { id: -3, customerId: -1, name: "Done", position: 2, createdAt: "", updatedAt: "", cards: [] },
];

function tenantName(c: DirectoryCustomer): string {
  return c.name || c.domain || `Customer ${c.id}`;
}

const inputStyle: React.CSSProperties = {
  padding: "7px 9px", borderRadius: 6, border: `1px solid ${border.card}`,
  background: "rgba(2,6,23,.7)", color: text.title, fontSize: 12, fontFamily: "inherit", outline: "none", minWidth: 0,
};

const primaryBtn: React.CSSProperties = {
  height: 26, padding: "0 10px", borderRadius: 6, border: "1px solid #2563eb", background: "#2563eb",
  color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

const ghostBtn: React.CSSProperties = {
  height: 26, padding: "0 10px", borderRadius: 6, border: `1px solid ${border.card}`, background: "transparent",
  color: text.muted, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

const dangerBtn: React.CSSProperties = {
  height: 26, padding: "0 10px", borderRadius: 6, border: `1px solid ${signal.critical.border}`,
  background: signal.critical.tint, color: signal.critical.text, fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};

export function Projects({
  customers,
  embedded,
  forceEmpty,
}: {
  customers: DirectoryCustomer[];
  embedded?: boolean;
  forceEmpty?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [demo, setDemo] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [addingCardFor, setAddingCardFor] = useState<number | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [newCardType, setNewCardType] = useState<KanbanCardType | null>(null);
  const [newPushTitle, setNewPushTitle] = useState("");
  const [newPushEffectiveDate, setNewPushEffectiveDate] = useState("");
  const [newPushOffsetDays, setNewPushOffsetDays] = useState("60,45,30");
  const [newSessionType, setNewSessionType] = useState(TRAINING_SESSION_TYPE_OPTIONS[0].value);
  const [newSessionDate, setNewSessionDate] = useState("");
  const [newSessionTopic, setNewSessionTopic] = useState("");
  const [newSessionNotes, setNewSessionNotes] = useState("");
  const [newAutomationEntryId, setNewAutomationEntryId] = useState<number | "">("");
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDesc, setDraftDesc] = useState("");
  const [draftBucketId, setDraftBucketId] = useState<number | null>(null);

  const showChrome = !(embedded ?? false);
  const customerId = selectedId ?? customers[0]?.id ?? null;

  const boardQuery = useKanbanBoard(customerId);
  const createBucket = useCreateBucket(customerId);
  const patchBucket = usePatchBucket(customerId);
  const deleteBucket = useDeleteBucket(customerId);
  const createCard = useCreateCard(customerId);
  const patchCard = usePatchCard(customerId);
  const deleteCard = useDeleteCard(customerId);
  const automationEntriesQuery = useAutomationRegistryEntries(newCardType === "automation_registry" ? customerId : null);

  const liveBuckets = forceEmpty ? [] : (boardQuery.data ?? []);
  const showIllustrative = showChrome && demo && !boardQuery.isLoading && liveBuckets.length === 0;
  const buckets = showIllustrative ? ILLUSTRATIVE_BOARD : liveBuckets;

  function resetNewCardForm() {
    setAddingCardFor(null);
    setNewCardTitle("");
    setNewCardType(null);
    setNewPushTitle("");
    setNewPushEffectiveDate("");
    setNewPushOffsetDays("60,45,30");
    setNewSessionType(TRAINING_SESSION_TYPE_OPTIONS[0].value);
    setNewSessionDate("");
    setNewSessionTopic("");
    setNewSessionNotes("");
    setNewAutomationEntryId("");
  }

  function submitNewCard(bucketId: number) {
    const title = newCardTitle.trim();
    if (!title) return;

    const payload: CreateCardPayload = { bucketId, title };

    if (newCardType === "communications_push") {
      const pushTitle = newPushTitle.trim();
      const offsetDays = newPushOffsetDays.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
      if (!pushTitle || !newPushEffectiveDate || offsetDays.length === 0) return;
      payload.type = "communications_push";
      payload.newCommunicationsPush = {
        title: pushTitle,
        effectiveDate: new Date(newPushEffectiveDate).toISOString(),
        offsetDays,
      };
    } else if (newCardType === "training_session") {
      const topic = newSessionTopic.trim();
      if (!topic || !newSessionDate) return;
      payload.type = "training_session";
      payload.newTrainingSession = {
        sessionType: newSessionType,
        sessionDate: new Date(newSessionDate).toISOString(),
        topic,
        notes: newSessionNotes.trim() || undefined,
      };
    } else if (newCardType === "automation_registry") {
      if (newAutomationEntryId === "") return;
      payload.type = "automation_registry";
      payload.automationRegistryId = newAutomationEntryId;
    }

    createCard.mutate(payload, { onSuccess: () => resetNewCardForm() });
  }

  function selectCustomer(id: number) {
    setSelectedId(id);
    resetNewCardForm();
    setEditingCardId(null);
    setNewBucketName("");
  }

  function startEdit(bucketId: number, card: KanbanBucket["cards"][number]) {
    setEditingCardId(card.id);
    setDraftTitle(card.title);
    setDraftDesc(card.description ?? "");
    setDraftBucketId(bucketId);
  }

  function cancelEdit() {
    setEditingCardId(null);
  }

  function saveCard(cardId: number) {
    const title = draftTitle.trim();
    if (!title) return;
    patchCard.mutate(
      { id: cardId, title, description: draftDesc.trim() || null, bucketId: draftBucketId ?? undefined },
      { onSuccess: () => setEditingCardId(null) },
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {showChrome && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 200, flex: 1 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", color: signal.info.strong }}>PROJECTS · KANBAN (PHASE 2)</span>
            <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.02em", color: text.title }}>Free-form boards, with typed cards</span>
          </div>
          <span style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 10px", borderRadius: 999, background: signal.warning.tint, border: `1px solid ${signal.warning.border}`, fontSize: 11, fontWeight: 600, color: signal.warning.strong }}>
            MSPOperator or above
          </span>
          <button
            onClick={() => setDemo((d) => !d)}
            style={{ display: "inline-flex", alignItems: "center", height: 26, padding: "0 10px", borderRadius: 999, background: "rgba(148,163,184,.08)", border: `1px solid ${border.soft}`, fontSize: 11, fontWeight: 600, color: text.muted, cursor: "pointer", fontFamily: "inherit" }}
          >
            {demo ? "Back to the live (empty) state" : "Show an illustrative board"}
          </button>
        </div>
      )}

      {customers.length === 0 ? (
        <EmptyPanel icon="building-2" title="No customers in this MSP's book yet" body="Projects boards live per customer — there is nothing to pick from until a customer exists." />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
            {customers.map((c) => {
              const on = c.id === customerId;
              return (
                <button
                  key={c.id}
                  onClick={() => selectCustomer(c.id)}
                  style={{
                    display: "inline-flex", alignItems: "center", height: 30, padding: "0 12px", borderRadius: 7,
                    border: `1px solid ${on ? "rgba(96,165,250,.45)" : border.card}`,
                    background: on ? "rgba(37,99,235,.18)" : "transparent",
                    color: on ? text.title : text.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  }}
                >
                  {tenantName(c)}
                </button>
              );
            })}
          </div>

          {boardQuery.isLoading && !showIllustrative && (
            <div style={{ border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 16, display: "flex", gap: 12 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 260, height: 140, borderRadius: 10, background: "rgba(148,163,184,.06)" }} />
              ))}
            </div>
          )}

          {boardQuery.isError && !showIllustrative && (
            <AdvisoryPanel status={(boardQuery.error as { status?: number } | null)?.status} />
          )}

          {!boardQuery.isLoading && !boardQuery.isError && (
            <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4, minWidth: 0 }}>
              {buckets.map((bkt) => {
                const isIllustrative = showIllustrative;
                return (
                  <div key={bkt.id} style={{ display: "flex", flexDirection: "column", gap: 10, width: 260, flex: "none", border: `1px solid ${border.card}`, borderRadius: 12, background: surface.card, padding: 12, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: text.title, flex: 1, textWrap: "pretty" }}>{bkt.name}</span>
                      <span style={{ fontSize: 10.5, color: text.muted }}>{bkt.cards.length}</span>
                      {!isIllustrative && (
                        <button
                          onClick={() => deleteBucket.mutate(bkt.id)}
                          title="Delete bucket"
                          style={{ width: 20, height: 20, borderRadius: 5, border: `1px solid ${signal.critical.border}`, background: signal.critical.tint, color: signal.critical.text, fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}
                        >
                          ×
                        </button>
                      )}
                    </div>

                    {bkt.cards.map((c) => {
                      const editing = !isIllustrative && editingCardId === c.id;
                      if (editing) {
                        return (
                          <div key={c.id} style={{ border: "1px solid rgba(96,165,250,.4)", borderRadius: 9, background: "rgba(96,165,250,.06)", padding: 10, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                            <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="Card title" style={inputStyle} />
                            <textarea value={draftDesc} onChange={(e) => setDraftDesc(e.target.value)} placeholder="Description (optional)" rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, fontSize: 11.5, color: text.body }} />
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", color: text.muted }}>MOVE TO</span>
                            <select
                              value={draftBucketId ?? bkt.id}
                              onChange={(e) => setDraftBucketId(Number(e.target.value))}
                              style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.7)", color: text.body, fontSize: 11.5, outline: "none" }}
                            >
                              {buckets.map((o) => (
                                <option key={o.id} value={o.id}>{o.name}</option>
                              ))}
                            </select>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button onClick={() => saveCard(c.id)} style={primaryBtn}>Save</button>
                              <button onClick={cancelEdit} style={ghostBtn}>Cancel</button>
                              <button onClick={() => deleteCard.mutate(c.id, { onSuccess: () => setEditingCardId(null) })} style={dangerBtn}>Delete</button>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <button
                          key={c.id}
                          onClick={() => !isIllustrative && startEdit(bkt.id, c)}
                          style={{ border: `1px solid ${border.faint}`, borderRadius: 9, background: "rgba(2,6,23,.4)", padding: 10, display: "flex", flexDirection: "column", gap: 4, textAlign: "left", cursor: isIllustrative ? "default" : "pointer", fontFamily: "inherit", minWidth: 0 }}
                        >
                          <TypedCardBadge card={c} />
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: text.title, textWrap: "pretty" }}>{c.title}</span>
                          {c.description && (
                            <span style={{ fontSize: 11, color: text.muted, textWrap: "pretty" }}>{c.description}</span>
                          )}
                          <TypedCardSummary card={c} />
                        </button>
                      );
                    })}

                    {!isIllustrative && addingCardFor === bkt.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {([null, "communications_push", "training_session", "automation_registry"] as const).map((t) => (
                            <button
                              key={t ?? "task"}
                              onClick={() => setNewCardType(t)}
                              style={{
                                height: 22, padding: "0 8px", borderRadius: 999, fontSize: 10, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                                border: `1px solid ${newCardType === t ? "rgba(96,165,250,.5)" : border.soft}`,
                                background: newCardType === t ? "rgba(37,99,235,.18)" : "transparent",
                                color: newCardType === t ? text.title : text.muted,
                              }}
                            >
                              {t === null ? "Task" : CARD_TYPE_CONFIG[t].label}
                            </button>
                          ))}
                        </div>

                        <input value={newCardTitle} onChange={(e) => setNewCardTitle(e.target.value)} placeholder="Card title" style={inputStyle} />

                        {newCardType === "communications_push" && (
                          <>
                            <input value={newPushTitle} onChange={(e) => setNewPushTitle(e.target.value)} placeholder="Push title (e.g. Q3 licensing change)" style={inputStyle} />
                            <input type="date" value={newPushEffectiveDate} onChange={(e) => setNewPushEffectiveDate(e.target.value)} style={inputStyle} />
                            <input value={newPushOffsetDays} onChange={(e) => setNewPushOffsetDays(e.target.value)} placeholder="Reminder offsets, days before (e.g. 60,45,30)" style={inputStyle} />
                          </>
                        )}

                        {newCardType === "training_session" && (
                          <>
                            <select
                              value={newSessionType}
                              onChange={(e) => setNewSessionType(e.target.value)}
                              style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.7)", color: text.body, fontSize: 11.5, outline: "none" }}
                            >
                              {TRAINING_SESSION_TYPE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                            <input type="date" value={newSessionDate} onChange={(e) => setNewSessionDate(e.target.value)} style={inputStyle} />
                            <input value={newSessionTopic} onChange={(e) => setNewSessionTopic(e.target.value)} placeholder="Topic" style={inputStyle} />
                            <textarea value={newSessionNotes} onChange={(e) => setNewSessionNotes(e.target.value)} placeholder="Notes (optional)" rows={2} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5, fontSize: 11.5, color: text.body }} />
                          </>
                        )}

                        {newCardType === "automation_registry" && (
                          automationEntriesQuery.isLoading ? (
                            <span style={{ fontSize: 10.5, color: text.muted }}>Loading automation entries…</span>
                          ) : (automationEntriesQuery.data ?? []).length === 0 ? (
                            <span style={{ fontSize: 10.5, color: text.muted, textWrap: "pretty" }}>
                              No automation registry entries yet for this customer — those are created in MyArchitect, not here.
                            </span>
                          ) : (
                            <select
                              value={newAutomationEntryId}
                              onChange={(e) => setNewAutomationEntryId(e.target.value ? Number(e.target.value) : "")}
                              style={{ padding: "6px 8px", borderRadius: 6, border: `1px solid ${border.soft}`, background: "rgba(2,6,23,.7)", color: text.body, fontSize: 11.5, outline: "none" }}
                            >
                              <option value="">Select an entry…</option>
                              {(automationEntriesQuery.data ?? []).map((e) => (
                                <option key={e.id} value={e.id}>{e.name} ({e.status})</option>
                              ))}
                            </select>
                          )
                        )}

                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => submitNewCard(bkt.id)} style={primaryBtn}>Add</button>
                          <button onClick={resetNewCardForm} style={ghostBtn}>Cancel</button>
                        </div>
                      </div>
                    ) : !isIllustrative && (
                      <button
                        onClick={() => { resetNewCardForm(); setAddingCardFor(bkt.id); }}
                        style={{ height: 28, borderRadius: 6, border: `1px dashed ${border.soft}`, background: "transparent", color: text.muted, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}
                      >
                        + Add card
                      </button>
                    )}
                  </div>
                );
              })}

              {!showIllustrative && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, width: 220, flex: "none", border: `1px dashed ${border.soft}`, borderRadius: 12, padding: 12, minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: text.muted }}>New bucket</span>
                  <input value={newBucketName} onChange={(e) => setNewBucketName(e.target.value)} placeholder="Bucket name" style={inputStyle} />
                  <button
                    onClick={() => {
                      const name = newBucketName.trim();
                      if (!name) return;
                      createBucket.mutate({ name }, { onSuccess: () => setNewBucketName("") });
                    }}
                    style={{ height: 28, borderRadius: 6, border: "1px solid rgba(96,165,250,.3)", background: "rgba(96,165,250,.1)", color: "#93c5fd", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
                  >
                    Add bucket
                  </button>
                </div>
              )}
            </div>
          )}

          {!boardQuery.isLoading && !boardQuery.isError && buckets.length === 0 && (
            <EmptyPanel
              icon="kanban"
              title="No buckets on this customer's board"
              body="This is the real, honest state for every customer today — the route returns an empty board rather than a fixture. Add one above to see the shape a populated board would take."
            />
          )}
        </>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 2 }}>
        <Icon name="info" size={13} color={text.faint} />
        <span style={{ fontSize: 11, color: text.faint, textWrap: "pretty" }}>
          A card can only move to a bucket on this same customer's board, and
          position is never renumbered by the server — new buckets and cards are always appended to the end.
        </span>
      </div>
    </div>
  );
}

function EmptyPanel({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={{
      border: `1px dashed ${border.soft}`, borderRadius: 12, background: "transparent", padding: "22px 20px",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 9, textAlign: "center",
    }}>
      <span style={{
        width: 44, height: 44, borderRadius: 13, background: signal.info.tint, border: `1px solid ${signal.info.border}`,
        color: signal.info.strong, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon name={icon} size={20} />
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color: text.secondary }}>{title}</span>
      <span style={{ fontSize: 11.5, color: text.muted, maxWidth: 420, textWrap: "pretty" }}>{body}</span>
    </div>
  );
}

function AdvisoryPanel({ status }: { status?: number }) {
  const is404 = status === 404;
  return (
    <div style={{ border: `1px solid ${signal.warning.border}`, borderRadius: 11, background: signal.warning.tint, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: signal.warning.strong }}>
        {is404 ? "Customer not found" : "Couldn't load the board"}
      </span>
      <span style={{ fontSize: 12, color: text.muted, textWrap: "pretty" }}>
        {is404
          ? "No tenant row exists for this customerId, or it isn't in your MSP's book."
          : "The board could not be loaded. Try again shortly."}
      </span>
    </div>
  );
}
