import React from 'react';

const PILLARS = [
  { label: 'Governance', color: '#3b82f6' },
  { label: 'Security', color: '#8b5cf6' },
  { label: 'Compliance', color: '#e2e8f0' },
  { label: 'Licensing', color: '#14b8a6' },
  { label: 'Adoption', color: '#f97316' },
  { label: 'Health', color: '#22c55e' },
];

export function Nav({ current = 'home', items }) {
  const defs = items || [
    { key: 'monitoring', label: 'Monitoring' },
    { key: 'quickstart', label: 'Quick-Start' },
    { key: 'retainers', label: 'Retainers' },
    { key: 'pricing', label: 'Pricing' },
  ];
  const linkStyle = (on) => ({
    padding: '7px 8px',
    borderRadius: 7,
    fontSize: 12,
    fontWeight: on ? 700 : 600,
    whiteSpace: 'nowrap',
    color: on ? '#f8fafc' : '#94a3b8',
    boxShadow: on ? 'inset 0 -2px 0 0 #60a5fa' : 'none',
    textDecoration: 'none',
  });
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'linear-gradient(90deg, rgba(2,6,23,.92), rgba(0,180,216,.05) 40%, rgba(139,92,246,.08) 70%, rgba(59,130,246,.1) 100%)',
      backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(30,41,59,.9)',
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '9px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'nowrap' }}>
        <a href="#" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, order: 1, textDecoration: 'none' }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 800, color: '#fff' }}>SM</div>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: '#f8fafc' }}>Brand Name</span>
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: '#64748b' }}>Category label</span>
          </div>
        </a>
        <a href="#" style={{ flexShrink: 0, padding: '7px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#fff', background: 'linear-gradient(90deg,#3b82f6,#8b5cf6)', whiteSpace: 'nowrap', order: 3, textDecoration: 'none' }}>Primary CTA</a>
        <nav style={{ display: 'flex', gap: 0, flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0, justifyContent: 'center', alignItems: 'center', rowGap: 4, order: 2 }}>
          <a href="#" style={linkStyle(current === 'home')}>Home</a>
          <span style={{ ...linkStyle(current === 'watch'), display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'default' }}>
            Category dropdown
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </span>
          {defs.map((d) => (
            <a key={d.key} href="#" style={linkStyle(d.key === current)}>{d.label}</a>
          ))}
        </nav>
      </div>
    </header>
  );
}

export const NAV_PILLARS = PILLARS;
