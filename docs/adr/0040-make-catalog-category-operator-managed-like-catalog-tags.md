# Make Catalog Category operator-managed, like Catalog Tags

The ten first-release Catalog Category values were a hardcoded
`FIXED_CATEGORIES` enum in backend code, validated by string comparison at
every write site (Official Pattern Draft publish, admin pattern-metadata
update, Community Pattern submission). Adding, retiring, or relabeling a
category required a backend code change and deploy. Catalog Tags, in
contrast, were already database-backed and operator-managed per ADR-0039:
create, relabel, and deactivate (never hard-delete once referenced) through
the Operator Console.

We move Catalog Category onto the same model. A new `catalog.categories`
table (code, label, active, created_at) replaces the constants file, seeded
with the original ten values by migration. A foreign key from
`patterns.category_code` to `categories.code` replaces the ad hoc array
lookup, so referential integrity is enforced by the database instead of
scattered `Array.some()` checks. The Operator Console gets a Categories
page mirroring the Tags page exactly: list, create, edit label, deactivate.
Deactivated categories stay valid for patterns that already reference them
but disappear from pickers for new selections, identical to how Catalog Tag
deactivation already works.

Unlike Catalog Tags, category labels remain a single value rather than a
per-locale set: the existing public catalog `/catalog/categories` endpoint
was never locale-aware, and localizing category labels is out of scope for
this change (CONTEXT.md's Catalog Source Language note anticipates it but
no code path yet renders category labels per locale). Revisit as its own
decision if that requirement becomes concrete.

We accept that this changes a previously-stated first-release constraint
("the first-release values are" the fixed ten) into "seeded with these
values, then operator-mutable" — the same posture already accepted for
Catalog Tags in ADR-0039. Community Pattern submission's Catalog Metadata
Validation continues to require exactly one active Catalog Category, now
checked against the table instead of the constant.
