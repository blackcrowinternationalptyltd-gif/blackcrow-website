import {ProductDetailPage} from '~/components/ProductDetailPage';

export const meta = () => [
  {title: 'BlackCrow Crimson | Drying Towel'},
  {name: 'description', content: 'The BlackCrow Crimson — engineered for one-pass drying and premium detailing performance.'},
];

export default function CrimsonPage() {
  return <ProductDetailPage handle="crimson" />;
}
