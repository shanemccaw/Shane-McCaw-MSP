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

export interface Conversation {
  clientId: number;
  clientName: string | null;
  clientEmail: string | null;
  latestMessage: string | null;
  latestAt: string | null;
  unreadCount: number;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function MessagesScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<Conversation[]>({
    queryKey: ["admin-conversations"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/conversations");
      if (!res.ok) throw new Error("Failed to load conversations");
      return res.json() as Promise<Conversation[]>;
    },
    refetchInterval: 15000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch]);

  const totalUnread = data?.reduce((sum, c) => sum + (c.unreadCount || 0), 0) ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Messages</Text>
        {totalUnread > 0 && (
          <View style={[styles.badge, { backgroundColor: colors.primary }]}>
            <Text style={styles.badgeText}>{totalUnread}</Text>
          </View>
        )}
      </View>

      {error && <ErrorBanner message="Failed to load conversations" onRetry={refetch} />}

      {isLoading && !data ? (
        <ListSkeleton count={5} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => String(item.clientId)}
          renderItem={({ item }) => {
            const initials = (item.clientName ?? item.clientEmail ?? "?")
              .split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => router.push(`/(tabs)/more/messages/${item.clientId}?name=${encodeURIComponent(item.clientName ?? item.clientEmail ?? "Client")}`)}
              >
                <View style={[styles.avatar, { backgroundColor: colors.primary + "22" }]}>
                  <Text style={[styles.avatarText, { color: colors.primary }]}>{initials}</Text>
                </View>
                <View style={styles.rowContent}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.clientName, { color: colors.text }]} numberOfLines={1}>
                      {item.clientName ?? item.clientEmail ?? "Unknown"}
                    </Text>
                    <Text style={[styles.time, { color: colors.mutedForeground }]}>{timeAgo(item.latestAt)}</Text>
                  </View>
                  <View style={styles.rowBottom}>
                    <Text style={[styles.preview, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {item.latestMessage ?? "No messages yet"}
                    </Text>
                    {item.unreadCount > 0 && (
                      <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                        <Text style={styles.unreadText}>
                          {item.unreadCount > 99 ? "99+" : item.unreadCount}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          contentContainerStyle={[styles.list, (data?.length ?? 0) === 0 && { flex: 1 }]}
          ListEmptyComponent={
            <EmptyState icon="message-square" title="No conversations" subtitle="Client messages will appear here" />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 12,
  },
  title: { fontSize: 20, fontFamily: "Inter_700Bold", flex: 1 },
  badge: { minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" },
  list: { paddingHorizontal: 16, paddingBottom: 100, gap: 8, paddingTop: 12 },
  row: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  rowContent: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  clientName: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  time: { fontSize: 12, fontFamily: "Inter_400Regular", marginLeft: 8 },
  rowBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  preview: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  unreadBadge: { borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  unreadText: { fontSize: 11, fontFamily: "Inter_700Bold", color: "#fff" },
});
