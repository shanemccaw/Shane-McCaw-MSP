import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  Pressable,
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
import { Badge } from "@/components/Badge";
import { ErrorBanner } from "@/components/ErrorBanner";
import { SectionHeader } from "@/components/SectionHeader";
import { ListSkeleton } from "@/components/SkeletonLoader";

interface OpportunityDetail {
  id: number;
  name: string;
  clientName?: string | null;
  clientId?: number | null;
  stage?: string | null;
  value?: number | null;
  fitScore?: number | null;
  painScore?: number | null;
  urgencyScore?: number | null;
  workflowType?: string | null;
  evidenceBullets?: string[];
  recommendedNextStep?: string | null;
  createdAt?: string;
  notes?: string | null;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n}`;
}

function scoreBar(label: string, score: number | null | undefined, colors: ReturnType<typeof useColors>) {
  const s = score ?? 0;
  const color = s >= 70 ? colors.success : s >= 50 ? colors.warning : colors.destructive;
  return (
    <View style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>{label}</Text>
        <Text style={{ color, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>{score ?? "—"}/100</Text>
      </View>
      <View style={{ height: 4, backgroundColor: colors.border, borderRadius: 2 }}>
        <View style={{ height: 4, width: `${Math.min(s, 100)}%`, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}

export default function OpportunityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const oppId = parseInt(id, 10);

  const { data, isLoading, error, refetch } = useQuery<OpportunityDetail>({
    queryKey: ["opportunity", oppId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/opportunities/${oppId}`);
      if (!res.ok) throw new Error("Opportunity not found");
      const json = await res.json() as { opportunity?: OpportunityDetail } | OpportunityDetail;
      return ("opportunity" in json ? json.opportunity : json) as OpportunityDetail;
    },
    enabled: !isNaN(oppId),
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.text }]} numberOfLines={1}>
          {data?.name ?? "Opportunity"}
        </Text>
        {data?.clientId && (
          <Pressable onPress={() => router.push(`/(tabs)/clients/${data.clientId}`)}>
            <Feather name="user" size={20} color={colors.primary} />
          </Pressable>
        )}
      </View>

      {error ? (
        <ErrorBanner message="Could not load opportunity" onRetry={refetch} />
      ) : isLoading ? (
        <ListSkeleton count={4} />
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <SectionHeader title="Overview" />
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Text style={[styles.value, { color: colors.success }]}>{fmt(data?.value)}</Text>
                {data?.stage && <Badge label={data.stage} variant="info" size="md" />}
              </View>
              {data?.clientName && (
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_400Regular" }}>
                  Client: {data.clientName}
                </Text>
              )}
              {data?.workflowType && (
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 }}>
                  Type: {data.workflowType}
                </Text>
              )}
            </Card>
          </View>

          {/* Scores */}
          <SectionHeader title="Score Breakdown" />
          <View style={{ paddingHorizontal: 16 }}>
            <Card>
              {scoreBar("Fit Score", data?.fitScore, colors)}
              {scoreBar("Pain Score", data?.painScore, colors)}
              {scoreBar("Urgency Score", data?.urgencyScore, colors)}
            </Card>
          </View>

          {/* Evidence */}
          {(data?.evidenceBullets?.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Evidence" />
              <View style={{ paddingHorizontal: 16 }}>
                <Card>
                  {data?.evidenceBullets?.map((b, i) => (
                    <View key={i} style={{ flexDirection: "row", gap: 8, paddingVertical: 4 }}>
                      <Feather name="check-circle" size={13} color={colors.success} style={{ marginTop: 2 }} />
                      <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1, lineHeight: 18 }}>
                        {b}
                      </Text>
                    </View>
                  ))}
                </Card>
              </View>
            </>
          )}

          {/* Recommended Next Step */}
          {data?.recommendedNextStep && (
            <>
              <SectionHeader title="Recommended Next Step" />
              <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
                <Card elevated>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Feather name="arrow-right-circle" size={16} color={colors.primary} style={{ marginTop: 2 }} />
                    <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, flex: 1 }}>
                      {data.recommendedNextStep}
                    </Text>
                  </View>
                </Card>
              </View>
            </>
          )}

          {/* Notes */}
          {data?.notes && (
            <>
              <SectionHeader title="Notes" />
              <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
                <Card>
                  <Text style={{ color: colors.text, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
                    {data.notes}
                  </Text>
                </Card>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  topTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center", marginHorizontal: 8 },
  scroll: {},
  value: { fontSize: 26, fontFamily: "Inter_700Bold" },
});
