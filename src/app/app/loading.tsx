import { Skeleton } from "@/components/ui/primitives";

/** Skeleton shown while any /app page streams its data. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <Skeleton className="mb-2 h-6 w-48" />
      <Skeleton className="mb-6 h-4 w-80" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[74px]" />)}
      </div>
      <Skeleton className="mt-5 h-64 w-full" />
    </div>
  );
}
