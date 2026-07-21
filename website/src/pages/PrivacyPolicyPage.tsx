import { Link } from 'react-router-dom'

export function PrivacyPolicyPage() {
  return (
    <main id="main-content">
      <div className="page-hero">
        <div className="container">
          <p className="page-hero__breadcrumb">
            <Link to="/">Home</Link> / Privacy Policy
          </p>
          <h1 className="page-hero__title">Privacy Policy</h1>
          <p className="page-hero__subtitle">
            Last updated: July 2026
          </p>
        </div>
      </div>

      <div className="page-content">
        <div className="container">
          <div className="prose">
            <p>
              AVK ("we", "our", or "us") operates the Stitch Wish: Cross Stitch
              mobile application (the "App"). This Privacy Policy explains what
              information we collect, how we use it, and your rights with respect
              to that information.
            </p>

            <h2>1. Information We Collect</h2>

            <h3>Account Information</h3>
            <p>
              When you create a Registered Account, we collect the email address or
              federated identity (Apple or Google) you use to sign in. We do not
              store your Apple or Google password. Your email address is used only
              for authentication (one-time sign-in codes) and required moderation
              notices — it is never displayed publicly.
            </p>

            <h3>Gameplay Data</h3>
            <p>
              We collect data necessary to operate the game: your stitching session
              progress, pattern collection, in-game currency balances, and purchase
              history. This data is stored on our servers and on your device.
            </p>

            <h3>Creator Profile</h3>
            <p>
              If you choose to submit patterns to the public catalog, you must
              create a Public Creator Profile with a unique username and optional
              display name and avatar. This information is publicly visible. Your
              real name, email, and authentication-provider identity are never
              exposed through your public profile.
            </p>

            <h3>Purchases</h3>
            <p>
              In-app purchases are processed by Apple or Google. We receive
              verified purchase receipts through RevenueCat. We do not receive or
              store your payment card details.
            </p>

            <h3>Advertising</h3>
            <p>
              The App shows optional rewarded advertisements through Google AdMob.
              We use non-personalized ad delivery with no cross-app tracking and
              request no App Tracking Transparency permission. We do not use
              advertising identifiers for cross-app tracking.
            </p>

            <h3>Technical and Crash Data</h3>
            <p>
              We collect crash reports and performance data through Sentry to
              improve app stability. This data is pseudonymized and does not include
              your prompts, artwork, email address, or provider identifiers.
            </p>

            <h2>2. How We Use Your Information</h2>
            <ul>
              <li>To provide and improve the App and its features</li>
              <li>To authenticate you and manage your account</li>
              <li>To process and verify in-app purchases</li>
              <li>To deliver transactional emails (sign-in codes, moderation notices)</li>
              <li>To detect fraud and enforce our content policies</li>
              <li>To respond to support requests and data-access requests</li>
            </ul>

            <h2>3. Information Sharing</h2>
            <p>
              We do not sell your personal data. We share data only with the
              following service providers, solely to operate the App:
            </p>
            <ul>
              <li><strong>Apple / Google</strong> — authentication and purchase verification</li>
              <li><strong>Firebase Authentication</strong> — federated identity brokering only</li>
              <li><strong>RevenueCat</strong> — purchase event normalization</li>
              <li><strong>fal.ai</strong> — AI artwork generation (your prompt text is sent to fal.ai)</li>
              <li><strong>OpenAI</strong> — prompt and image safety moderation</li>
              <li><strong>Resend</strong> — transactional email delivery</li>
              <li><strong>Google AdMob</strong> — rewarded advertisements</li>
              <li><strong>Sentry</strong> — crash and performance telemetry</li>
              <li><strong>Cloudflare</strong> — DNS, CDN, and pattern delivery</li>
            </ul>

            <h2>4. Data Retention and Deletion</h2>
            <p>
              You may request deletion of your account at any time through the
              App (Profile → Delete Account) or via our{' '}
              <Link to="/account-deletion">Account Deletion page</Link>. After a
              30-day recovery window, your account and associated personal data
              are permanently deleted. Some minimal transaction records are
              retained for legal and fraud-prevention purposes.
            </p>

            <h2>5. Children's Privacy</h2>
            <p>
              The App does not knowingly collect personal information from children
              under 13 (or under 16 in the EEA). If you believe a child has
              provided us with personal information, contact us at{' '}
              <a href="mailto:muratti32@gmail.com">muratti32@gmail.com</a>.
            </p>

            <h2>6. Your Rights</h2>
            <p>
              Depending on your jurisdiction, you may have the right to access,
              correct, export, or delete your personal data. To exercise these
              rights, contact us at{' '}
              <a href="mailto:muratti32@gmail.com">muratti32@gmail.com</a>{' '}
              or visit our <Link to="/support">Support page</Link>.
            </p>

            <h2>7. Security</h2>
            <p>
              We use industry-standard security practices including TLS encryption
              in transit, encrypted storage at rest, and least-privilege access
              controls. No system is perfectly secure; if you discover a
              vulnerability, please disclose it responsibly to{' '}
              <a href="mailto:muratti32@gmail.com">muratti32@gmail.com</a>.
            </p>

            <h2>8. Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. Significant changes will
              be communicated through the App or by email. Continued use after the
              effective date constitutes acceptance of the updated policy.
            </p>

            <h2>9. Contact</h2>
            <p>
              For privacy questions or data-access requests, contact us at{' '}
              <a href="mailto:muratti32@gmail.com">muratti32@gmail.com</a>.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
