import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

export default function Msp() {
  return (
    <Layout>
      <SEOMeta
        title="MSP & Partner Programme | Shane McCaw Consulting"
        description="White-label Microsoft 365 architecture and advisory services for MSPs and IT partners."
      />
      <div className="min-h-screen bg-[#0A2540] pt-[130px] pb-16 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-3">MSP & Partner Programme</h1>
          <p className="text-white/60">Coming soon — full page in the next release.</p>
        </div>
      </div>
    </Layout>
  );
}
