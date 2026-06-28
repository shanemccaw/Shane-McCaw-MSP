import { Feather } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

// ── M365 Profile type ─────────────────────────────────────────────────────────

interface M365Profile {
  orgName?: string;
  tenantDomain?: string;
  industry?: string;
  employeeCount?: string;
  licensedUserCount?: string;
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

// ── Score helpers (mirrors PortalM365Profile.tsx exactly) ─────────────────────

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
  if (v.mfaEnforced === false) alerts.push({ level: "critical", headline: "MFA is not enforced", why: "A stolen password gives attackers full tenant access without additional verification." });
  if (v.conditionalAccessEnabled === false) alerts.push({ level: "critical", headline: "No Conditional Access policies", why: "No control over where, how, or from which devices users can sign in." });
  if (v.hasDLP === false) alerts.push({ level: "critical", headline: "No Data Loss Prevention policies", why: "Sensitive data can leave the organisation via email or Teams unchecked." });
  if (v.hasDefender === false) alerts.push({ level: "warning", headline: "Microsoft Defender not active", why: "Anti-phishing, malware, and Safe Links protection is missing." });
  if (v.sensitivityLabelsConfigured === false) alerts.push({ level: "warning", headline: "Sensitivity labels not configured", why: "Required for Copilot governance and compliance framework readiness." });
  if (v.hasRetentionPolicies === false) alerts.push({ level: "warning", headline: "No retention policies in place", why: "Data may be deleted or retained indefinitely — creating compliance risk." });
  return alerts;
}

function hasAnyProfileData(v: M365Profile): boolean {
  return [v.mfaEnforced, v.conditionalAccessEnabled, v.intuneEnabled, v.hasAADP1orP2,
    v.hasDefender, v.hasDLP, v.usesComplianceCenter, v.sensitivityLabelsConfigured,
    v.hasRetentionPolicies, v.hasInsiderRisk, v.hasCopilotLicenses,
  ].some((f) => f !== undefined);
}

// ── Score card (compact numeric + bar) ───────────────────────────────────────

