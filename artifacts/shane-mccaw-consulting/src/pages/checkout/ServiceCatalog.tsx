import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface PublicService {
  id: number;
  name: string;
  description: string | null;
  price: number;
  type: string;
  features?: string[];
}

interface Props {
  email: string;
  preSelectedId?: number | null;
  onSelect: (service: PublicService) => void;
}

function formatPrice(cents: number, type: string): string {
  const dollars = (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 });
  return type === "retainer" ? `${dollars}/mo` : dollars;
}

export function ServiceCatalog({ preSelectedId, onSelect }: Props) {
  const { data, isLoading, isError } = useQuery<PublicService[]>({
    queryKey: ["public-catalog"],
    queryFn: async () => {
      const res = await fetch("/api/portal/onboarding/services");
      if (!res.ok) throw new Error("Failed to load services");
      return res.json() as Promise<PublicService[]>;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Unable to load services. Please refresh and try again.
      </div>
    );
  }

  const services = preSelectedId
    ? data.filter((s) => s.id === preSelectedId)
    : data;

  if (services.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No services available at this time.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-[#0A2540]">Choose a service</h2>
        <p className="text-muted-foreground mt-1">Select the package that fits your needs.</p>
      </div>

      <div className="grid gap-4">
        {services.map((service) => (
          <Card
            key={service.id}
            className="border-border hover:border-primary transition-colors cursor-pointer group"
            onClick={() => onSelect(service)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">{service.name}</CardTitle>
                  {service.description && (
                    <CardDescription className="mt-1">{service.description}</CardDescription>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xl font-bold text-primary">
                    {formatPrice(service.price, service.type)}
                  </div>
                  <Badge variant="outline" className="text-xs capitalize mt-1">
                    {service.type.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
            </CardHeader>

            {service.features && service.features.length > 0 && (
              <CardContent className="pt-0">
                <ul className="space-y-1.5 mt-2">
                  {service.features.slice(0, 4).map((feature, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="size-4 text-primary shrink-0 mt-0.5" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}

            <div className="px-6 pb-4">
              <Button className="w-full group-hover:bg-primary/90" size="sm">
                Select this service <ArrowRight className="ml-2 size-4" />
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
