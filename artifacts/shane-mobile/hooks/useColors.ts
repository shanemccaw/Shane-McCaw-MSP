import colors from "@/constants/colors";

/**
 * Returns the dark palette design tokens — the Command Center is always dark.
 */
export function useColors() {
  return { ...colors.dark, radius: colors.radius };
}
