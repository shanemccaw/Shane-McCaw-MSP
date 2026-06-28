import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ErrorBanner";

// ── M365 Profile type ─────────────────────────────────────────────────────────

interface M365Profile {
  orgName?: string;
  mfaEnforced?: boolean;
  conditionalAccessEnabled?: boolean;
  intuneEnabled?: boolean;
  hasAADP1orP2?: boolean;
  hasDefender?: boolean;
  hasDLP?: boolean;
  usesComplianceCenter?: boolean;
  sensitivityLabelsConfigured?: boolean;
  hasRetentionPolicies?: boolean;
  hasInsiderRisk?: boolean;
  hasCopilotLicenses?: boolean;
  activeUserPercent?: string;
  allUsersLicensed?: boolean;
}

interface ClientRow {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
  healthScore?: number | null;
}

interface ClientDetail {
  profile: M365Profile | null;
  updatedAt?: string | null;
}

// ── Score helpers (mirrors PortalM365Profile.tsx logic) ───────────────────────

function boolScore(fields: (boolean | undefined)[]): number {
  const answered = fields.filter((f) => f !== undefined);
  if (answered.length === 0) return 0;
  return Math.round((fields.filter((f) => f === true).length / fields.length) * 100);
}

function computeScores(v: M365Profile) {
  const secScore = boolScore([v.mfaEnforced, v.conditionalAccessEnabled, v.intuneEnabled, v.hasAADP1orP2, v.hasDefender, v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies]);
  const compScore = boolScore([v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured, v.hasRetentionPolicies, v.hasInsiderRisk]);
  const copScore = boolScore([v.hasCopilotLicenses, v.mfaEnforced, v.sensitivityLabelsConfigured, v.hasDLP, v.hasRetentionPolicies]);
  const govScore = boolScore([v.hasRetentionPolicies, v.sensitivityLabelsConfigured, v.usesComplianceCenter, v.conditionalAccessEnabled]);
  const pct = parseInt(v.activeUserPercent ?? "0", 10);
  const adoptionScore = Math.min((isNaN(pct) ? 60 : pct) + (v.allUsersLicensed ? 10 : 0), 100);
  return { secScore, compScore, copScore, govScore, adoptionScore };
}

interface AlertItem { level: "critical" | "warning"; headline: string; why: string }

function deriveAlerts(v: M365Profile): AlertItem[] {
  const alerts: AlertItem[] = [];
  if (v.mfaEnforced === false) alerts.push({ level: "critical", headline: "MFA is not enforced", why: "A stolen password gives attackers full tenant access." });
  if (v.conditionalAccessEnabled === false) alerts.push({ level: "critical", headline: "No Conditional Access policies", why: "No control over where and how users can sign in." });
  if (v.hasDLP === false) alerts.push({ level: "critical", headline: "No Data Loss Prevention policies", why: "Sensitive data can leave via email or Teams unchecked." });
  if (v.hasDefender === false) alerts.push({ level: "warning", headline: "Microsoft Defender not active", why: "Anti-phishing and malware protection is missing." });
  if (v.sensitivityLabelsConfigured === false) alerts.push({ level: "warning", headline: "Sensitivity labels not configured", why: "Required for Copilot governance and compliance frameworks." });
  if (v.hasRetentionPolicies === false) alerts.push({ level: "warning", headline: "No retention policies in place", why: "Data may be deleted or retained indefinitely — compliance risk." });
  return alerts;
}

// ── ScoreRing ─────────────────────────────────────────────────────────────────

