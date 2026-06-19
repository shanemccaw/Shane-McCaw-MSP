import React, { ReactNode } from "react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

interface CTAButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  href?: string;
  children: ReactNode;
  className?: string;
}

export function CTAButton({ href, children, className, ...props }: CTAButtonProps) {
  const baseClasses = "inline-flex items-center justify-center bg-primary text-white font-semibold text-base px-6 py-3 rounded hover:bg-[#005A9E] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";
  
  if (href) {
    const isCrossApp = href.startsWith("http://") || href.startsWith("https://") || href.startsWith("/crm");
    if (isCrossApp) {
      return (
        <a href={href} className={cn(baseClasses, className)}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={cn(baseClasses, className)}>
        {children}
      </Link>
    );
  }

  return (
    <button className={cn(baseClasses, className)} {...props}>
      {children}
    </button>
  );
}
