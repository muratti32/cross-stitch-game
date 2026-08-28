# Gate releases on complete reviewed translations

English is the canonical interface-text source, but a release cannot ship until every bundled App Display Language has complete translations with matching namespaces, keys, placeholders, and plural forms. Copying English into another locale is incomplete work, and any unexpected runtime fallback is reported and blocks release readiness.

Machine translation may produce the first draft, but a native speaker reviews every string before release; commerce, legal, authentication, and destructive-action text receives a second review. Layout length, language switching, formatting, and representative iOS and Android device flows are release gates alongside automated resource checks.

Feature code may be developed before its translations are approved, but it cannot enter a player release incomplete. We accept translation lead time and stricter coordination because bundled resources have no remote correction channel and silent fallback would turn every later feature into permanent localization debt.
