import React from 'react';

export function PillarIdentity({ color, icon, label, variant = 'tile', active = false }) {
  if (variant === 'chip') {
    return (
      <span style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', borderRadius: 999,
        fontSize: 11.5, fontWeight: active ? 700 : 600,
        color: active ? '#f8fafc' : '#94a3b8',
        border: active ? `1px solid ${color}73` : '1px solid rgba(30,41,59,.9)',
        background: active ? `${color}1A` : 'transparent',
      }}>
        <Glyph color={active ? color : color} icon={icon} size={13} />
        {label}
      </span>
    );
  }
  return (
    <span style={{
      flex: 'none', width: 22, height: 22, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `${color}1A`, border: `1px solid ${color}33`,
    }}>
      <Glyph color={color} icon={icon} size={13} />
    </span>
  );
}

function Glyph({ color, icon, size }) {
  // icon: raw SVG path/shape children as a string of <path>/<circle> markup for the six pillars,
  // or pass your own via the icon prop from a real icon set (Lucide etc).
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: icon || '<circle cx="12" cy="12" r="8"></circle>' }} />
  );
}

// Reference glyphs actually used for the six pillars — pass as the icon prop.
export const PILLAR_GLYPHS = {
  Governance: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path>',
  Security: '<rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
  Compliance: '<path d="M12 3v18"></path><path d="M5 7h14"></path><path d="M5 7l-2 6h4z"></path><path d="M19 7l2 6h-4z"></path><path d="M8 21h8"></path>',
  Licensing: '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v12"></path><path d="M15 9.5a2.5 2.5 0 0 0-2.5-2h-1a2.5 2.5 0 0 0 0 5h1a2.5 2.5 0 0 1 0 5h-1a2.5 2.5 0 0 1-2.5-2"></path>',
  Adoption: '<path d="M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9.5" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>',
  Health: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>',
};

export const PILLAR_COLORS = {
  Governance: '#3b82f6', Security: '#8b5cf6', Compliance: '#e2e8f0',
  Licensing: '#14b8a6', Adoption: '#f97316', Health: '#22c55e',
};
