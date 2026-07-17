import { detectDrift } from './drift-detector.js';

export interface UiSurfaceRegistryEntry {
  surfaceId: string;
  surfaceType: 'banner' | 'bubble' | 'chart' | 'nudge' | 'table';
  selector: string;
  expectedState: {
    copy?: Record<string, string>;
    styling?: Record<string, string>;
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
        expectedState: {
          copy: {
            text: 'Setup complete! Let\'s begin.'
          }
        }
      }
    ]
  ]);

  public getRegistryEntry(surfaceId: string): UiSurfaceRegistryEntry | undefined {
    return this.registry.get(surfaceId);
  }

  public validate(surfaceId: string, actualUiState: any): { passed: boolean; why?: string; comparison: { expected: any; actual: any; diffs: any[] } } {
    const entry = this.getRegistryEntry(surfaceId);
    if (!entry) {
      const emptyResult = { expected: {}, actual: {}, diffs: [] };
      return { passed: false, why: `UI Surface ${surfaceId} not registered in Registry`, comparison: emptyResult };
    }

    const expected = entry.expectedState;
    const actual = actualUiState || {};

    const diffs = detectDrift(expected, actual);
    const passed = diffs.length === 0;

    let why = passed ? undefined : 'UI Content or Styling Drift Detected';
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
