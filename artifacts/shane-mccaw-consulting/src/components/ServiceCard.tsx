import React from "react";
import { Link } from "wouter";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ServiceCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  className?: string;
}

export function ServiceCard({ icon: Icon, title, description, href, className }: ServiceCardProps) {
  return (
    <div className={cn("group bg-white p-8 border border-border rounded-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-lg flex flex-col h-full", className)}>
      <div className="mb-6">
        <Icon className="w-10 h-10 text-primary" />
      </div>
      <h3 className="text-2xl font-bold text-foreground mb-4">{title}</h3>
      <p className="text-muted-foreground leading-relaxed flex-grow mb-6">{description}</p>
      <Link href={href} className="text-primary font-medium hover:underline inline-flex items-center">
        Learn More <span className="ml-1 transition-transform group-hover:translate-x-1">→</span>
      </Link>
    </div>
  );
}
