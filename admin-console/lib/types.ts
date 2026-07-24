// Shapes mirrored 1:1 from backend/src/admin and backend/src/catalog. Do not
// add fields the backend does not return; do not invent endpoints.

export type PatternStatus = 'available' | 'review_hold' | 'withdrawn' | 'removed';
export type PatternUnlockPriceTier = 'small' | 'medium' | 'large' | null;

export interface AdminPatternListItem {
  id: string;
  title: string;
  creatorName: string;
  categoryCode: string;
  status: PatternStatus;
  unlockPriceTier: PatternUnlockPriceTier;
  previewUrl: string;
  publishedAt: string;
  createdAt: string;
}

export interface PatternTagRef {
  code: string;
  label: string;
}

export interface AdminPatternDetail extends AdminPatternListItem {
  width: number;
  height: number;
  paletteSize: number;
  tags: PatternTagRef[];
}

export interface AdminPatternPage {
  items: AdminPatternListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdatePatternMetadataInput {
  title: string;
  creatorName: string;
  categoryCode: string;
  tagCodes: string[];
}

export interface StaffPickItem {
  patternId: string;
  title: string;
  creatorName: string;
  position: number;
  previewUrl: string;
}

export interface TagLabel {
  locale: string;
  label: string;
}

export interface Tag {
  code: string;
  active: boolean;
  labels: TagLabel[];
}

export type OfficialPatternDraftStatus =
  | 'pending'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'published'
  | 'discarded';

export interface OfficialPatternDraftView {
  id: string;
  status: OfficialPatternDraftStatus;
  shortEdgeCells: number;
  maxColors: number;
  width: number | null;
  height: number | null;
  paletteSize: number | null;
  stitchableCellCount: number | null;
  hasPreview: boolean;
  failureReason: string | null;
  publishedPatternId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfficialPatternDraftPage {
  items: OfficialPatternDraftView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateDraftResponse {
  draftId: string;
  jobId: string;
}

export interface PublishDraftInput {
  title: string;
  creatorName: string;
  categoryCode: string;
  tagCodes: string[];
  paid: boolean;
}

export interface PublishDraftResponse {
  draftId: string;
  patternId: string;
  status: 'published';
}

export interface DiscardDraftResponse {
  draftId: string;
  status: 'discarded';
}

export interface Category {
  code: string;
  label: string;
  active: boolean;
}

export interface OperatorProfile {
  id: string;
  email: string;
  role: string;
}

export interface MfaRequiredResponse {
  status: 'mfa_required';
  challenge: string;
  expiresAt: string;
}

export interface AuthenticatedResponse {
  status: 'authenticated';
  operator: OperatorProfile;
}

export type LoginResponse = MfaRequiredResponse | AuthenticatedResponse;

export interface MfaSuccessResponse {
  operator: OperatorProfile;
}

/** Default Nest exception shape (no custom exception filter is registered). */
export interface BackendErrorPayload {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export interface ResolvedSupportRecord {
  type: 'ai_artwork' | 'pattern_conversion' | 'processing_job';
  id: string;
  data: Record<string, unknown> | null;
}

export interface ResolvedSupportReference {
  id: string;
  code: string;
  createdAt: string;
  principal: { type: 'account' | 'guest'; id: string };
  records: ResolvedSupportRecord[];
}

export type CatalogSubmissionStatus =
  | 'precheck_pending'
  | 'review_pending'
  | 'quarantined'
  | 'precheck_failed'
  | 'rejected'
  | 'appeal_pending'
  | 'appeal_upheld'
  | 'accepted';

export type CatalogRejectionReason =
  | 'safety'
  | 'publication_rights'
  | 'duplicate_or_spam'
  | 'technical_invalidity'
  | 'quality_standard';

export interface CatalogSubmissionReview {
  accountId: string;
  appealed: boolean;
  categoryCode: string;
  communityPatternId: string | null;
  createdAt: string;
  creatorProfileId: string;
  description: string;
  height: number;
  id: string;
  initialModeratorId: string | null;
  licenseVersion: string;
  metadataErrors: string[];
  metadataValid: boolean | null;
  moderationEvidence: unknown;
  paletteSize: number;
  previewUrl: string;
  rejectionNote: string | null;
  rejectionReason: CatalogRejectionReason | null;
  rightsDeclared: boolean;
  rightsDeclaredAt: string;
  similarityEvidence: unknown;
  sourceLanguage: string;
  sourcePatternId: string;
  status: CatalogSubmissionStatus;
  tagCodes: string[];
  technicalErrors: string[];
  technicalValid: boolean | null;
  title: string;
  updatedAt: string;
  width: number;
}

export interface CatalogReviewDecision {
  createdAt: string;
  decision: 'accepted' | 'rejected';
  note: string | null;
  operatorAccountId: string;
  rejectionReason: CatalogRejectionReason | null;
  reviewRound: 'initial' | 'appeal';
}

export interface CatalogSubmissionReviewDetail extends CatalogSubmissionReview {
  appeal: { createdAt: string; note: string | null } | null;
  decisions: CatalogReviewDecision[];
}

export type CatalogMetadataRevisionStatus =
  | 'pending'
  | 'rejected'
  | 'appeal_pending'
  | 'appeal_upheld'
  | 'accepted'
  | 'withdrawn';

export interface CatalogMetadataRevisionReview {
  accountId: string;
  categoryCode: string;
  communityPatternId: string;
  createdAt: string;
  creatorProfileId: string;
  description: string;
  id: string;
  initialModeratorId: string | null;
  metadataErrors: string[];
  metadataValid: boolean | null;
  rejectionNote: string | null;
  rejectionReason: CatalogRejectionReason | null;
  sourceLanguage: string;
  status: CatalogMetadataRevisionStatus;
  tagCodes: string[];
  title: string;
  updatedAt: string;
}

export interface CatalogMetadataRevisionCurrentPattern {
  categoryCode: string;
  description: string | null;
  publishedAt: string;
  sourceLanguage: string | null;
  tagCodes: string[];
  title: string;
}

export interface CatalogMetadataReviewDecision {
  createdAt: string;
  decision: 'accepted' | 'rejected';
  note: string | null;
  operatorAccountId: string;
  rejectionReason: CatalogRejectionReason | null;
  reviewRound: 'initial' | 'appeal';
}

export interface CatalogMetadataAppeal {
  createdAt: string;
  note: string | null;
}

export interface CatalogMetadataRevisionReviewDetail extends CatalogMetadataRevisionReview {
  appeal: CatalogMetadataAppeal | null;
  currentPattern: CatalogMetadataRevisionCurrentPattern | null;
  decisions: CatalogMetadataReviewDecision[];
}

export type CommunityReportReason =
  | 'inappropriate_or_unsafe_content'
  | 'copyright_or_publication_rights'
  | 'duplicate_or_spam'
  | 'misleading_title_or_tags'
  | 'other';

export interface PostPublicationReviewListItem {
  holdAppliedAt: string | null;
  holdReason: string | null;
  id: string;
  openedAt: string;
  patternId: string;
  patternStatus: PatternStatus;
  patternTitle: string;
  reportCount: number;
  status: 'open' | 'closed';
}

export interface PostPublicationReviewReport {
  createdAt: string;
  explanation: string | null;
  id: string;
  reason: CommunityReportReason;
}

export interface PostPublicationReviewDetail extends PostPublicationReviewListItem {
  metadataRevisionId: string | null;
  noticeId: string | null;
  pattern: {
    categoryCode: string;
    description: string | null;
    id: string;
    previewUrl: string;
    sourceLanguage: string | null;
    status: PatternStatus;
    tagCodes: string[];
    title: string;
  };
  reports: PostPublicationReviewReport[];
}

export interface ReviewHoldResult {
  applied: boolean;
  emailQueued: boolean;
  holdAppliedAt: string;
  moderationNoticeId: string;
  patternId: string;
  reason: string;
  reviewId: string;
  status: 'review_hold';
}
