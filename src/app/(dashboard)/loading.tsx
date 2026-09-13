export default function DashboardRouteLoading() {
  return (
    <div aria-label="Loading page" className="space-y-5" role="status">
      <div className="h-8 w-52 animate-pulse rounded bg-slate-200 dark:bg-slate-800" />
      <div className="h-4 w-80 max-w-full animate-pulse rounded bg-slate-100 dark:bg-slate-900" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-lg border border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-900" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg border border-slate-200 bg-slate-100/70 dark:border-slate-800 dark:bg-slate-900" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
