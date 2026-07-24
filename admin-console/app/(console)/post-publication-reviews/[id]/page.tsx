import { PostPublicationReviewDetailView } from '@/components/post-publication-reviews/post-publication-review-detail-view';

export default async function PostPublicationReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PostPublicationReviewDetailView reviewId={id} />;
}
