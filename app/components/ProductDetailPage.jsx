import {useState} from 'react';
import {useCart} from '~/context/CartContext';
import {ProductCard} from '~/components/ProductCard';
import {SpecRow} from '~/components/SpecRow';

/* ─── Product data ───────────────────────────────────────────────────────── */

const PRODUCTS = {
  crimson: {
    handle: 'crimson',
    name: 'CRIMSON',
    heading: 'BLACKCROW CRIMSON',
    description: 'Engineered for one-pass drying and premium detailing performance.',
    price: '$80',
    gallery: [
      {src: '/images/crimson-1.jpg', alt: 'BlackCrow Crimson — product view'},
      {src: '/images/crimson-2.jpg', alt: 'BlackCrow Crimson — angle'},
      {src: '/images/crimson-3.jpg', alt: 'BlackCrow Crimson — lifestyle'},
      {src: '/images/crimson-4.jpg', alt: 'BlackCrow Crimson — detail'},
    ],
  },
  phantom: {
    handle: 'phantom',
    name: 'PHANTOM',
    heading: 'BLACKCROW PHANTOM',
    description: 'Engineered for one-pass drying and premium detailing performance.',
    price: '$80',
    gallery: [
      {src: '/images/phantom-1.jpg', alt: 'BlackCrow Phantom — product view'},
      {src: '/images/phantom-2.jpg', alt: 'BlackCrow Phantom — angle'},
      {src: '/images/phantom-3.jpg', alt: 'BlackCrow Phantom — lifestyle'},
      {src: '/images/phantom-4.jpg', alt: 'BlackCrow Phantom — detail'},
    ],
  },
  titan: {
    handle: 'titan',
    name: 'TITAN',
    heading: 'BLACKCROW TITAN',
    description: 'Engineered for one-pass drying and premium detailing performance.',
    price: '$80',
    gallery: [
      {src: '/images/titan-1.jpg', alt: 'BlackCrow Titan — product view'},
      {src: '/images/titan-2.jpg', alt: 'BlackCrow Titan — angle'},
      {src: '/images/titan-3.jpg', alt: 'BlackCrow Titan — lifestyle'},
      {src: '/images/titan-4.jpg', alt: 'BlackCrow Titan — detail'},
    ],
  },
  arctic: {
    handle: 'arctic',
    name: 'ARCTIC',
    heading: 'BLACKCROW ARCTIC',
    description: 'Engineered for one-pass drying and premium detailing performance.',
    price: '$80',
    gallery: [
      {src: '/images/arctic-1.jpg', alt: 'BlackCrow Arctic — product view'},
      {src: '/images/arctic-2.jpg', alt: 'BlackCrow Arctic — angle'},
      {src: '/images/arctic-3.jpg', alt: 'BlackCrow Arctic — lifestyle'},
      {src: '/images/arctic-4.jpg', alt: 'BlackCrow Arctic — detail'},
    ],
  },
};

/* All 4 products as upsell cards (with imgBg for Arctic blue) */
const ALL_UPSELL = [
  {handle: 'crimson', name: 'CRIMSON', price: '$80.00', image: '/images/product-crimson.jpg', to: '/products/crimson', imgBg: 'bg-bc-mid', imgRing: 'ring-2 ring-bc-red ring-offset-2 ring-offset-bc-card'},
  {handle: 'phantom', name: 'PHANTOM', price: '$80.00', image: '/images/product-phantom.jpg', to: '/products/phantom', imgBg: 'bg-bc-mid', imgRing: ''},
  {handle: 'titan',   name: 'TITAN',   price: '$80.00', image: '/images/product-titan.jpg',   to: '/products/titan',   imgBg: 'bg-bc-mid', imgRing: ''},
  {handle: 'arctic',  name: 'ARCTIC',  price: '$80.00', image: '/images/product-arctic.jpg',  to: '/products/arctic',  imgBg: 'bg-bc-arctic', imgRing: ''},
];

/* ─── Spec icons (monoline SVG) ──────────────────────────────────────────── */

function IconPerformance() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5"  y="30" width="9" height="13" rx="1" />
      <rect x="19" y="22" width="9" height="21" rx="1" />
      <rect x="33" y="14" width="9" height="29" rx="1" />
      <path d="M37.5 2l1.4 4.2 4.4.4-3.3 2.9 1 4.3-3.5-2.2-3.5 2.2 1-4.3-3.3-2.9 4.4-.4z" />
    </svg>
  );
}

