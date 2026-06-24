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

interface PurchaseDetail {
  id: number;
  clientName?: string | null;
  clientEmail?: string | null;
  clientId?: number | null;
  serviceName?: string | null;
  amount?: number | null;
  status: string;
  createdAt?: string;
  services?: { name: string; status: string }[];
  wizardConfig?: Record<string, unknown>;
  fulfillmentSteps?: { title: string; status: string; completedAt?: string | null }[];
  notes?: string | null;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

function statusVariant(s: string) {
  if (s === "active" || s === "completed") return "success" as const;
  if (s === "pending" || s === "processing") return "warning" as const;
  if (s === "cancelled" || s === "failed") return "danger" as const;
  return "default" as const;
}

export default function PurchaseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const purchaseId = parseInt(id, 10);

  const { data, isLoading, error, refetch } = useQuery<PurchaseDetail>({
    queryKey: ["purchase", purchaseId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/purchases/${purchaseId}`);
      if (!res.ok) throw new Error("Purchase not found");
      const json = await res.json() as { purchase?: PurchaseDetail } | PurchaseDetail;
      return ("purchase" in json ? json.purchase : json) as PurchaseDetail;
    },
    enabled: !isNaN(purchaseId),
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.topTitle, { color: colors.text }]}>Purchase #{id}</Text>
        {data?.clientId && (
          <Pressable onPress={() => router.push(`/(tabs)/clients/${data.clientId}`)}>
            <Feather name="user" size={20} color={colors.primary} />
          </Pressable>
        )}
      </View>

      {error ? (
        <ErrorBanner message="Could not load purchase" onRetry={refetch} />
      ) : isLoading ? (
        <ListSkeleton count={3} />
      ) : (
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]} showsVerticalScrollIndicator={false}>
          {/* Summary */}
          <SectionHeader title="Summary" />
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <Card>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <Text style={[styles.amount, { color: colors.success }]}>{fmt(data?.amount)}</Text>
                <Badge label={data?.status ?? "unknown"} variant={statusVariant(data?.status ?? "")} size="md" />
              </View>
              {data?.serviceName && (
                <Text style={[styles.serviceName, { color: colors.text }]}>{data.serviceName}</Text>
              )}
              {(data?.clientName ?? data?.clientEmail) && (
                <Text style={[styles.clientInfo, { color: colors.mutedForeground }]}>
                  {data.clientName ?? data.clientEmail}
                </Text>
              )}
              {data?.createdAt && (
                <Text style={[styles.date, { color: colors.mutedForeground }]}>
                  {new Date(data.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </Text>
              )}
            </Card>
          </View>

          {/* Services */}
          {(data?.services?.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Services" />
              <View style={{ paddingHorizontal: 16, gap: 6 }}>
                {data?.services?.map((s, i) => (
                  <View key={i} style={[styles.serviceRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.serviceItem, { color: colors.text }]}>{s.name}</Text>
                    <Badge label={s.status} variant={statusVariant(s.status)} />
                  </View>
                ))}
              </View>
            </>
          )}

          {/* Fulfillment steps */}
          {(data?.fulfillmentSteps?.length ?? 0) > 0 && (
            <>
              <SectionHeader title="Fulfillment" />
              <View style={{ paddingHorizontal: 16, gap: 6 }}>
                {data?.fulfillmentSteps?.map((step, i) => (
                  <View key={i} style={[styles.stepRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={[
                      styles.stepIcon,
                      { backgroundColor: step.status === "completed" ? colors.success + "22" : colors.border },
                    ]}>
                      <Feather
                        name={step.status === "completed" ? "check" : "clock"}
                        size={12}
                        color={step.status === "completed" ? colors.success : colors.mutedForeground}
                      />
                    </View>
                    <Text style={[styles.stepTitle, { color: colors.text }]}>{step.title}</Text>
                    <Badge label={step.status} variant={step.status === "completed" ? "success" : "muted"} />
                  </View>
                ))}
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  topTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold", textAlign: "center", marginHorizontal: 8 },
  scroll: {},
  amount: { fontSize: 26, fontFamily: "Inter_700Bold" },
  serviceName: { fontSize: 16, fontFamily: "Inter_600SemiBold", marginBottom: 4 },
  clientInfo: { fontSize: 13, fontFamily: "Inter_400Regular" },
  date: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  serviceRow: { borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1 },
  serviceItem: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  stepRow: { borderRadius: 10, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1 },
  stepIcon: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepTitle: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
});
