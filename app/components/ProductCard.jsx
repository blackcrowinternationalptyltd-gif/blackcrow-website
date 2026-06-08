import {Link} from '@remix-run/react';

/**
 * ProductCard — used on collection pages and "Complete the Collection" upsells.
 * imgBg: Tailwind bg class for the inner image container (default: bg-bc-mid)
 * imgRing: optional Tailwind ring classes (e.g. 'ring-2 ring-bc-red ...')
 */
export function ProductCard({name, price, image, to, imgBg = 'bg-bc-mid', imgRing = ''}) {
  return (
    <Link to={to} className="group block">
      <div className="bg-bc-card rounded-[36px] p-4 flex flex-col items-center hover:bg-bc-mid transition-colors duration-150">
        {/* Inner image container */}
        <div
          className={[
            'w-full rounded-[24px] overflow-hidden flex items-center justify-center p-5 aspect-[4/3]',
            imgBg,
            imgRing,
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <img
            src={image}
            alt={name}
            className="max-h-full w-auto object-contain"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>

        {/* Name */}
        <p className="font-display text-[2.6rem] text-white mt-5 leading-none tracking-wide">
          {name}
        </p>

        {/* Price */}
        <p className="font-ui font-medium text-[1rem] text-white mt-2">{price}</p>

        {/* CTA */}
        <div className="btn-explore mt-4 mb-2">EXPLORE -&gt;</div>
      </div>
    </Link>
  );
}
