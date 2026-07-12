import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

export default function Assessment() {

  return (
    <Layout>
      <SEOMeta
        title="Free M365 Assessment | Shane McCaw Consulting"
        description="Get a free Microsoft 365 environment assessment from a 30-year Microsoft veteran. Find out where your tenant stands in minutes."
      />
      <div className="min-h-screen bg-[#0A2540] pt-[130px] pb-16 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-3">Free M365 Assessment</h1>
          <p className="text-white/60">Coming soon — full page in the next release.</p>
        </div>
      </div>
    </Layout>
  );
}
