import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useQuickAccess, QuickAccessItem } from "@/hooks/useQuickAccess";
import { Badge } from "@/components/Badge";
import { Toast } from "@/components/Toast";

interface MenuItem {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  route: string;
  badge?: number;
  description?: string;
}

function MenuRow({
  item,
  colors,
  pinned,
  onLongPress,
}: {
  item: MenuItem;
  colors: ReturnType<typeof useColors>;
  pinned: boolean;
  onLongPress: () => void;
}) {
  const router = useRouter();
  // Prevent the tap from firing as navigation when the user actually long-pressed
  const suppressNextPress = useRef(false);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.menuRow,
        { backgroundColor: colors.card, borderColor: colors.border },
        pressed && { opacity: 0.75 },
      ]}
      onPress={() => {
        if (suppressNextPress.current) {
          suppressNextPress.current = false;
          return;
        }
        router.push(item.route as Parameters<typeof router.push>[0]);
      }}
      onLongPress={() => {
        suppressNextPress.current = true;
        onLongPress();
      }}
      delayLongPress={400}
    >
      <View style={[styles.menuIcon, { backgroundColor: colors.primary + "18" }]}>
        <Feather name={item.icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.menuContent}>
        <Text style={[styles.menuLabel, { color: colors.text }]}>{item.label}</Text>
        {item.description && (
          <Text style={[styles.menuDesc, { color: colors.mutedForeground }]}>{item.description}</Text>
        )}
      </View>
      {item.badge ? (
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Text style={styles.badgeText}>{item.badge > 99 ? "99+" : item.badge}</Text>
        </View>
      ) : null}
      {pinned && (
        <Feather name="bookmark" size={14} color={colors.primary} style={{ marginRight: 4 }} />
      )}
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function MoreScreen() {
  const { fetchWithAuth, user, logout } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const { isPinned, addItem, removeItem, hintSeen, dismissHint } = useQuickAccess();

  const [toastMsg, setToastMsg] = useState("");
  const [toastKey, setToastKey] = useState(0);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setToastKey((k) => k + 1);
  }, []);

  const handleLongPress = useCallback(
    (item: MenuItem) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      if (isPinned(item.route)) {
        removeItem(item.route);
        showToast(`"${item.label}" removed from Quick Access`);
      } else {
        const qa: QuickAccessItem = {
          label: item.label,
          icon: item.icon,
          route: item.route,
        };
        addItem(qa);
        showToast(`"${item.label}" added to Quick Access`);
      }
      if (!hintSeen) dismissHint();
    },
    [isPinned, addItem, removeItem, showToast, hintSeen, dismissHint]
  );

  const { data: conversations } = useQuery<{ unreadCount: number }[]>({
    queryKey: ["admin-conversations"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/conversations");
      if (!res.ok) return [];
      return res.json() as Promise<{ unreadCount: number }[]>;
    },
    refetchInterval: 15000,
  });
  const unreadMessages = conversations?.reduce((s, c) => s + (c.unreadCount || 0), 0) ?? 0;

  const { data: emailData } = useQuery<{ count: number }>({
    queryKey: ["admin-emails-unread-count"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/emails/unread-count");
      if (!res.ok) return { count: 0 };
      return res.json() as Promise<{ count: number }>;
    },
    refetchInterval: 30000,
  });
  const unreadEmails = emailData?.count ?? 0;

  const sections: { title: string; items: MenuItem[] }[] = [
    {
      title: "Communication",
      items: [
        { icon: "message-circle", label: "Messages", route: "/(tabs)/more/messages", badge: unreadMessages, description: "Client conversations" },
        { icon: "mail", label: "Inbox", route: "/(tabs)/more/inbox", badge: unreadEmails, description: "Microsoft 365 email" },
      ],
    },
    {
      title: "Intelligence",
      items: [
        { icon: "terminal", label: "Script Runner", route: "/(tabs)/more/script-runner", description: "Run PowerShell runbooks" },
        { icon: "bar-chart-2", label: "Analytics", route: "/(tabs)/more/analytics", description: "Website & engagement metrics" },
        { icon: "trending-up", label: "Revenue Forecast", route: "/(tabs)/more/forecast", description: "12-month projection" },
      ],
    },
    {
      title: "Finance & Contracts",
      items: [
        { icon: "shopping-bag", label: "Purchases", route: "/(tabs)/more/purchases", description: "Service orders" },
        { icon: "file-text", label: "Invoices", route: "/(tabs)/more/invoices", description: "Billing & payments" },
        { icon: "clipboard", label: "Contracts", route: "/(tabs)/more/contracts", description: "Signed agreements" },
      ],
    },
    {
      title: "Audit",
      items: [
        { icon: "activity", label: "Activity Log", route: "/(tabs)/more/activity-log", description: "Admin activity history" },
      ],
    },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.text }]}>More</Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>Hold any item to pin</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {user && (
          <View style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.userAvatar, { backgroundColor: colors.primary + "22" }]}>
              <Text style={[styles.userAvatarText, { color: colors.primary }]}>
                {user.email[0]?.toUpperCase() ?? "A"}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.userEmail, { color: colors.text }]}>{user.email}</Text>
              <Badge label="Admin" variant="default" />
            </View>
            <Pressable onPress={() => void logout()} hitSlop={8}>
              <Feather name="log-out" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}

        {sections.map((section) => (
          <View key={section.title}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
                {section.title.toUpperCase()}
              </Text>
            </View>
            <View style={[styles.sectionGroup, { borderColor: colors.border }]}>
              {section.items.map((item, i) => (
                <View key={item.label}>
                  <MenuRow
                    item={item}
                    colors={colors}
                    pinned={isPinned(item.route)}
                    onLongPress={() => handleLongPress(item)}
                  />
                  {i < section.items.length - 1 && (
                    <View style={[styles.separator, { backgroundColor: colors.border }]} />
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}

        <Pressable
          onPress={async () => {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            await logout();
          }}
          style={({ pressed }) => [
            styles.signOutBtn,
            { backgroundColor: colors.destructive + "14", borderColor: colors.destructive + "44" },
            pressed && { opacity: 0.75 },
          ]}
        >
          <Feather name="log-out" size={16} color={colors.destructive} />
          <Text style={[styles.signOutText, { color: colors.destructive }]}>Sign Out</Text>
        </Pressable>
      </ScrollView>

      <Toast message={toastMsg} toastKey={toastKey} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
  },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1, textAlign: "right" },
  scroll: { paddingTop: 16 },
  userCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 20,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  userAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  userAvatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  userEmail: { fontSize: 14, fontFamily: "Inter_500Medium", marginBottom: 4 },
  sectionHeader: { paddingHorizontal: 20, paddingBottom: 6 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },
  sectionGroup: { marginHorizontal: 16, marginBottom: 20, borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  menuContent: { flex: 1 },
  menuLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  menuDesc: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { color: "#fff", fontSize: 10, fontFamily: "Inter_700Bold" },
  separator: { height: 1, marginLeft: 62 },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  signOutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
