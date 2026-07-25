// @ts-nocheck
import React from 'react';
import { SecurityComplianceConsole } from './SecurityComplianceConsole';
import { Tenant } from '../types';

interface SecurityComplianceViewProps {
  tenants: Tenant[];
  selectedTenant?: Tenant | null;
  onSelectTenant?: (tenant: Tenant | null) => void;
  onExecuteWorkflow?: (actionId: string, params: Record<string, any>) => void;
  onShowToast?: (
    type: 'success' | 'info' | 'warning' | 'error',
    title: string,
    description: string
  ) => void;
  onTriggerAction?: (title: string, tenantName: string) => void;
}

export const SecurityComplianceView: React.FC<SecurityComplianceViewProps> = ({
  tenants,
  selectedTenant,
  onSelectTenant,
  onExecuteWorkflow,
  onShowToast,
  onTriggerAction,
}) => {
  return (
    <SecurityComplianceConsole
      tenants={tenants}
      selectedTenant={selectedTenant}
      onSelectTenant={onSelectTenant}
      onExecuteWorkflow={onExecuteWorkflow}
      onShowToast={onShowToast}
      onTriggerAction={onTriggerAction}
    />
  );
};


