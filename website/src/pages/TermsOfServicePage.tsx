import { Link } from 'react-router-dom'

const SECTIONS = [
  ['eligibility', '1. Eligibility and Accounts'],
  ['purchases', '2. Purchases, Virtual Items, and Subscriptions'],
  ['advertising', '3. Advertising'],
  ['your-content', '4. Your Content and the Catalog'],
  ['acceptable-use', '5. Acceptable Use'],
  ['moderation', '6. Moderation and Enforcement'],
  ['ai-artwork', '7. AI-Generated Artwork'],
  ['license', '8. License to Use the App'],
  ['deletion', '9. Account Deletion and Termination'],
  ['disclaimers', '10. Disclaimers'],
  ['liability', '11. Limitation of Liability'],
  ['changes', '12. Changes to These Terms'],
  ['governing-law', '13. Governing Law'],
  ['general', '14. General'],
  ['contact', '15. Contact'],
] as const

export function TermsOfServicePage() {
  return (
    <main id="main-content">
      <div className="page-hero">
        <div className="container">
          <p className="page-hero__breadcrumb">
            <Link to="/">Home</Link> / Terms of Service
          </p>
          <h1 className="page-hero__title">Terms of Service</h1>
          <p className="page-hero__subtitle">
            Last updated: 6 August 2026
          </p>
        </div>
      </div>

      <div className="page-content">
        <div className="container">
          <div className="prose">
            <p>
              These Terms of Service (the "Terms") are an agreement between you
              and AVK ("we", "our", or "us") governing your use of the Stitch
              Wish: Cross Stitch mobile application, its backend services, and
              this website (together, the "App"). By downloading, installing, or
              using the App you accept these Terms. If you do not accept them,
              do not use the App.
            </p>
            <p>
              How we handle your personal data is described separately in our{' '}
              <Link to="/privacy-policy">Privacy Policy</Link>, which forms part
              of these Terms.
            </p>

            <nav className="prose-toc" aria-label="Table of contents">
              <h2 className="prose-toc__title">Contents</h2>
              <ol className="prose-toc__list">
                {SECTIONS.map(([id, label]) => (
                  <li key={id}>
                    <a href={`#${id}`}>{label.replace(/^\d+\.\s/, '')}</a>
                  </li>
                ))}
              </ol>
            </nav>

            <h2 id="eligibility">1. Eligibility and Accounts</h2>
            <p>
              You may play as a Guest Player without an account. Some features —
              purchases, cloud progress sync, a Public Creator Profile, and
              catalog submissions — require a Registered Account created with an
              email one-time code or with Apple or Google sign-in.
            </p>
            <p>
              You are responsible for keeping access to your sign-in email or
              federated identity secure, and for all activity that occurs
              through your account. Guest progress is tied to an installation on
              a single device and may be lost if you delete the App or lose the
              device; only a Registered Account is protected by cloud sync.
            </p>
            <p>
              The App is not directed at children under 13 (under 16 in the
              EEA). If you are a minor in your jurisdiction, you may use the App
              only with the consent and supervision of a parent or guardian.
            </p>

            <h2 id="purchases">2. Purchases, Virtual Items, and Subscriptions</h2>
            <p>
              All payments are processed by Apple or Google under their own
              terms. We never receive your payment card details.
            </p>

            <h3>Virtual items</h3>
            <p>
              Stitch Coin and AI Credit are limited, revocable, non-transferable
              licenses to use in-App features. They are not money, have no cash
              value, cannot be exchanged for one another, cannot be sold or
              transferred between accounts, and cannot be redeemed for real
              currency or anything of value outside the App. Stitch Coin buys
              permanent Pattern Unlocks; AI Credit pays for AI artwork
              generation. Advertising never grants AI Credit.
            </p>

            <h3>Premium Membership</h3>
            <p>
              Premium Plans (Weekly, Monthly, and Annual) are auto-renewing
              subscriptions billed through your App Store or Google Play
              account. Your subscription renews automatically at the then-current
              price unless you cancel at least 24 hours before the end of the
              current period. Manage or cancel a subscription in your store
              account settings — deleting your Stitch Wish account does not
              cancel a store subscription.
            </p>
            <p>
              A Monthly Trial, where offered, is a three-day no-charge
              introductory period on the Monthly Plan. It is available only to
              store-eligible players and only once across all Premium Plans, so
              a player who has already held any plan starts as a paid period.
              Trial credit grants are delivered only after the store verifies
              conversion into the first paid monthly period.
            </p>
            <p>
              Purchases require a Registered Account. A Guest Player may browse
              products and store prices but must register before buying a
              Premium Plan, a Stitch Coin Pack, or an AI Credit Pack.
            </p>

            <h3>Refunds and reversals</h3>
            <p>
              Refunds are granted by Apple or Google under their policies; we
              cannot issue store refunds directly. When a purchase is refunded
              or charged back, we reverse the corresponding Stitch Coin or AI
              Credit grant. The affected balance may become negative and cannot
              fund new spending until it again covers a requested cost. Content
              you already created or unlocked is not deleted.
            </p>
            <p>
              AI Credit is charged when artwork is successfully delivered.
              Disliking or declining a delivered result does not entitle you to
              a refund of that credit. A failed or safety-blocked generation
              costs no credit.
            </p>

            <h3>Pricing and availability</h3>
            <p>
              Prices, product contents, reward amounts, and feature availability
              may change. Changes apply going forward and never retroactively
              remove virtual items you have already been granted.
            </p>

            <h2 id="advertising">3. Advertising</h2>
            <p>
              The App offers optional Rewarded Ads that you explicitly start.
              There are no forced interstitials or banners. Rewards are subject
              to a daily pool and to server-side verification; we may withhold
              rewards for unverified, tampered, or abusive ad completions.
            </p>

            <h2 id="your-content">4. Your Content and the Catalog</h2>
            <p>
              You retain ownership of the patterns, artwork, photos, prompts,
              and profile content you create ("Your Content").
            </p>
            <p>
              When you submit a pattern to the public Pattern Catalog, you
              affirm that you created it or otherwise hold the rights needed to
              publish it, and you grant us a non-exclusive, worldwide,
              royalty-free license to host, technically transform, display, and
              distribute that submission, its preview, and its public metadata
              through the App, the catalog CDN, share links, and the service
              providers needed to operate them. We do not gain any right to sell
              your standalone artwork or use it outside operating and promoting
              that catalog entry. Withdrawing a pattern ends new catalog
              distribution; the license survives only as needed for existing
              stitching sessions, backups, moderation, fraud prevention, and
              legal records.
            </p>

            <h2 id="acceptable-use">5. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Submit content you do not have the rights to publish</li>
              <li>
                Submit or generate content that is illegal, sexually explicit,
                hateful, violent, harassing, deceptive, or that depicts
                identifiable people without consent
              </li>
              <li>Impersonate another person, creator, or brand</li>
              <li>
                Cheat, exploit bugs, tamper with balances or receipts, automate
                ad completions, or otherwise manipulate the economy
              </li>
              <li>
                Reverse engineer, decompile, scrape, or attack the App or its
                backend services
              </li>
              <li>Resell, rent, or commercially redistribute App content</li>
            </ul>

            <h2 id="moderation">6. Moderation and Enforcement</h2>
            <p>
              Automated safety signals and human moderators review catalog
              submissions, profile content, and AI prompts. Automated signals
              never make the final publication decision. We may reject, hold,
              withdraw, or remove content, and may suspend or terminate an
              account, when these Terms or our content policies are violated. We
              send a moderation notice for decisions that affect your content or
              account, and appeal paths are available in the App where the
              decision allows one.
            </p>

            <h2 id="ai-artwork">7. AI-Generated Artwork</h2>
            <p>
              AI artwork is generated by a third-party provider from the prompt
              you supply. Generated results are not unique to you, may resemble
              other outputs, and are provided without any warranty of
              originality or non-infringement. You are responsible for the
              prompts you write and for how you use the results, including
              anything you submit to the catalog.
            </p>

            <h2 id="license">8. License to Use the App</h2>
            <p>
              We grant you a personal, non-exclusive, non-transferable,
              revocable license to use the App on devices you own or control,
              for personal, non-commercial purposes. All rights in the App, its
              official patterns, code, and branding remain ours or our
              licensors'. On iOS, this license is also subject to Apple's
              Licensed Application End User License Agreement, and Apple is a
              third-party beneficiary of these Terms with the right to enforce
              them. Apple has no responsibility for the App or its support.
            </p>

            <h2 id="deletion">9. Account Deletion and Termination</h2>
            <p>
              You may delete your account at any time from the App or through
              our <Link to="/account-deletion">Account Deletion page</Link>.
              After a 30-day recovery window your account and associated
              personal data are permanently deleted. Deletion forfeits unspent
              Stitch Coin, AI Credit, and any remaining membership time, and
              does not cancel a store subscription. We may suspend or terminate
              your access for violations of these Terms or where required by
              law.
            </p>

            <h2 id="disclaimers">10. Disclaimers</h2>
            <p>
              The App is provided "as is" and "as available", without warranties
              of any kind to the fullest extent permitted by law. We do not
              warrant that the App will be uninterrupted, error-free, or that
              progress, patterns, or artwork will never be lost. Some
              jurisdictions do not allow certain warranty exclusions, so parts
              of this section may not apply to you.
            </p>

            <h2 id="liability">11. Limitation of Liability</h2>
            <p>
              To the fullest extent permitted by law, we are not liable for
              indirect, incidental, special, consequential, or punitive damages,
              or for lost data, progress, or virtual items. Our total liability
              for any claim relating to the App is limited to the greater of the
              amount you paid us in the 12 months before the claim or USD 50.
              Nothing here limits liability that cannot be limited by law,
              including your statutory consumer rights.
            </p>

            <h2 id="changes">12. Changes to These Terms</h2>
            <p>
              We may update these Terms. Material changes will be announced in
              the App or by email before they take effect. Continuing to use the
              App after the effective date means you accept the updated Terms.
            </p>

            <h2 id="governing-law">13. Governing Law</h2>
            <p>
              These Terms are governed by the laws of the Republic of Türkiye,
              without regard to conflict-of-law rules, and the courts of
              Istanbul have jurisdiction. If you are a consumer, you keep the
              protection of the mandatory laws and the competent courts of your
              country of residence.
            </p>

            <h2 id="general">14. General</h2>
            <p>
              These Terms, together with the{' '}
              <Link to="/privacy-policy">Privacy Policy</Link>, are the entire
              agreement between you and us about the App. If a provision is held
              unenforceable, the rest stays in force. Our failure to enforce a
              provision is not a waiver of it. You may not transfer your rights
              under these Terms; we may transfer ours to a successor that takes
              on the same obligations. We are not liable for delays or failures
              caused by events beyond our reasonable control, such as store,
              network, or infrastructure outages.
            </p>

            <h2 id="contact">15. Contact</h2>
            <p>
              Questions about these Terms? Email{' '}
              <a href="mailto:muratti32@gmail.com">muratti32@gmail.com</a> or
              visit our <Link to="/support">Support page</Link>. See also our{' '}
              <Link to="/privacy-policy">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
