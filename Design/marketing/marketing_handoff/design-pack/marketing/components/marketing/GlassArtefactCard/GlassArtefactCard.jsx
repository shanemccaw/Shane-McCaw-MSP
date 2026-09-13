import React from 'react';

export function GlassArtefactCard({ color = '#3b82f6', eyebrow, tag, children }) {
  return (
    <div style={{
      border: `1px solid ${color}38`, borderRadius: 18,
      background: `linear-gradient(160deg, ${color}1A, rgba(11,21,36,.52) 55%, rgba(11,21,36,.34))`,
      backdropFilter: 'blur(3px)',
      boxShadow: `0 0 60px ${color}21, inset 0 1px 0 rgba(148,163,184,.08)`,
      padding: 22,
    }}>
      {(eyebrow || tag) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', color: '#64748b' }}>{eyebrow}</span>
          {tag && <span style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: '#475569' }}>{tag}</span>}
        </div>
      )}
      {children}
    </div>
  );
}
