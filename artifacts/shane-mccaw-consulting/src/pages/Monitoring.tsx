import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

export default function Monitoring() {
  return (
    <Layout>
      <SEOMeta
        title="M365 Tenant Monitoring | Shane McCaw Consulting"
        description="Continuous Microsoft 365 tenant monitoring to catch configuration drift, security gaps, and licence waste before they become problems."
      />
      <div className="min-h-screen bg-[#0A2540] pt-[130px] pb-16 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-3">M365 Tenant Monitoring</h1>
          <p className="text-white/60">Coming soon — full page in the next release.</p>
        </div>
      </div>
    </Layout>
  );
}
