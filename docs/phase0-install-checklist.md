# Phase 0 — Packaged-Build Verification Checklist

Run this against the NSIS installer in `dist/` after `npm run dist`.
Phase 0 ships **unsigned**: Windows SmartScreen will warn ("Windows protected
your PC") — click "More info" → "Run anyway". Expected until a code-signing
certificate is purchased (pre-distribution to-do, D-14).

Tip: to test first-run behaviour without touching your real data, set the
environment variable `JOBPIN_DATA_DIR` to an empty folder before launching,
or temporarily rename your existing `%USERPROFILE%\jobpin-data`.

- [ ] 1. Run the installer. It offers a choice of install directory (oneClick: false).
- [ ] 2. Launch Jobpin from the Start Menu. The window opens.
- [ ] 3. Server status shows green "running"; "Database schema: v1".
- [ ] 4. "Open folder" opens `%USERPROFILE%\jobpin-data` in Explorer with:
      `company\company_memory.md`, `company\values.md`, `company\boss_preferences.json`,
      `company\legal_templates\`, `company\onboarding_templates\`, `jobs\`, `jobpin.db`.
- [ ] 5. Quit. Relaunch. Status is green again; no duplicate scaffold, files preserved
      (edit `values.md` before relaunch to confirm it is untouched).
- [ ] 6. Launch a second copy while one is running: the existing window is focused,
      no second window appears.
- [ ] 7. **Offline test:** disable Wi-Fi/Ethernet, relaunch: everything above still works.
- [ ] 8. Uninstall via Windows Settings. `%USERPROFILE%\jobpin-data` **must survive**
      uninstall (the boss's data is never the installer's to delete).
