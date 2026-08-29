// Placeholder index route for the fresh portal scaffolding (#1673). The real
// pages are rebuilt one at a time under #1648-1671, each against a design in
// Design/portal/. Nothing else is routed yet by design.
export default function IndexPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
        Customer Portal
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Scaffolding is in place. Pages are built one at a time under their own issues.
      </p>
    </div>
  );
}
