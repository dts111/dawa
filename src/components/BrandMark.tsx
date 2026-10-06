import Image from "next/image";

/** Square logo mark (the Dafegen bird) used in the app header, home page and sign-in card. */
export default function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* The source PNG has wide empty margins, so scale it up to fill the box. */}
      <Image src="/dafegen-mark.png" alt="" width={size} height={size} className="scale-[1.45] object-contain" priority />
    </span>
  );
}