function IconAbsorption() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5c0 0-6 6-6 11a6 6 0 0 0 12 0c0-5-6-11-6-11z" />
      <path d="M32 3c0 0-4 4.5-4 8.5a4 4 0 0 0 8 0c0-4-4-8.5-4-8.5z" />
      <path d="M4 30c7-4 14 4 21 0s14-4 21 0" />
      <path d="M4 37c7-4 14 4 21 0s14-4 21 0" />
      <path d="M4 44c7-4 14 4 21 0s14-4 21 0" />
    </svg>
  );
}

function IconMaterial() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="24" cy="24" r="3" />
      <circle cx="10" cy="16" r="3" />
      <circle cx="38" cy="16" r="3" />
      <circle cx="10" cy="32" r="3" />
      <circle cx="38" cy="32" r="3" />
      <circle cx="24" cy="8"  r="3" />
      <circle cx="24" cy="40" r="3" />
      <line x1="13" y1="18" x2="21" y2="22" />
      <line x1="35" y1="18" x2="27" y2="22" />
      <line x1="13" y1="30" x2="21" y2="26" />
      <line x1="35" y1="30" x2="27" y2="26" />
      <line x1="24" y1="11" x2="24" y2="21" />
      <line x1="24" y1="27" x2="24" y2="37" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

const SPECS = [
  {Icon: IconPerformance, label: 'PERFORMANCE', value: 'One-Pass Drying'},
  {Icon: IconAbsorption,  label: 'ABSORPTION',  value: '850 GSM'},
  {Icon: IconMaterial,    label: 'MATERIAL',    value: 'Premium Microfibre'},
];

/* ─── Build product shape from Supabase row ──────────────────────────────── */

function fromSupabase(data) {
  const gallery =
    data.gallery_image_urls?.length
      ? data.gallery_image_urls.map((src, i) => ({
          src,
          alt: `${data.name} — view ${i + 1}`,
        }))
      : [{src: data.main_image_url ?? `/images/product-${data.slug}.jpg`, alt: data.name}];

  return {
    handle: data.slug,
    name: data.name,
    heading: `BLACKCROW ${data.name}`,
    description: data.description ?? 'Premium automotive detailing product.',
    price: `$${Number(data.price).toFixed(0)}`,
    priceNum: Number(data.price),
    mainImage: data.main_image_url ?? `/images/product-${data.slug}.jpg`,
    gallery,
  };
}

/* ─── Main exported component ────────────────────────────────────────────── */

export function ProductDetailPage({handle, productData, upsellProducts}) {
  const product = productData ? fromSupabase(productData) : PRODUCTS[handle];
  const upsell = (upsellProducts ?? ALL_UPSELL).filter((p) => p.handle !== handle);

  return (
    <>
      <ProductSection product={product} />
      <TaglineSection />
      <SpecSection />
      <CompleteCollectionSection products={upsell} />
    </>
  );
}

/* ─── 1. Product hero: gallery + info ────────────────────────────────────── */

