import { Link } from 'react-router-dom'

const SUPPORT_EMAIL = 'muratti32@gmail.com'

export function AccountDeletionPage() {
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
          <div className="prose">
            <h2>How to delete your account</h2>
            <p>
              Account deletion is requested from inside the app, where you are
              already signed in and we can verify that the request comes from
              the account holder:
            </p>
            <ol>
              <li>Open Stitch Wish and go to <strong>Settings</strong>.</li>
              <li>
                Under <strong>Account</strong>, tap{' '}
                <strong>Delete Account</strong>.
              </li>
              <li>
                Confirm the two-step warning and type <strong>DELETE</strong>{' '}
                when prompted.
              </li>
            </ol>
            <p>
              If you have been signed in for a while, the app asks you to verify
              one of the sign-in methods linked to that same account before the
              request is accepted.
            </p>

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

            <h2>If you cannot reach the app</h2>
            <p>
              If you have lost access to your device or cannot sign in, email{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with the
              subject line "Account Deletion Request" and we will verify your
              ownership of the account before starting the same 30-day process.
            </p>
            <p>
              Need help with something else?{' '}
              <Link to="/support">Contact our support team</Link>.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
