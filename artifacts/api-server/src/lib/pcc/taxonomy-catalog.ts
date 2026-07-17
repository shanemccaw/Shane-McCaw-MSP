export type PccTaxonomy = 'ConfigDrift' | 'GraphEndpoint' | 'EventInjection' | 'JourneyReplay' | 'UISurface';

export interface PccTest {
  id: string;
  name: string;
  taxonomy: PccTaxonomy;
  description: string;
  isProdSafe: boolean;
  dependencies: string[];
}

export const DEFAULT_TESTS: PccTest[] = [
  {
    id: 'drift-detect-settings',
    name: 'Tenant Settings Drift Check',
    taxonomy: 'ConfigDrift',
    description: 'Compares target tenant environment configuration against the reference baseline.',
    isProdSafe: true,
    dependencies: []
  },
  {
    id: 'graph-user-read',
    name: 'Microsoft Graph User Directory Endpoint Test',
    taxonomy: 'GraphEndpoint',
    description: 'Queries Graph user endpoint and validates schema compliance.',
    isProdSafe: true,
    dependencies: []
  },
  {
    id: 'graph-license-check',
    name: 'Microsoft Graph License Inactivity Check',
    taxonomy: 'GraphEndpoint',
    description: 'Validates that licensing signals are accurately mapped from user sign-in details.',
    isProdSafe: true,
    dependencies: ['graph-user-read']
  },
  {
    id: 'event-stripe-checkout',
    name: 'Stripe Webhook Event Injection',
    taxonomy: 'EventInjection',
    description: 'Simulates a Stripe checkout completion webhook delivery.',
    isProdSafe: false,
    dependencies: []
  },
  {
    id: 'event-consent-grant',
    name: 'Consent Granted Action Injection',
    taxonomy: 'EventInjection',
    description: 'Simulates a user accepting policy terms.',
    isProdSafe: false,
    dependencies: []
  },
  {
    id: 'ui-banner-check',
    name: 'System Alert Banner Visibility Test',
    taxonomy: 'UISurface',
    description: 'Verifies warning banner positioning and copy drift.',
    isProdSafe: true,
    dependencies: []
  },
  {
    id: 'ui-onboarding-nudge',
    name: 'Onboarding User Nudge Bubble Test',
    taxonomy: 'UISurface',
    description: 'Validates the presence and styling of client onboarding prompts.',
    isProdSafe: true,
    dependencies: ['event-consent-grant']
  },
  {
    id: 'journey-90day-replay',
    name: '90-Day Tenant Journey Lifecycle Replay',
    taxonomy: 'JourneyReplay',
    description: 'Replays a sequence of customer lifecycle ticks and asserts state trends.',
    isProdSafe: false,
    dependencies: ['event-stripe-checkout']
  }
];
