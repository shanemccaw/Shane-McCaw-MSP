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
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorBanner } from "@/components/ErrorBanner";
import { ListSkeleton } from "@/components/SkeletonLoader";

interface Invoice {
  id: number | string;
  clientName?: string | null;
  clientEmail?: string | null;
  amount?: number | null;
  status: string;
  dueDate?: string | null;
  createdAt?: string;
  invoiceNumber?: string | null;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

function statusVariant(s: string) {
  if (s === "paid") return "success" as const;
  if (s === "overdue") return "danger" as const;
  if (s === "pending" || s === "open") return "warning" as const;
  return "muted" as const;
}

export default function InvoicesScreen() {
  const { fetchWithAuth } = useAuth();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<Invoice[]>({
    queryKey: ["admin-invoices"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/invoices?admin=true&limit=50");
      if (!res.ok) {
        const res2 = await fetchWithAuth("/api/admin/invoices?limit=50");
        if (!res2.ok) return [];
        const json2 = await res2.json() as { invoices?: Invoice[] } | Invoice[];
        return Array.isArray(json2) ? json2 : (json2.invoices ?? []);
      }
      const json = await res.json() as { invoices?: Invoice[] } | Invoice[];
      return Array.isArray(json) ? json : (json.invoices ?? []);
    },
    staleTime: 60000,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [refetch]);

  const totalOutstanding = (data ?? [])
    .filter((i) => i.status !== "paid")
    .reduce((sum, i) => sum + (i.amount ?? 0), 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>Invoices</Text>
        {totalOutstanding > 0 && (
          <Text style={[styles.outstanding, { color: colors.warning }]}>{fmt(totalOutstanding)} outstanding</Text>
        )}
      </View>

      {error && <ErrorBanner message="Could not load invoices" onRetry={refetch} />}

      {isLoading && !data ? (
        <ListSkeleton count={5} />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(i) => String(i.id)}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && { opacity: 0.8 },
              ]}
              onPress={() => Alert.alert(
                `Invoice ${item.invoiceNumber ?? item.id}`,
                `Client: ${item.clientName ?? item.clientEmail ?? "Unknown"}\nAmount: ${fmt(item.amount)}\nStatus: ${item.status}${item.dueDate ? `\nDue: ${new Date(item.dueDate).toLocaleDateString()}` : ""}`,
                [{ text: "OK" }]
              )}
            >
              <View style={styles.cardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.invoiceNum, { color: colors.text }]}>
                    {item.invoiceNumber ? `#${item.invoiceNumber}` : `Invoice #${item.id}`}
                  </Text>
                  <Text style={[styles.clientName, { color: colors.mutedForeground }]}>
                    {item.clientName ?? item.clientEmail ?? "Unknown"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={[styles.amount, { color: item.status === "paid" ? colors.success : colors.text }]}>
                    {fmt(item.amount)}
                  </Text>
                  <Badge label={item.status} variant={statusVariant(item.status)} />
                </View>
              </View>
              {item.dueDate && (
                <Text style={[styles.dueDate, { color: item.status === "overdue" ? colors.destructive : colors.mutedForeground }]}>
                  Due: {new Date(item.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </Text>
              )}
            </Pressable>
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          contentContainerStyle={[styles.list, (data?.length ?? 0) === 0 && { flex: 1 }]}
          ListEmptyComponent={
            <EmptyState icon="file-text" title="No invoices" subtitle="Client invoices will appear here" />
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
  outstanding: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  list: { padding: 16, gap: 8, paddingBottom: 100 },
  card: { borderRadius: 14, padding: 14, borderWidth: 1, gap: 4 },
  cardRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  invoiceNum: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  clientName: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  amount: { fontSize: 15, fontFamily: "Inter_700Bold" },
  dueDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