function ScoreCard({
  label,
  score,
  colors,
}: {
  label: string;
  score: number;
  colors: ReturnType<typeof useColors>;
}) {
  const barColor = score >= 80 ? colors.success : score >= 55 ? colors.warning : colors.destructive;

  return (
    <View style={[styles.scoreCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.scoreNum, { color: barColor }]}>{score}</Text>
      <Text style={[styles.scoreMax, { color: colors.mutedForeground }]}>/ 100</Text>
      <View style={[styles.scoreBar, { backgroundColor: colors.border }]}>
        <View style={[styles.scoreBarFill, { width: `${score}%` as `${number}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function TenantHealthScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const [refreshing, setRefreshing] = useState(false);

  const { data: profile, isLoading, error, refetch } = useQuery<M365Profile>({
    queryKey: ["portal-m365-profile-mobile"],
    queryFn: async () => {
      const [m365Res, baseRes] = await Promise.all([
        fetchWithAuth("/api/portal/m365-profile"),
        fetchWithAuth("/api/portal/profile"),
      ]);
      const m365 = m365Res.ok ? (await m365Res.json() as M365Profile) : {} as M365Profile;
      const base = baseRes.ok ? (await baseRes.json() as { company?: string | null }) : {};
      if (!m365.orgName && base.company) m365.orgName = base.company;
      return m365;
    },
    staleTime: 120000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const scores = profile && hasAnyProfileData(profile) ? computeScores(profile) : null;
  const alerts = profile && hasAnyProfileData(profile) ? deriveAlerts(profile) : [];
  const criticals = alerts.filter((a) => a.level === "critical");
  const warnings = alerts.filter((a) => a.level === "warning");

  const SCORE_RINGS = scores
    ? [
        { label: "Security Posture", score: scores.secScore },
        { label: "Compliance Coverage", score: scores.compScore },
        { label: "Copilot Readiness", score: scores.copScore },
        { label: "Governance Maturity", score: scores.govScore },
        { label: "Adoption", score: scores.adoptionScore },
      ]
    : [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Tenant Health</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            M365 security &amp; readiness scores
          </Text>
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
        <View style={styles.centered}>
          <View style={[styles.errorIcon, { backgroundColor: colors.destructive + "18" }]}>
            <Feather name="alert-triangle" size={24} color={colors.destructive} />
          </View>
          <Text style={[styles.errorTitle, { color: colors.text }]}>Unable to load tenant data</Text>
          <Text style={[styles.errorMsg, { color: colors.mutedForeground }]}>
            Check your connection and try again.
          </Text>
          <Pressable
            style={[styles.retryBtn, { backgroundColor: colors.primary }]}
            onPress={() => void refetch()}
          >
            <Feather name="refresh-cw" size={14} color={colors.primaryForeground} />
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>Retry</Text>
          </Pressable>
        </View>
      ) : !profile || !hasAnyProfileData(profile) ? (
        <View style={styles.centered}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="cloud-off" size={28} color={colors.primary} />
          </View>
          <Text style={[styles.errorTitle, { color: colors.text }]}>No profile data yet</Text>
          <Text style={[styles.errorMsg, { color: colors.mutedForeground }]}>
            Complete the M365 questionnaire in the web portal to see your scores here.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Org info */}
          {(profile.orgName || profile.tenantDomain) && (
            <View style={[styles.orgBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {profile.orgName && (
                <Text style={[styles.orgName, { color: colors.text }]}>{profile.orgName}</Text>
              )}
              {profile.tenantDomain && (
                <Text style={[styles.orgDomain, { color: colors.mutedForeground }]}>{profile.tenantDomain}</Text>
              )}
              <View style={styles.orgMeta}>
                {profile.employeeCount && (
                  <View style={styles.orgMetaItem}>
                    <Text style={[styles.orgMetaNum, { color: colors.primary }]}>
                      {(parseInt(profile.employeeCount ?? "", 10) || 0).toLocaleString()}
                    </Text>
                    <Text style={[styles.orgMetaLabel, { color: colors.mutedForeground }]}>Employees</Text>
                  </View>
                )}
                {profile.licensedUserCount && (
                  <View style={styles.orgMetaItem}>
                    <Text style={[styles.orgMetaNum, { color: colors.accent }]}>
                      {(parseInt(profile.licensedUserCount ?? "", 10) || 0).toLocaleString()}
                    </Text>
                    <Text style={[styles.orgMetaLabel, { color: colors.mutedForeground }]}>Licensed Users</Text>
                  </View>
                )}
              </View>
            </View>
          )}

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

          {/* All clear */}
          {alerts.length === 0 && (
            <View style={[styles.alertCard, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
              <View style={styles.alertHeader}>
                <Feather name="check-circle" size={14} color="#16A34A" />
                <Text style={[styles.alertTitle, { color: "#16A34A" }]}>No critical issues detected</Text>
              </View>
            </View>
          )}

          {/* Five score cards */}
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>HEALTH SCORES</Text>
          <View style={styles.scoresGrid}>
            {SCORE_RINGS.map((r) => (
              <ScoreCard key={r.label} label={r.label} score={r.score} colors={colors} />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },

  errorIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  errorTitle: { fontSize: 16, fontFamily: "Inter_700Bold", textAlign: "center" },
  errorMsg: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  retryBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, marginTop: 4,
  },
  retryText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  scroll: { padding: 16, gap: 12 },

  orgBanner: {
    borderRadius: 14, borderWidth: 1, padding: 16, gap: 4,
  },
  orgName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  orgDomain: { fontSize: 12, fontFamily: "Inter_400Regular" },
  orgMeta: { flexDirection: "row", gap: 20, marginTop: 8 },
  orgMetaItem: { gap: 2 },
  orgMetaNum: { fontSize: 20, fontFamily: "Inter_700Bold" },
  orgMetaLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase", letterSpacing: 0.5 },

  alertCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 8 },
  alertHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  alertTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  alertItem: { paddingTop: 8, gap: 3 },
  alertHeadline: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  alertWhy: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  sectionTitle: {
    fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1,
    textTransform: "uppercase", marginTop: 4, marginBottom: 4,
  },

  scoresGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  scoreCard: {
    width: "29.5%", borderRadius: 12, borderWidth: 1, padding: 10,
    alignItems: "center", gap: 5,
  },
  scoreNum: { fontSize: 24, fontFamily: "Inter_700Bold" },
  scoreMax: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: -6 },
  scoreBar: { width: "100%", height: 4, borderRadius: 2, overflow: "hidden" },
  scoreBarFill: { height: 4, borderRadius: 2 },
  scoreLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", textAlign: "center" },
});
