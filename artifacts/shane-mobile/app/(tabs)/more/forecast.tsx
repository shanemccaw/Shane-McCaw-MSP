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

interface ForecastPoint {
  month: string;
  revenue: number;
  lower?: number;
  upper?: number;
}

interface ForecastResponse {
  forecast?: ForecastPoint[];
  narrative?: string;
  totalForecast?: number;
  growthRate?: number;
}

function fmt(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function RevenueChart({ data, colors }: { data: ForecastPoint[]; colors: ReturnType<typeof useColors> }) {
  if (!data.length) return null;
  const maxVal = Math.max(...data.map((d) => d.upper ?? d.revenue), 1);
  const chartH = 120;

  return (
    <View style={{ flexDirection: "row", alignItems: "flex-end", height: chartH + 24, paddingHorizontal: 4, gap: 3 }}>
      {data.map((point, i) => {
        const barH = Math.max((point.revenue / maxVal) * chartH, 4);
        const upperH = point.upper ? Math.max((point.upper / maxVal) * chartH, 4) : barH;
        const lowerH = point.lower ? Math.max((point.lower / maxVal) * chartH, 4) : barH;
        return (
          <View key={i} style={{ flex: 1, alignItems: "center" }}>
            <View style={{ height: chartH, justifyContent: "flex-end", alignItems: "center", width: "100%" }}>
              {/* Confidence band */}
              {point.upper && point.lower && (
                <View style={{
                  position: "absolute",
                  bottom: lowerH,
                  height: upperH - lowerH,
                  width: "80%",
                  backgroundColor: colors.primary + "18",
                  borderRadius: 2,
                }} />
              )}
              {/* Bar */}
              <View style={{
                width: "65%",
                height: barH,
                backgroundColor: colors.primary,
                borderRadius: 3,
                opacity: 0.85 + 0.15 * (i / data.length),
              }} />
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 8, fontFamily: "Inter_400Regular", marginTop: 4 }}>
              {new Date(point.month).toLocaleDateString("en-US", { month: "short" })}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ForecastScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<ForecastResponse>({
    queryKey: ["analytics-forecast"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/analytics-forecast");
      if (!res.ok) throw new Error("Failed to load forecast");
      return res.json() as Promise<ForecastResponse>;
    },
    staleTime: 300000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch]);

  const forecast = data?.forecast ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Revenue Forecast</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {error && <ErrorBanner message="Could not load forecast" onRetry={refetch} />}

        {isLoading ? (
          <ListSkeleton count={3} />
        ) : (
          <>
            {/* Summary KPIs */}
            <SectionHeader title="12-Month Projection" />
            <View style={styles.kpiRow}>
              <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>Total Forecast</Text>
                <Text style={[styles.kpiValue, { color: colors.success }]}>{fmt(data?.totalForecast)}</Text>
              </View>
              <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.kpiLabel, { color: colors.mutedForeground }]}>Growth Rate</Text>
                <Text style={[styles.kpiValue, { color: colors.primary }]}>
                  {data?.growthRate !== undefined ? `${data.growthRate.toFixed(1)}%` : "—"}
                </Text>
              </View>
            </View>

            {/* Chart */}
            {forecast.length > 0 && (
              <>
                <SectionHeader title="Monthly Projection" />
                <View style={{ paddingHorizontal: 16 }}>
                  <Card>
                    <RevenueChart data={forecast} colors={colors} />
                    <View style={styles.legend}>
                      <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: colors.primary }]} />
                        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Forecast</Text>
                      </View>
                      <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: colors.primary + "33" }]} />
                        <Text style={[styles.legendText, { color: colors.mutedForeground }]}>Confidence band</Text>
                      </View>
                    </View>
                  </Card>
                </View>

                {/* Monthly breakdown */}
                <SectionHeader title="Monthly Breakdown" />
                <View style={{ paddingHorizontal: 16, gap: 6, marginBottom: 16 }}>
                  {forecast.map((point, i) => (
                    <View key={i} style={[styles.monthRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <Text style={[styles.monthLabel, { color: colors.text }]}>
                        {new Date(point.month).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                      </Text>
                      <View style={styles.monthValues}>
                        <Text style={[styles.monthMain, { color: colors.success }]}>{fmt(point.revenue)}</Text>
                        {point.lower !== undefined && point.upper !== undefined && (
                          <Text style={[styles.monthRange, { color: colors.mutedForeground }]}>
                            {fmt(point.lower)} – {fmt(point.upper)}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* AI Narrative */}
            {data?.narrative && (
              <>
                <SectionHeader title="AI Narrative" />
                <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
                  <Card elevated>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                      <Feather name="cpu" size={14} color={colors.primary} />
                      <Text style={{ color: colors.primary, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>AI ANALYSIS</Text>
                    </View>
                    <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 }}>
                      {data.narrative}
                    </Text>
                  </Card>
                </View>
              </>
            )}

            {forecast.length === 0 && !error && (
              <View style={{ alignItems: "center", padding: 40 }}>
                <Feather name="trending-up" size={40} color={colors.border} />
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 12 }}>
                  Revenue forecast data is not available yet
                </Text>
              </View>
            )}
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
  kpiRow: { flexDirection: "row", gap: 10, paddingHorizontal: 16 },
  kpiCard: { flex: 1, padding: 14, borderRadius: 14, borderWidth: 1 },
  kpiLabel: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 4 },
  kpiValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  legend: { flexDirection: "row", gap: 16, marginTop: 10, justifyContent: "center" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  monthRow: { borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1 },
  monthLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  monthValues: { alignItems: "flex-end" },
  monthMain: { fontSize: 14, fontFamily: "Inter_700Bold" },
  monthRange: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
});
