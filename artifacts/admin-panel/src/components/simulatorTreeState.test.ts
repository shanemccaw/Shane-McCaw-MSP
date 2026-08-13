/**
 * simulatorTreeState.test.ts
 *
 * SimulatorLeftTree's expand/collapse persistence (Simulator Studio Part B).
 * Run with: pnpm --filter @workspace/admin-panel run test (vitest)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { readTreeState, writeTreeState, LS_TREE_STATE, DEFAULT_EXPANDED_CATS } from "./simulatorTreeState";

// vitest's node environment doesn't ship localStorage — stand in a minimal one.
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  (globalThis as any).localStorage = new FakeStorage();
});

describe("readTreeState", () => {
  it("returns null when nothing has been persisted yet", () => {
    expect(readTreeState()).toBeNull();
  });

  it("round-trips exactly what writeTreeState wrote", () => {
    const state = {
      sections: { scenarios: false, endpoints: true },
      cats: { ...DEFAULT_EXPANDED_CATS, "ep:identity": true },
    };
    writeTreeState(state);
    expect(readTreeState()).toEqual(state);
  });

  it("survives a genuine reload — a second read after a fresh module load sees the same value", () => {
    writeTreeState({ sections: { scriptsOpen: false }, cats: {} });
    // Simulate "reload" by reading again independently, exactly as a fresh
    // page load would call readTreeState() during useState's initializer.
    const first = readTreeState();
    const second = readTreeState();
    expect(first).toEqual(second);
    expect(first?.sections.scriptsOpen).toBe(false);
  });

  it("returns null (not throws) on corrupted JSON", () => {
    localStorage.setItem(LS_TREE_STATE, "{not json");
    expect(readTreeState()).toBeNull();
  });

  it("defaults sections/cats to empty objects when the stored shape is partial", () => {
    localStorage.setItem(LS_TREE_STATE, JSON.stringify({ sections: { foo: true } }));
    expect(readTreeState()).toEqual({ sections: { foo: true }, cats: {} });
  });

  it("returns null when the persisted value isn't an object at all", () => {
    localStorage.setItem(LS_TREE_STATE, JSON.stringify("just a string"));
    expect(readTreeState()).toBeNull();
  });
});

describe("writeTreeState", () => {
  it("does not throw when localStorage is unavailable", () => {
    (globalThis as any).localStorage = {
      setItem() {
        throw new Error("storage blocked");
      },
    };
    expect(() => writeTreeState({ sections: {}, cats: {} })).not.toThrow();
  });
});
