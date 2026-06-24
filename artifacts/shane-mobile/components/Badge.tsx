import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "muted";

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: "sm" | "md";
}

export function Badge({ label, variant = "default", size = "sm" }: BadgeProps) {
  const colors = useColors();

  const bgMap: Record<BadgeVariant, string> = {
    default: colors.primary + "22",
    success: colors.success + "22",
    warning: colors.warning + "22",
    danger: colors.destructive + "22",
    info: colors.teal + "22",
    muted: colors.muted,
  };
  const textMap: Record<BadgeVariant, string> = {
    default: colors.primary,
    success: colors.success,
    warning: colors.warning,
    danger: colors.destructive,
    info: colors.teal,
    muted: colors.mutedForeground,
  };

  return (
    <View style={[styles.badge, { backgroundColor: bgMap[variant] }, size === "md" && styles.badgeMd]}>
      <Text style={[styles.text, { color: textMap[variant] }, size === "md" && styles.textMd]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  badgeMd: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  text: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
  textMd: {
    fontSize: 13,
  },
});
