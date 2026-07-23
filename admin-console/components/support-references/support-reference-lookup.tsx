'use client';

import { FormEvent, useState } from 'react';
import { Search } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/client/fetcher';
import { formatDateTime } from '@/lib/format';
import type { ResolvedSupportReference } from '@/lib/types';

export function SupportReferenceLookup() {
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<ResolvedSupportReference | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function lookup(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const resolved = await api.post<ResolvedSupportReference>(
        '/api/admin/support-references/lookup',
        { code, reason },
      );
      setCode(resolved.code);
      setResult(resolved);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Support Reference lookup failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support References"
        description="Resolve a player-provided reference to its owned server records. Every lookup is audited."
      />

      <Card>
        <CardHeader>
          <CardTitle>Lookup</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid max-w-2xl gap-5" onSubmit={(event) => void lookup(event)}>
            <div className="grid gap-2">
              <Label htmlFor="support-reference-code">Support Reference</Label>
              <Input
                id="support-reference-code"
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="SW-XXXX-XXXX-XXXX"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="support-reference-reason">Reason for access</Label>
              <Textarea
                id="support-reference-reason"
                maxLength={500}
                placeholder="Describe the support case and why these records are needed."
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">Minimum 10 characters. This reason is written to the append-only operator audit log.</p>
            </div>
            <Button className="w-fit" disabled={pending || code.trim() === '' || reason.trim().length < 10} type="submit">
              <Search className="size-4" />
              {pending ? 'Looking up…' : 'Resolve reference'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error !== null && (
        <Alert variant="destructive">
          <AlertTitle>Lookup failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result !== null && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-mono">{result.code}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Created:</span> {formatDateTime(result.createdAt)}</div>
              <div><span className="text-muted-foreground">Principal:</span> {result.principal.type}</div>
              <div className="font-mono text-xs sm:col-span-2"><span className="font-sans text-sm text-muted-foreground">Principal ID:</span> {result.principal.id}</div>
            </CardContent>
          </Card>
          {result.records.map((record) => (
            <Card key={`${record.type}:${record.id}`}>
              <CardHeader>
                <CardTitle className="text-base">{record.type.replaceAll('_', ' ')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="font-mono text-xs text-muted-foreground">{record.id}</p>
                {record.data === null ? (
                  <Alert><AlertTitle>Record unavailable</AlertTitle><AlertDescription>The linked record no longer exists.</AlertDescription></Alert>
                ) : (
                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    {Object.entries(record.data).map(([key, value]) => (
                      <div key={key} className="min-w-0">
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{key}</dt>
                        <dd className="break-words font-mono text-xs">{formatValue(value)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}
