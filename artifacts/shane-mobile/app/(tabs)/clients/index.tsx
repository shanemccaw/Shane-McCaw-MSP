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
  TextInput,
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

interface Client {
  id: number;
  name: string | null;
  email: string;
  company: string | null;
  status: string | null;
  healthScore?: number | null;
  unreadMessages?: number;
  activeProjects?: number;
}

function healthBadge(score: number | null | undefined) {
  if (score === null || score === undefined) return { label: "Unknown", variant: "muted" as const };
  if (score >= 75) return { label: `${score}% Healthy`, variant: "success" as const };
  if (score >= 50) return { label: `${score}% Fair`, variant: "warning" as const };
  return { label: `${score}% At Risk`, variant: "danger" as const };
}

function ClientRow({ client, onPress }: { client: Client; onPress: () => void }) {
  const colors = useColors();
  const initials = (client.name ?? client.email)
    .split(" ").slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  const h = healthBadge(client.healthScore);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.8 },
      ]}
      onPress={onPress}
    >
      <View style={[styles.avatar, { backgroundColor: colors.primary + "22" }]}>
        <Text style={[styles.avatarText, { color: colors.primary }]}>{initials}</Text>
      </View>
      <View style={styles.rowContent}>
        <View style={styles.rowTop}>
          <Text style={[styles.clientName, { color: colors.text }]} numberOfLines={1}>
            {client.name ?? client.email}
          </Text>
          {client.unreadMessages ? (
            <View style={[styles.unreadDot, { backgroundColor: colors.primary }]}>
              <Text style={styles.unreadDotText}>{client.unreadMessages > 9 ? "9+" : client.unreadMessages}</Text>
            </View>
          ) : null}
        </View>
        {client.company ? (
          <Text style={[styles.company, { color: colors.mutedForeground }]} numberOfLines={1}>{client.company}</Text>
        ) : null}
        <View style={styles.rowMeta}>
          <Badge label={h.label} variant={h.variant} />
          {client.activeProjects ? (
            <Badge label={`${client.activeProjects} project${client.activeProjects !== 1 ? "s" : ""}`} variant="info" />
          ) : null}
        </View>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function ClientsScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<Client[]>({
    queryKey: ["admin-clients"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/clients/enriched");
      if (!res.ok) {
        const res2 = await fetchWithAuth("/api/admin/clients");
        if (!res2.ok) throw new Error("Failed to load clients");
        return res2.json() as Promise<Client[]>;
      }
      const json = await res.json() as { clients?: Client[] } | Client[];
      return Array.isArray(json) ? json : (json.clients ?? []);
    },
    staleTime: 60000,
  });

  const filtered = (data ?? []).filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (c.name ?? "").toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      (c.company ?? "").toLowerCase().includes(q)
    );
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>Clients</Text>
        {data && <Text style={[styles.count, { color: colors.mutedForeground }]}>{data.length}</Text>}
      </View>

      <View style={[styles.searchWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search clients…"
          placeholderTextColor={colors.mutedForeground}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      {error && <ErrorBanner message="Could not load clients" onRetry={refetch} />}

      {isLoading && !data ? (
        <ListSkeleton count={5} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(c) => String(c.id)}
          renderItem={({ item }) => (
            <ClientRow
              client={item}
              onPress={() => router.push(`/(tabs)/clients/${item.id}?name=${encodeURIComponent(item.name ?? item.email)}`)}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          contentContainerStyle={[styles.list, filtered.length === 0 && { flex: 1 }]}
          ListEmptyComponent={
            <EmptyState
              icon="users"
              title={search ? "No matching clients" : "No clients yet"}
              subtitle={search ? "Try a different search" : "Clients will appear here after onboarding"}
            />
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
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 10,
  },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  count: { fontSize: 14, fontFamily: "Inter_400Regular" },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    margin: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", padding: 0 },
  list: { paddingHorizontal: 16, paddingBottom: 100, gap: 8, paddingTop: 8 },
  row: {
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  rowContent: { flex: 1 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 3 },
  clientName: { fontSize: 15, fontFamily: "Inter_600SemiBold", flex: 1 },
  company: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 6 },
  rowMeta: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  unreadDot: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  unreadDotText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
});
