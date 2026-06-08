import {useState, useEffect, useRef} from 'react';
import {Link} from '@remix-run/react';

const SEARCH_DATA = [
  {name: 'CRIMSON', tag: 'Drying Towel', image: '/images/product-crimson.jpg', to: '/products/crimson'},
  {name: 'PHANTOM', tag: 'Drying Towel', image: '/images/product-phantom.jpg', to: '/products/phantom'},
  {name: 'TITAN',   tag: 'Drying Towel', image: '/images/product-titan.jpg',   to: '/products/titan'},
  {name: 'ARCTIC',  tag: 'Drying Towel', image: '/images/product-arctic.jpg',  to: '/products/arctic'},
];

export function SearchOverlay({onClose}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  /* Auto-focus input */
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /* Close on Escape */
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const results = query.trim()
    ? SEARCH_DATA.filter((p) =>
        p.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : SEARCH_DATA;

  return (
    /* Backdrop — click outside search panel closes */
    <div
      className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Panel */}
      <div className="bg-bc-bg border-b border-bc-divider shadow-2xl">
        {/* Search input row */}
        <div className="px-6 py-5 lg:px-14 flex items-center gap-4">
          <div className="flex-1 flex items-center bg-bc-card rounded-pill px-5 py-[11px] gap-3">
            {/* Search icon */}
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-bc-secondary flex-shrink-0"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>

            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products..."
              className="flex-1 bg-transparent text-white font-ui text-[0.9rem] placeholder:text-bc-secondary outline-none"
            />

            {/* Clear query */}
            {query && (
              <button
                onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                className="text-bc-secondary hover:text-white transition-colors"
                aria-label="Clear search"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          {/* Cancel */}
          <button
            onClick={onClose}
            className="font-ui text-[0.8rem] text-bc-secondary hover:text-white uppercase tracking-[0.1em] transition-colors duration-150 flex-shrink-0"
          >
            Cancel
          </button>
        </div>

        {/* Results */}
        <div className="px-6 pb-8 lg:px-14">
          {results.length === 0 ? (
            <p className="font-ui text-[0.85rem] text-bc-secondary py-4">
              No results for &ldquo;{query}&rdquo;
            </p>
          ) : (
            <>
              <p className="font-ui text-[0.7rem] text-bc-secondary uppercase tracking-[0.12em] mb-4">
                {query.trim() ? `${results.length} result${results.length !== 1 ? 's' : ''}` : 'All products'}
              </p>
              <div className="flex gap-4 flex-wrap">
                {results.map((product) => (
                  <Link
                    key={product.name}
                    to={product.to}
                    onClick={onClose}
                    className="group flex-shrink-0"
                  >
                    <div className="bg-bc-card rounded-[20px] p-4 w-[160px] flex flex-col items-center hover:bg-bc-mid transition-colors duration-150">
                      <div className="w-full aspect-[4/3] bg-bc-mid rounded-[12px] flex items-center justify-center overflow-hidden mb-3">
                        <img
                          src={product.image}
                          alt={product.name}
                          className="max-h-full w-auto object-contain"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                      </div>
                      <p className="font-display text-[1.5rem] text-white leading-none self-start">
                        {product.name}
                      </p>
                      <p className="font-ui text-[0.72rem] text-bc-secondary mt-1 self-start">
                        {product.tag}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
