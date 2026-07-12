import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

export default function Terms() {
  return (
    <Layout>
      <SEOMeta
        title="Terms of Service | Shane McCaw Consulting"
        description="Terms of service for Shane McCaw Consulting engagements and use of this website."
      />
      <div className="min-h-screen bg-white pt-[130px] pb-16">
        <div className="max-w-2xl mx-auto px-6">
          <h1 className="text-3xl font-bold text-[#0A2540] mb-4">Terms of Service</h1>
          <p className="text-muted-foreground">Full terms of service coming soon. For questions, please <a href="/contact" className="text-[#0078D4] hover:underline">contact us</a>.</p>
        </div>
      </div>
    </Layout>
  );
}
