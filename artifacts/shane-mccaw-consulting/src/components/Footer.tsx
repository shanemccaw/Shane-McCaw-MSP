import React from "react";
import { Link } from "wouter";
import { FaLinkedin } from "react-icons/fa";
import { Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Footer() {
  return (
    <footer className="bg-sidebar text-white py-16">
      <div className="max-w-[1200px] mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
        <div className="md:col-span-2">
          <Link href="/" className="flex items-center gap-2 text-white hover:opacity-90 transition-opacity mb-4">
            <Rocket className="w-6 h-6 text-primary" />
            <span className="font-semibold text-xl">Shane McCaw Consulting</span>
          </Link>
          <p className="text-white/70 max-w-sm mb-6">
            Enterprise Microsoft 365 & AI Authority. Trusted by NASA.
          </p>
          <div className="text-white/70 text-sm space-y-2 mb-6">
            <p>Vero Beach, FL — Serving clients nationwide, remote-first</p>
            <p><a href="mailto:info@shanemccawconsulting.com" className="hover:text-white transition-colors">info@shanemccawconsulting.com</a></p>
          </div>
          <a href="#" className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-primary transition-colors">
            <FaLinkedin className="w-5 h-5" />
          </a>
        </div>
        
        <div>
          <h4 className="font-semibold text-lg mb-4">Quick Links</h4>
          <ul className="space-y-3">
            <li><Link href="/about" className="text-white/70 hover:text-white transition-colors">About</Link></li>
            <li><Link href="/services" className="text-white/70 hover:text-white transition-colors">Services</Link></li>
            <li><Link href="/micro-offers" className="text-white/70 hover:text-white transition-colors">Micro-Offers</Link></li>
            <li><Link href="/pricing" className="text-white/70 hover:text-white transition-colors">Pricing</Link></li>
            <li><Link href="/resources" className="text-white/70 hover:text-white transition-colors">Resources</Link></li>
            <li><Link href="/contact" className="text-white/70 hover:text-white transition-colors">Contact</Link></li>
          </ul>
        </div>
        
        <div>
          <h4 className="font-semibold text-lg mb-4">Newsletter</h4>
          <p className="text-white/70 text-sm mb-4">Get M365 & Copilot tips in your inbox.</p>
          <form className="flex flex-col gap-2" onSubmit={(e) => e.preventDefault()}>
            <input 
              type="email" 
              placeholder="Your email address" 
              className="bg-white/10 border border-white/20 rounded px-4 py-2 text-sm text-white placeholder:text-white/50 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button type="submit" className="bg-primary hover:bg-[#005A9E] text-white">Subscribe</Button>
          </form>
        </div>
      </div>
      
      <div className="max-w-[1200px] mx-auto px-6 mt-16 pt-8 border-t border-white/10 text-center text-white/50 text-sm">
        <p>© 2024 Shane McCaw Consulting. All rights reserved.</p>
      </div>
    </footer>
  );
}
