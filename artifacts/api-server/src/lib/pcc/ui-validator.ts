import { detectDrift, PccDiff } from './drift-detector.js';

export interface UiSurfaceRegistryEntry {
  surfaceId: string;
  surfaceType: 'banner' | 'bubble' | 'chart' | 'nudge' | 'table';
  selector: string;
  triggerConditions: {
    events?: string[];
    stateContext?: Record<string, any>;
  };
  visibilityRules: {
    requiresAuth: boolean;
    allowedRoles?: string[];
    deviceTargets?: string[];
  };
  expectedState: {
    copy?: Record<string, string>;
    styling?: Record<string, string>;
    thresholds?: Record<string, { min?: number; max?: number }>;
  };
}

export class PccUiValidator {
  private registry = new Map<string, UiSurfaceRegistryEntry>([
    [
      'ui-banner-check',
      {
        surfaceId: 'ui-banner-check',
        surfaceType: 'banner',
        selector: '#announcement-banner',
        triggerConditions: { events: ['stripe.card.declined'] },
        visibilityRules: { requiresAuth: true, allowedRoles: ['BillingAdmin'] },
        expectedState: {
          copy: {
            title: 'Welcome to Platform Center',
            actionText: 'Learn More'
          },
          styling: {
            backgroundColor: 'rgb(79, 70, 229)'
          }
        }
      }
    ],
    [
      'ui-onboarding-nudge',
      {
        surfaceId: 'ui-onboarding-nudge',
        surfaceType: 'nudge',
        selector: '.onboarding-nudge-bubble',
        triggerConditions: { events: ['consent.granted'] },
        visibilityRules: { requiresAuth: true },
        expectedState: {
          copy: {
            text: 'Setup complete! Let\'s begin.'
          }
        }
      }
    ],
    [
      'ui-metrics-chart',
      {
        surfaceId: 'ui-metrics-chart',
        surfaceType: 'chart',
        selector: '.kpi-metrics-chart',
        triggerConditions: {},
        visibilityRules: { requiresAuth: true },
        expectedState: {
          thresholds: {
            activeUsers: { min: 0, max: 10000 },
            mrr: { min: 0 }
          }
        }
      }
    ]
  ]);

  public getRegistryEntry(surfaceId: string): UiSurfaceRegistryEntry | undefined {
    return this.registry.get(surfaceId);
  }

  public validate(surfaceId: string, actualUiState: any): { passed: boolean; why?: string; comparison: { expected: any; actual: any; diffs: PccDiff[] } } {
    const entry = this.getRegistryEntry(surfaceId);
    if (!entry) {
      const emptyResult = { expected: {}, actual: {}, diffs: [] };
      return { passed: false, why: `UI Surface ${surfaceId} not registered in Registry`, comparison: emptyResult };
    }

    const expected = entry.expectedState;
    const actual = actualUiState || {};
    const diffs: PccDiff[] = [];

    // 1. Check standard copy & style properties via structural drift detector
    if (expected.copy || expected.styling) {
      const baseExpected = { copy: expected.copy, styling: expected.styling };
      const baseActual = { copy: actual.copy, styling: actual.styling };
      diffs.push(...detectDrift(baseExpected, baseActual));
    }

    // 2. Evaluate numeric thresholds (drift check for charts / tables data boundaries)
    if (expected.thresholds && actual.values) {
      for (const [key, rules] of Object.entries(expected.thresholds)) {
        const value = actual.values[key];
        if (value === undefined) {
          diffs.push({
            op: 'remove',
            path: `/values/${key}`,
            oldValue: rules
          });
          continue;
        }

        if (rules.min !== undefined && value < rules.min) {
          diffs.push({
            op: 'replace',
            path: `/values/${key}`,
            value: value,
            oldValue: `min: ${rules.min}`
          });
        }
        if (rules.max !== undefined && value > rules.max) {
          diffs.push({
            op: 'replace',
            path: `/values/${key}`,
            value: value,
            oldValue: `max: ${rules.max}`
          });
        }
      }
    }

    const passed = diffs.length === 0;
    let why = passed ? undefined : 'UI Surface Assertions Failed';

    if (!passed) {
      const descriptions = diffs.map(d => {
        if (d.op === 'replace') return `Property '${d.path}' value changed from '${d.oldValue}' to '${d.value}'`;
        if (d.op === 'remove') return `Property '${d.path}' is missing (expected '${d.oldValue}')`;
        if (d.op === 'add') return `Extra property '${d.path}' value found: '${d.value}'`;
        return 'Drift detected';
      });
      why = `UI Surface Drift: ${descriptions.join(', ')}`;
    }

    return {
      passed,
      why,
      comparison: {
        expected,
        actual,
        diffs
      }
    };
  }
}
