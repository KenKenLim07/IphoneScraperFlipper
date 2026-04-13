export default function ListingsLoading() {
  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="space-y-2">
        <div className="h-6 w-48 rounded-md bg-muted/60 animate-pulse" />
        <div className="h-4 w-72 rounded-md bg-muted/40 animate-pulse" />
      </div>

      <div className="rounded-xl border border-border/70 bg-card/40 p-3 sm:p-4 space-y-3">
        <div className="h-10 w-full rounded-md bg-muted/60 animate-pulse" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="h-10 rounded-md bg-muted/40 animate-pulse" />
          <div className="h-10 rounded-md bg-muted/40 animate-pulse" />
          <div className="h-10 rounded-md bg-muted/40 animate-pulse" />
          <div className="h-10 rounded-md bg-muted/40 animate-pulse" />
        </div>
      </div>

      <div className="rounded-xl border border-border/70 bg-card p-4 space-y-3">
        <div className="h-4 w-40 rounded-md bg-muted/60 animate-pulse" />
        <div className="grid gap-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="h-20 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
