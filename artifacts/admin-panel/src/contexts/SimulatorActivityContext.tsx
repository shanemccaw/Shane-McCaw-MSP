import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface SimulatorActivityContextType {
  isBusy: boolean;
  startOperation: (id: string) => void;
  endOperation: (id: string) => void;
  isOperationActive: (id: string) => boolean;
}

const SimulatorActivityContext = createContext<SimulatorActivityContextType | undefined>(undefined);

export function useSimulatorActivity() {
  const ctx = useContext(SimulatorActivityContext);
  if (!ctx) throw new Error("useSimulatorActivity must be used within a SimulatorActivityProvider");
  return ctx;
}

export function SimulatorActivityProvider({ children }: { children: ReactNode }) {
  const [activeOperations, setActiveOperations] = useState<Set<string>>(new Set());

  const startOperation = useCallback((id: string) => {
    setActiveOperations(prev => new Set(prev).add(id));
  }, []);

  const endOperation = useCallback((id: string) => {
    setActiveOperations(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const isOperationActive = useCallback((id: string) => activeOperations.has(id), [activeOperations]);

  return (
    <SimulatorActivityContext.Provider
      value={{ isBusy: activeOperations.size > 0, startOperation, endOperation, isOperationActive }}
    >
      {children}
    </SimulatorActivityContext.Provider>
  );
}