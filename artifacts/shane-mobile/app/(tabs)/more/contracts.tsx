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

interface Contract {
  id: number;
  title?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientId?: number | null;
  status: string;
  signedAt?: string | null;
  createdAt?: string;
  templateName?: string | null;
}

function statusVariant(s: string) {
  if (s === "signed") return "success" as const;
  if (s === "pending") return "warning" as const;
  if (s === "expired" || s === "cancelled") return "danger" as const;
  return "muted" as const;
}

export default function ContractsScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<Contract[]>({
    queryKey: ["admin-contracts"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/contracts?limit=50");
      if (!res.ok) throw new Error("Failed to load contracts");
      const json = await res.json() as { contracts?: Contract[] } | Contract[];
      return Array.isArray(json) ? json : (json.contracts ?? []);
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
        <Text style={[styles.title, { color: colors.text }]}>Contracts</Text>
        {data && <Text style={[styles.count, { color: colors.mutedForeground }]}>{data.length}</Text>}
      </View>

      {error && <ErrorBanner message="Could not load contracts" onRetry={refetch} />}

      {isLoading && !data ? (
        <ListSkeleton count={5} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => item.clientId && router.push(`/(tabs)/clients/${item.clientId}`)}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>
                    {item.title ?? item.templateName ?? "Service Agreement"}
                  </Text>
                  <Text style={[styles.cardSub, { color: colors.mutedForeground }]}>
                    {item.clientName ?? item.clientEmail ?? "Unknown client"}
                  </Text>
                </View>
                <Badge label={item.status} variant={statusVariant(item.status)} size="md" />
              </View>
              <View style={styles.cardMeta}>
                <Feather name={item.status === "signed" ? "check-circle" : "clock"} size={12} color={item.status === "signed" ? colors.success : colors.mutedForeground} />
                <Text style={[styles.cardDate, { color: colors.mutedForeground }]}>
                  {item.signedAt
                    ? `Signed ${new Date(item.signedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                    : item.createdAt
                    ? `Created ${new Date(item.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                    : ""}
                </Text>
              </View>
            </Pressable>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, (data?.length ?? 0) === 0 && { flex: 1 }]}
          ListEmptyComponent={
            <EmptyState icon="clipboard" title="No contracts" subtitle="Client contracts will appear here" />
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
  card: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 8 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  cardMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardDate: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