function ProductSection({product}) {
  const [active, setActive] = useState(0);
  const {addItem} = useCart();
  const prev = () => setActive((a) => Math.max(0, a - 1));
  const next = () => setActive((a) => Math.min(product.gallery.length - 1, a + 1));

  return (
    <section className="bg-bc-bg px-4 py-10 sm:px-6 lg:px-14">
      {/* Stack vertically on mobile, side-by-side from md up */}
      <div className="flex flex-col md:flex-row gap-4 lg:gap-6 items-start">

        {/* Thumbnail column — hidden on mobile */}
        <div className="hidden sm:flex flex-col gap-2 flex-shrink-0 w-[108px]">
          {product.gallery.map((img, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              aria-label={img.alt}
              className={[
                'rounded-[10px] overflow-hidden border-2 transition-all duration-150 w-full',
                active === i
                  ? 'border-bc-red opacity-100'
                  : 'border-transparent opacity-55 hover:opacity-80',
              ].join(' ')}
            >
              <div className="aspect-[4/3] bg-bc-mid flex items-center justify-center">
                <img
                  src={img.src}
                  alt={img.alt}
                  className="w-full h-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>
            </button>
          ))}
        </div>

        {/* Main image */}
        <div className="flex-1 w-full relative flex items-center justify-center min-h-[260px] sm:min-h-[360px] lg:min-h-[420px]">
          <img
            src={product.gallery[active].src}
            alt={product.gallery[active].alt}
            className="max-h-[320px] sm:max-h-[420px] w-auto object-contain"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />

          {/* Dot indicators — visible only on mobile where thumbnails are hidden */}
          <div className="sm:hidden absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            {product.gallery.map((_, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                aria-label={`Go to image ${i + 1}`}
                className={[
                  'w-2 h-2 rounded-full transition-all',
                  active === i ? 'bg-bc-red scale-125' : 'bg-bc-secondary opacity-60',
                ].join(' ')}
              />
            ))}
          </div>

          {/* Arrow nav — hidden on mobile (dots handle it), shown sm+ */}
          <div className="hidden sm:flex absolute bottom-4 left-1/2 -translate-x-1/2 gap-6">
            <button
              onClick={prev}
              aria-label="Previous image"
              className="text-white text-2xl leading-none hover:text-bc-secondary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              ←
            </button>
            <button
              onClick={next}
              aria-label="Next image"
              className="text-white text-2xl leading-none hover:text-bc-secondary transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              →
            </button>
          </div>
        </div>

        {/* Product info — full width on mobile, fixed width on md+ */}
        <div className="w-full md:flex-shrink-0 md:w-[260px] lg:w-[300px] flex flex-col">
          <h1 className="font-display text-[2rem] sm:text-[2.4rem] lg:text-[3.2rem] leading-none text-white">
            {product.heading}
          </h1>
          <p className="font-ui text-[0.85rem] text-bc-secondary mt-3 leading-relaxed">
            {product.description}
          </p>

          {/* Price / shipping pill */}
          <div className="mt-5 flex flex-wrap items-center bg-bc-card rounded-pill px-5 py-[11px] gap-3 min-w-0">
            <span className="font-ui font-bold text-[1rem] text-white min-w-0">{product.price}</span>
            <span className="w-px h-4 bg-bc-divider flex-shrink-0" />
            <span className="font-ui text-[0.8rem] text-bc-secondary min-w-0">Free Shipping*</span>
          </div>

          {/* Add to Bag */}
          <button
            type="button"
            onClick={() =>
              addItem({
                handle: product.handle,
                name: product.name,
                priceNum: product.priceNum ?? 80,
                image: product.mainImage ?? `/images/product-${product.handle}.jpg`,
              })
            }
            className="btn-primary mt-4 w-full flex items-center justify-center gap-2 min-h-[44px]"
          >
            <span className="underline">Add to Bag</span>
            <IconCart />
          </button>

          {/* Explore Collection — scrolls to Complete the Collection section */}
          <button
            type="button"
            onClick={() =>
              document
                .getElementById('complete-collection')
                ?.scrollIntoView({behavior: 'smooth'})
            }
            className="btn-primary mt-2 w-full flex items-center justify-center min-h-[44px]"
          >
            <span className="underline">Explore Collection</span>
          </button>
        </div>

      </div>
    </section>
  );
}

/* ─── 2. Tagline ─────────────────────────────────────────────────────────── */

function TaglineSection() {
  return (
    <section className="bg-bc-bg px-4 py-8 sm:px-6 lg:px-14">
      <p className="font-ui font-bold text-[1.05rem] uppercase tracking-[0.04em] text-white leading-snug max-w-4xl">
        A combination of ultra-high GSM and surface area supercharges your detailing speed.
      </p>
    </section>
  );
}

/* ─── 3. Spec row ────────────────────────────────────────────────────────── */

function SpecSection() {
  return (
    <section className="bg-bc-bg px-4 pb-12 sm:px-6 lg:px-14">
      <SpecRow specs={SPECS} />
    </section>
  );
}

/* ─── 4. Complete the Collection ─────────────────────────────────────────── */

function CompleteCollectionSection({products}) {
  return (
    <section id="complete-collection" className="bg-bc-bg px-4 py-12 sm:px-6 lg:px-14">
      <h2 className="font-display text-[2rem] sm:text-[2.5rem] lg:text-[3rem] text-white text-center mb-8 leading-none tracking-wide">
        COMPLETE THE COLLECTION
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 max-w-4xl mx-auto">
        {products.map((product) => (
          <ProductCard key={product.handle} {...product} />
        ))}
      </div>
    </section>
  );
}
