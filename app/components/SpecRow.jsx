/**
 * SpecRow — horizontal 3-card spec strip used on product detail pages.
 *
 * Usage:
 *   <SpecRow specs={[
 *     { Icon: SomeIcon, label: 'PERFORMANCE', value: 'One-Pass Drying' },
 *     ...
 *   ]} />
 */
export function SpecRow({specs}) {
  return (
    <div className="bg-bc-mid rounded-[20px] overflow-x-auto">
      <div className="flex flex-col sm:flex-row sm:divide-x divide-bc-divider divide-y sm:divide-y-0">
        {specs.map(({Icon, label, value}) => (
          <div
            key={label}
            className="flex-1 flex flex-col items-center justify-center py-8 sm:py-10 px-4 sm:px-6 text-center min-w-0"
          >
            <div className="text-white mb-5 flex-shrink-0">
              <Icon />
            </div>
            <p className="font-display text-[1.4rem] sm:text-[1.8rem] text-white leading-none break-words w-full">{label}</p>
            <p className="font-ui font-medium text-[0.85rem] text-bc-secondary mt-2">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
