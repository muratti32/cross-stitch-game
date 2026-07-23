import { CatalogSubmissionDetailView } from '@/components/submissions/catalog-submission-detail-view';

export default async function CatalogSubmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogSubmissionDetailView submissionId={id} />;
}
