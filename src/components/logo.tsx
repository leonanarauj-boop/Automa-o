export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <rect width="24" height="24" rx="7" fill="var(--primary)" />
        <path d="M7 16.5V8h5.2a3 3 0 0 1 0 6H9.5m3 0 3 2.5" fill="none" stroke="var(--on-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Retoma
    </span>
  );
}
