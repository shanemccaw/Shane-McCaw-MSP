import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useQuery } from "@tanstack/react-query";

function useUnreadCount() {
  const { fetchWithAuth } = useAuth();
  const { data } = useQuery<{ unreadCount: number }[]>({
    queryKey: ["admin-conversations"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/conversations");
      if (!res.ok) return [];
      return res.json() as Promise<{ unreadCount: number }[]>;
    },
    refetchInterval: 15000,
    staleTime: 5000,
  });
  return data?.reduce((sum, c) => sum + (c.unreadCount || 0), 0) ?? 0;
}

export default function TabLayout() {
  const colors = useColors();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const unread = useUnreadCount();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.card,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color, size }) => <Feather name="home" size={size ?? 22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: "Clients",
          tabBarIcon: ({ color, size }) => <Feather name="users" size={size ?? 22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pipeline"
        options={{
          title: "Pipeline",
          tabBarIcon: ({ color, size }) => <Feather name="trending-up" size={size ?? 22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="projects"
        options={{
          title: "Projects",
          tabBarIcon: ({ color, size }) => <Feather name="grid" size={size ?? 22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarIcon: ({ color, size }) => <Feather name="menu" size={size ?? 22} color={color} />,
        }}
      />
      <Tabs.Screen name="orders" options={{ href: null }} />
      <Tabs.Screen name="messages" options={{ href: null }} />
      <Tabs.Screen name="email" options={{ href: null }} />
    </Tabs>
  );
}
