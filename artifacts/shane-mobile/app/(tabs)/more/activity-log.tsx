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
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ListSkeleton } from "@/components/SkeletonLoader";

interface ActivityEntry {
  id: number | string;
  action?: string;
  entityType?: string;
  entityId?: number | null;
  description?: string;
  adminEmail?: string | null;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

function actionIcon(action: string | undefined): keyof typeof Feather.glyphMap {
  if (!action) return "activity";
  if (action.includes("create") || action.includes("add")) return "plus-circle";
  if (action.includes("update") || action.includes("edit")) return "edit-2";
  if (action.includes("delete") || action.includes("remove")) return "trash-2";
  if (action.includes("login") || action.includes("auth")) return "log-in";
  if (action.includes("send") || action.includes("email")) return "send";
  if (action.includes("run") || action.includes("script")) return "terminal";
  if (action.includes("view")) return "eye";
  return "activity";
}

function timeAgo(str: string | undefined): string {
  if (!str) return "";
  const diff = Date.now() - new Date(str).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(str).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function ActivityLogScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<ActivityEntry[]>({
    queryKey: ["admin-activity-log"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/audit-logs?limit=50");
      if (!res.ok) throw new Error("Failed to load activity log");
      const json = await res.json() as { logs?: ActivityEntry[] } | ActivityEntry[];
      return Array.isArray(json) ? json : (json.logs ?? []);
    },
    staleTime: 30000,
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
        <Text style={[styles.title, { color: colors.text }]}>Activity Log</Text>
        {data && <Text style={[styles.count, { color: colors.mutedForeground }]}>{data.length} entries</Text>}
      </View>

      {error && <ErrorBanner message="Could not load activity log" onRetry={refetch} />}

      {isLoading && !data ? (
        <ListSkeleton count={6} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(e) => String(e.id)}
          renderItem={({ item }) => (
            <View style={[styles.row, { borderBottomColor: colors.border }]}>
              <View style={[styles.iconWrap, { backgroundColor: colors.card }]}>
                <Feather name={actionIcon(item.action)} size={14} color={colors.primary} />
              </View>
              <View style={styles.rowContent}>
                <Text style={[styles.action, { color: colors.text }]}>
                  {item.description ?? item.action ?? "Unknown action"}
                </Text>
                <View style={styles.rowMeta}>
                  {item.entityType && (
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.entityType}</Text>
                  )}
                  {item.adminEmail && (
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{item.adminEmail}</Text>
                  )}
                </View>
              </View>
              <Text style={[styles.time, { color: colors.mutedForeground }]}>{timeAgo(item.createdAt)}</Text>
            </View>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, (data?.length ?? 0) === 0 && { flex: 1 }]}
          ListEmptyComponent={
            <EmptyState icon="activity" title="No activity" subtitle="Admin actions will be logged here" />
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
  count: { fontSize: 12, fontFamily: "Inter_400Regular" },
  list: { paddingBottom: 100 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  iconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  rowContent: { flex: 1 },
  action: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  rowMeta: { flexDirection: "row", gap: 8, marginTop: 2, flexWrap: "wrap" },
  metaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  time: { fontSize: 11, fontFamily: "Inter_400Regular", flexShrink: 0, marginTop: 2 },
});
