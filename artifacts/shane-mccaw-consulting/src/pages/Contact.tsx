import { SEOMeta } from "@/components/SEOMeta";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/Layout";
import { CTAButton } from "@/components/CTAButton";
import { MicrosoftBookingsEmbed } from "@/components/MicrosoftBookingsEmbed";
import { Mail, MapPin, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email required"),
  company: z.string().min(1, "Company name is required"),
  companySize: z.string().min(1, "Please select a company size"),
  service: z.string().min(1, "Please select a service area"),
  message: z.string().min(10, "Message must be at least 10 characters"),
  howFound: z.string().min(1, "Please let us know how you found us"),
});

type FormData = z.infer<typeof schema>;

export default function Contact() {
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    let res: Response;
    try {
      res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${data.firstName} ${data.lastName}`,
          email: data.email,
          company: data.company,
          companySize: data.companySize,
          serviceArea: data.service,
          message: data.message,
          source: "contact_form",
          howFound: data.howFound,
        }),
      });
    } catch {
      toast({
        title: "Something went wrong",
        description: "Your message couldn't be sent. Please check your connection and try again, or email info@shanemccaw.com directly.",
        variant: "destructive",
      });
      return;
    }

    if (!res.ok) {
      toast({
        title: "Something went wrong",
        description: "Your message couldn't be sent. Please try again or email info@shanemccaw.com directly.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Message sent!",
      description: "Thanks! Shane will personally respond within 1 business day.",
    });
    reset();
  };

  return (
    <Layout>
      <SEOMeta
        title="Contact Shane McCaw | Microsoft 365 Consultant | Shane McCaw Consulting"
        description="Contact Shane McCaw — NASA's Lead Microsoft 365 Architect. Get expert answers about M365, Copilot AI, SharePoint, and governance. Expect a personal response within 1 business day."
      />
      <section className="bg-[#0A2540] pt-32 pb-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <p className="text-[#0078D4] text-sm font-semibold uppercase tracking-[0.1em] mb-4">Get in Touch</p>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-white leading-tight max-w-3xl">
            Let's Talk Microsoft 365.
          </h1>
          <p className="text-white/70 text-lg mt-6 max-w-xl leading-relaxed">
            Tell me what you're dealing with and I'll give you a straight answer on whether and how I can help.
          </p>
        </div>
      </section>

      <section className="bg-[#F7F9FC] py-20">
        <div className="max-w-[1200px] mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Form */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl border border-border p-8 md:p-10">
                <h2 className="text-2xl font-extrabold text-[#0A2540] mb-8">Send a Message</h2>
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" data-testid="contact-form">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">First Name *</label>
                      <input
                        {...register("firstName")}
                        className="w-full border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                        data-testid="input-first-name"
                      />
                      {errors.firstName && <p className="text-destructive text-xs mt-1">{errors.firstName.message}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Last Name *</label>
                      <input
                        {...register("lastName")}
                        className="w-full border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                        data-testid="input-last-name"
                      />
                      {errors.lastName && <p className="text-destructive text-xs mt-1">{errors.lastName.message}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Email Address *</label>
                      <input
                        type="email"
                        {...register("email")}
                        className="w-full border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                        data-testid="input-email"
                      />
                      {errors.email && <p className="text-destructive text-xs mt-1">{errors.email.message}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Company Name *</label>
                      <input
                        {...register("company")}
                        className="w-full border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4]"
                        data-testid="input-company"
                      />
                      {errors.company && <p className="text-destructive text-xs mt-1">{errors.company.message}</p>}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">Company Size *</label>
                      <select
                        {...register("companySize")}
                        className="w-full border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                        data-testid="select-company-size"
                      >
                        <option value="">Select size...</option>
                        <option value="1-10">1–10 employees</option>
                        <option value="11-50">11–50 employees</option>
                        <option value="51-200">51–200 employees</option>
                        <option value="201-500">201–500 employees</option>
                        <option value="500+">500+ employees</option>
                      </select>
                      {errors.companySize && <p className="text-destructive text-xs mt-1">{errors.companySize.message}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1.5">How did you find me? *</label>
                      <select
                        {...register("howFound")}
                        className="w-full border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                        data-testid="select-how-found"
                      >
                        <option value="">Select...</option>
                        <option value="google">Google Search</option>
                        <option value="linkedin">LinkedIn</option>
                        <option value="referral">Referral</option>
                        <option value="microsoft-community">Microsoft Community</option>
                        <option value="other">Other</option>
                      </select>
                      {errors.howFound && <p className="text-destructive text-xs mt-1">{errors.howFound.message}</p>}
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">What do you need help with? *</label>
                    <select
                      {...register("service")}
                      className="w-full border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-white"
                      data-testid="select-service"
                    >
                      <option value="">Select a service area...</option>
                      <option value="m365">M365 Setup/Optimization</option>
                      <option value="copilot">Copilot AI</option>
                      <option value="sharepoint">SharePoint</option>
                      <option value="power-platform">Power Platform</option>
                      <option value="governance">Governance/Compliance</option>
                      <option value="migration">Cloud Migration</option>
                      <option value="retainer">Retainer/Ongoing Support</option>
                      <option value="not-sure">Not Sure</option>
                    </select>
                    {errors.service && <p className="text-destructive text-xs mt-1">{errors.service.message}</p>}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Message *</label>
                    <textarea
                      {...register("message")}
                      rows={5}
                      placeholder="Tell me about your situation — what's working, what isn't, and what you're hoping to achieve."
                      className="w-full border border-border rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#0078D4] resize-none"
                      data-testid="textarea-message"
                    />
                    {errors.message && <p className="text-destructive text-xs mt-1">{errors.message.message}</p>}
                  </div>

                  <CTAButton
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full justify-center py-3.5"
                    data-testid="button-submit"
                  >
                    {isSubmitting ? "Sending..." : "Send Message"}
                  </CTAButton>
                </form>
              </div>

              {/* Microsoft Bookings Inline Embed */}
              <div className="mt-10" data-testid="bookings-embed-contact">
                <h3 className="text-xl font-bold text-[#0A2540] mb-4">Or Book Directly on My Calendar</h3>
                <MicrosoftBookingsEmbed minHeight={630} />
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-border p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Clock className="w-5 h-5 text-[#0078D4] mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-[#0A2540] mb-1">Personal Response</h4>
                    <p className="text-muted-foreground text-sm">I personally respond to every inquiry within 1 business day.</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-border p-6">
                <div className="flex items-start gap-3 mb-4">
                  <Mail className="w-5 h-5 text-[#0078D4] mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-[#0A2540] mb-1">Direct Email</h4>
                    <a href="mailto:info@shanemccaw.com" className="text-[#0078D4] text-sm hover:underline" data-testid="contact-email">
                      info@shanemccaw.com
                    </a>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-border p-6">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-[#0078D4] mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="font-bold text-[#0A2540] mb-1">Location</h4>
                    <p className="text-muted-foreground text-sm">Based in Vero Beach, FL.</p>
                    <p className="text-muted-foreground text-sm">Serving clients nationwide via remote engagement.</p>
                  </div>
                </div>
              </div>

              <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-xl p-6">
                <h4 className="font-bold text-[#0A2540] mb-2">Prefer a call right now?</h4>
                <p className="text-muted-foreground text-sm mb-4">Book a time directly on Shane's calendar for a free 30-minute discovery call.</p>
                <CTAButton href="/book" className="w-full justify-center text-sm" data-testid="contact-book-link">
                  Book a Free Call
                </CTAButton>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Layout>
  );
}
