import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ListSkeleton } from "@/components/SkeletonLoader";

interface Purchase {
  id: number;
  clientName?: string | null;
  clientEmail?: string | null;
  serviceName?: string | null;
  amount?: number | null;
  status: string;
  createdAt?: string;
}

function statusVariant(s: string) {
  if (s === "active" || s === "completed") return "success" as const;
  if (s === "pending" || s === "processing") return "warning" as const;
  if (s === "cancelled" || s === "failed") return "danger" as const;
  return "default" as const;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

function timeAgo(str: string | undefined): string {
  if (!str) return "";
  const d = Math.floor((Date.now() - new Date(str).getTime()) / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  return new Date(str).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PurchasesScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<Purchase[]>({
    queryKey: ["admin-purchases"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/purchases?limit=50");
      if (!res.ok) throw new Error("Failed to load purchases");
      const json = await res.json() as { purchases?: Purchase[] } | Purchase[];
      return Array.isArray(json) ? json : (json.purchases ?? []);
    },
    staleTime: 60000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Purchases</Text>
        {data && <Text style={[styles.count, { color: colors.mutedForeground }]}>{data.length}</Text>}
      </View>

      {error && <ErrorBanner message="Could not load purchases" onRetry={refetch} />}

      {isLoading && !data ? (
        <ListSkeleton count={5} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => router.push(`/(tabs)/more/purchases/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                    {item.serviceName ?? "Service Purchase"}
                  </Text>
                  <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                    {item.clientName ?? item.clientEmail ?? "Unknown client"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={[styles.amount, { color: colors.success }]}>{fmt(item.amount)}</Text>
                  <Badge label={item.status} variant={statusVariant(item.status)} />
                </View>
              </View>
              <Text style={[styles.cardTime, { color: colors.mutedForeground }]}>{timeAgo(item.createdAt)}</Text>
            </Pressable>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, (data?.length ?? 0) === 0 && { flex: 1 }]}
          ListEmptyComponent={
            <EmptyState icon="shopping-bag" title="No purchases yet" subtitle="Service orders will appear here" />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, gap: 12 },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", flex: 1 },
  count: { fontSize: 13, fontFamily: "Inter_400Regular" },
  list: { padding: 16, gap: 8, paddingBottom: 100 },
  card: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  amount: { fontSize: 16, fontFamily: "Inter_700Bold" },
  cardTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
