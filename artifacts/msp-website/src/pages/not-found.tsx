import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
      <div className="text-center space-y-4 px-6">
        <h1 className="text-6xl font-bold tracking-tight">404</h1>
        <p className="text-lg text-muted-foreground">Page not found.</p>
        <Link href="/" className="inline-block text-primary underline underline-offset-4 hover:opacity-80 transition-opacity">
          Go home
        </Link>
      </div>
    </div>
  );
}
