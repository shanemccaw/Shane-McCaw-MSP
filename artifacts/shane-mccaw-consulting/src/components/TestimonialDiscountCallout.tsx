import { Tag, Star } from "lucide-react";

interface Props {
  variant?: "banner" | "card";
}

export function TestimonialDiscountCallout({ variant = "card" }: Props) {
  if (variant === "banner") {
    return (
      <div className="bg-amber-50 border-y border-amber-200 py-3 px-6">
        <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center">
          <span className="inline-flex items-center gap-1.5 text-amber-700 font-bold text-sm">
            <Tag className="w-3.5 h-3.5" />
            New client offer
          </span>
          <span className="text-amber-900 text-sm">
            Use code{" "}
            <span className="font-mono font-bold bg-white border border-amber-300 px-2 py-0.5 rounded text-amber-800 tracking-wider">
              TESTIMONIAL
            </span>{" "}
            for <strong>10% off</strong> your first engagement — in exchange for a short written testimonial or case study within 90 days.
          </span>
        </div>
      </div>
    );
  }

  return (
    <section className="bg-amber-50 py-12 px-6 border-y border-amber-100">
      <div className="max-w-[900px] mx-auto">
        <div className="flex flex-col md:flex-row items-center gap-6 md:gap-10">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 border border-amber-200 flex items-center justify-center flex-shrink-0">
            <Star className="w-7 h-7 text-amber-500" />
          </div>
          <div className="flex-1 text-center md:text-left">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">New Client Offer</p>
            <h3 className="text-lg font-extrabold text-[#0A2540] mb-1">
              10% off your first engagement — use code{" "}
              <span className="font-mono bg-white border border-amber-300 px-2 py-0.5 rounded text-amber-800 tracking-wider">
                TESTIMONIAL
              </span>
            </h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Apply code <span className="font-mono font-semibold">TESTIMONIAL</span> at checkout to receive 10% off your first engagement. In exchange, Shane asks for a brief written testimonial or short case study within 90 days of your engagement completing — helping other organizations make a more informed decision.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
