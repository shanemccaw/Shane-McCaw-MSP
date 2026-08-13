import React, { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

interface CTAButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  href?: string;
  children: ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement | HTMLAnchorElement>) => void;
}

export function CTAButton({ href, children, className, onClick, ...props }: CTAButtonProps) {
  const baseClasses = "inline-flex items-center justify-center bg-primary text-white font-semibold text-base px-6 py-3 rounded hover:bg-[#005A9E] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

  if (href) {
    const isCrossApp = href.startsWith("http://") || href.startsWith("https://") || href.startsWith("/portal");
    if (isCrossApp) {
      return (
        <a href={href} className={cn(baseClasses, className)} data-track="cta" onClick={onClick}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={cn(baseClasses, className)} data-track="cta" onClick={onClick}>
        {children}
      </Link>
    );
  }

  return (
    <button className={cn(baseClasses, className)} data-track="cta" onClick={onClick} {...props}>
      {children}
    </button>
  );
}
