import React from 'react';

export function PageGradientSection({ color = '#3b82f6', watermark, padding = '48px 32px 30px', children }) {
  return (
    <section style={{
      position: 'relative', overflow: 'hidden', padding,
      background: `radial-gradient(circle 1100px at 76% -20%, ${color}1C, rgba(2,6,23,0) 62%), radial-gradient(circle 780px at 6% 10%, ${color}0D, rgba(2,6,23,0) 66%)`,
    }}>
      {watermark && (
        <span style={{ position: 'absolute', right: -90, top: -70, opacity: 0.035, pointerEvents: 'none', lineHeight: 0 }}>
          <svg width="520" height="520" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth=".9" strokeLinecap="round" strokeLinejoin="round"
            dangerouslySetInnerHTML={{ __html: watermark }} />
        </span>
      )}
      <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
    </section>
  );
}

export function SeamSection({ tintColor, children, padding = '40px 32px 46px' }) {
  return (
    <section style={{
      padding,
      background: `linear-gradient(180deg, rgba(5,13,30,0) 0%, #050d1e 16%, #050d1e 84%, rgba(5,13,30,0) 100%)${tintColor ? `, radial-gradient(circle 900px at 20% 0%, ${tintColor}0D, rgba(2,6,23,0) 60%)` : ''}`,
    }}>
      {children}
    </section>
  );
}
