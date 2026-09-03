import { Link } from "wouter";

// Placeholder index route for the fresh portal scaffolding (#1673). The real
// pages are rebuilt one at a time under #1648-1671, each against a design in
// Design/portal/. /support (#2519) is the first real page wired up — linked
// here so it's reachable without knowing the URL by heart.
export default function IndexPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
        Customer Portal
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Scaffolding is in place. Pages are built one at a time under their own issues.
      </p>
      <Link
        href="/support"
        className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
      >
        Go to Support →
      </Link>
    </div>
  );
}
