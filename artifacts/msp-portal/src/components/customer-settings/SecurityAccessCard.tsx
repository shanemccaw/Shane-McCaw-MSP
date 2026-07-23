import React, { useState } from 'react';
import { Shield, Lock, CheckCircle, Eye, EyeOff } from 'lucide-react';

interface SecurityAccessCardProps {
  mfaEnabled: boolean;
  onToggleMfa: (enabled: boolean) => void;
  onUpdatePassword: (success: boolean, msg: string) => void;
}

export const SecurityAccessCard: React.FC<SecurityAccessCardProps> = ({
  mfaEnabled,
  onToggleMfa,
  onUpdatePassword,
}) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      onUpdatePassword(false, 'Please enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      onUpdatePassword(false, 'New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      onUpdatePassword(false, 'New password and confirmation do not match.');
      return;
    }

    setIsUpdating(true);
    setTimeout(() => {
      setIsUpdating(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onUpdatePassword(true, 'Password updated successfully.');
    }, 600);
  };

  return (
    <div className="bg-[#1e2020] border border-[#282a2b] rounded-xl p-5 flex flex-col justify-between shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 pb-3 border-b border-[#282a2b]">
          <Shield className="w-4 h-4 text-[#a0c9ff]" />
          <h2 className="font-display font-semibold text-base text-[#f1f3f5]">Security & Access</h2>
        </div>

        {/* MFA Box */}
        <div className="bg-[#141616] border border-[#282a2b] rounded-lg p-3.5 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-medium text-xs text-[#e2e2e2]">Multi-Factor Authentication</h3>
            <p className="text-[11px] text-[#8a919d] mt-0.5">
              Require a code from your mobile device to log in.
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5 text-[11px] font-mono text-[#8a919d]">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  mfaEnabled ? 'bg-[#479ef5]' : 'bg-[#6b7280]'
                }`}
              />
              <span>Status: {mfaEnabled ? 'Enabled' : 'Disabled'}</span>
            </div>

            {/* Toggle Switch */}
            <button
              type="button"
              onClick={() => onToggleMfa(!mfaEnabled)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                mfaEnabled ? 'bg-[#3881e6]' : 'bg-[#333535]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  mfaEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Change Password Section */}
        <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3 mt-1">
          <p className="text-xs text-[#8a919d]">Change Password</p>

          <div className="relative">
            <input
              type={showCurrent ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              className="w-full bg-[#141616] border border-[#282a2b] rounded-md py-2 px-3 text-xs text-[#e2e2e2] placeholder-[#525866] focus:outline-none focus:border-[#479ef5] transition-all"
            />
            <button
              type="button"
              onClick={() => setShowCurrent(!showCurrent)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a919d] hover:text-white"
            >
              {showCurrent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full bg-[#141616] border border-[#282a2b] rounded-md py-2 px-3 text-xs text-[#e2e2e2] placeholder-[#525866] focus:outline-none focus:border-[#479ef5] transition-all"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a919d] hover:text-white"
              >
                {showNew ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>

            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              className="w-full bg-[#141616] border border-[#282a2b] rounded-md py-2 px-3 text-xs text-[#e2e2e2] placeholder-[#525866] focus:outline-none focus:border-[#479ef5] transition-all"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={isUpdating}
              className="bg-[#282a2b] hover:bg-[#333535] active:bg-[#38393a] border border-[#38393a] text-[#e2e2e2] text-xs font-medium py-2 px-4 rounded-md transition-all shadow-xs disabled:opacity-50"
            >
              {isUpdating ? 'Updating...' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
