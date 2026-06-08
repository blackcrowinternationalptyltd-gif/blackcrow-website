import {Link} from '@remix-run/react';

export const meta = () => [
  {title: 'BlackCrow Automotive'},
  {name: 'description', content: 'Premium detailing essentials engineered for performance.'},
];

/* ─── Data ─────────────────────────────────────────────────────────────── */

const FEATURES = [
  {
    image: '/images/feature-850gsm.jpg',
    title: '850 GSM',
    description: 'Maximum Water Absorption.',
  },
  {
    image: '/images/feature-streak-free.jpg',
    title: 'STREAK FREE',
    description: 'Engineered Finish.',
  },
  {
    image: '/images/feature-one-pass.jpg',
    title: 'ONE-PASS DRYING',
    description: 'Competence Prioritised.',
  },
  {
    image: '/images/feature-microfibre.jpg',
    title: 'PREMIUM MICROFIBRE',
    description: 'Soft on Paint.',
  },
];

/* ─── Homepage ──────────────────────────────────────────────────────────── */

export default function Homepage() {
  return (
    <>
      <HeroSection />
      <EfficiencySection />
      <CollectionSection />
    </>
  );
}

/* ─── Hero ──────────────────────────────────────────────────────────────── */

function HeroSection() {
  return (
    <section className="bg-bc-surface min-h-[400px] sm:min-h-[540px] flex flex-col sm:flex-row items-stretch overflow-hidden">
      {/* Left — text */}
      <div className="flex flex-col justify-center px-4 sm:px-8 lg:px-20 py-10 sm:py-16 w-full sm:max-w-[520px] sm:flex-shrink-0 z-10">
        <h1 className="font-display text-[3.5rem] sm:text-[5rem] lg:text-[6.5rem] leading-[0.9] text-white">
          BLACKCROW
        </h1>
        <h1 className="font-display text-[3.5rem] sm:text-[5rem] lg:text-[6.5rem] leading-[0.9] text-bc-red">
          CRIMSON
        </h1>
        <p className="font-ui font-bold text-[0.85rem] uppercase tracking-[0.1em] text-white mt-6 leading-loose">
          Engineered for one-pass drying<br />
          Maximum absorption. Zero streaks.
        </p>
        <Link
          to="/products/crimson"
          className="btn-primary mt-8 self-start"
        >
          SHOP CRIMSON
        </Link>
      </div>

      {/* Right — product image */}
      <div className="hidden sm:flex flex-1 items-end justify-center relative">
        <img
          src="/images/hero-crimson.png"
          alt="BlackCrow Crimson Drying Towel"
          className="max-h-[500px] w-auto object-contain object-bottom"
        />
      </div>
    </section>
  );
}

/* ─── Built for Efficiency ──────────────────────────────────────────────── */

function EfficiencySection() {
  return (
    <section className="bg-bc-bg py-20 px-4 sm:px-8 lg:px-14">
      {/* Heading */}
      <div className="text-center mb-12">
        <h2 className="font-display text-[2rem] sm:text-[3.5rem] leading-none text-white">
          BUILT FOR EFFICIENCY
        </h2>
        <p className="font-ui font-medium text-[1rem] text-bc-secondary mt-3">
          Maximum Performance. Minimal Effort.
        </p>
      </div>

      {/* 4 feature cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-5xl mx-auto">
        {FEATURES.map((f) => (
          <FeatureCard key={f.title} {...f} />
        ))}
      </div>
    </section>
  );
}

function FeatureCard({image, title, description}) {
  return (
    <div className="bg-bc-mid rounded-[16px] overflow-hidden border border-bc-divider">
      {/* Image */}
      <div className="aspect-[4/3] overflow-hidden bg-bc-card">
        <img
          src={image}
          alt={title}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
      </div>
      {/* Text */}
      <div className="px-5 py-4">
        <p className="font-ui font-bold text-[0.85rem] text-white uppercase tracking-[0.08em]">
          {title}
        </p>
        <p className="font-ui text-[0.8rem] text-bc-secondary mt-1">
          {description}
        </p>
      </div>
    </div>
  );
}

/* ─── The BlackCrow Collection ──────────────────────────────────────────── */

function CollectionSection() {
  return (
    <section className="bg-bc-bg py-16 px-4 sm:px-8 lg:px-14">
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Left — heading + lifestyle image + CTA */}
        <div className="flex-1 min-w-0">
          <h2 className="font-display text-[2rem] sm:text-[3.2rem] leading-none text-white mb-5">
            THE BLACKCROW COLLECTION
          </h2>
          <div className="rounded-[20px] overflow-hidden bg-bc-mid aspect-[4/3] w-full">
            <img
              src="/images/collection-lifestyle.jpg"
              alt="BlackCrow Collection"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
              }}
            />
          </div>
          <div className="mt-5">
            <Link to="/collections/drying" className="btn-explore">
              EXPLORE COLLECTION →
            </Link>
          </div>
        </div>

        {/* Right — product grid */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 lg:pt-[88px]">

          {/* Phantom — full width of right column */}
          <Link to="/products/phantom" className="group block">
            <div className="bg-bc-mid rounded-[20px] p-6 flex flex-col items-center hover:bg-bc-card transition-colors duration-150">
              <div className="h-[180px] w-full flex items-center justify-center bg-bc-card rounded-[12px] overflow-hidden">
                <img
                  src="/images/product-phantom.jpg"
                  alt="Phantom"
                  className="h-full w-auto object-contain"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <p className="font-display text-[1.5rem] sm:text-[2rem] text-white mt-4 tracking-wide">
                PHANTOM
              </p>
            </div>
          </Link>

          {/* Obsidian + Graphite — side by side */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Link to="/products/obsidian" className="group block">
              <div className="bg-bc-mid rounded-[20px] p-5 flex flex-col items-center hover:bg-bc-card transition-colors duration-150">
                <div className="h-[130px] w-full flex items-center justify-center bg-bc-card rounded-[12px] overflow-hidden">
                  <img
                    src="/images/product-obsidian.jpg"
                    alt="Obsidian"
                    className="h-full w-auto object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
                <p className="font-display text-[1.4rem] sm:text-[1.8rem] text-white mt-3 tracking-wide">
                  OBSIDIAN
                </p>
              </div>
            </Link>

            <Link to="/products/graphite" className="group block">
              <div className="bg-bc-mid rounded-[20px] p-5 flex flex-col items-center hover:bg-bc-card transition-colors duration-150">
                <div className="h-[130px] w-full flex items-center justify-center bg-bc-card rounded-[12px] overflow-hidden">
                  <img
                    src="/images/product-graphite.jpg"
                    alt="Graphite"
                    className="h-full w-auto object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                </div>
                <p className="font-display text-[1.4rem] sm:text-[1.8rem] text-white mt-3 tracking-wide">
                  GRAPHITE
                </p>
              </div>
            </Link>
          </div>

        </div>
      </div>
    </section>
  );
}
