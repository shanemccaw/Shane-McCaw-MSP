import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, Rocket } from "lucide-react";
import { CTAButton } from "./CTAButton";
import { cn } from "@/lib/utils";

export function Header() {
  const [location] = useLocation();
  const isHome = location === "/";
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: "Home", href: "/" },
    { label: "About", href: "/about" },
    { label: "Services", href: "/services" },
    { label: "Micro-Offers", href: "/micro-offers" },
    { label: "Pricing", href: "/pricing" },
    { label: "Resources", href: "/resources" },
    { label: "Contact", href: "/contact" },
  ];

  const headerClasses = cn(
    "fixed top-0 left-0 right-0 z-50 transition-all duration-300",
    isHome && !scrolled ? "bg-transparent py-6" : "bg-sidebar py-4 shadow-sm"
  );

  return (
    <header className={headerClasses}>
      <div className="max-w-[1200px] mx-auto px-6 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 text-white hover:opacity-90 transition-opacity">
          <Rocket className="w-6 h-6 text-primary" />
          <span className="font-semibold text-lg">Shane McCaw Consulting</span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-8">
          <ul className="flex items-center gap-6">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link 
                  href={link.href} 
                  className={cn(
                    "text-sm font-medium text-white/90 hover:text-white transition-colors",
                    location === link.href && "text-primary"
                  )}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <a
            href="/crm/"
            className="text-sm font-semibold px-5 py-2 rounded border border-white/30 text-white/90 hover:text-white hover:border-white/60 transition-colors"
          >
            Client Login
          </a>
          <CTAButton href="/book" className="text-sm px-5 py-2">Book a Call</CTAButton>
        </nav>

        {/* Mobile Nav Toggle */}
        <button 
          className="md:hidden text-white"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>
      </div>

      {/* Mobile Nav Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden absolute top-full left-0 right-0 bg-sidebar border-t border-white/10 p-6 flex flex-col gap-4 shadow-lg">
          <ul className="flex flex-col gap-4">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link 
                  href={link.href} 
                  onClick={() => setMobileMenuOpen(false)}
                  className="block text-white/90 hover:text-white font-medium text-lg"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="pt-4 border-t border-white/10 flex flex-col gap-3">
            <a
              href="/crm/"
              className="w-full text-center font-semibold py-3 px-6 rounded border border-white/30 text-white/90 hover:text-white hover:border-white/60 transition-colors"
              onClick={() => setMobileMenuOpen(false)}
            >
              Client Login
            </a>
            <CTAButton href="/book" className="w-full justify-center">Book a Call</CTAButton>
          </div>
        </div>
      )}
    </header>
  );
}
