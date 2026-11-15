# 12 Nov 2026 · Flagged 9 MCQs with broken options

`node scripts/flag-broken-mcq-options.mjs --apply` on the live bank (db `pcmb`).

- Backup first: `backups/flag-broken-mcq-options-2026-11-11T19-19-17-880Z.json` (9 documents in full, kept outside git).
- Wrote only `reviewFlags.options` (+ `flaggedAt`) on these 9; question content checked unchanged afterwards (9/9).
- With this branch deployed they stay out of practice, self-assessments, new tests and random picks until an admin edit fixes their options (the flag then clears itself).

| Question id | Subject · chapter | Key | Reasons |
|---|---|---|---|
| 6ada7beb87617a4e668a30c8 | Mathematics · Polynomials | A | only-a |
| 6ada7e6887617a4e668a491a | Science · Carbon and its Compounds | D | key-on-empty-option |
| 6ada955f1aa9e8d314acc8a4 | Biology · Cell: The Unit of Life | B | only-a, key-on-empty-option |
| 6adad31f1aa9e8d314adc490 | Chemistry · Aldehydes, Ketones and Carboxylic Acids | C | key-on-empty-option (Column I/II imported as options A/B) |
| 6adad3c41aa9e8d314adda28 | Chemistry · Biomolecules | B | gap |
| 6adad4c01aa9e8d314adefd6 | Chemistry · p-Block Elements (Class 12) | A | gap |
| 6adb20605225f0ad50c2924e | Biology · Evolution | D | only-a, key-on-empty-option |
| 6adb219b5225f0ad50c2bb34 | Biology · Ecosystem | D | key-on-empty-option |
| 6adb2ee851e3cba27d772514 | Science · SOUND | D | key-on-empty-option |

Undo: `$unset: { reviewFlags: 1 }` on these ids (or restore the backup).
