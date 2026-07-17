import { PatternDetailView } from '@/components/patterns/pattern-detail-view';

export default async function PatternDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PatternDetailView patternId={id} />;
}
