import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

// Context that lets any surface (Explorer tree, pages, tabs) publish the
// currently selected entity so the shell's Property Panel can render its
// details — independent of which tab is open in the center workspace.

export interface PropertyEntry {
  label: string;
  value: ReactNode;
  /** Render the value in the mono/live type role (ids, counts, timestamps). */
  mono?: boolean;
}

export interface PropertySelection {
  /** Source of the selection, e.g. "explorer", "tab", "page". */
  source: string;
  title: string;
  subtitle?: string;
  properties: PropertyEntry[];
}

export interface PropertyPanelContextValue {
  selection: PropertySelection | null;
  setSelection: (selection: PropertySelection | null) => void;
}

export const PropertyPanelContext = createContext<PropertyPanelContextValue>({
  selection: null,
  setSelection: () => {},
});

export function PropertyPanelProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<PropertySelection | null>(null);
  const value = useMemo(() => ({ selection, setSelection }), [selection]);
  return (
    <PropertyPanelContext.Provider value={value}>
      {children}
    </PropertyPanelContext.Provider>
  );
}

/** Publish/read the Property Panel selection from anywhere under the shell. */
export function usePropertyPanel(): PropertyPanelContextValue {
  return useContext(PropertyPanelContext);
}

/**
 * An explicit selection (from the Explorer or a page) always wins over the
 * shell's derived fallback (active-tab metadata). Pure so it's unit-testable.
 */
export function resolveShownSelection(
  selection: PropertySelection | null,
  fallback: PropertySelection | null,
): PropertySelection | null {
  return selection ?? fallback;
}
