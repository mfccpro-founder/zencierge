export function ZenciergeLogo({
  className = "h-10 w-auto",
  priority: _priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    // Official mark is an SVG; use img so Next Image SVG restrictions do not apply.
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/zencierge-logo.svg" alt="Zencierge" className={className} />
  );
}
