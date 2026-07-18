import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export interface LogEntry {
  id: string;
  type: "info" | "success" | "error";
  message: string;
  timestamp: string;
  /** Epoch ms, for merge-sorting against other timestamped sources (e.g. the live SSE stream). */
  at: number;
}

interface SimulatorActivityContextType {
  isBusy: boolean;
  startOperation: (id: string) => void;
  endOperation: (id: string) => void;
  isOperationActive: (id: string) => boolean;
  logs: LogEntry[];
  addLog: (type: "info" | "success" | "error", message: string) => void;
  clearLogs: () => void;
}

const SimulatorActivityContext = createContext<SimulatorActivityContextType | undefined>(undefined);

export function useSimulatorActivity() {
  const ctx = useContext(SimulatorActivityContext);
  if (!ctx) throw new Error("useSimulatorActivity must be used within a SimulatorActivityProvider");
  return ctx;
}

export function SimulatorActivityProvider({ children }: { children: ReactNode }) {
  const [activeOperations, setActiveOperations] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: "init",
      type: "info",
      message: "Simulator Studio log terminal initialized. Ready for database & telemetry triggers.",
      timestamp: new Date().toLocaleTimeString(),
      at: Date.now(),
    }
  ]);

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

  const addLog = useCallback((type: "info" | "success" | "error", message: string) => {
    setLogs(prev => [
      ...prev,
      {
        id: Math.random().toString(36).substring(7),
        type,
        message,
        timestamp: new Date().toLocaleTimeString(),
        at: Date.now(),
      }
    ]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  useEffect(() => {
    const handleLogEvent = (e: CustomEvent) => {
      const { type, message } = e.detail;
      addLog(type || "info", message);
    };

    window.addEventListener("simulator-log", handleLogEvent as EventListener);
    return () => {
      window.removeEventListener("simulator-log", handleLogEvent as EventListener);
    };
  }, [addLog]);

  return (
    <SimulatorActivityContext.Provider
      value={{ 
        isBusy: activeOperations.size > 0, 
        startOperation, 
        endOperation, 
        isOperationActive,
        logs,
        addLog,
        clearLogs
      }}
    >
      {children}
    </SimulatorActivityContext.Provider>
  );
}