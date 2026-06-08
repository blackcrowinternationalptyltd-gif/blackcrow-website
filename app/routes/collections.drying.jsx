import {json} from '@shopify/remix-oxygen';
import {useLoaderData} from '@remix-run/react';
import {ProductCard} from '~/components/ProductCard';

export const meta = () => [
  {title: 'Drying Collection | BlackCrow Automotive'},
  {name: 'description', content: 'The full BlackCrow drying collection — CRIMSON, PHANTOM, TITAN, ARCTIC.'},
];

const PRODUCTS = [
  {name: 'CRIMSON', price: '$80.00', image: '/images/product-crimson.jpg', to: '/products/crimson', imgBg: 'bg-bc-mid', imgRing: 'ring-2 ring-bc-red ring-offset-2 ring-offset-bc-card'},
  {name: 'PHANTOM', price: '$80.00', image: '/images/product-phantom.jpg', to: '/products/phantom', imgBg: 'bg-bc-mid', imgRing: ''},
  {name: 'TITAN',   price: '$80.00', image: '/images/product-titan.jpg',   to: '/products/titan',   imgBg: 'bg-bc-mid', imgRing: ''},
  {name: 'ARCTIC',  price: '$80.00', image: '/images/product-arctic.jpg',  to: '/products/arctic',  imgBg: 'bg-bc-arctic', imgRing: ''},
];

export async function loader() {
  return json({products: PRODUCTS});
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
