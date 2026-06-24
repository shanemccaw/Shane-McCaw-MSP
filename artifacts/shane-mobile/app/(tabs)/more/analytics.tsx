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
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Card } from "@/components/Card";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SectionHeader } from "@/components/SectionHeader";
import { ListSkeleton } from "@/components/SkeletonLoader";

interface KPIs {
  pageviews?: number;
  sessions?: number;
  uniqueVisitors?: number;
  avgSessionDuration?: number;
  bounceRate?: number;
  conversionRate?: number;
}

interface TopPage {
  path: string;
  views: number;
  percentage?: number;
}

interface TopEvent {
  name: string;
  count: number;
}

interface Referrer {
  source: string;
  count: number;
}

interface PageviewPoint {
  date: string;
  views: number;
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <View style={{ flex: 1, height: 4, backgroundColor: color + "22", borderRadius: 2 }}>
      <View style={{ width: `${pct}%`, height: 4, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

function SparkLine({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const barW = 100 / data.length;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: 32, gap: 2 }}>
      {data.map((v, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            height: Math.max((v / max) * 32, 2),
            backgroundColor: color,
            borderRadius: 2,
            opacity: 0.7 + 0.3 * (i / data.length),
          }}
        />
      ))}
    </View>
  );
}

export default function AnalyticsScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data: kpis, isLoading: kpisLoading, error: kpisError, refetch: refetchKpis } = useQuery<KPIs>({
    queryKey: ["admin-analytics-kpis"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/analytics/kpis");
      if (!res.ok) return {};
      return res.json() as Promise<KPIs>;
    },
    staleTime: 120000,
  });

  const { data: pageviewsSeries, refetch: refetchSeries } = useQuery<PageviewPoint[]>({
    queryKey: ["admin-analytics-series"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/analytics/pageviews-series?days=14");
      if (!res.ok) return [];
      const json = await res.json() as { data?: PageviewPoint[] } | PageviewPoint[];
      return Array.isArray(json) ? json : (json.data ?? []);
    },
    staleTime: 120000,
  });

  const { data: topPages, refetch: refetchPages } = useQuery<TopPage[]>({
    queryKey: ["admin-analytics-top-pages"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/analytics/top-pages?limit=10");
      if (!res.ok) return [];
      const json = await res.json() as { pages?: TopPage[] } | TopPage[];
      return Array.isArray(json) ? json : (json.pages ?? []);
    },
    staleTime: 120000,
  });

  const { data: topEvents, refetch: refetchEvents } = useQuery<TopEvent[]>({
    queryKey: ["admin-analytics-top-events"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/analytics/top-events?limit=8");
      if (!res.ok) return [];
      const json = await res.json() as { events?: TopEvent[] } | TopEvent[];
      return Array.isArray(json) ? json : (json.events ?? []);
    },
    staleTime: 120000,
  });

  const { data: referrers, refetch: refetchReferrers } = useQuery<Referrer[]>({
    queryKey: ["admin-analytics-referrers"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/analytics/top-referrers?limit=8");
      if (!res.ok) return [];
      const json = await res.json() as { referrers?: Referrer[] } | Referrer[];
      return Array.isArray(json) ? json : (json.referrers ?? []);
    },
    staleTime: 120000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchKpis(), refetchSeries(), refetchPages(), refetchEvents(), refetchReferrers()]);
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetchKpis, refetchSeries, refetchPages, refetchEvents, refetchReferrers]);

  const sparkValues = (pageviewsSeries ?? []).map((p) => p.views);
  const maxPages = Math.max(...(topPages ?? []).map((p) => p.views), 1);
  const maxEvents = Math.max(...(topEvents ?? []).map((e) => e.count), 1);
  const maxRefs = Math.max(...(referrers ?? []).map((r) => r.count ?? 0), 1);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Analytics</Text>
        <Pressable onPress={() => router.push("/(tabs)/more/forecast")}>
          <Feather name="trending-up" size={20} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {kpisError && <ErrorBanner message="Could not load analytics" onRetry={refetchKpis} />}

        {/* KPI Grid */}
        <SectionHeader title="Overview (14 days)" />
        {kpisLoading ? (
          <ListSkeleton count={2} />
        ) : (
          <View style={styles.kpiGrid}>
            {[
              { label: "Page Views", value: kpis?.pageviews?.toLocaleString() ?? "—", icon: "eye" as const },
              { label: "Sessions", value: kpis?.sessions?.toLocaleString() ?? "—", icon: "monitor" as const },
              { label: "Visitors", value: kpis?.uniqueVisitors?.toLocaleString() ?? "—", icon: "users" as const },
              { label: "Bounce Rate", value: kpis?.bounceRate !== undefined ? `${kpis.bounceRate.toFixed(1)}%` : "—", icon: "log-out" as const },
            ].map((k) => (
              <View key={k.label} style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name={k.icon} size={16} color={colors.primary} style={{ marginBottom: 6 }} />
                <Text style={[styles.kpiValue, { color: colors.text }]}>{k.value}</Text>
                <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>{k.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Sparkline */}
        {sparkValues.length > 0 && (
          <>
            <SectionHeader title="Page Views Trend (14 days)" />
            <View style={{ paddingHorizontal: 16 }}>
              <Card>
                <SparkLine data={sparkValues} color={colors.primary} />
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: "Inter_400Regular" }}>
                    {pageviewsSeries?.[0]?.date ? new Date(pageviewsSeries[0].date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 10, fontFamily: "Inter_400Regular" }}>
                    {pageviewsSeries?.[pageviewsSeries.length - 1]?.date ? new Date(pageviewsSeries[pageviewsSeries.length - 1].date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                  </Text>
                </View>
              </Card>
            </View>
          </>
        )}

        {/* Top Pages */}
        {(topPages?.length ?? 0) > 0 && (
          <>
            <SectionHeader title="Top Pages" />
            <View style={{ paddingHorizontal: 16, gap: 6 }}>
              {topPages?.map((p, i) => (
                <View key={i} style={[styles.tableRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.tableCell, { color: colors.text }]} numberOfLines={1}>{p.path}</Text>
                  <View style={styles.tableRight}>
                    <MiniBar value={p.views ?? 0} max={maxPages} color={colors.primary} />
                    <Text style={[styles.tableNum, { color: colors.primary }]}>{(p.views ?? 0).toLocaleString()}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Top Events */}
        {(topEvents?.length ?? 0) > 0 && (
          <>
            <SectionHeader title="Top Events" />
            <View style={{ paddingHorizontal: 16, gap: 6 }}>
              {topEvents?.map((e, i) => (
                <View key={i} style={[styles.tableRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.tableCell, { color: colors.text }]} numberOfLines={1}>{e.name}</Text>
                  <View style={styles.tableRight}>
                    <MiniBar value={e.count ?? 0} max={maxEvents} color={colors.teal} />
                    <Text style={[styles.tableNum, { color: colors.teal }]}>{(e.count ?? 0).toLocaleString()}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Referrers */}
        {(referrers?.length ?? 0) > 0 && (
          <>
            <SectionHeader title="Traffic Sources" />
            <View style={{ paddingHorizontal: 16, gap: 6, marginBottom: 16 }}>
              {referrers?.map((r, i) => (
                <View key={i} style={[styles.tableRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.tableCell, { color: colors.text }]} numberOfLines={1}>{r.source || "Direct"}</Text>
                  <View style={styles.tableRight}>
                    <MiniBar value={r.count ?? 0} max={maxRefs} color={colors.success} />
                    <Text style={[styles.tableNum, { color: colors.success }]}>{(r.count ?? 0).toLocaleString()}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", flex: 1 },
  scroll: {},
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, paddingHorizontal: 16 },
  kpiCard: { width: "47%", padding: 14, borderRadius: 14, borderWidth: 1 },
  kpiValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  kpiLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  tableRow: { borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "center", borderWidth: 1, gap: 10 },
  tableCell: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  tableRight: { flexDirection: "row", alignItems: "center", gap: 8, width: 120 },
  tableNum: { fontSize: 12, fontFamily: "Inter_600SemiBold", width: 40, textAlign: "right" },
});
