import {json} from '@shopify/remix-oxygen';
import {useLoaderData} from '@remix-run/react';
import {ProductCard} from '~/components/ProductCard';

export const meta = () => [
  {title: 'Interior Collection | BlackCrow Automotive'},
  {name: 'description', content: 'The BlackCrow interior detailing collection.'},
];

const PRODUCTS = [];

export async function loader() {
  return json({products: PRODUCTS});
}

export default function InteriorCollection() {
  const {products} = useLoaderData();

  if (!products.length) {
    return (
      <div className="bg-bc-bg min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="font-display text-[2rem] sm:text-[3.2rem] lg:text-[4rem] text-white tracking-[0.12em] sm:tracking-[0.18em] leading-none">
            INTERIOR COLLECTION
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
        INTERIOR COLLECTION
      </h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 lg:gap-6 max-w-5xl mx-auto">
        {products.map((product) => (
          <ProductCard key={product.name} {...product} />
        ))}
      </div>
    </div>
  );
}
