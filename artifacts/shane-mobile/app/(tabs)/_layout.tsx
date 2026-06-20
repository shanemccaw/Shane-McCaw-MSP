import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useQuery } from "@tanstack/react-query";

interface Conversation {
  unreadCount: number;
}

function useUnreadCount() {
  const { fetchWithAuth } = useAuth();
  const { data } = useQuery<Conversation[]>({
    queryKey: ["admin-conversations"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/conversations");
      if (!res.ok) return [];
      return res.json() as Promise<Conversation[]>;
    },
    refetchInterval: 15000,
    staleTime: 5000,
  });
  return data?.reduce((sum, c) => sum + (c.unreadCount || 0), 0) ?? 0;
}

interface UnreadEmailCountResponse {
  count: number;
}

function useUnreadEmailCount() {
  const { fetchWithAuth } = useAuth();
  const { data } = useQuery<UnreadEmailCountResponse>({
    queryKey: ["admin-emails-unread-count"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/emails/unread-count");
      if (!res.ok) return { count: 0 };
      return res.json() as Promise<UnreadEmailCountResponse>;
    },
    refetchInterval: 30000,
    staleTime: 10000,
  });
  return data?.count ?? 0;
}

export default function TabLayout() {
  const colors = useColors();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const unread = useUnreadCount();
  const unreadEmails = useUnreadEmailCount();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint="light"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ),
      }}
    >
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="bag" tintColor={color} size={24} />
            ) : (
              <Feather name="shopping-bag" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: "Messages",
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="message" tintColor={color} size={24} />
            ) : (
              <Feather name="message-circle" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="email"
        options={{
          title: "Email",
          tabBarBadge: unreadEmails > 0 ? unreadEmails : undefined,
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="envelope" tintColor={color} size={24} />
            ) : (
              <Feather name="mail" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}
