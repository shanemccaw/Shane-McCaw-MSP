import React from 'react';

export function Footer({ columns }) {
  const cols = columns || [
    { title: 'Products', links: ['Product A', 'Product B', 'Product C'] },
    { title: 'Start here', links: ['Free entry point', 'How pricing works'] },
    { title: 'Company', links: ['About', 'Contact'] },
  ];
  return (
    <footer style={{ background: '#020617', borderTop: '1px solid rgba(30,41,59,.9)', padding: '48px 32px 32px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 32, marginBottom: 36 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff' }}>SM</div>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>Brand Name</span>
            </div>
            <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6, maxWidth: 280, margin: 0 }}>One or two sentences of brand description sit here, sized to wrap at ~280px.</p>
          </div>
          {cols.map((c) => (
            <div key={c.title}>
              <h4 style={{ color: '#f8fafc', fontSize: 13, margin: '0 0 14px' }}>{c.title}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {c.links.map((l) => <a key={l} href="#" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>{l}</a>)}
              </div>
            </div>
          ))}
        </div>
        <div style={{ paddingTop: 24, borderTop: '1px solid rgba(30,41,59,.9)', display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#475569', flexWrap: 'wrap', gap: 8 }}>
          <span>© 2026 Brand Name. All rights reserved.</span>
          <span>Category line</span>
        </div>
      </div>
    </footer>
  );
}

export function AskChatFAB({ open, onToggle }) {
  return (
    <button onClick={onToggle} style={{
      position: 'fixed', right: 20, bottom: 20, zIndex: 100, width: 52, height: 52, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(59,130,246,.4)',
      background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)', cursor: 'pointer', boxShadow: '0 8px 22px rgba(59,130,246,.35)',
    }} title="Ask us">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z"></path></svg>
    </button>
  );
}
