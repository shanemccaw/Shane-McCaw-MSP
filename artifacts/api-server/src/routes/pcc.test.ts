import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import pccRouter from './pcc.js';
import { PccStateManager } from '../lib/pcc/state-manager.js';
import { PccStreamingServer } from '../lib/pcc/streaming-server.js';

// Setup local test express application mounting only the PCC router
const testApp = express();
testApp.use(express.json());
testApp.use('/api/pcc', pccRouter);

describe('Platform Command Center (PCC) API & Runner Integration Tests', () => {
  const stateManager = PccStateManager.getInstance();
  const streamingServer = PccStreamingServer.getInstance();

  beforeEach(() => {
    stateManager.clearAll();
    stateManager.setEnvironment('test');
    stateManager.setReplayMode('live');
  });

  it('GET /api/pcc/catalog should return the complete taxonomy catalog', async () => {
    const res = await request(testApp)
      .get('/api/pcc/catalog')
      .expect(200);

    expect(res.body).toHaveProperty('tests');
    expect(Array.isArray(res.body.tests)).toBe(true);
    expect(res.body.tests.length).toBeGreaterThan(0);
    expect(res.body.tests[0]).toHaveProperty('taxonomy');
  });

  it('GET /api/pcc/state should return correct default state', async () => {
    const res = await request(testApp)
      .get('/api/pcc/state')
      .expect(200);

    expect(res.body.environment).toBe('test');
    expect(res.body.replayMode).toBe('live');
  });

  it('POST /api/pcc/environment should update target environment gating', async () => {
    await request(testApp)
      .post('/api/pcc/environment')
      .send({ environment: 'prod' })
      .expect(200);

    expect(stateManager.getEnvironment()).toBe('prod');
  });

  it('POST /api/pcc/run should run full test suite with gating on prod', async () => {
    // Set to prod environment
    stateManager.setEnvironment('prod');

    const res = await request(testApp)
      .post('/api/pcc/run')
      .send({})
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.results).toBeDefined();

    // Verify non-prod safe tests are SKIPPED in prod target
    const skipTest = res.body.results.find((r: any) => r.testId === 'event-stripe-checkout');
    expect(skipTest).toBeDefined();
    expect(skipTest.status).toBe('SKIPPED');
  });

  it('POST /api/pcc/inject should perform parameter-aware injection and validate schemas', async () => {
    // Valid Stripe Checkout success
    const validPayload = { customerId: 'cus_testing_123', amountTotal: 2500, subscriptionId: 'sub_123' };
    const resSuccess = await request(testApp)
      .post('/api/pcc/inject')
      .send({ eventType: 'stripe.checkout.success', payload: validPayload })
      .expect(200);

    expect(resSuccess.body.status).toBe('INJECTED');

    // Invalid Stripe Checkout failure missing reason
    const invalidPayload = { customerId: 'cus_testing_123' };
    const resFail = await request(testApp)
      .post('/api/pcc/inject')
      .send({ eventType: 'stripe.checkout.failure', payload: invalidPayload })
      .expect(200);

    expect(resFail.body.status).toBe('FAILED');
    expect(resFail.body.why).toContain('Missing customerId or failureReason');
  });

  it('POST /api/pcc/run should run all tests including non-prod safe when environment is test', async () => {
    stateManager.setEnvironment('test');

    const res = await request(testApp)
      .post('/api/pcc/run')
      .send({})
      .expect(200);

    expect(res.body.success).toBe(true);
    
    // Verify event-stripe-checkout is executed (not skipped) and passes
    const stripeResult = res.body.results.find((r: any) => r.testId === 'event-stripe-checkout');
    expect(stripeResult).toBeDefined();
    expect(stripeResult.status).toBe('PASS');
  });
});
