import React from 'react';

export function GradientButton({ children, size = 'md', withArrow = false, as = 'a', ...rest }) {
  const pad = size === 'lg' ? '13px 26px' : size === 'sm' ? '7px 13px' : '12px 22px';
  const fontSize = size === 'lg' ? 14 : size === 'sm' ? 12 : 13.5;
  const Tag = as;
  return (
    <Tag {...rest} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: pad, borderRadius: 10,
      fontWeight: 700, fontSize, color: '#fff', background: 'linear-gradient(90deg,#3b82f6,#8b5cf6)',
      whiteSpace: 'nowrap', border: 0, cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit',
    }}>
      {children}
      {withArrow && (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="12" x2="20" y2="12"></line><polyline points="14 6 20 12 14 18"></polyline>
        </svg>
      )}
    </Tag>
  );
}

export function OutlineButton({ children, size = 'md', as = 'a', ...rest }) {
  const pad = size === 'lg' ? '13px 26px' : size === 'sm' ? '7px 13px' : '12px 22px';
  const fontSize = size === 'lg' ? 14 : size === 'sm' ? 12 : 13.5;
  const Tag = as;
  return (
    <Tag {...rest} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: pad, borderRadius: 10,
      fontWeight: 600, fontSize, color: '#cbd5e1', border: '1px solid rgba(148,163,184,.2)',
      whiteSpace: 'nowrap', background: 'none', cursor: 'pointer', textDecoration: 'none', fontFamily: 'inherit',
    }}>
      {children}
    </Tag>
  );
}
