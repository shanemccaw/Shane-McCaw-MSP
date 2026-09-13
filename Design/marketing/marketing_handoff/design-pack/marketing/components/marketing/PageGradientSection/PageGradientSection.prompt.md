Background wrapper for a page's hero, and for the body sections beneath it.

```jsx
<PageGradientSection color="#3b82f6" watermark={PILLAR_GLYPHS.Governance}>
  {/* hero content */}
</PageGradientSection>
<SeamSection tintColor="#3b82f6">{/* body content */}</SeamSection>
```

Rule: max one hard color per page (the accent), everything else fades to the slate-950 canvas. Never a flat color block.
