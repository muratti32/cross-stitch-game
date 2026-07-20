// Shapes mirrored 1:1 from backend/src/admin and backend/src/catalog. Do not
// add fields the backend does not return; do not invent endpoints.

export type PatternStatus = 'available' | 'withdrawn' | 'removed';
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
