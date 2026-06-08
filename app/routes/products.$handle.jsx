import {json} from '@shopify/remix-oxygen';
import {useLoaderData} from '@remix-run/react';
import {ProductDetailPage} from '~/components/ProductDetailPage';
import {getSupabase} from '~/lib/supabase.server';

export async function loader({params, context}) {
  const {handle} = params;
  const sb = getSupabase(context.env);

  if (!sb) return json({product: null, handle, upsellProducts: null});

  const [{data: product}, {data: upsellData}] = await Promise.all([
    sb.from('products').select('*').eq('slug', handle).eq('status', 'active').maybeSingle(),
    sb
      .from('products')
      .select('name, slug, price, main_image_url, status')
      .eq('status', 'active')
      .order('display_order', {ascending: true}),
  ]);

  const upsellProducts = (upsellData ?? [])
    .filter((p) => p.slug !== handle)
    .map((p) => ({
      handle: p.slug,
      name: p.name,
      price: `$${Number(p.price).toFixed(2)}`,
      image: p.main_image_url ?? `/images/product-${p.slug}.jpg`,
      to: `/products/${p.slug}`,
      imgBg: p.slug === 'arctic' ? 'bg-bc-arctic' : 'bg-bc-mid',
      imgRing: p.slug === 'crimson' ? 'ring-2 ring-bc-red ring-offset-2 ring-offset-bc-card' : '',
    }));

  return json({product: product ?? null, handle, upsellProducts});
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
