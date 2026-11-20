import Link from "next/link";

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 font-semibold text-ink no-underline">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9.5" fill="none" stroke="var(--color-ink)" strokeWidth="1.8" />
        <path d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5H12z" fill="var(--color-signal)" />
        <circle cx="12" cy="12" r="2.2" fill="var(--color-ink)" />
      </svg>
      <span>SupplyFlywheel</span>
    </Link>
  );
}
