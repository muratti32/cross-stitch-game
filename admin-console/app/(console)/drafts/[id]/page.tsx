import { DraftDetailView } from '@/components/drafts/draft-detail-view';

export default async function DraftDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DraftDetailView draftId={id} />;
}
