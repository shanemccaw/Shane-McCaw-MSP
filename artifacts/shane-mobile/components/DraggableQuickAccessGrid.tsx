import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { QuickAccessItem } from "@/contexts/QuickAccessContext";
import { useColors } from "@/hooks/useColors";

interface Props {
  items: QuickAccessItem[];
  onReorder: (items: QuickAccessItem[]) => void;
  onRemove: (route: string) => void;
  onFirstInteraction?: () => void;
}

const ITEM_HEIGHT = 82;
const COLS = 3;
const H_PAD = 16;
const GAP = 10;

// Wiggle animation for edit mode
function useWiggle(active: boolean) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (active) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(anim, { toValue: 1, duration: 80, useNativeDriver: true }),
          Animated.timing(anim, { toValue: -1, duration: 80, useNativeDriver: true }),
          Animated.timing(anim, { toValue: 0, duration: 80, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      anim.setValue(0);
    }
  }, [active, anim]);
  return anim;
}

export function DraggableQuickAccessGrid({ items, onReorder, onRemove, onFirstInteraction }: Props) {
  const colors = useColors();
  const router = useRouter();

  const [editMode, setEditMode] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const wiggleAnim = useWiggle(editMode && dragIndex === null);

  const containerRef = useRef<View>(null);
  // Absolute screen position of the container (populated on layout + on scroll)
  const containerScreen = useRef({ x: 0, y: 0 });

  // Refs for PanResponder (avoids stale closure)
  const dragIndexRef = useRef<number | null>(null);
  const hoverIndexRef = useRef<number | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Ghost position (container-relative)
  const ghostX = useRef(new Animated.Value(0)).current;
  const ghostY = useRef(new Animated.Value(0)).current;
  const ghostScale = useRef(new Animated.Value(1)).current;

  // Item width is computed once from container layout
  const itemWidthRef = useRef(80);

  const measureContainer = useCallback(() => {
    containerRef.current?.measureInWindow((x, y) => {
      containerScreen.current = { x, y };
    });
  }, []);

  const getHoverIndex = useCallback((absX: number, absY: number): number => {
    const { x: cx, y: cy } = containerScreen.current;
    const relX = absX - cx;
    const relY = absY - cy;
    const colWidth = itemWidthRef.current + GAP;
    const col = Math.min(COLS - 1, Math.max(0, Math.floor((relX - H_PAD) / colWidth)));
    const row = Math.max(0, Math.floor(relY / (ITEM_HEIGHT + GAP)));
    return Math.min(itemsRef.current.length - 1, Math.max(0, row * COLS + col));
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => dragIndexRef.current !== null,
      onMoveShouldSetPanResponderCapture: () => dragIndexRef.current !== null,
      onPanResponderMove: (_, gs) => {
        const { x: cx, y: cy } = containerScreen.current;
        const w = itemWidthRef.current;
        // Center the ghost on the finger
        ghostX.setValue(gs.moveX - cx - w / 2);
        ghostY.setValue(gs.moveY - cy - ITEM_HEIGHT / 2);
        const hi = getHoverIndex(gs.moveX, gs.moveY);
        hoverIndexRef.current = hi;
        setHoverIndex(hi);
      },
      onPanResponderRelease: () => {
        const di = dragIndexRef.current;
        const hi = hoverIndexRef.current;
        if (di !== null && hi !== null && di !== hi) {
          const next = [...itemsRef.current];
          const [moved] = next.splice(di, 1);
          // hi is in [0, n-1] (original index space). After splice(di, 1) the array
          // has n-1 items; splice(hi, 0, moved) places the item correctly because
          // - hi < di: positions unchanged, direct insert
          // - hi > di: Array.splice on an n-1 length array with hi ≤ n-1 inserts
          //   after the element that was originally at hi-1 (shifted left by 1)
          //   which is exactly where the visual placeholder appears — no -1 needed.
          next.splice(hi, 0, moved);
          onReorder(next);
        }
        dragIndexRef.current = null;
        hoverIndexRef.current = null;
        setDragIndex(null);
        setHoverIndex(null);
        Animated.spring(ghostScale, { toValue: 1, useNativeDriver: true }).start();
      },
      onPanResponderTerminate: () => {
        dragIndexRef.current = null;
        hoverIndexRef.current = null;
        setDragIndex(null);
        setHoverIndex(null);
        Animated.spring(ghostScale, { toValue: 1, useNativeDriver: true }).start();
      },
    })
  ).current;

  const interactedRef = useRef(false);

  const enterEditMode = useCallback((index: number) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (!interactedRef.current) {
      interactedRef.current = true;
      onFirstInteraction?.();
    }
    setEditMode(true);
    // Start dragging immediately
    dragIndexRef.current = index;
    hoverIndexRef.current = index;
    setDragIndex(index);
    setHoverIndex(index);
    // Re-measure since page might have scrolled
    measureContainer();
    Animated.spring(ghostScale, { toValue: 1.12, useNativeDriver: true }).start();
  }, [ghostScale, measureContainer]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setDragIndex(null);
    setHoverIndex(null);
    dragIndexRef.current = null;
    hoverIndexRef.current = null;
  }, []);

  // Build display rows with placeholder at hover position
  const buildRows = (): (number | "placeholder" | "spacer")[][] => {
    if (dragIndex === null || hoverIndex === null) {
      const rows: number[][] = [];
      for (let i = 0; i < items.length; i += COLS) {
        rows.push(items.slice(i, i + COLS).map((_, j) => i + j));
      }
      return rows;
    }
    const order: (number | "placeholder")[] = items
      .map((_, i) => i)
      .filter((i) => i !== dragIndex) as (number | "placeholder")[];
    // Insert placeholder at hoverIndex directly (same semantics as release handler)
    order.splice(hoverIndex, 0, "placeholder");

    const rows: (number | "placeholder" | "spacer")[][] = [];
    for (let i = 0; i < order.length; i += COLS) {
      const row = order.slice(i, i + COLS) as (number | "placeholder" | "spacer")[];
      while (row.length < COLS) row.push("spacer");
      rows.push(row);
    }
    return rows;
  };

  const displayRows = buildRows();
  const draggingItem = dragIndex !== null ? items[dragIndex] : null;

  return (
    <View>
      <View
        ref={containerRef}
        onLayout={(e) => {
          const { width } = e.nativeEvent.layout;
          itemWidthRef.current = Math.floor((width - H_PAD * 2 - GAP * (COLS - 1)) / COLS);
          measureContainer();
        }}
        style={styles.grid}
        {...panResponder.panHandlers}
      >
        {displayRows.map((row, rowIdx) => (
          <View key={rowIdx} style={styles.row}>
            {row.map((cell, colIdx) => {
              if (cell === "placeholder") {
                return (
                  <View
                    key={`ph-${rowIdx}-${colIdx}`}
                    style={[
                      styles.itemBtn,
                      {
                        backgroundColor: colors.primary + "14",
                        borderColor: colors.primary + "50",
                        borderStyle: "dashed",
                      },
                    ]}
                  />
                );
              }
              if (cell === "spacer") {
                return (
                  <View
                    key={`sp-${rowIdx}-${colIdx}`}
                    style={[styles.itemBtn, { backgroundColor: "transparent", borderWidth: 0 }]}
                  />
                );
              }

              const itemIdx = cell;
              const item = items[itemIdx];
              if (!item) return null;
              const isDragging = itemIdx === dragIndex;

              return (
                <Animated.View
                  key={item.route}
                  style={[
                    styles.itemBtn,
                    {
                      backgroundColor: colors.card,
                      borderColor: isDragging ? colors.primary + "40" : colors.border,
                      opacity: isDragging ? 0.2 : 1,
                      transform: [
                        {
                          rotate: wiggleAnim.interpolate({
                            inputRange: [-1, 0, 1],
                            outputRange: ["-1.5deg", "0deg", "1.5deg"],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  {/* Remove badge (edit mode only, not while dragging) */}
                  {editMode && !isDragging && (
                    <Pressable
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onRemove(item.route);
                        if (items.length <= 1) exitEditMode();
                      }}
                      style={[styles.removeBadge, { backgroundColor: colors.destructive }]}
                      hitSlop={4}
                    >
                      <Feather name="minus" size={10} color="#fff" />
                    </Pressable>
                  )}

                  <Pressable
                    style={styles.itemInner}
                    onPress={() => {
                      if (editMode) return;
                      router.push(item.route as Parameters<typeof router.push>[0]);
                    }}
                    onLongPress={() => enterEditMode(itemIdx)}
                    delayLongPress={300}
                  >
                    <Feather name={item.icon} size={20} color={colors.primary} />
                    <Text style={[styles.itemLabel, { color: colors.text }]}>{item.label}</Text>
                  </Pressable>
                </Animated.View>
              );
            })}
          </View>
        ))}

        {/* Ghost — follows finger in container-relative coords */}
        {draggingItem && (
          <Animated.View
            style={[
              styles.ghost,
              {
                backgroundColor: colors.card,
                borderColor: colors.primary,
                shadowColor: colors.primary,
                width: itemWidthRef.current,
                transform: [
                  { translateX: ghostX },
                  { translateY: ghostY },
                  { scale: ghostScale },
                ],
              },
            ]}
            pointerEvents="none"
          >
            <Feather name={draggingItem.icon} size={22} color={colors.primary} />
            <Text style={[styles.itemLabel, { color: colors.text }]}>{draggingItem.label}</Text>
          </Animated.View>
        )}
      </View>

      {/* Edit mode Done button */}
      {editMode && (
        <Pressable
          onPress={exitEditMode}
          style={[styles.doneBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.doneBtnText, { color: colors.primaryForeground }]}>Done</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { paddingHorizontal: H_PAD, gap: GAP },
  row: { flexDirection: "row", gap: GAP },
  itemBtn: {
    flex: 1,
    height: ITEM_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "visible",
  },
  itemInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 10,
  },
  itemLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  removeBadge: {
    position: "absolute",
    top: -6,
    left: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  ghost: {
    position: "absolute",
    height: ITEM_HEIGHT,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 10,
    borderWidth: 2,
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 16,
    zIndex: 100,
  },
  doneBtn: {
    marginHorizontal: H_PAD,
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  doneBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
