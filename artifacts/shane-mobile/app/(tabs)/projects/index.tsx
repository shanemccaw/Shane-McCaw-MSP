import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  FlatList,
  Platform,
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

type StatusFilter = "all" | "active" | "on_hold" | "completed";

interface Project {
  id: number;
  name: string;
  clientName?: string | null;
  status: string;
  phase?: string | null;
  progress?: number | null;
  dueDate?: string | null;
  tasksTotal?: number;
  tasksCompleted?: number;
  updatedAt?: string;
}

function statusVariant(s: string) {
  if (s === "active") return "success" as const;
  if (s === "on_hold") return "warning" as const;
  if (s === "completed") return "muted" as const;
  return "default" as const;
}

function progressColor(p: number | null | undefined, colors: ReturnType<typeof useColors>) {
  if (!p) return colors.border;
  if (p >= 80) return colors.success;
  if (p >= 50) return colors.primary;
  return colors.warning;
}

export default function ProjectsScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [refreshing, setRefreshing] = useState(false);
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data, isLoading, error, refetch } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/engagement-projects");
      if (!res.ok) throw new Error("Failed to load projects");
      const json = await res.json() as { projects?: Project[] } | Project[];
      return Array.isArray(json) ? json : (json.projects ?? []);
    },
    staleTime: 60000,
  });

  const filtered = (data ?? []).filter((p) =>
    filter === "all" ? true : p.status === filter
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch]);

  const filters: { key: StatusFilter; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "on_hold", label: "On Hold" },
    { key: "completed", label: "Done" },
    { key: "all", label: "All" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Projects</Text>
        {data && <Text style={[styles.count, { color: colors.mutedForeground }]}>{data.length}</Text>}
      </View>

      <View style={[styles.filterBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        {filters.map((f) => (
          <Pressable
            key={f.key}
            onPress={() => setFilter(f.key)}
            style={[
              styles.filterBtn,
              filter === f.key && [styles.filterBtnActive, { backgroundColor: colors.primary + "22" }],
            ]}
          >
            <Text style={[styles.filterBtnText, { color: filter === f.key ? colors.primary : colors.mutedForeground }]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && <ErrorBanner message="Could not load projects" onRetry={refetch} />}

      {isLoading && !data ? (
        <ListSkeleton count={4} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p) => String(p.id)}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => router.push(`/(tabs)/projects/${item.id}`)}
            >
              <View style={styles.cardTop}>
                <View style={styles.cardTitleWrap}>
                  <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                  {item.clientName && (
                    <Text style={[styles.cardClient, { color: colors.mutedForeground }]}>{item.clientName}</Text>
                  )}
                </View>
                <Badge label={item.status.replace("_", " ")} variant={statusVariant(item.status)} />
              </View>

              {item.phase && (
                <Text style={[styles.phase, { color: colors.mutedForeground }]}>Phase: {item.phase}</Text>
              )}

              {item.progress !== null && item.progress !== undefined && (
                <View style={styles.progressWrap}>
                  <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                    <View style={[
                      styles.progressFill,
                      { width: `${Math.min(item.progress, 100)}%`, backgroundColor: progressColor(item.progress, colors) },
                    ]} />
                  </View>
                  <Text style={[styles.progressText, { color: colors.mutedForeground }]}>{item.progress}%</Text>
                </View>
              )}

              {(item.tasksTotal !== undefined || item.dueDate) && (
                <View style={styles.cardMeta}>
                  {item.tasksTotal !== undefined && (
                    <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                      {item.tasksCompleted ?? 0}/{item.tasksTotal} tasks
                    </Text>
                  )}
                  {item.dueDate && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <Feather name="calendar" size={11} color={colors.mutedForeground} />
                      <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                        {new Date(item.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </Pressable>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, filtered.length === 0 && { flex: 1 }]}
          ListEmptyComponent={
            <EmptyState
              icon="grid"
              title={filter === "all" ? "No projects yet" : `No ${filter.replace("_", " ")} projects`}
              subtitle="Projects will appear here as clients are activated"
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, gap: 10 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  count: { fontSize: 14, fontFamily: "Inter_400Regular" },
  filterBar: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 10, gap: 8, borderBottomWidth: 1 },
  filterBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  filterBtnActive: {},
  filterBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  list: { padding: 16, gap: 8, paddingBottom: 100 },
  card: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 6 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  cardTitleWrap: { flex: 1 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardClient: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  phase: { fontSize: 12, fontFamily: "Inter_400Regular" },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  progressText: { fontSize: 11, fontFamily: "Inter_500Medium", width: 30 },
  cardMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  metaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
