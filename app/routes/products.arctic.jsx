import {ProductDetailPage} from '~/components/ProductDetailPage';

export const meta = () => [
  {title: 'BlackCrow Arctic | Drying Towel'},
  {name: 'description', content: 'The BlackCrow Arctic — engineered for one-pass drying and premium detailing performance.'},
];

export default function ArcticPage() {
  return <ProductDetailPage handle="arctic" />;
}
