import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-slate-950 shadow-sm", className)} aria-hidden="true">
      <svg viewBox="0 0 32 32" className="h-6 w-6" fill="none">
        <path d="M5 9.2c4.7.3 7.8 2 9.4 5.1-3.8.2-7-1.5-9.4-5.1Z" fill="#A5B4FC" />
        <path d="M27 9.2c-4.7.3-7.8 2-9.4 5.1 3.8.2 7-1.5 9.4-5.1Z" fill="#C4B5FD" />
        <path d="M7 17c4.2-.8 7.2-.1 9 2.2 1.8-2.3 4.8-3 9-2.2-2.4 3.8-5.4 5.7-9 5.7S9.4 20.8 7 17Z" fill="white" />
        <path d="m16 5 2.4 5.2L16 13l-2.4-2.8L16 5Z" fill="#818CF8" />
      </svg>
    </span>
  );
}

export function Brand({ href = "/", compact = false, className }: { href?: string; compact?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5", className)}>
      <BrandMark />
      {!compact && <span className="text-[19px] font-bold tracking-[-0.03em] text-slate-950">Garuda</span>}
    </Link>
  );
}
