import {json} from '@remix-run/node';
import {useLoaderData} from '@remix-run/react';
import {ProductCard} from '~/components/ProductCard';
import {getSupabase} from '~/lib/supabase.server';

export const meta = () => [
  {title: 'Drying Collection | BlackCrow Automotive'},
  {name: 'description', content: 'The full BlackCrow drying collection — CRIMSON, PHANTOM, TITAN, ARCTIC.'},
];

const FALLBACK_PRODUCTS = [
  {name: 'CRIMSON', price: '$80.00', image: '/images/product-crimson.jpg', to: '/products/crimson', imgBg: 'bg-bc-mid',    imgRing: 'ring-2 ring-bc-red ring-offset-2 ring-offset-bc-card'},
  {name: 'PHANTOM', price: '$80.00', image: '/images/product-phantom.jpg', to: '/products/phantom', imgBg: 'bg-bc-mid',    imgRing: ''},
  {name: 'TITAN',   price: '$80.00', image: '/images/product-titan.jpg',   to: '/products/titan',   imgBg: 'bg-bc-mid',    imgRing: ''},
  {name: 'ARCTIC',  price: '$80.00', image: '/images/product-arctic.jpg',  to: '/products/arctic',  imgBg: 'bg-bc-arctic', imgRing: ''},
];

export async function loader() {
  const sb = getSupabase();
  if (!sb) return json({products: FALLBACK_PRODUCTS});

  const {data, error} = await sb
    .from('products')
    .select('name, slug, price, main_image_url, status, display_order')
    .eq('category', 'Drying')
    .in('status', ['active', 'coming_soon'])
    .order('display_order', {ascending: true});

  if (error || !data?.length) return json({products: FALLBACK_PRODUCTS});

  const products = data.map((p) => ({
    name: p.name,
    price: `$${Number(p.price).toFixed(2)}`,
    image: p.main_image_url ?? `/images/product-${p.slug}.jpg`,
    to: `/products/${p.slug}`,
    imgBg: p.slug === 'arctic' ? 'bg-bc-arctic' : 'bg-bc-mid',
    imgRing: p.slug === 'crimson' ? 'ring-2 ring-bc-red ring-offset-2 ring-offset-bc-card' : '',
    comingSoon: p.status === 'coming_soon',
  }));

  return json({products});
}

export default function DryingCollection() {
  const {products} = useLoaderData();

  return (
    <div className="bg-bc-bg min-h-screen px-4 py-8 sm:px-8 lg:px-14 lg:py-12">
      <h1 className="font-display text-[2rem] sm:text-[3.2rem] lg:text-[4rem] text-white text-center tracking-[0.12em] sm:tracking-[0.18em] mb-8 lg:mb-10 leading-none">
        DRYING COLLECTION
      </h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6 max-w-5xl mx-auto">
        {products.map((product) => (
          <ProductCard key={product.name} {...product} />
        ))}
      </div>
    </div>
  );
}
