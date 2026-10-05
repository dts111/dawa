/** Square logo mark used in the app header, home page and sign-in card. */
export default function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-brand font-bold text-white shadow-card"
      style={{ width: size, height: size, fontSize: size * 0.48 }}
      aria-hidden
    >
      D
      <span className="absolute right-0 bottom-0 h-1/4 w-1/4 rounded-tl-sm bg-gold" />
    </span>
  );
}
