import BrandMark from "./BrandMark";

/**
 * The logo for whoever a plan belongs to: the client's own logo when one is set,
 * otherwise the Dafegen bird. Stage 2 (accounts) passes the organisation's logo too.
 */
export default function ClientMark({
  name,
  logo,
  height = 36,
}: {
  name?: string | null;
  logo?: string | null;
  height?: number;
}) {
  if (!logo) return <BrandMark size={height} />;

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white px-1.5 shadow-card"
      style={{ height, maxWidth: height * 3 }}
      title={name ?? undefined}
    >
      {/* Data URLs can't go through next/image, so this is a plain img. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={logo} alt={name ? `${name} logo` : ""} className="h-full w-auto max-w-full object-contain py-1" />
    </span>
  );
}
