import { PccStreamingServer } from './streaming-server.js';

export interface PccInjectionResult {
  injectionId: string;
  eventType: string;
  payload: Record<string, any>;
  status: 'INJECTED' | 'FAILED';
  timestamp: string;
}

export class PccEventInjector {
  private streamingServer = PccStreamingServer.getInstance();

  public inject(eventType: string, payload: Record<string, any>): PccInjectionResult {
    const injectionId = `inj-${Math.random().toString(36).substring(2, 11)}`;
    const timestamp = new Date().toISOString();

    // Basic structural validation checks based on eventTypes
    let status: 'INJECTED' | 'FAILED' = 'INJECTED';

    if (eventType === 'stripe.checkout.success') {
      if (!payload.customerId || typeof payload.amountTotal !== 'number') {
        status = 'FAILED';
      }
    } else if (eventType === 'stripe.checkout.failure' || eventType === 'stripe.card.declined') {
      if (!payload.customerId) {
        status = 'FAILED';
      }
    } else if (eventType === 'consent.granted') {
      if (!payload.policyVersion) {
        status = 'FAILED';
      }
    } else if (eventType === 'quiz.submitted') {
      if (!payload.quizId) {
        status = 'FAILED';
      }
    }

    const result: PccInjectionResult = {
      injectionId,
      eventType,
      payload,
      status,
      timestamp
    };

    // Broadcast the injection event
    this.streamingServer.broadcast('event_injected', result);

    return result;
  }
}
