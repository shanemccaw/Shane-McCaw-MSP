import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ListSkeleton } from "@/components/SkeletonLoader";

interface InboxMessage {
  id: string;
  subject?: string | null;
  sender?: { name?: string | null; address?: string | null };
  preview?: string | null;
  receivedAt?: string | null;
  isRead?: boolean;
  isImportant?: boolean;
}

function timeAgo(dateStr: string | undefined | null): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default function InboxScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<{ messages: InboxMessage[]; total: number }>({
    queryKey: ["inbox-messages"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/inbox/messages?limit=50");
      if (!res.ok) throw new Error("Failed to load inbox");
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await fetchWithAuth(`/api/inbox/messages/${id}/read`, { method: "PATCH" });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["inbox-messages"] }),
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch]);

  const messages = data?.messages ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Inbox</Text>
        {data?.total !== undefined && (
          <Text style={[styles.count, { color: colors.mutedForeground }]}>{data.total}</Text>
        )}
      </View>

      {error && <ErrorBanner message="Could not load inbox" onRetry={refetch} />}

      {isLoading && !data ? (
        <ListSkeleton count={6} />
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => String(m.id)}
          renderItem={({ item }) => {
            const senderName = item.sender?.name ?? item.sender?.address ?? "Unknown";
            const initials = senderName.split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
            return (
              <Pressable
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  !item.isRead && { borderLeftWidth: 3, borderLeftColor: colors.primary },
                  pressed && { opacity: 0.8 },
                ]}
                onPress={() => {
                  if (!item.isRead) markReadMutation.mutate(item.id);
                  Alert.alert(
                    item.subject ?? "Email",
                    `From: ${senderName}\n\n${item.preview ?? "No preview available"}`,
                    [
                      { text: "Close", style: "cancel" },
                      {
                        text: "Reply",
                        onPress: () => {
                          Alert.prompt(
                            "Reply",
                            `Replying to ${senderName}`,
                            async (replyText) => {
                              if (!replyText?.trim()) return;
                              await fetchWithAuth(`/api/inbox/messages/${item.id}/reply`, {
                                method: "POST",
                                body: JSON.stringify({ body: replyText }),
                              });
                              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                            }
                          );
                        },
                      },
                    ]
                  );
                }}
              >
                <View style={[styles.avatar, { backgroundColor: item.isImportant ? colors.warning + "22" : colors.primary + "18" }]}>
                  <Text style={[styles.avatarText, { color: item.isImportant ? colors.warning : colors.primary }]}>{initials}</Text>
                </View>
                <View style={styles.rowContent}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.sender, { color: colors.text, fontFamily: item.isRead ? "Inter_400Regular" : "Inter_600SemiBold" }]} numberOfLines={1}>
                      {senderName}
                    </Text>
                    <Text style={[styles.time, { color: colors.mutedForeground }]}>{timeAgo(item.receivedAt)}</Text>
                  </View>
                  <Text style={[styles.subject, { color: colors.text, fontFamily: item.isRead ? "Inter_400Regular" : "Inter_500Medium" }]} numberOfLines={1}>
                    {item.subject ?? "(No subject)"}
                  </Text>
                  {item.preview && (
                    <Text style={[styles.preview, { color: colors.mutedForeground }]} numberOfLines={1}>{item.preview}</Text>
                  )}
                  <View style={styles.rowMeta}>
                    {item.isImportant && <Badge label="Important" variant="warning" />}
                    {!item.isRead && <Badge label="Unread" variant="default" />}
                  </View>
                </View>
              </Pressable>
            );
          }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, messages.length === 0 && { flex: 1 }]}
          ListEmptyComponent={
            <EmptyState icon="mail" title="Inbox is empty" subtitle="Microsoft 365 emails will appear here" />
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
  list: { paddingHorizontal: 16, paddingBottom: 100, gap: 8, paddingTop: 12 },
  row: { borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 12, borderWidth: 1 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  rowContent: { flex: 1, gap: 2 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sender: { fontSize: 14, flex: 1 },
  time: { fontSize: 11, fontFamily: "Inter_400Regular", marginLeft: 8 },
  subject: { fontSize: 13, lineHeight: 18 },
  preview: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rowMeta: { flexDirection: "row", gap: 5, marginTop: 4 },
});
