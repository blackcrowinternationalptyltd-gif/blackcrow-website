import {Link} from '@remix-run/react';
import {useCart} from '~/context/CartContext';

/* ─── Icons ──────────────────────────────────────────────────────────────── */

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

/* ─── CartDropdown ───────────────────────────────────────────────────────── */

export function CartDropdown() {
  const {items, isOpen, setIsOpen, removeItem, updateQty, totalPrice} = useCart();

  if (!isOpen) return null;

  return (
    <div
      className="absolute top-[calc(100%+12px)] right-0 w-[360px] bg-bc-surface border border-bc-divider rounded-[20px] shadow-2xl z-[200] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-bc-divider">
        <p className="font-display text-[1.5rem] text-white tracking-widest">YOUR BAG</p>
        <button
          onClick={() => setIsOpen(false)}
          aria-label="Close cart"
          className="text-bc-secondary hover:text-white transition-colors duration-150"
        >
          <XIcon />
        </button>
      </div>

      {/* Empty state */}
      {items.length === 0 && (
        <div className="px-5 py-10 text-center">
          <p className="font-ui text-[0.85rem] text-bc-secondary">Your bag is empty.</p>
        </div>
      )}

      {/* Items */}
      {items.length > 0 && (
        <div className="px-5 py-4 flex flex-col gap-4 max-h-[300px] overflow-y-auto">
          {items.map((item) => (
            <div key={item.handle} className="flex items-center gap-3">
              {/* Thumbnail */}
              <div className="w-[60px] h-[60px] rounded-[10px] bg-bc-mid flex-shrink-0 overflow-hidden flex items-center justify-center">
                <img
                  src={item.image}
                  alt={item.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>

              {/* Name + per-item price */}
              <div className="flex-1 min-w-0">
                <p className="font-display text-[1.25rem] text-white leading-none">{item.name}</p>
                <p className="font-ui text-[0.78rem] text-bc-secondary mt-1">
                  ${(item.priceNum * item.qty).toFixed(2)}
                </p>
              </div>

              {/* Qty controls */}
              <div className="flex items-center gap-[6px]">
                <button
                  onClick={() => updateQty(item.handle, -1)}
                  aria-label="Decrease quantity"
                  className="w-6 h-6 rounded-full bg-bc-card text-white text-[1rem] leading-none flex items-center justify-center hover:bg-bc-mid transition-colors duration-150"
                >
                  −
                </button>
                <span className="font-ui text-[0.9rem] text-white w-5 text-center select-none">
                  {item.qty}
                </span>
                <button
                  onClick={() => updateQty(item.handle, 1)}
                  aria-label="Increase quantity"
                  className="w-6 h-6 rounded-full bg-bc-card text-white text-[1rem] leading-none flex items-center justify-center hover:bg-bc-mid transition-colors duration-150"
                >
                  +
                </button>
              </div>

              {/* Remove */}
              <button
                onClick={() => removeItem(item.handle)}
                aria-label="Remove item"
                className="text-bc-secondary hover:text-bc-red transition-colors duration-150 ml-1 flex-shrink-0"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Footer: total + checkout */}
      {items.length > 0 && (
        <div className="px-5 pb-5 pt-4 border-t border-bc-divider">
          <div className="flex items-center justify-between mb-4">
            <span className="font-ui text-[0.8rem] text-bc-secondary uppercase tracking-[0.12em]">
              Total
            </span>
            <span className="font-ui font-bold text-[1rem] text-white">
              ${totalPrice.toFixed(2)}
            </span>
          </div>
          <Link
            to="/cart"
            onClick={() => setIsOpen(false)}
            className="btn-primary w-full flex items-center justify-center"
          >
            CHECKOUT
          </Link>
        </div>
      )}
    </div>
  );
}
