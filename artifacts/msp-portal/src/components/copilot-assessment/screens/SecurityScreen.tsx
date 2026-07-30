import React from 'react';
import { GovernanceState } from '../types';
import { SecurityBlastRadiusReactor } from '../reactor/SecurityBlastRadiusReactor';

interface SecurityScreenProps {
  governance: GovernanceState;
  onUpdateGovernance: (updated: Partial<GovernanceState>) => void;
  onContinue: () => void;
  onHelpClick?: () => void;
  onExitClick?: () => void;
  onNavigate?: (step: string) => void;
}

export const SecurityScreen: React.FC<SecurityScreenProps> = ({
  governance,
  onUpdateGovernance,
  onContinue,
  onHelpClick,
  onExitClick,
  onNavigate
}) => {
  return (
    <SecurityBlastRadiusReactor
      governance={governance}
      onUpdateGovernance={onUpdateGovernance}
      onContinue={onContinue}
      onHelpClick={onHelpClick}
      onExitClick={onExitClick}
      onNavigate={onNavigate}
    />
  );
};
