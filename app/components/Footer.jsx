import {Link} from '@remix-run/react';

const FOOTER_LINKS = [
  {label: 'Drying', to: '/collections/drying'},
  {label: 'Interior', to: '/collections/interior'},
  {label: 'Exterior', to: '/collections/exterior'},
  {label: 'About', to: '/about'},
  {label: 'Contact', to: '/contact'},
];

function IconInstagram() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function IconTikTok() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.19a8.16 8.16 0 0 0 4.77 1.52V6.27a4.85 4.85 0 0 1-1-.58z" />
    </svg>
  );
}

function IconYouTube() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46a2.78 2.78 0 0 0-1.95 1.96A29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
      <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="bg-bc-bg border-t border-bc-divider">
      <div className="px-6 sm:px-10 lg:px-14 py-10 sm:py-16">
        <div className="flex flex-col md:flex-row justify-between gap-8 md:gap-10">

          {/* Left — logo + tagline */}
          <div className="max-w-[200px]">
            <Link to="/">
              <img
                src="/images/logo-stacked.png"
                alt="BlackCrow Automotive"
                className="h-14 w-auto object-contain object-left mb-4"
              />
            </Link>
            <p className="font-ui text-[0.8rem] text-bc-secondary leading-relaxed">
              Premium detailing essentials engineered for performance.
            </p>
          </div>

          {/* Center — nav links */}
          <div className="flex flex-col gap-3">
            {FOOTER_LINKS.map(({label, to}) => (
              <Link
                key={to}
                to={to}
                className="font-ui text-[0.8rem] text-bc-secondary hover:text-white transition-colors duration-150"
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Right — social icons */}
          <div className="flex flex-row md:flex-col gap-6 md:gap-4">
            <a href="#" aria-label="Instagram" className="text-white hover:text-bc-red transition-colors duration-150">
              <IconInstagram />
            </a>
            <a href="#" aria-label="TikTok" className="text-white hover:text-bc-red transition-colors duration-150">
              <IconTikTok />
            </a>
            <a href="#" aria-label="YouTube" className="text-white hover:text-bc-red transition-colors duration-150">
              <IconYouTube />
            </a>
          </div>

        </div>
      </div>

      {/* Copyright bar */}
      <div className="border-t border-bc-divider py-6 text-center">
        <p className="font-ui text-[0.7rem] text-bc-secondary tracking-[0.08em]">
          © 2026 BLACKCROW AUTOMOTIVE. ALL RIGHTS RESERVED.
        </p>
      </div>
    </footer>
  );
}
