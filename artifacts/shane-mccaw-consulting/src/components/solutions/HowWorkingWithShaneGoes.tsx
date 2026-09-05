import { HOW_WORKING_WITH_SHANE_GOES_STEPS } from "@/data/solutionsDeepDive";

/**
 * Shared "How working with Shane goes" four-step section — identical on the
 * Solutions index and every topic deep-dive page (README §7–§8, Git #2961).
 */
export function HowWorkingWithShaneGoes() {
  return (
    <section
      className="border-t border-[rgba(30,41,59,0.8)]"
      style={{ background: "linear-gradient(180deg,#020617,#040b1e 40%,#020617)" }}
    >
      <div className="max-w-[1160px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-[88px]">
        <div className="max-w-[720px] mb-7">
          <div className="flex items-center gap-3">
            <span className="w-[26px] h-px" style={{ background: "linear-gradient(90deg,#00B4D8,rgba(0,180,216,.15))" }} />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#00B4D8]">
              How working with Shane goes
            </span>
          </div>
          <h2 className="text-[24px] sm:text-[34px] leading-[1.14] tracking-[-0.025em] font-extrabold text-[#f8fafc] mt-[14px] mb-3">
            A conversation first. Then Shane reviews the tenant himself.
          </h2>
          <p className="text-[15px] leading-[1.65] text-[#94a3b8]">
            No automated scan runs before you have spoken. The review is a read-only pass Shane runs himself after
            kickoff, focused on what you told him matters.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {HOW_WORKING_WITH_SHANE_GOES_STEPS.map((step, i) => (
            <div
              key={step.title}
              className="relative overflow-hidden rounded-2xl border border-[rgba(30,41,59,0.9)] bg-[rgba(15,23,42,0.6)] p-5 sm:p-[22px]"
            >
              <span
                className="absolute -right-1.5 -bottom-7 text-[104px] font-extrabold leading-none tracking-[-0.05em] pointer-events-none"
                style={{ color: "rgba(0,180,216,.06)" }}
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <span className="font-mono text-[11px] tracking-[0.12em] text-[#00B4D8]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="text-base font-bold tracking-[-0.01em] text-[#f1f5f9] mt-3 mb-2">{step.title}</h3>
              <p className="relative text-[13.5px] leading-[1.6] text-[#94a3b8]">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
