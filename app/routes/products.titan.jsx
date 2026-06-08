import {ProductDetailPage} from '~/components/ProductDetailPage';

export const meta = () => [
  {title: 'BlackCrow Titan | Drying Towel'},
  {name: 'description', content: 'The BlackCrow Titan — engineered for one-pass drying and premium detailing performance.'},
];

export default function TitanPage() {
  return <ProductDetailPage handle="titan" />;
}
