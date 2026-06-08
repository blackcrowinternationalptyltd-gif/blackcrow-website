import {json} from '@shopify/remix-oxygen';
import {useLoaderData} from '@remix-run/react';
import {ProductDetailPage} from '~/components/ProductDetailPage';

// Static product data — Shopify Storefront API integration can be added here
const PRODUCTS = {
  crimson: {name: 'CRIMSON', price: 80.00, status: 'active'},
  phantom: {name: 'PHANTOM', price: 80.00, status: 'active'},
  titan:   {name: 'TITAN',   price: 80.00, status: 'active'},
  arctic:  {name: 'ARCTIC',  price: 80.00, status: 'active'},
};

const UPSELL = [
  {handle: 'crimson', name: 'CRIMSON', price: '$80.00', image: '/images/product-crimson.jpg', to: '/products/crimson', imgBg: 'bg-bc-mid', imgRing: 'ring-2 ring-bc-red ring-offset-2 ring-offset-bc-card'},
  {handle: 'phantom', name: 'PHANTOM', price: '$80.00', image: '/images/product-phantom.jpg', to: '/products/phantom', imgBg: 'bg-bc-mid', imgRing: ''},
  {handle: 'titan',   name: 'TITAN',   price: '$80.00', image: '/images/product-titan.jpg',   to: '/products/titan',   imgBg: 'bg-bc-mid', imgRing: ''},
  {handle: 'arctic',  name: 'ARCTIC',  price: '$80.00', image: '/images/product-arctic.jpg',  to: '/products/arctic',  imgBg: 'bg-bc-arctic', imgRing: ''},
];

export async function loader({params}) {
  const {handle} = params;
  const product = PRODUCTS[handle] ?? null;
  const upsellProducts = UPSELL.filter(p => p.handle !== handle);
  return json({product, handle, upsellProducts});
}

export const meta = ({data}) => [
  {title: `${data?.product?.name ?? (data?.handle ?? '').toUpperCase()} | BlackCrow`},
];

export default function DynamicProductRoute() {
  const {product, handle, upsellProducts} = useLoaderData();
  return (
    <ProductDetailPage
      handle={handle}
      productData={product}
      upsellProducts={upsellProducts}
    />
  );
}
