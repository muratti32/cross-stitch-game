'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { UploadCloud, X } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useCreateDraft } from '@/hooks/use-drafts';
import { ApiError } from '@/lib/client/fetcher';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg'];
const SHORT_EDGE_MIN = 20;
const SHORT_EDGE_MAX = 300;
const MAX_COLORS_MIN = 5;
const MAX_COLORS_MAX = 60;

export function DraftUploadForm() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [shortEdgeCells, setShortEdgeCells] = useState(100);
  const [maxColors, setMaxColors] = useState(20);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const createDraft = useCreateDraft();

  function handleFileSelect(selected: File | null): void {
    if (previewUrl !== null) {
      URL.revokeObjectURL(previewUrl);
    }
    if (selected === null) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (!ACCEPTED_TYPES.includes(selected.type)) {
      setFileError('Source image must be a PNG or JPEG file.');
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    if (selected.size > MAX_UPLOAD_BYTES) {
      setFileError('Source image must be 10 MB or smaller.');
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    setFileError(null);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  function clearFile(): void {
    handleFileSelect(null);
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (file === null) {
      setFileError('Choose a source image to upload.');
      return;
    }
    try {
      await createDraft.mutateAsync({ maxColors, shortEdgeCells, sourceImage: file });
      toast.success('Upload received. Converting your pattern now.');
      clearFile();
      setShortEdgeCells(100);
      setMaxColors(20);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : 'Failed to upload the source image.');
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a new Official Pattern Draft</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-1.5">
            <Label htmlFor="sourceImage">Source image</Label>
            {previewUrl === null ? (
              <label
                htmlFor="sourceImage"
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-8 text-center hover:bg-muted/50"
              >
                <UploadCloud className="size-6 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  PNG or JPEG, up to 10 MB
                </span>
              </label>
            ) : (
              <div className="relative w-fit">
                <Image
                  src={previewUrl}
                  alt="Source image preview"
                  width={160}
                  height={160}
                  unoptimized
                  className="max-h-40 w-auto rounded-lg border border-border object-contain"
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="secondary"
                  className="absolute -top-2 -right-2"
                  onClick={clearFile}
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            )}
            <input
              ref={inputRef}
              id="sourceImage"
              type="file"
              accept="image/png,image/jpeg"
              className="sr-only"
              onChange={(event) => handleFileSelect(event.target.files?.[0] ?? null)}
            />
            {fileError !== null && <p className="text-sm text-destructive">{fileError}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="shortEdgeCells">Short-edge cells</Label>
              <Input
                type="number"
                min={SHORT_EDGE_MIN}
                max={SHORT_EDGE_MAX}
                value={shortEdgeCells}
                onChange={(event) => setShortEdgeCells(clamp(Number(event.target.value), SHORT_EDGE_MIN, SHORT_EDGE_MAX))}
                className="w-20"
              />
            </div>
            <Slider
              id="shortEdgeCells"
              min={SHORT_EDGE_MIN}
              max={SHORT_EDGE_MAX}
              step={1}
              value={[shortEdgeCells]}
              onValueChange={(next) => setShortEdgeCells(Array.isArray(next) ? next[0] : next)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="maxColors">Max colors</Label>
              <Input
                type="number"
                min={MAX_COLORS_MIN}
                max={MAX_COLORS_MAX}
                value={maxColors}
                onChange={(event) => setMaxColors(clamp(Number(event.target.value), MAX_COLORS_MIN, MAX_COLORS_MAX))}
                className="w-20"
              />
            </div>
            <Slider
              id="maxColors"
              min={MAX_COLORS_MIN}
              max={MAX_COLORS_MAX}
              step={1}
              value={[maxColors]}
              onValueChange={(next) => setMaxColors(Array.isArray(next) ? next[0] : next)}
            />
          </div>

          {createDraft.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {createDraft.error instanceof ApiError
                  ? createDraft.error.message
                  : 'Failed to upload the source image.'}
              </AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={createDraft.isPending}>
            {createDraft.isPending ? 'Uploading…' : 'Upload and convert'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}
