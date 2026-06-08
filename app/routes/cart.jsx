import {useRef, useState} from 'react';
import {Link} from '@remix-run/react';
import {useCart} from '~/context/CartContext';
import {ProductCard} from '~/components/ProductCard';

export const meta = () => [
  {title: 'Cart | BlackCrow Automotive'},
];

/* ─── Static data ────────────────────────────────────────────────────────── */

const FULL_NAMES = {
  crimson: 'BlackCrow Crimson Detailing Towel',
  phantom: 'BlackCrow Phantom Detailing Towel',
  titan:   'BlackCrow Titan Detailing Towel',
  arctic:  'BlackCrow Arctic Detailing Towel',
};

const IMG_RING = {
  crimson: 'ring-2 ring-bc-red ring-offset-2 ring-offset-bc-card',
  phantom: '',
  titan:   '',
  arctic:  'ring-2 ring-bc-arctic ring-offset-2 ring-offset-bc-card',
};

const IMG_BG = {
  crimson: 'bg-bc-mid',
  phantom: 'bg-bc-mid',
  titan:   'bg-bc-mid',
  arctic:  'bg-bc-arctic',
};

const ALL_EXPLORE = [
  {name: 'CRIMSON', price: '$80.00', image: '/images/product-crimson.jpg', to: '/products/crimson', imgBg: 'bg-bc-mid', imgRing: 'ring-2 ring-bc-red ring-offset-2 ring-offset-bc-card'},
  {name: 'PHANTOM', price: '$80.00', image: '/images/product-phantom.jpg', to: '/products/phantom', imgBg: 'bg-bc-mid', imgRing: ''},
  {name: 'TITAN',   price: '$80.00', image: '/images/product-titan.jpg',   to: '/products/titan',   imgBg: 'bg-bc-mid', imgRing: ''},
  {name: 'ARCTIC',  price: '$80.00', image: '/images/product-arctic.jpg',  to: '/products/arctic',  imgBg: 'bg-bc-arctic', imgRing: ''},
];

/* ─── Icons ──────────────────────────────────────────────────────────────── */

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

function ReturnIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-3.07" />
    </svg>
  );
}

/* ─── Cart item row ───────────────────────────────────────────────────────── */

function CartItemRow({item}) {
  const {removeItem, updateQty} = useCart();
  const fullName = FULL_NAMES[item.handle] || item.name;

  return (
    <div className="mb-8">
      <div className="flex gap-5 items-start">
        {/* Product image */}
        <div
          className={[
            'flex-shrink-0 w-[100px] h-[90px] sm:w-[140px] sm:h-[120px] rounded-[16px] overflow-hidden flex items-center justify-center p-3',
            IMG_BG[item.handle] || 'bg-bc-mid',
            IMG_RING[item.handle] || '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <img
            src={item.image}
            alt={fullName}
            className="max-h-full w-auto object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        </div>

        {/* Name + price */}
        <div className="flex-1 min-w-0 flex items-start justify-between pt-1">
          <div className="min-w-0 flex-1">
            <Link
              to={`/products/${item.handle}`}
              className="font-ui text-[0.9rem] text-white underline underline-offset-2 hover:text-bc-secondary transition-colors leading-snug block"
            >
              {fullName}
            </Link>
          </div>
          <span className="font-ui font-bold text-[1rem] text-white ml-3 flex-shrink-0">
            ${item.priceNum * item.qty}
          </span>
        </div>
      </div>

      {/* Qty controls — positioned under image */}
      <div className="mt-3 flex items-center bg-bc-card rounded-pill px-4 py-[9px] gap-3 w-fit">
        <button
          onClick={() => removeItem(item.handle)}
          aria-label="Remove item"
          className="text-white hover:text-bc-red transition-colors duration-150 w-[44px] h-[44px] flex items-center justify-center"
        >
          <TrashIcon />
        </button>
        <button
          onClick={() => updateQty(item.handle, -1)}
          aria-label="Decrease quantity"
          className="font-ui text-[1.1rem] text-white hover:text-bc-secondary transition-colors duration-150 leading-none w-[44px] h-[44px] flex items-center justify-center"
        >
          −
        </button>
        <span className="font-ui font-medium text-[0.9rem] text-white w-4 text-center select-none">
          {item.qty}
        </span>
        <button
          onClick={() => updateQty(item.handle, 1)}
          aria-label="Increase quantity"
          className="font-ui text-[1.1rem] text-white hover:text-bc-secondary transition-colors duration-150 leading-none w-[44px] h-[44px] flex items-center justify-center"
        >
          +
        </button>
      </div>
    </div>
  );
}

/* ─── Promo code accordion ───────────────────────────────────────────────── */

function PromoCode() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');

  return (
    <div className="border-b border-bc-divider pb-4 mb-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between font-ui text-[0.85rem] text-white hover:text-bc-secondary transition-colors"
      >
        <span>Do you have a Promo Code?</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter code"
            className="flex-1 min-w-0 bg-bc-card rounded-pill px-4 py-2 font-ui text-[0.82rem] text-white placeholder:text-bc-secondary outline-none border border-bc-divider focus:border-bc-secondary"
          />
          <button className="btn-explore flex-shrink-0 px-5 py-2 text-[0.78rem]">APPLY</button>
        </div>
      )}
    </div>
  );
}

/* ─── Order summary panel ────────────────────────────────────────────────── */

