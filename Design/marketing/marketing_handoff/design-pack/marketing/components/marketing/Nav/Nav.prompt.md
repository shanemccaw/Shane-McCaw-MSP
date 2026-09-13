Fixed marketing site header, used at the top of every page. Sticky, translucent, blurred backdrop.

```jsx
<Nav current="monitoring" />
```

Notable: active item gets a 2px accent underline via inset box-shadow, not a border (avoids layout shift). The link row uses `flex-wrap: nowrap` on the outer header so the CTA never gets pushed off — only the inner nav links wrap among themselves on narrow widths.
