import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";

export default function Projects() {
  return (
    <Layout>
      <SEOMeta
        title="Fixed-Scope Projects | Shane McCaw Consulting"
        description="Defined-outcome Microsoft 365 projects delivered at a fixed price. No scope creep, no surprises."
      />
      <div className="min-h-screen bg-[#0A2540] pt-[130px] pb-16 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-3">Fixed-Scope Projects</h1>
          <p className="text-white/60">Coming soon — full page in the next release.</p>
        </div>
      </div>
    </Layout>
  );
}
