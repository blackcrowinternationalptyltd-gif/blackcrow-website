import {ProductDetailPage} from '~/components/ProductDetailPage';

export const meta = () => [
  {title: 'BlackCrow Phantom | Drying Towel'},
  {name: 'description', content: 'The BlackCrow Phantom — engineered for one-pass drying and premium detailing performance.'},
];

export default function PhantomPage() {
  return <ProductDetailPage handle="phantom" />;
}
