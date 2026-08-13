import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, Download, CheckCircle, Loader2 } from "lucide-react";

const schema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  company: z.string().min(1, "Required"),
  email: z.string().email("Please enter a valid email"),
});
type FormData = z.infer<typeof schema>;

interface Props {
  serviceName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ServiceOverviewModal({ serviceName, isOpen, onClose }: Props) {
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  if (!isOpen) return null;

  const handleClose = () => {
    reset();
    setSubmitted(false);
    setError("");
    onClose();
  };

  const onSubmit = async (data: FormData) => {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${data.firstName} ${data.lastName}`,
          email: data.email,
          company: data.company,
          serviceArea: serviceName,
          source: "service_overview_download",
          message: `Requested service overview: ${serviceName}`,
        }),
      });
      if (!res.ok) throw new Error("Submit failed");
      setSubmitted(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {submitted ? (
          <div className="text-center py-4">
            <CheckCircle className="w-12 h-12 text-[#0078D4] mx-auto mb-4" />
            <h3 className="text-xl font-bold text-[#0A2540] mb-2">Overview on its way.</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We've received your request for the <strong>{serviceName}</strong> overview.
              Shane personally reviews every request and will follow up within one business day.
            </p>
            <button
              onClick={handleClose}
              className="mt-6 text-[#0078D4] text-sm font-semibold hover:underline"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                <Download className="w-5 h-5 text-[#0078D4]" />
              </div>
              <div>
                <h3 className="font-bold text-[#0A2540] text-lg leading-tight">Download Overview</h3>
                <p className="text-muted-foreground text-sm">{serviceName}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-[#0A2540] mb-1.5">First Name</label>
                  <input
                    {...register("firstName")}
                    placeholder="Jane"
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  />
                  {errors.firstName && (
                    <p className="text-red-500 text-xs mt-1">{errors.firstName.message}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#0A2540] mb-1.5">Last Name</label>
                  <input
                    {...register("lastName")}
                    placeholder="Smith"
                    className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                  />
                  {errors.lastName && (
                    <p className="text-red-500 text-xs mt-1">{errors.lastName.message}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0A2540] mb-1.5">Company</label>
                <input
                  {...register("company")}
                  placeholder="Acme Corp"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
                {errors.company && (
                  <p className="text-red-500 text-xs mt-1">{errors.company.message}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-[#0A2540] mb-1.5">Work Email</label>
                <input
                  {...register("email")}
                  type="email"
                  placeholder="jane@company.com"
                  className="w-full border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                />
                {errors.email && (
                  <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>
                )}
              </div>

              {error && <p className="text-red-500 text-sm">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-[#0078D4] hover:bg-[#006BBE] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" /> Send Me the Overview
                  </>
                )}
              </button>
              <p className="text-xs text-muted-foreground text-center">
                No spam. Shane personally reviews every request.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
