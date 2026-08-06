import { Link } from 'react-router-dom'

export function SupportPage() {
  return (
    <main id="main-content">
      <div className="page-hero">
        <div className="container">
          <p className="page-hero__breadcrumb">
            <Link to="/">Home</Link> / Support
          </p>
          <h1 className="page-hero__title">Support</h1>
          <p className="page-hero__subtitle">
            We're here to help. Reach out anytime.
          </p>
        </div>
      </div>

      <div className="page-content">
        <div className="container">
          <div className="support-cards">
            <div className="support-card">
              <span className="support-card__icon" aria-hidden="true">✉️</span>
              <h2 className="support-card__title">Email Support</h2>
              <p className="support-card__text">
                For bug reports, billing questions, account issues, or general
                feedback, send us an email and we'll get back to you as soon as
                possible.
              </p>
              <a
                href="mailto:muratti32@gmail.com"
                className="support-card__action"
                aria-label="Send support email"
              >
                muratti32@gmail.com →
              </a>
            </div>

            <div className="support-card">
              <span className="support-card__icon" aria-hidden="true">🗑️</span>
              <h2 className="support-card__title">Delete Your Account</h2>
              <p className="support-card__text">
                You can permanently delete your Stitch Wish account and all
                associated data. This action starts a 30-day recovery window
                before your data is erased.
              </p>
              <Link
                to="/account-deletion"
                className="support-card__action"
                aria-label="Go to account deletion page"
              >
                Account Deletion page →
              </Link>
            </div>

            <div className="support-card">
              <span className="support-card__icon" aria-hidden="true">🔒</span>
              <h2 className="support-card__title">Privacy &amp; Data</h2>
              <p className="support-card__text">
                Learn about what data we collect, how we use it, and your rights
                as a user under GDPR, CCPA, and other applicable laws.
              </p>
              <Link
                to="/privacy-policy"
                className="support-card__action"
                aria-label="Read our privacy policy"
              >
                Privacy Policy →
              </Link>
            </div>

            <div className="support-card">
              <span className="support-card__icon" aria-hidden="true">📄</span>
              <h2 className="support-card__title">Terms of Service</h2>
              <p className="support-card__text">
                The rules for using Stitch Wish: accounts, purchases and
                subscriptions, virtual items, catalog submissions, and content
                moderation.
              </p>
              <Link
                to="/terms-of-service"
                className="support-card__action"
                aria-label="Read our terms of service"
              >
                Terms of Service →
              </Link>
            </div>

            <div className="support-card">
              <span className="support-card__icon" aria-hidden="true">💳</span>
              <h2 className="support-card__title">Subscription &amp; Billing</h2>
              <p className="support-card__text">
                To cancel a Premium Membership or Stitch Coin subscription,
                manage it directly through your App Store (iPhone) or Google
                Play (Android) account settings.
              </p>
              <a
                href="https://support.apple.com/en-us/HT202039"
                className="support-card__action"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Manage App Store subscriptions (opens Apple support)"
              >
                Manage on App Store →
              </a>
            </div>
          </div>

          <div className="prose" style={{ marginTop: '3rem' }}>
            <h2>Common Questions</h2>

            <h3>I lost my progress — can I recover it?</h3>
            <p>
              If you were signed in to a Registered Account, your progress is
              synced to the cloud and will restore automatically when you sign in
              again. Guest player progress is stored on your device and may not
              be recoverable if you lose access to the device. We strongly
              recommend creating a Registered Account to protect your progress.
            </p>

            <h3>How do I report a pattern or creator profile?</h3>
            <p>
              Use the in-app report button on the pattern detail page or creator
              profile. Reports are reviewed by our moderation team. If you need
              to escalate, email us at{' '}
              <a href="mailto:muratti32@gmail.com">muratti32@gmail.com</a>.
            </p>

            <h3>My AI artwork generation failed — was I charged?</h3>
            <p>
              AI Credit is only charged after a successful artwork delivery.
              If the generation failed, your credit was not consumed. If you
              believe you were incorrectly charged, contact us with your Support
              Reference code (shown in the error screen) and we will investigate.
            </p>

            <h3>How do I export my data?</h3>
            <p>
              You have the right to request a copy of your personal data. Email
              us at{' '}
              <a href="mailto:muratti32@gmail.com">muratti32@gmail.com</a>{' '}
              with "Data Export Request" in the subject line and we will respond
              within 30 days.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
