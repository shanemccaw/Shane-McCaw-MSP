import { Stack } from "expo-router";
import React from "react";
import { useColors } from "@/hooks/useColors";

export default function MoreLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: "slide_from_right",
      }}
    />
  );
}
