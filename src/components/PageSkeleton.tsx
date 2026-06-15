import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";

export const PageSkeleton = () => (
  <div className="container max-w-4xl mx-auto py-6 px-4 space-y-4" dir="rtl">
    <div className="flex items-center gap-3">
      <Skeleton className="h-8 w-8 rounded-full" />
      <Skeleton className="h-6 w-48" />
    </div>
    <Card className="p-4 space-y-3">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </Card>
    <Card className="p-4 space-y-3">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-10 w-full rounded-lg" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-24 rounded-md" />
        <Skeleton className="h-9 w-24 rounded-md" />
      </div>
    </Card>
  </div>
);

export const DiarizationSkeleton = () => (
  <div className="container max-w-4xl mx-auto py-6 px-4 space-y-4" dir="rtl">
    <div className="flex items-center gap-3 mb-4">
      <Skeleton className="h-7 w-7 rounded-full" />
      <Skeleton className="h-6 w-40" />
    </div>
    <Card className="p-4 space-y-3">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
    </Card>
    <Card className="p-4 space-y-3">
      <div className="flex gap-2 mb-2">
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <Skeleton className="h-6 w-full rounded" />
      <Skeleton className="h-48 w-full rounded-lg" />
    </Card>
  </div>
);
