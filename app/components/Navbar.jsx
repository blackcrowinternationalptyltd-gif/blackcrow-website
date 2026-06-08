import {useEffect, useRef, useState} from 'react';
import {Link, useLocation} from '@remix-run/react';
import {useCart} from '~/context/CartContext';
import {CartDropdown} from '~/components/CartDropdown';
import {SearchOverlay} from '~/components/SearchOverlay';

const NAV_LINKS = [
  {label: 'DRYING', to: '/collections/drying'},
  {label: 'INTERIOR', to: '/collections/interior'},
  {label: 'EXTERIOR', to: '/collections/exterior'},
  {label: 'ABOUT', to: '/about'},
  {label: 'CONTACT', to: '/contact'},
];

export function Navbar() {
  const location = useLocation();
  const {totalCount, isOpen, setIsOpen} = useCart();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  /* ── Cart: hover open/close + outside-click ──────────────────────────── */
  const cartWrapperRef = useRef(null);
  const closeTimerRef = useRef(null);

  function scheduleClose() {
    closeTimerRef.current = setTimeout(() => setIsOpen(false), 180);
  }
  function cancelClose() {
    clearTimeout(closeTimerRef.current);
  }

  /* Close cart when clicking completely outside the wrapper */
  useEffect(() => {
    function onMouseDown(e) {
      if (
        isOpen &&
        cartWrapperRef.current &&
        !cartWrapperRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isOpen, setIsOpen]);

  /* Close search and mobile menu on route change */
  useEffect(() => {
    setSearchOpen(false);
    setMobileOpen(false);
  }, [location.pathname]);

  /* Prevent body scroll when mobile menu is open */
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-[100] h-16 bg-bc-bg flex items-center overflow-hidden">
        <div className="w-full flex items-center px-8 lg:px-14">

          {/* Left — hamburger (mobile only) + crow icon logo */}
          <div className="flex items-center gap-4 flex-shrink-0">
            {/* Hamburger button — visible only below md */}
            <button
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
              className="md:hidden text-white hover:text-bc-secondary transition-colors duration-150 flex flex-col justify-center gap-[5px] w-6"
            >
              <span className="block w-6 h-[1.5px] bg-current" />
              <span className="block w-6 h-[1.5px] bg-current" />
              <span className="block w-4 h-[1.5px] bg-current" />
            </button>

            <Link to="/" className="flex-shrink-0">
              <img
                src="/images/logo-icon.png"
                alt="BlackCrow"
                width={32}
                height={32}
                className="w-8 h-8 object-contain"
              />
            </Link>
          </div>

          {/* Center — nav links (absolutely centered in header, desktop only) */}
          <nav className="absolute left-1/2 -translate-x-1/2 hidden md:flex items-center gap-9">
            {NAV_LINKS.map(({label, to}) => (
              <Link
                key={to}
                to={to}
                className={[
                  'font-ui font-medium text-[0.85rem] uppercase tracking-[0.1em] transition-colors duration-150',
                  location.pathname === to
                    ? 'text-bc-red'
                    : 'text-white hover:text-bc-secondary',
                ].join(' ')}
              >
                {label}
              </Link>
            ))}
          </nav>

          {/* Right — search + cart */}
          <div className="flex items-center gap-5 ml-auto">

            {/* Search button */}
            <button
              aria-label="Search"
              onClick={() => setSearchOpen((o) => !o)}
              className={[
                'transition-colors duration-150',
                searchOpen ? 'text-bc-red' : 'text-white hover:text-bc-secondary',
              ].join(' ')}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </button>

            {/* Cart — hover previews, click toggles */}
            <div
              ref={cartWrapperRef}
              className="relative"
              onMouseEnter={() => { cancelClose(); setIsOpen(true); }}
              onMouseLeave={scheduleClose}
            >
              <button
                onClick={() => { cancelClose(); setIsOpen((o) => !o); }}
                aria-label="Cart"
                className="relative text-white hover:text-bc-secondary transition-colors duration-150"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <path d="M16 10a4 4 0 0 1-8 0" />
                </svg>
                {/* Badge */}
                {totalCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-bc-red rounded-full text-white font-ui font-bold text-[0.6rem] flex items-center justify-center px-[3px] leading-none">
                    {totalCount}
                  </span>
                )}
              </button>

              {isOpen && <CartDropdown />}
            </div>

          </div>
        </div>
      </header>

      {/* Mobile full-screen nav overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[200] bg-bc-bg flex flex-col md:hidden">
          {/* Mobile menu header row */}
          <div className="h-16 flex items-center justify-between px-8 flex-shrink-0">
            <Link to="/" onClick={() => setMobileOpen(false)} className="flex-shrink-0">
              <img
                src="/images/logo-icon.png"
                alt="BlackCrow"
                width={32}
                height={32}
                className="w-8 h-8 object-contain"
              />
            </Link>
            <button
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="text-white hover:text-bc-secondary transition-colors duration-150"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Nav links — vertically centered in remaining space */}
          <nav className="flex-1 flex flex-col items-center justify-center gap-10">
            {NAV_LINKS.map(({label, to}) => (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={[
                  'font-ui font-medium text-2xl uppercase tracking-[0.15em] transition-colors duration-150',
                  location.pathname === to
                    ? 'text-bc-red'
                    : 'text-white hover:text-bc-secondary',
                ].join(' ')}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      )}

      {/* Search overlay — rendered below fixed header */}
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </>
  );
}
