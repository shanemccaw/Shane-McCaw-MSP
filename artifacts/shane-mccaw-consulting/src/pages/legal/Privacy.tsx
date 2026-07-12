import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

export default function LegalPrivacy() {
  return (
    <Layout>
      <SEOMeta
        title="Privacy Policy | Shane McCaw Consulting"
        description="Privacy policy for Shane McCaw Consulting — how we collect, use, and protect your information."
      />
      <div className="min-h-screen bg-white pt-[130px] pb-16">
        <div className="max-w-2xl mx-auto px-6">
          <h1 className="text-3xl font-bold text-[#0A2540] mb-4">Privacy Policy</h1>
          <p className="text-muted-foreground">Full privacy policy coming soon. For questions, please <a href="/contact" className="text-[#0078D4] hover:underline">contact us</a>.</p>
        </div>
      </div>
    </Layout>
  );
}
