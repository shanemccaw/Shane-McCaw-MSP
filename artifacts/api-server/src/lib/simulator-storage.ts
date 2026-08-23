import { AsyncLocalStorage } from "node:async_hooks";

export interface SimulatorContext {
  isTestbed: boolean;
  testbedMspId: number;
  testbedCustomerId?: number;
}

export const simulatorStorage = new AsyncLocalStorage<SimulatorContext>();