function SummaryPanel({totalPrice}) {
  const gst = (totalPrice * 0.1).toFixed(2);

  return (
    <div className="bg-bc-card lg:bg-bc-bg border border-bc-divider lg:border-0 rounded-[16px] lg:rounded-none p-5 lg:p-0 lg:sticky lg:top-24">
      <h2 className="font-display text-[1.6rem] sm:text-[2.2rem] text-white tracking-widest mb-6 leading-none">
        SUMMARY
      </h2>

      <PromoCode />

      {/* Subtotal / Shipping */}
      <div className="space-y-3 mb-4">
        <div className="flex justify-between">
          <span className="font-ui text-[0.85rem] text-bc-secondary">Subtotal</span>
          <span className="font-ui text-[0.85rem] text-white">${totalPrice.toFixed(0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-ui text-[0.85rem] text-bc-secondary">Shipping</span>
          <span className="font-ui text-[0.85rem] text-white">Free</span>
        </div>
      </div>

      {/* Total */}
      <div className="border-t border-bc-divider pt-4 mb-1">
        <div className="flex justify-between items-center">
          <span className="font-ui font-bold text-[1rem] text-white">Total</span>
          <span className="font-ui font-bold text-[1rem] text-white">${totalPrice.toFixed(0)}</span>
        </div>
        <p className="font-ui text-[0.72rem] text-bc-secondary mt-1">
          Inclusive of 10% GST
        </p>
      </div>

      {/* Checkout */}
      <button className="btn-primary w-full mt-5 flex items-center justify-center text-[0.95rem]">
        Checkout
      </button>

      {/* PayPal */}
      <button
        className="w-full mt-2 rounded-pill py-[13px] px-6 font-ui font-bold text-[0.85rem] text-white tracking-wide transition-opacity hover:opacity-90"
        style={{backgroundColor: '#2C9C6F'}}
      >
        Paypal Button
      </button>
    </div>
  );
}

/* ─── Explore carousel ───────────────────────────────────────────────────── */

function ExploreCarousel({cartHandles}) {
  const scrollRef = useRef(null);
  const products = ALL_EXPLORE.filter((p) => !cartHandles.includes(p.name.toLowerCase()));

  function scrollLeft() {
    scrollRef.current?.scrollBy({left: -320, behavior: 'smooth'});
  }
  function scrollRight() {
    scrollRef.current?.scrollBy({left: 320, behavior: 'smooth'});
  }

  if (products.length === 0) return null;

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-ui font-bold text-[1.1rem] text-white">
          Explore our other products
        </h2>
        <div className="flex gap-2">
          <button
            onClick={scrollLeft}
            aria-label="Scroll left"
            className="w-9 h-9 rounded-full bg-bc-card flex items-center justify-center text-white hover:bg-bc-mid transition-colors"
          >
            ←
          </button>
          <button
            onClick={scrollRight}
            aria-label="Scroll right"
            className="w-9 h-9 rounded-full bg-bc-card flex items-center justify-center text-white hover:bg-bc-mid transition-colors"
          >
            →
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-3 scroll-smooth"
        style={{scrollbarWidth: 'none', msOverflowStyle: 'none'}}
      >
        {products.map((product) => (
          <div key={product.name} className="flex-shrink-0 w-[75vw] sm:w-[280px]">
            <ProductCard {...product} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */

export default function CartPage() {
  const {items, totalPrice} = useCart();
  const cartHandles = items.map((i) => i.handle);

  return (
    <div className="bg-bc-bg min-h-screen px-4 py-10 sm:px-6 lg:px-14">

      {/* Empty cart */}
      {items.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-5">
          <h1 className="font-display text-[1.5rem] sm:text-[3rem] text-white tracking-widest text-center">YOUR BAG IS EMPTY</h1>
          <Link to="/collections/drying" className="btn-primary">SHOP NOW</Link>
        </div>
      )}

      {/* Cart with items */}
      {items.length > 0 && (
        <>
          {/* Two-column: cart items + summary */}
          <div className="flex flex-col lg:flex-row gap-10 lg:gap-16 items-start">

            {/* Left — cart items */}
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-[1.8rem] sm:text-[2.5rem] text-white tracking-widest mb-8 leading-none">
                CART
              </h1>

              {items.map((item) => (
                <CartItemRow key={item.handle} item={item} />
              ))}

              {/* Separator */}
              <div className="border-t border-bc-divider pt-5 flex items-center gap-3 text-bc-secondary">
                <ReturnIcon />
                <p className="font-ui text-[0.82rem]">
                  Free returns for BlackCrow Members.{' '}
                  <Link to="/about" className="underline hover:text-white transition-colors">
                    Learn More.
                  </Link>
                </p>
              </div>
            </div>

            {/* Right — order summary */}
            <div className="w-full lg:w-[340px] flex-shrink-0">
              <SummaryPanel totalPrice={totalPrice} />
            </div>
          </div>

          {/* Favourites strip */}
          <div className="mt-10 pt-8 border-t border-bc-divider">
            <h2 className="font-ui font-bold text-[1.1rem] text-white mb-2">Favourites</h2>
            <p className="font-ui text-[0.82rem] text-bc-secondary">
              Want to view your favourites?{' '}
              <Link to="/about" className="underline text-white hover:text-bc-secondary transition-colors">
                Join us
              </Link>{' '}
              or{' '}
              <Link to="/about" className="underline text-white hover:text-bc-secondary transition-colors">
                Sign in.
              </Link>
            </p>
          </div>

          {/* Separator before explore */}
          <div className="border-t border-bc-divider mt-8" />
        </>
      )}

      {/* Explore carousel — always visible */}
      <ExploreCarousel cartHandles={cartHandles} />
    </div>
  );
}
