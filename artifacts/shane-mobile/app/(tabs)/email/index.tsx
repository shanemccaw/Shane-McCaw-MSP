import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";

interface EmailRow {
  email: {
    id: number;
    messageId: string;
    subject: string;
    senderAddress: string;
    rawFrom: string;
    bodyPreview: string | null;
    receivedAt: string;
    linkedUserId: number | null;
  };
  clientName: string | null;
  clientEmail: string | null;
  clientCompany: string | null;
}

interface EmailsResponse {
  emails: EmailRow[];
  total: number;
  page: number;
  limit: number;
}

function timeAgo(dateStr: string): string {
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

function parseSenderName(rawFrom: string): string {
  const match = rawFrom.match(/^(.+?)\s*</);
  return match ? (match[1]?.trim() ?? rawFrom) : rawFrom;
}

function EmailCard({
  item,
  highlighted,
}: {
  item: EmailRow;
  highlighted: boolean;
}) {
  const initials = parseSenderName(item.email.rawFrom)
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
    || item.email.senderAddress[0]?.toUpperCase()
    || "?";

  return (
    <View
      style={[styles.card, highlighted && styles.cardHighlighted]}
      testID={`email-${item.email.id}`}
    >
      <View style={[styles.avatar, item.email.linkedUserId ? styles.avatarLinked : styles.avatarUnlinked]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.cardContent}>
        <View style={styles.cardTop}>
          <Text style={styles.sender} numberOfLines={1}>
            {item.clientName ?? parseSenderName(item.email.rawFrom)}
          </Text>
          <Text style={styles.time}>{timeAgo(item.email.receivedAt)}</Text>
        </View>
        <Text style={styles.subject} numberOfLines={1}>
          {item.email.subject}
        </Text>
        {item.email.bodyPreview ? (
          <Text style={styles.preview} numberOfLines={1}>
            {item.email.bodyPreview}
          </Text>
        ) : null}
        {!item.email.linkedUserId && (
          <View style={styles.unlinkedBadge}>
            <Text style={styles.unlinkedText}>Unlinked</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function EmailActivityScreen() {
  const { fetchWithAuth } = useAuth();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<FlatList<EmailRow>>(null);

  const { messageId } = useLocalSearchParams<{ messageId?: string }>();

  const { data, isLoading, error, refetch } = useQuery<EmailsResponse>({
    queryKey: ["admin-emails"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/emails?limit=50");
      if (!res.ok) throw new Error("Failed to load emails");
      return res.json() as Promise<EmailsResponse>;
    },
    refetchInterval: 30000,
  });

  const emails = data?.emails ?? [];

  const highlightedIndex = messageId
    ? emails.findIndex((r) => r.email.messageId === messageId)
    : -1;

  useEffect(() => {
    if (highlightedIndex >= 0 && emails.length > 0) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index: highlightedIndex,
          animated: true,
          viewPosition: 0.3,
        });
      }, 300);
    }
  }, [highlightedIndex, emails.length]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Email Activity</Text>
        {data && (
          <Text style={styles.headerCount}>{data.total}</Text>
        )}
      </View>

      {isLoading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0078D4" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color="#E53E3E" />
          <Text style={styles.errorText}>Failed to load emails</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={emails}
          keyExtractor={(item) => String(item.email.id)}
          renderItem={({ item, index }) => (
            <EmailCard
              item={item}
              highlighted={index === highlightedIndex}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#0078D4"
            />
          }
          onScrollToIndexFailed={() => null}
          contentContainerStyle={[
            styles.list,
            emails.length === 0 && styles.listEmpty,
          ]}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="mail" size={48} color="#8FA3B8" />
              <Text style={styles.emptyTitle}>No emails yet</Text>
              <Text style={styles.emptySubtitle}>
                Inbound emails from Microsoft 365 will appear here
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F9FC",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: "#0A2540",
    letterSpacing: -0.5,
  },
  headerCount: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "#6B7E96",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  errorText: {
    fontSize: 16,
    fontFamily: "Inter_500Medium",
    color: "#6B7E96",
  },
  retryBtn: {
    backgroundColor: "#0078D4",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  listEmpty: {
    flex: 1,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    shadowColor: "#0A2540",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHighlighted: {
    borderWidth: 2,
    borderColor: "#0078D4",
    shadowOpacity: 0.14,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  avatarLinked: {
    backgroundColor: "#0A2540",
  },
  avatarUnlinked: {
    backgroundColor: "#8FA3B8",
  },
  avatarText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
  cardContent: {
    flex: 1,
    gap: 3,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  sender: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#0A2540",
    flex: 1,
  },
  time: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#9DB4C8",
    marginLeft: 8,
  },
  subject: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#2D4A6A",
  },
  preview: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#6B7E96",
  },
  unlinkedBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#FFF3CD",
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginTop: 4,
  },
  unlinkedText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: "#856404",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingTop: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: "#0A2540",
    marginTop: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "#6B7E96",
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
