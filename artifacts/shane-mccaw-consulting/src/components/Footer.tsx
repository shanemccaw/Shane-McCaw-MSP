import React from 'react';
import { Link } from 'wouter';

export function Footer() {
  return (
    <footer className="bg-slate-950 border-t border-slate-800 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-8">
        <div className="col-span-1 md:col-span-2">
          <span className="text-white font-bold text-lg">Shane McCaw Consulting</span>
          <p className="text-slate-400 text-sm mt-2 max-w-sm">
            M365 Governance SaaS platform & specialized architecture consulting. 
            NASA-grade security frameworks for enterprise scale.
          </p>
        </div>
        
        <div>
          <h4 className="text-white font-semibold mb-3 text-sm">Platform</h4>
          <ul className="space-y-2 text-sm text-slate-400">
            <li><Link href="/assessments">Assessments</Link></li>
            <li><Link href="/monitoring">Monitoring</Link></li>
            <li><Link href="/about">About Shane</Link></li>
          </ul>
        </div>

        <div>
          <h4 className="text-white font-semibold mb-3 text-sm">Legal</h4>
          <ul className="space-y-2 text-sm text-slate-400">
            <li><Link href="/terms">Terms of Service</Link></li>
            <li><Link href="/privacy">Privacy Policy</Link></li>
          </ul>
        </div>
      </div>
      <div className="max-w-7xl mx-auto mt-12 pt-8 border-t border-slate-900 text-center text-slate-500 text-xs">
        &copy; {new Date().getFullYear()} Shane McCaw Consulting. All rights reserved.
      </div>
    </footer>
  );
}

// Add the default export to satisfy the runtime import
export default Footer;