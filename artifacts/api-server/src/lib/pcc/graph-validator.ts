import { detectDrift, PccDiff } from './drift-detector.js';

export interface GraphRegistryEntry {
  endpointId: string;
  endpointUrl: string;
  requiredScopes: string[];
  entityType: string;
  fields: Record<string, { type: string; required: boolean }>;
}

export class PccGraphValidator {
  private registry = new Map<string, GraphRegistryEntry>([
    [
      'graph-user-read',
      {
        endpointId: 'graph-user-read',
        endpointUrl: 'https://graph.microsoft.com/v1.0/users',
        requiredScopes: ['User.Read.All'],
        entityType: 'User',
        fields: {
          id: { type: 'string', required: true },
          displayName: { type: 'string', required: true },
          mail: { type: 'string', required: true }
        }
      }
    ],
    [
      'graph-license-check',
      {
        endpointId: 'graph-license-check',
        endpointUrl: 'https://graph.microsoft.com/v1.0/users/{id}/licenseDetails',
        requiredScopes: ['Organization.Read.All', 'User.Read.All'],
        entityType: 'LicenseDetails',
        fields: {
          skuId: { type: 'string', required: true },
          skuPartNumber: { type: 'string', required: true }
        }
      }
    ]
  ]);

  public getRegistryEntry(endpointId: string): GraphRegistryEntry | undefined {
    return this.registry.get(endpointId);
  }

  public validate(endpointId: string, actualResponse: any): { passed: boolean; why?: string; diffs: PccDiff[] } {
    const entry = this.getRegistryEntry(endpointId);
    if (!entry) {
      return { passed: false, why: `Endpoint ${endpointId} not registered in Graph Registry`, diffs: [] };
    }

    // Build the expected schema template object to compare
    const expectedTemplate: Record<string, any> = {};
    for (const [field, rule] of Object.entries(entry.fields)) {
      if (rule.required) {
        // Just mock a matching primitive type for drift-detector comparison
        expectedTemplate[field] = rule.type === 'number' ? 0 : rule.type === 'boolean' ? false : '';
      }
    }

    // Extract actual fields matching expected structure for comparison
    const sanitizedActual: Record<string, any> = {};
    if (actualResponse && typeof actualResponse === 'object') {
      for (const field of Object.keys(entry.fields)) {
        if (field in actualResponse) {
          sanitizedActual[field] = actualResponse[field];
        }
      }
    }

    const diffs = detectDrift(expectedTemplate, sanitizedActual);
    
    // Check if required fields are missing
    const missingFields = diffs.filter(d => d.op === 'remove');
    if (missingFields.length > 0) {
      return {
        passed: false,
        why: `Schema Drift: Missing required Graph field(s): ${missingFields.map(m => m.path.substring(1)).join(', ')}`,
        diffs
      };
    }

    // Verify types
    for (const [field, rule] of Object.entries(entry.fields)) {
      if (field in actualResponse) {
        const actualType = typeof actualResponse[field];
        if (actualType !== rule.type) {
          return {
            passed: false,
            why: `Schema Drift: Type mutation on field '${field}'. Expected '${rule.type}', got '${actualType}'.`,
            diffs: [
              {
                op: 'replace',
                path: `/${field}`,
                value: actualType,
                oldValue: rule.type
              }
            ]
          };
        }
      }
    }

    return { passed: true, diffs: [] };
  }
}
