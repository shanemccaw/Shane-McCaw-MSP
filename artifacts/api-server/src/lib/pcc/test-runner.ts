import { DEFAULT_TESTS, PccTest } from './taxonomy-catalog.js';
import { PccStateManager, PccRunResult } from './state-manager.js';
import { PccStreamingServer } from './streaming-server.js';
import { PccGraphValidator } from './graph-validator.js';
import { PccUiValidator } from './ui-validator.js';
import { PccEventInjector } from './event-injector.js';

export class PccTestRunner {
  private stateManager = PccStateManager.getInstance();
  private streamingServer = PccStreamingServer.getInstance();
  private graphValidator = new PccGraphValidator();
  private uiValidator = new PccUiValidator();
  private eventInjector = new PccEventInjector();

  public async runSuite(tags: string[] = []): Promise<PccRunResult[]> {
    const runId = `run-${Math.random().toString(36).substring(2, 11)}`;
    const env = this.stateManager.getEnvironment();
    this.stateManager.startRun(runId);

    const targetTests = tags.length > 0
      ? DEFAULT_TESTS.filter(t => t.tags.some(tag => tags.includes(tag)))
      : DEFAULT_TESTS;

    // Broadcast run starting
    this.streamingServer.broadcast('run_started', {
      runId,
      environment: env,
      totalTests: targetTests.length,
      timestamp: new Date().toISOString()
    });

    const results: PccRunResult[] = [];
    const testStatusMap = new Map<string, 'PASS' | 'FAIL' | 'SKIPPED'>();

    for (const test of targetTests) {
      // 1. Environment Gating
      if (env === 'prod' && !test.isProdSafe) {
        const skipResult: PccRunResult = {
          runId,
          testId: test.id,
          taxonomy: test.taxonomy,
          environment: env,
          status: 'SKIPPED',
          timestamp: new Date().toISOString(),
          durationMs: 0,
          why: `Environment Gating: Destructive or non-prod tests are disabled on environment 'prod'`
        };
        this.stateManager.addTestResult(runId, skipResult);
        results.push(skipResult);
        testStatusMap.set(test.id, 'SKIPPED');
        this.streamingServer.broadcast('test_finished', { runId, testId: test.id, result: skipResult });
        continue;
      }

      // 2. Dependency Checking
      let hasFailedDependency = false;
      for (const depId of test.dependencies) {
        const depStatus = testStatusMap.get(depId);
        if (depStatus === 'FAIL' || depStatus === 'SKIPPED') {
          hasFailedDependency = true;
          break;
        }
      }

      if (hasFailedDependency) {
        const skipResult: PccRunResult = {
          runId,
          testId: test.id,
          taxonomy: test.taxonomy,
          environment: env,
          status: 'SKIPPED',
          timestamp: new Date().toISOString(),
          durationMs: 0,
          why: `Dependency Resolution: Prerequisite test failed or was skipped`
        };
        this.stateManager.addTestResult(runId, skipResult);
        results.push(skipResult);
        testStatusMap.set(test.id, 'SKIPPED');
        this.streamingServer.broadcast('test_finished', { runId, testId: test.id, result: skipResult });
        continue;
      }

      // Broadcast test started
      this.streamingServer.broadcast('test_started', {
        runId,
        testId: test.id,
        taxonomy: test.taxonomy,
        timestamp: new Date().toISOString()
      });

      const startTime = Date.now();

      // Simulate step progress
      this.streamingServer.broadcast('step_progress', {
        runId,
        testId: test.id,
        stepName: 'Init Setup',
        status: 'RUNNING',
        timestamp: new Date().toISOString()
      });

      // Run specific mock logic depending on category
      let status: 'PASS' | 'FAIL' = 'PASS';
      let why = '';
      let comparison: any = undefined;

      try {
        if (test.taxonomy === 'GraphEndpoint') {
          // Provide mock responses to validate
          const mockGraphPayload = test.id === 'graph-user-read'
            ? { id: 'usr-11', displayName: 'Shane McCaw', mail: 'shane@mccaw.org' }
            : { skuId: 'sku-enterprise-pack', skuPartNumber: 'ENTERPRISE_PLAN' };

          const val = this.graphValidator.validate(test.id, mockGraphPayload);
          if (!val.passed) {
            status = 'FAIL';
            why = val.why || 'Graph schema validation failed';
            comparison = { expected: {}, actual: mockGraphPayload, diff: val.diffs };
          }
        } else if (test.taxonomy === 'UISurface') {
          // Provide mock UI states to validate
          const mockUiState = test.id === 'ui-banner-check'
            ? { copy: { title: 'Welcome to Platform Center', actionText: 'Learn More' }, styling: { backgroundColor: 'rgb(79, 70, 229)' } }
            : { copy: { text: 'Setup complete! Let\'s begin.' } };

          const val = this.uiValidator.validate(test.id, mockUiState);
          if (!val.passed) {
            status = 'FAIL';
            why = val.why || 'UI surface layout validation failed';
            comparison = val.comparison;
          }
        } else if (test.taxonomy === 'EventInjection') {
          // Trigger mock event injection
          const injPayload = test.id === 'event-stripe-checkout'
            ? { customerId: 'cus_998', amountTotal: 14900, subscriptionId: 'sub_enterprise_998' }
            : { policyVersion: 'v2026.1', consentTypes: ['marketing', 'analytics'] };
          const inj = this.eventInjector.inject(test.id === 'event-stripe-checkout' ? 'stripe.checkout.success' : 'consent.granted', injPayload);
          if (inj.status === 'FAILED') {
            status = 'FAIL';
            why = 'Event Injection parameters validation failed';
          }
        } else if (test.taxonomy === 'ConfigDrift') {
          // Compare a default mock configurations setup
          const expectedConfig = { activePortalFeatures: ['billing', 'reports', 'mfa'] };
          const actualConfig = { activePortalFeatures: ['billing', 'reports'] }; // missing mfa
          status = 'FAIL';
          why = 'Config Drift: Missing feature flag: mfa';
          comparison = { expected: expectedConfig, actual: actualConfig };
        } else if (test.taxonomy === 'JourneyReplay') {
          // Mock successful tick simulation sequence
          this.stateManager.setReplayProgress(1, 10);
        }
      } catch (err: any) {
        status = 'FAIL';
        why = err.message || 'Execution error';
      }

      const durationMs = Date.now() - startTime;
      const testResult: PccRunResult = {
        runId,
        testId: test.id,
        taxonomy: test.taxonomy,
        environment: env,
        status,
        timestamp: new Date().toISOString(),
        durationMs,
        why: status === 'FAIL' ? why : undefined,
        comparison
      };

      this.stateManager.addTestResult(runId, testResult);
      results.push(testResult);
      testStatusMap.set(test.id, status);

      // Broadcast test finished
      this.streamingServer.broadcast('test_finished', {
        runId,
        testId: test.id,
        result: testResult
      });
    }

    // Broadcast run finished
    const passedCount = results.filter(r => r.status === 'PASS').length;
    const failedCount = results.filter(r => r.status === 'FAIL').length;
    const skippedCount = results.filter(r => r.status === 'SKIPPED').length;

    this.streamingServer.broadcast('run_finished', {
      runId,
      summary: {
        total: results.length,
        passed: passedCount,
        failed: failedCount,
        skipped: skippedCount
      },
      timestamp: new Date().toISOString()
    });

    return results;
  }
}
