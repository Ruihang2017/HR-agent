# Developer-supplied template content (AU market — PRD D-16)

**This is where the lawyer-reviewed template content lands.** The app bundles these files as
defaults and copies them into the boss's `jobpin-data/company/legal_templates/` and
`onboarding_templates/` at first run; the runtime copies are the boss's to edit.

```
templates/
  au/
    emails/       # invitation (online/onsite), reschedule, rejection,
                  # more-materials, onboarding email        → F6.1 (Phase 4, MVP)
    onboarding/   # onboarding documents                     → F6.2 (immediately post-MVP, D-19)
    legal/        # offer letters, contracts, legal notices  → F6.3 (post-MVP)
```

Rules (PRD F6.3 / D-16 / D-7):

1. Every template carries a **version** and a **jurisdiction tag** (`AU`) in its front-matter.
2. Legal and onboarding content must be **lawyer-reviewed before shipping** — record the review
   date and reviewer in the front-matter. Engineering never invents legal wording.
3. English-first (D-7), Australian business norms.
4. Generated documents from these templates always require human review before use (PRD section 11.1).
