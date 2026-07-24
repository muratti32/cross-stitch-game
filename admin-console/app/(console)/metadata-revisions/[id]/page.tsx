import { CatalogMetadataRevisionDetailView } from '@/components/metadata-revisions/catalog-metadata-revision-detail-view';

export default async function CatalogMetadataRevisionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <CatalogMetadataRevisionDetailView revisionId={id} />;
}
