import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="py-24 text-center">
      <p className="text-sm font-semibold text-muted-foreground">404</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-foreground">
        Page not found
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block text-sm font-medium text-foreground underline underline-offset-4"
      >
        Back to MSP Console
      </Link>
    </div>
  );
}
