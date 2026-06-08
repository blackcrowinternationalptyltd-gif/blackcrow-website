import {json} from '@shopify/remix-oxygen';
import {useLoaderData} from '@remix-run/react';
import {ProductCard} from '~/components/ProductCard';
import {getSupabase} from '~/lib/supabase.server';

export const meta = () => [
  {title: 'Exterior Collection | BlackCrow Automotive'},
  {name: 'description', content: 'The BlackCrow exterior detailing collection.'},
];

export async function loader({context}) {
  const sb = getSupabase(context.env);
  if (!sb) return json({products: []});

  const {data, error} = await sb
    .from('products')
    .select('name, slug, price, main_image_url, status, display_order')
    .eq('category', 'Exterior')
    .in('status', ['active', 'coming_soon'])
    .order('display_order', {ascending: true});

  if (error || !data?.length) return json({products: []});

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

export default function ExteriorCollection() {
  const {products} = useLoaderData();

  if (!products.length) {
    return (
      <div className="bg-bc-bg min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-[2rem] sm:text-[3.2rem] lg:text-[4rem] text-white tracking-[0.12em] sm:tracking-[0.18em] leading-none">
            EXTERIOR COLLECTION
          </h1>
          <p className="font-ui text-bc-secondary mt-6 text-[0.9rem] tracking-[0.08em] uppercase">
            Coming Soon
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-bc-bg min-h-screen px-4 py-8 sm:px-8 lg:px-14 lg:py-12">
      <h1 className="font-display text-[2rem] sm:text-[3.2rem] lg:text-[4rem] text-white text-center tracking-[0.12em] sm:tracking-[0.18em] mb-8 lg:mb-10 leading-none">
        EXTERIOR COLLECTION
      </h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 lg:gap-6 max-w-5xl mx-auto">
        {products.map((product) => (
          <ProductCard key={product.name} {...product} />
        ))}
      </div>
    </div>
  );
}
