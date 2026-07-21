import { useState, FormEvent } from 'react'
import { Link } from 'react-router-dom'

const API_URL = import.meta.env.VITE_API_URL as string | undefined

type FormState = 'idle' | 'submitting' | 'success' | 'error'

export function AccountDeletionPage() {
  const [email, setEmail]       = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [formState, setFormState] = useState<FormState>('idle')
  const [errorMsg, setErrorMsg]   = useState('')

  const apiConfigured = !!API_URL

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!apiConfigured || !confirmed || formState === 'submitting') return

    setFormState('submitting')
    setErrorMsg('')

    try {
      const res = await fetch(`${API_URL}/v1/account/deletion-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (res.ok) {
        setFormState('success')
      } else {
        const body = await res.json().catch(() => ({}))
        setErrorMsg(
          (body as { message?: string }).message ??
            'Something went wrong. Please try again or email us directly.'
        )
        setFormState('error')
      }
    } catch {
      setErrorMsg(
        'Could not reach the server. Please check your connection or email us directly at muratti32@gmail.com.'
      )
      setFormState('error')
    }
  }

  return (
    <main id="main-content">
      <div className="page-hero">
        <div className="container">
          <p className="page-hero__breadcrumb">
            <Link to="/">Home</Link> / Account Deletion
          </p>
          <h1 className="page-hero__title">Delete Your Account</h1>
          <p className="page-hero__subtitle">
            Permanently remove your Stitch Wish account and all associated data.
          </p>
        </div>
      </div>

      <div className="page-content">
        <div className="container">
          {/* What gets deleted */}
          <div className="prose">
            <h2>What happens when you delete your account?</h2>
            <p>
              Submitting a deletion request starts a <strong>30-day recovery
              window</strong>. During this time your account is frozen —
              no new purchases or gameplay writes are possible — but you
              can sign in to cancel the deletion and restore full access.
            </p>
            <p>After the 30-day window, the following is permanently deleted:</p>
            <ul>
              <li>Your email address and authentication identifiers</li>
              <li>Your Registered Account profile, username, and avatar</li>
              <li>All personal patterns, AI artwork, and stitching progress</li>
              <li>Your Stitch Coin balance and AI Credit balance</li>
              <li>Your pattern unlocks, likes, and community content</li>
            </ul>
            <p>
              <strong>Note:</strong> Deleting your game account does not
              automatically cancel an active Apple or Google subscription.
              Cancel your subscription separately through your device's
              subscription management settings before submitting this request.
            </p>
            <p>
              You can also delete your account directly from within the app:{' '}
              <strong>Profile → Settings → Delete Account</strong>.
            </p>
          </div>

          {/* Deletion form */}
          <div className="deletion-form-wrap">
            {!apiConfigured && (
              <div className="alert alert--warning" role="alert">
                <p className="alert__title">⚠️ API not configured</p>
                <p>
                  The account deletion API is not yet connected. To request
                  deletion, please email us directly at{' '}
                  <a href="mailto:muratti32@gmail.com">muratti32@gmail.com</a>{' '}
                  with the subject line "Account Deletion Request".
                </p>
              </div>
            )}

            {formState === 'success' ? (
              <div className="alert alert--success" role="alert">
                <p className="alert__title">✅ Deletion request received</p>
                <p>
                  We've started the account deletion process for <strong>{email}</strong>.
                  You have 30 days to sign in and cancel if you change your mind.
                  You will receive a confirmation email shortly.
                </p>
              </div>
            ) : (
              <form
                className="deletion-form"
                onSubmit={handleSubmit}
                aria-label="Account deletion request form"
              >
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.2rem', marginBottom: '1.25rem', color: 'var(--color-brown)' }}>
                  Request Account Deletion
                </h2>

                {formState === 'error' && (
                  <div className="alert alert--error" role="alert">
                    <p className="alert__title">Error</p>
                    <p>{errorMsg}</p>
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="deletion-email">
                    Account Email Address
                  </label>
                  <input
                    id="deletion-email"
                    type="email"
                    className="form-input"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    disabled={formState === 'submitting' || !apiConfigured}
                    aria-describedby="deletion-email-hint"
                  />
                  <p className="form-hint" id="deletion-email-hint">
                    Enter the email address associated with your Stitch Wish account.
                  </p>
                </div>

                <div className="form-group">
                  <div className="form-checkbox-group">
                    <input
                      type="checkbox"
                      id="deletion-confirm"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                      disabled={formState === 'submitting' || !apiConfigured}
                      aria-describedby="deletion-confirm-hint"
                    />
                    <label htmlFor="deletion-confirm">
                      I understand that deleting my account is permanent after a
                      30-day recovery window and cannot be undone. I have
                      cancelled any active subscriptions separately.
                    </label>
                  </div>
                  <p className="form-hint" id="deletion-confirm-hint" style={{ marginTop: '0.5rem' }}>
                    You must confirm to proceed.
                  </p>
                </div>

                <button
                  type="submit"
                  className="btn btn--danger"
                  disabled={!confirmed || !email || formState === 'submitting' || !apiConfigured}
                  aria-busy={formState === 'submitting'}
                >
                  {formState === 'submitting' ? 'Submitting…' : 'Submit Deletion Request'}
                </button>
              </form>
            )}

            <p style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--color-brown-light)' }}>
              Need help? <Link to="/support" style={{ color: 'var(--color-red)' }}>Contact our support team</Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
