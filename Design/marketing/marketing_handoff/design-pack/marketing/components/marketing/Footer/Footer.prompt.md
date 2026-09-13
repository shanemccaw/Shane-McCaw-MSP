Site-wide footer, mounted once at the bottom of every marketing page.

```jsx
<Footer columns={[{ title: 'Products', links: ['Monitoring', 'Packs'] }]} />
```

Pattern: any page can open the chat panel by dispatching a shared event — the footer is the single owner of that panel's state so pages linking to "contact" don't need their own contact surface.