function ScoreRing({ label, score, colors }: { label: string; score: number; colors: ReturnType<typeof useColors> }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 80 ? colors.success : score >= 55 ? colors.warning : colors.destructive;
  const textColor = score >= 80 ? colors.success : score >= 55 ? colors.warning : colors.destructive;

  return (
    <View style={styles.ringContainer}>
      <View style={styles.ringSvgWrap}>
        <View style={styles.ringTrack}>
          <View style={[styles.ringFill, { borderColor: color, borderLeftColor: "transparent", transform: [{ rotate: `${(score / 100) * 360 - 90}deg` }] }]} />
        </View>
        <Text style={[styles.ringScore, { color: textColor }]}>{score}</Text>
      </View>
      <Text style={[styles.ringLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// SVG approach for better rendering
function ScoreRingNative({ label, score, colors }: { label: string; score: number; colors: ReturnType<typeof useColors> }) {
  const ringColor = score >= 80 ? colors.success : score >= 55 ? colors.warning : colors.destructive;
  const pct = score / 100;
  const SIZE = 56;
  const STROKE = 6;
  const R = (SIZE - STROKE) / 2;
  const circ = 2 * Math.PI * R;
  const filled = pct * circ;
  // We approximate the arc with a border-radius view since RN doesn't have SVG natively
  // Use a compact bar instead
  return (
    <View style={[styles.scoreCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.scoreNum, { color: ringColor }]}>{score}</Text>
      <View style={[styles.scoreBar, { backgroundColor: colors.border }]}>
        <View style={[styles.scoreBarFill, { width: `${score}%` as `${number}%`, backgroundColor: ringColor }]} />
      </View>
      <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]} numberOfLines={2}>{label}</Text>
    </View>
  );
}

// ── Client list row ───────────────────────────────────────────────────────────

function ClientHealthRow({
  client,
  onPress,
  colors,
}: {
  client: ClientRow;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const initials = (client.name ?? client.email)
    .split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

  const score = client.healthScore;
  const scoreColor = score == null ? colors.mutedForeground : score >= 75 ? colors.success : score >= 50 ? colors.warning : colors.destructive;
  const scoreLabel = score == null ? "No data" : score >= 75 ? "Healthy" : score >= 50 ? "Fair" : "At Risk";

  return (
    <Pressable
      style={({ pressed }) => [styles.clientRow, { backgroundColor: colors.card, borderColor: colors.border }, pressed && { opacity: 0.78 }]}
      onPress={onPress}
    >
      <View style={[styles.avatar, { backgroundColor: colors.primary + "22" }]}>
        <Text style={[styles.avatarText, { color: colors.primary }]}>{initials}</Text>
      </View>
      <View style={styles.clientInfo}>
        <Text style={[styles.clientName, { color: colors.text }]} numberOfLines={1}>
          {client.name ?? client.email}
        </Text>
        {client.company ? (
          <Text style={[styles.clientCompany, { color: colors.mutedForeground }]} numberOfLines={1}>{client.company}</Text>
        ) : null}
      </View>
      <View style={styles.clientScore}>
        <Text style={[styles.clientScoreNum, { color: scoreColor }]}>{score ?? "—"}</Text>
        <Text style={[styles.clientScoreLabel, { color: scoreColor }]}>{scoreLabel}</Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

// ── Detail view ───────────────────────────────────────────────────────────────

function TenantDetailView({
  client,
  onBack,
  fetchWithAuth,
  colors,
}: {
  client: ClientRow;
  onBack: () => void;
  fetchWithAuth: (path: string, init?: RequestInit) => Promise<Response>;
  colors: ReturnType<typeof useColors>;
}) {
  const insets = useSafeAreaInsets();

  const { data, isLoading, error, refetch } = useQuery<ClientDetail>({
    queryKey: ["client-m365-profile", client.id],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/clients/${client.id}/m365-profile`);
      if (!res.ok) throw new Error("Failed to load M365 profile");
      return res.json() as Promise<ClientDetail>;
    },
    staleTime: 120000,
  });

  const profile = data?.profile;
  const scores = profile ? computeScores(profile) : null;
  const alerts = profile ? deriveAlerts(profile) : [];
  const criticals = alerts.filter((a) => a.level === "critical");
  const warnings = alerts.filter((a) => a.level === "warning");

  const SCORE_RINGS = scores
    ? [
        { label: "Security", score: scores.secScore },
        { label: "Compliance", score: scores.compScore },
        { label: "Copilot", score: scores.copScore },
        { label: "Governance", score: scores.govScore },
        { label: "Adoption", score: scores.adoptionScore },
      ]
    : [];

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View style={[styles.detailTopBar, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={onBack} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <View style={styles.detailTitleWrap}>
          <Text style={[styles.detailTitle, { color: colors.text }]} numberOfLines={1}>
            {client.name ?? client.email}
          </Text>
          {client.company ? (
            <Text style={[styles.detailSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{client.company}</Text>
          ) : null}
        </View>
        <Pressable onPress={() => void refetch()} hitSlop={8}>
          <Feather name="refresh-cw" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <ErrorBanner message="Could not load M365 profile" onRetry={refetch} />
      ) : !profile || !profile.orgName ? (
        <View style={styles.centered}>
          <Feather name="cloud-off" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No M365 profile data yet for this client.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.detailScroll, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Critical alerts */}
          {criticals.length > 0 && (
            <View style={[styles.alertCard, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
              <View style={styles.alertHeader}>
                <Feather name="alert-triangle" size={14} color="#DC2626" />
                <Text style={[styles.alertTitle, { color: "#DC2626" }]}>
                  {criticals.length} Critical Alert{criticals.length > 1 ? "s" : ""}
                </Text>
              </View>
              {criticals.map((a, i) => (
                <View key={i} style={[styles.alertItem, i > 0 && { borderTopWidth: 1, borderTopColor: "#FECACA" }]}>
                  <Text style={[styles.alertHeadline, { color: "#991B1B" }]}>{a.headline}</Text>
                  <Text style={[styles.alertWhy, { color: "#B91C1C" }]}>{a.why}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Warning alerts */}
          {warnings.length > 0 && (
            <View style={[styles.alertCard, { backgroundColor: "#FFFBEB", borderColor: "#FDE68A" }]}>
              <View style={styles.alertHeader}>
                <Feather name="alert-circle" size={14} color="#D97706" />
                <Text style={[styles.alertTitle, { color: "#D97706" }]}>
                  {warnings.length} Improvement{warnings.length > 1 ? "s" : ""} Needed
                </Text>
              </View>
              {warnings.map((a, i) => (
                <View key={i} style={[styles.alertItem, i > 0 && { borderTopWidth: 1, borderTopColor: "#FDE68A" }]}>
                  <Text style={[styles.alertHeadline, { color: "#92400E" }]}>{a.headline}</Text>
                  <Text style={[styles.alertWhy, { color: "#B45309" }]}>{a.why}</Text>
                </View>
              ))}
            </View>
          )}

          {/* No alerts */}
          {alerts.length === 0 && (
            <View style={[styles.alertCard, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
              <View style={styles.alertHeader}>
                <Feather name="check-circle" size={14} color="#16A34A" />
                <Text style={[styles.alertTitle, { color: "#16A34A" }]}>No critical issues detected</Text>
              </View>
            </View>
          )}

          {/* 5 Score rings */}
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>HEALTH SCORES</Text>
          <View style={styles.scoresGrid}>
            {SCORE_RINGS.map((r) => (
              <ScoreRingNative key={r.label} label={r.label} score={r.score} colors={colors} />
            ))}
          </View>

          {/* Updated at */}
          {data?.updatedAt && (
            <Text style={[styles.updatedAt, { color: colors.mutedForeground }]}>
              Last updated {new Date(data.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </Text>
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function TenantHealthScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<ClientRow[]>({
    queryKey: ["admin-clients-health"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/clients/enriched");
      if (!res.ok) {
        const res2 = await fetchWithAuth("/api/admin/clients");
        if (!res2.ok) throw new Error("Failed to load clients");
        return res2.json() as Promise<ClientRow[]>;
      }
      const json = await res.json() as { clients?: ClientRow[] } | ClientRow[];
      return Array.isArray(json) ? json : (json.clients ?? []);
    },
    staleTime: 60000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch]);

  const filtered = (data ?? []).filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.name ?? "").toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q)
    );
  }).sort((a, b) => {
    const sa = a.healthScore ?? 101;
    const sb = b.healthScore ?? 101;
    return sa - sb;
  });

  if (selected) {
    return (
      <TenantDetailView
        client={selected}
        onBack={() => setSelected(null)}
        fetchWithAuth={fetchWithAuth}
        colors={colors}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Tenant Health</Text>
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>M365 security & readiness scores</Text>
      </View>

      {/* Search */}
      <View style={[styles.searchWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
        <Feather name="search" size={15} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search clients…"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>

      {error ? (
        <ErrorBanner message="Could not load client list" onRetry={refetch} />
      ) : isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 90 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Feather name="users" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                {search ? "No clients match that search." : "No clients found."}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <ClientHealthRow
              client={item}
              colors={colors}
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelected(item);
              }}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },

  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },

  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },

  listContent: { paddingHorizontal: 16, paddingTop: 4 },

  clientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  clientInfo: { flex: 1, gap: 2 },
  clientName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  clientCompany: { fontSize: 12, fontFamily: "Inter_400Regular" },
  clientScore: { alignItems: "flex-end", gap: 2, marginRight: 4 },
  clientScoreNum: { fontSize: 18, fontFamily: "Inter_700Bold" },
  clientScoreLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },

  emptyWrap: { alignItems: "center", justifyContent: "center", paddingVertical: 64, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },

  // Detail view
  detailTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  backBtn: { padding: 4 },
  detailTitleWrap: { flex: 1 },
  detailTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  detailSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },

  detailScroll: { padding: 16, gap: 12 },

  alertCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  alertHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  alertTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  alertItem: { paddingTop: 8, gap: 3 },
  alertHeadline: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  alertWhy: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  sectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 4,
    marginBottom: 4,
  },

  scoresGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  // Compact score card
  scoreCard: {
    width: "29.5%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    alignItems: "center",
    gap: 6,
  },
  scoreNum: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  scoreBar: {
    width: "100%",
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  scoreBarFill: {
    height: 4,
    borderRadius: 2,
  },
  scoreLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },

  // Legacy ring helpers (not used on native but kept for web compat)
  ringContainer: { alignItems: "center", gap: 4 },
  ringSvgWrap: { position: "relative", width: 56, height: 56, alignItems: "center", justifyContent: "center" },
  ringTrack: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 6, borderColor: "#e5e7eb",
    position: "absolute",
  },
  ringFill: {
    width: 56, height: 56, borderRadius: 28,
    borderWidth: 6,
    position: "absolute",
  },
  ringScore: { fontSize: 14, fontFamily: "Inter_700Bold" },
  ringLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  updatedAt: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
  },
});
