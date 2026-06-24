import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useQuickAccess } from "@/hooks/useQuickAccess";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SectionHeader } from "@/components/SectionHeader";
import { ListSkeleton } from "@/components/SkeletonLoader";
import { DraggableQuickAccessGrid } from "@/components/DraggableQuickAccessGrid";

interface KPIs {
  revenueMtd?: number;
  revenueYtd?: number;
  mrr?: number;
  arr?: number;
  activeClients?: number;
  openLeads?: number;
  pipelineVelocity?: number;
  totalPipeline?: number;
}

interface NextBestAction {
  id: number;
  title: string;
  description?: string;
  entityType?: string;
  entityId?: number;
  priority?: string;
  status?: string;
}

interface ActivityItem {
  id: number | string;
  type: string;
  title: string;
  subtitle?: string;
  timestamp?: string;
}

function fmt(n: number | undefined, prefix = "$"): string {
  if (n === undefined || n === null) return "—";
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(0)}K`;
  return `${prefix}${n}`;
}

function timeAgo(str: string | undefined): string {
  if (!str) return "";
  const diff = Date.now() - new Date(str).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function activityIcon(type: string): keyof typeof Feather.glyphMap {
  if (type.includes("lead")) return "user-plus";
  if (type.includes("purchase") || type.includes("stripe")) return "credit-card";
  if (type.includes("contract")) return "file-text";
  if (type.includes("quiz")) return "help-circle";
  if (type.includes("message")) return "message-circle";
  if (type.includes("runbook") || type.includes("script")) return "terminal";
  return "activity";
}

export default function HomeScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { items: quickItems, reorder, removeItem, hintSeen, dismissHint } = useQuickAccess();

  const { data: kpis, isLoading: kpisLoading, error: kpisError, refetch: refetchKpis } = useQuery<KPIs>({
    queryKey: ["admin-kpis"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/analytics/kpis");
      if (!res.ok) return {};
      return res.json() as Promise<KPIs>;
    },
    staleTime: 60000,
  });

  const { data: actions, isLoading: actionsLoading, refetch: refetchActions } = useQuery<NextBestAction[]>({
    queryKey: ["next-best-actions"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/ai/next-best-actions?status=pending&limit=5");
      if (!res.ok) return [];
      const json = await res.json() as { actions?: NextBestAction[] } | NextBestAction[];
      return Array.isArray(json) ? json : (json.actions ?? []);
    },
    staleTime: 120000,
  });

  const { data: activity, isLoading: activityLoading, refetch: refetchActivity } = useQuery<ActivityItem[]>({
    queryKey: ["admin-activity-stream"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/overview?limit=10");
      if (!res.ok) return [];
      const json = await res.json() as { recentActivity?: ActivityItem[] } | ActivityItem[];
      return Array.isArray(json) ? json : (json.recentActivity ?? []);
    },
    staleTime: 30000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchKpis(), refetchActions(), refetchActivity()]);
    void qc.invalidateQueries({ queryKey: ["admin-conversations"] });
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetchKpis, refetchActions, refetchActivity, qc]);

  const resolveAction = useCallback(async (id: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await fetchWithAuth(`/api/ai/next-best-actions/${id}/resolve`, { method: "POST", body: JSON.stringify({ status: "resolved" }) });
    void qc.invalidateQueries({ queryKey: ["next-best-actions"] });
  }, [fetchWithAuth, qc]);

  const isLoading = kpisLoading && actionsLoading && activityLoading;

  const kpiCards = [
    { label: "Rev MTD", value: fmt(kpis?.revenueMtd), icon: "trending-up" as const },
    { label: "MRR", value: fmt(kpis?.mrr), icon: "repeat" as const },
    { label: "ARR", value: fmt(kpis?.arr), icon: "bar-chart-2" as const },
    { label: "Clients", value: kpis?.activeClients !== undefined ? String(kpis.activeClients) : "—", icon: "users" as const },
    { label: "Open Leads", value: kpis?.openLeads !== undefined ? String(kpis.openLeads) : "—", icon: "user-plus" as const },
    { label: "Pipeline", value: fmt(kpis?.totalPipeline), icon: "dollar-sign" as const },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>Good {greeting()}</Text>
          <Text style={[styles.title, { color: colors.text }]}>Command Center</Text>
        </View>
        <Pressable
          onPress={() => router.push("/(tabs)/more")}
          style={[styles.profileBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="settings" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <ListSkeleton count={3} />
        ) : (
          <>
            {kpisError && <ErrorBanner message="Could not load KPIs" onRetry={refetchKpis} />}

            {/* KPI Ribbon */}
            <SectionHeader title="Overview" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.kpiRow}
            >
              {kpiCards.map((k) => (
                <View key={k.label} style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name={k.icon} size={16} color={colors.primary} style={{ marginBottom: 6 }} />
                  <Text style={[styles.kpiValue, { color: colors.text }]}>{k.value}</Text>
                  <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>{k.label}</Text>
                </View>
              ))}
            </ScrollView>

            {/* Next Best Actions */}
            <SectionHeader
              title="Next Best Actions"
              right={
                <Pressable onPress={() => router.push("/(tabs)/pipeline")}>
                  <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
                </Pressable>
              }
            />
            {actionsLoading ? (
              <View style={{ padding: 16 }}>
                <ListSkeleton count={2} />
              </View>
            ) : (actions?.length ?? 0) === 0 ? (
              <View style={[styles.emptySection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="check-circle" size={20} color={colors.success} />
                <Text style={[styles.emptySectionText, { color: colors.mutedForeground }]}>All caught up!</Text>
              </View>
            ) : (
              <View style={styles.section}>
                {actions?.map((action) => (
                  <Card key={action.id} style={styles.actionCard}>
                    <View style={styles.actionRow}>
                      <View style={[styles.actionDot, { backgroundColor: action.priority === "high" ? colors.destructive : colors.primary }]} />
                      <View style={styles.actionContent}>
                        <Text style={[styles.actionTitle, { color: colors.text }]}>{action.title}</Text>
                        {action.description ? (
                          <Text style={[styles.actionDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                            {action.description}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable onPress={() => resolveAction(action.id)} hitSlop={8}>
                        <Feather name="check" size={18} color={colors.success} />
                      </Pressable>
                    </View>
                    {action.entityType && (
                      <View style={styles.actionMeta}>
                        <Badge label={action.entityType} variant="info" />
                        {action.priority === "high" && <Badge label="High priority" variant="danger" />}
                      </View>
                    )}
                  </Card>
                ))}
              </View>
            )}

            {/* Quick Access */}
            <SectionHeader title="Quick Access" />
            {!hintSeen && (
              <Pressable
                onPress={dismissHint}
                style={[styles.hintBanner, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}
              >
                <Feather name="move" size={14} color={colors.primary} />
                <Text style={[styles.hintText, { color: colors.primary }]}>
                  Hold any item to rearrange · Hold More items to pin here
                </Text>
                <Feather name="x" size={14} color={colors.primary} />
              </Pressable>
            )}
            <DraggableQuickAccessGrid
              items={quickItems}
              onReorder={reorder}
              onRemove={removeItem}
              onFirstInteraction={!hintSeen ? dismissHint : undefined}
            />

            {/* Activity Stream */}
            <SectionHeader title="Recent Activity" />
            {activityLoading ? (
              <View style={{ padding: 16 }}>
                <ListSkeleton count={3} />
              </View>
            ) : (activity?.length ?? 0) === 0 ? (
              <View style={[styles.emptySection, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.emptySectionText, { color: colors.mutedForeground }]}>No recent activity</Text>
              </View>
            ) : (
              <View style={[styles.section, { marginBottom: 20 }]}>
                {activity?.map((item) => (
                  <View key={String(item.id)} style={[styles.activityRow, { borderBottomColor: colors.border }]}>
                    <View style={[styles.activityIcon, { backgroundColor: colors.secondary }]}>
                      <Feather name={activityIcon(item.type)} size={14} color={colors.primary} />
                    </View>
                    <View style={styles.activityContent}>
                      <Text style={[styles.activityTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                      {item.subtitle ? (
                        <Text style={[styles.activitySub, { color: colors.mutedForeground }]} numberOfLines={1}>{item.subtitle}</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.activityTime, { color: colors.mutedForeground }]}>{timeAgo(item.timestamp)}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  greeting: { fontSize: 12, fontFamily: "Inter_400Regular" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5, marginTop: 2 },
  profileBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  scroll: {},
  kpiRow: { paddingHorizontal: 16, paddingBottom: 4, gap: 10 },
  kpiCard: { width: 100, padding: 12, borderRadius: 14, borderWidth: 1, alignItems: "flex-start" },
  kpiValue: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  kpiLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  section: { paddingHorizontal: 16, gap: 8 },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },
  actionCard: { marginHorizontal: 0 },
  actionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  actionDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  actionContent: { flex: 1 },
  actionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  actionDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2, lineHeight: 17 },
  actionMeta: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  emptySection: { marginHorizontal: 16, borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1 },
  emptySectionText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  hintBanner: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hintText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1 },
  activityIcon: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  activityContent: { flex: 1 },
  activityTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  activitySub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  activityTime: { fontSize: 11, fontFamily: "Inter_400Regular", flexShrink: 0 },
});
