import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
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

interface Purchase {
  id: number;
  invoiceNumber: string;
  description: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  paidAt: string | null;
  createdAt: string;
  clientEmail: string | null;
  clientName: string | null;
  clientCompany: string | null;
}

function statusColor(status: string): { bg: string; text: string; label: string } {
  switch (status) {
    case "paid":
      return { bg: "#D1FAE5", text: "#065F46", label: "Paid" };
    case "pending":
      return { bg: "#FEF3C7", text: "#92400E", label: "Pending" };
    case "draft":
      return { bg: "#E5E7EB", text: "#374151", label: "Draft" };
    case "due":
      return { bg: "#DBEAFE", text: "#1E40AF", label: "Due" };
    case "overdue":
      return { bg: "#FEE2E2", text: "#991B1B", label: "Overdue" };
    default:
      return { bg: "#E5E7EB", text: "#374151", label: status };
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatAmount(amount: string | null, currency: string | null): string {
  if (!amount) return "—";
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PurchaseRow({ item, onPress }: { item: Purchase; onPress: () => void }) {
  const { bg, text, label } = statusColor(item.status);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
      testID={`order-row-${item.id}`}
    >
      <View style={styles.rowLeft}>
        <View style={styles.iconWrap}>
          <Feather name="shopping-bag" size={18} color="#0078D4" />
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.clientName} numberOfLines={1}>
            {item.clientName ?? item.clientEmail ?? "Unknown client"}
          </Text>
          <Text style={styles.description} numberOfLines={1}>
            {item.description ?? item.invoiceNumber}
          </Text>
          <Text style={styles.timestamp}>{timeAgo(item.createdAt)}</Text>
        </View>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.amount}>{formatAmount(item.amount, item.currency)}</Text>
        <View style={[styles.badge, { backgroundColor: bg }]}>
          <Text style={[styles.badgeText, { color: text }]}>{label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

export default function OrdersScreen() {
  const { fetchWithAuth } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<Purchase[]>({
    queryKey: ["admin-purchases"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/purchases");
      if (!res.ok) throw new Error("Failed to load orders");
      return res.json() as Promise<Purchase[]>;
    },
    refetchInterval: 30000,
  });

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
        <Text style={styles.headerTitle}>Orders</Text>
        {data && <Text style={styles.headerCount}>{data.length}</Text>}
      </View>

      {isLoading && !data ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#0078D4" />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="alert-circle" size={40} color="#E53E3E" />
          <Text style={styles.errorText}>Failed to load orders</Text>
          <Pressable style={styles.retryBtn} onPress={() => refetch()}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <PurchaseRow
              item={item}
              onPress={() => router.push(`/orders/${item.id}`)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#0078D4"
            />
          }
          contentContainerStyle={[
            styles.list,
            (data?.length ?? 0) === 0 && styles.listEmpty,
          ]}
          scrollEnabled={!!(data && data.length > 0)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="inbox" size={48} color="#8FA3B8" />
              <Text style={styles.emptyTitle}>No orders yet</Text>
              <Text style={styles.emptySubtitle}>
                New orders will appear here
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
    backgroundColor: "#E8F0FB",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
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
    marginTop: 4,
  },
  retryBtn: {
    backgroundColor: "#0078D4",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 4,
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
  row: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#0A2540",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  rowPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#E8F0FB",
    alignItems: "center",
    justifyContent: "center",
  },
  rowContent: {
    flex: 1,
  },
  clientName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: "#0A2540",
    marginBottom: 2,
  },
  description: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "#6B7E96",
    marginBottom: 3,
  },
  timestamp: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: "#9DB4C8",
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 6,
    minWidth: 80,
  },
  amount: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#0A2540",
    letterSpacing: -0.3,
  },
  badge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
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
  },
});
