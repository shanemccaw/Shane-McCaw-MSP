-- Manual Migration: Seed mock DLQ items for the active MSP.
-- Target: Postgres database. To be run manually by Shane.

DO $$
DECLARE
  v_msp_id INTEGER;
  v_customer_id_1 INTEGER;
  v_customer_id_2 INTEGER;
BEGIN
  -- 1. Get first available MSP
  SELECT id INTO v_msp_id FROM msps ORDER BY id LIMIT 1;

  IF v_msp_id IS NOT NULL THEN
    -- 2. Try to get or create customers/tenants to associate DLQs with
    SELECT id INTO v_customer_id_1 FROM msp_customers WHERE msp_id = v_msp_id AND tenant_id = 't-contoso' LIMIT 1;
    IF v_customer_id_1 IS NULL THEN
      INSERT INTO msp_customers (msp_id, name, domain, tenant_id, status, owner_type)
      VALUES (v_msp_id, 'Contoso Corporation', 'contoso.com', 't-contoso', 'active', 'customer')
      RETURNING id INTO v_customer_id_1;
    END IF;

    SELECT id INTO v_customer_id_2 FROM msp_customers WHERE msp_id = v_msp_id AND tenant_id = 't-fabrikam' LIMIT 1;
    IF v_customer_id_2 IS NULL THEN
      INSERT INTO msp_customers (msp_id, name, domain, tenant_id, status, owner_type)
      VALUES (v_msp_id, 'Fabrikam Inc', 'fabrikam.com', 't-fabrikam', 'active', 'customer')
      RETURNING id INTO v_customer_id_2;
    END IF;

    -- 3. Clear existing seeded DLQ items if any (by event_type filter to prevent duplicate seeding issues)
    DELETE FROM msp_dlq_store WHERE event_type LIKE 'portal_wf.seed%';

    -- 4. Seed DLQ Message 1 (HTTP_429)
    INSERT INTO msp_dlq_store (
      dlq_id, event_type, payload, error_message, error_stack, attempt_count,
      last_attempt_at, resolved_at, resolution, msp_id, customer_id, created_at
    ) VALUES (
      '57d69280-9b43-4e4f-b677-160a2d5e2191',
      'portal_wf.seed_conditional_access_policies',
      '{
        "runId": "run-seed-1",
        "workflowKey": "wf-identity-audit",
        "inputPayload": {
          "tenantId": "t-contoso",
          "endpoint": "/identity/conditionalAccess/policies",
          "queryParameters": { "$select": "id,displayName,state,conditions" },
          "clientAppId": "app-reg-contoso-01"
        }
      }'::jsonb,
      'Graph API Rate Limited: 429 Too Many Requests. Retry-After header indicates 180 seconds cooldown required.',
      'Microsoft.Graph.ServiceException: Code: 429\nResponse: Too Many Requests\nHeader: Retry-After: 180\nAt Orchestrator.GraphClient.SendAsync(HttpRequestMessage request) in /src/Engine/GraphClient.cs:line 142',
      3,
      NOW() - INTERVAL '5 minutes',
      NULL,
      NULL,
      v_msp_id,
      v_customer_id_1,
      NOW() - INTERVAL '15 minutes'
    );

    -- Seed DLQ Message 2 (HTTP_401)
    INSERT INTO msp_dlq_store (
      dlq_id, event_type, payload, error_message, error_stack, attempt_count,
      last_attempt_at, resolved_at, resolution, msp_id, customer_id, created_at
    ) VALUES (
      '57d69280-9b43-4e4f-b677-160a2d5e2192',
      'portal_wf.seed_revoke_auth_methods',
      '{
        "runId": "run-seed-2",
        "workflowKey": "wf-compromised-user-lockdown",
        "inputPayload": {
          "tenantId": "t-contoso",
          "targetUpn": "alex.wilson@contosobio.com",
          "action": "RevokeSessionsAndMfa",
          "appRegistrationId": "app-reg-contoso-01"
        }
      }'::jsonb,
      'Authorization Request Denied: Client secret for App Registration "MSP-AutoHeal-Worker" expired on 2026-07-20.',
      'Microsoft.Identity.Client.MsalServiceException: AADSTS7000215: Invalid client secret provided.\nTrace ID: e429f012-9912-4211-9981-a90f12110000\nAt Orchestrator.AuthService.AcquireTokenForAppAsync() in /src/Auth/MsalProvider.cs:line 55',
      5,
      NOW() - INTERVAL '10 minutes',
      NULL,
      NULL,
      v_msp_id,
      v_customer_id_1,
      NOW() - INTERVAL '25 minutes'
    );

    -- Seed DLQ Message 3 (HTTP_500)
    INSERT INTO msp_dlq_store (
      dlq_id, event_type, payload, error_message, error_stack, attempt_count,
      last_attempt_at, resolved_at, resolution, msp_id, customer_id, created_at
    ) VALUES (
      '57d69280-9b43-4e4f-b677-160a2d5e2193',
      'portal_wf.seed_defender_telemetry',
      '{
        "runId": "run-seed-3",
        "workflowKey": "wf-defender-psa-sync",
        "inputPayload": {
          "tenantId": "t-fabrikam",
          "filter": "status eq ''active''",
          "top": 50
        }
      }'::jsonb,
      'Microsoft Graph Service Outage: Internal Server Error (500) encountered on endpoint /security/incidents.',
      'Microsoft.Graph.ServiceException: Code: 500\nMessage: InternalServerError - database degradation.\nAt Orchestrator.DefenderAdapter.FetchIncidents() in /src/Adapters/DefenderAdapter.cs:line 210',
      2,
      NOW() - INTERVAL '1 minute',
      NULL,
      NULL,
      v_msp_id,
      v_customer_id_2,
      NOW() - INTERVAL '8 minutes'
    );

    -- Seed DLQ Message 4 (SCHEMA_ERROR)
    INSERT INTO msp_dlq_store (
      dlq_id, event_type, payload, error_message, error_stack, attempt_count,
      last_attempt_at, resolved_at, resolution, msp_id, customer_id, created_at
    ) VALUES (
      '57d69280-9b43-4e4f-b677-160a2d5e2194',
      'portal_wf.seed_intune_baseline',
      '{
        "runId": "run-seed-4",
        "workflowKey": "wf-intune-mdm-remediation",
        "inputPayload": {
          "tenantId": "t-contoso",
          "baselineId": "intune-baseline-sec-09",
          "enforceAutoHeal": true
        }
      }'::jsonb,
      'Response Schema Validation Error: Expected string on property "deviceOwner", received null.',
      'SchemaValidationError: Expected string, received null at data.deviceOwner\nAt Orchestrator.SchemaParser.ValidateResponse(String json) in /src/Engine/SchemaParser.cs:line 301',
      4,
      NOW() - INTERVAL '30 minutes',
      NULL,
      NULL,
      v_msp_id,
      v_customer_id_1,
      NOW() - INTERVAL '40 minutes'
    );
  END IF;
END $$;
