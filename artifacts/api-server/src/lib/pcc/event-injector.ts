import { PccStreamingServer } from './streaming-server.js';

export interface PccInjectionResult {
  injectionId: string;
  eventType: string;
  payload: Record<string, any>;
  status: 'INJECTED' | 'FAILED';
  timestamp: string;
  why?: string;
}

export class PccEventInjector {
  private streamingServer = PccStreamingServer.getInstance();
  private recordedEvents: PccInjectionResult[] = [];
  private isRecording = false;

  public startRecording() {
    this.isRecording = true;
    this.recordedEvents = [];
  }

  public stopRecording(): PccInjectionResult[] {
    this.isRecording = false;
    return this.recordedEvents;
  }

  public getRecordedEvents(): PccInjectionResult[] {
    return this.recordedEvents;
  }

  public inject(eventType: string, payload: Record<string, any>, options: { isIsolated?: boolean } = {}): PccInjectionResult {
    const injectionId = `inj-${Math.random().toString(36).substring(2, 11)}`;
    const timestamp = new Date().toISOString();
    let status: 'INJECTED' | 'FAILED' = 'INJECTED';
    let why: string | undefined = undefined;

    // Strict schema-based validation rules
    switch (eventType) {
      case 'stripe.checkout.success':
        if (!payload.customerId || typeof payload.amountTotal !== 'number' || !payload.subscriptionId) {
          status = 'FAILED';
          why = 'Missing customerId, subscriptionId or numeric amountTotal';
        }
        break;
      case 'stripe.checkout.failure':
        if (!payload.customerId || !payload.failureReason) {
          status = 'FAILED';
          why = 'Missing customerId or failureReason';
        }
        break;
      case 'stripe.card.declined':
        if (!payload.customerId || !payload.last4 || !payload.declineCode) {
          status = 'FAILED';
          why = 'Missing customerId, last4, or declineCode';
        }
        break;
      case 'consent.granted':
        if (!payload.policyVersion || !Array.isArray(payload.consentTypes)) {
          status = 'FAILED';
          why = 'Missing policyVersion or consentTypes array';
        }
        break;
      case 'quiz.submitted':
        if (!payload.quizId || !payload.responses) {
          status = 'FAILED';
          why = 'Missing quizId or responses object';
        }
        break;
      case 'assessment.completed':
        if (!payload.assessmentId || typeof payload.score !== 'number') {
          status = 'FAILED';
          why = 'Missing assessmentId or numeric score';
        }
        break;
      case 'offer.accepted':
      case 'offer.dismissed':
        if (!payload.offerId) {
          status = 'FAILED';
          why = 'Missing offerId';
        }
        break;
      case 'tenant.onboarded':
        if (!payload.companyName || typeof payload.seatCount !== 'number' || !payload.tier) {
          status = 'FAILED';
          why = 'Missing companyName, seatCount, or tier';
        }
        break;
      case 'admin.action.taken':
        if (!payload.actionName || !payload.targetUserId) {
          status = 'FAILED';
          why = 'Missing actionName or targetUserId';
        }
        break;
      default:
        status = 'FAILED';
        why = `Unregistered event type: '${eventType}'`;
    }

    const result: PccInjectionResult = {
      injectionId,
      eventType,
      payload,
      status,
      timestamp,
      why
    };

    // If recording is enabled, save to timeline log (only save valid events)
    if (this.isRecording && status === 'INJECTED' && !options.isIsolated) {
      this.recordedEvents.push(result);
    }

    // Broadcast injection state to SSE clients
    this.streamingServer.broadcast('event_injected', result);

    return result;
  }
}
