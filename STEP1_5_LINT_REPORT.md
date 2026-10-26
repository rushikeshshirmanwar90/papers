# Step 1.5 — ESLint and Code-Quality Tooling Report

_Date: 2026-10-26 · Projects: `papers/` (Next.js backend), `pcmb-paper/` (Expo app)_

## Summary

| Check | Before | After |
|---|---|---|
| Backend `npm run lint` | **Crashed** (`ERR_PACKAGE_PATH_NOT_EXPORTED`) | **Pass**: 159 files, 0 errors, 0 warnings |
| Backend lint inside `next build` | **Silently skipped** (no config Next 14 recognises) | **Runs and passes** |
| Mobile `npx expo lint` | 1 error, 9 warnings | **Pass**: 0 errors, 0 warnings |

There are no dependency changes in either project. No lint rule was disabled, and nothing was suppressed with `eslint-disable`.

---

## 1. Original configuration problems

### Backend (`papers/`)

- **Installed:** `eslint` **8.57.1**, `eslint-config-next` **14.2.35**, `next` **14.2.35**. These are pinned in `package.json` and `package-lock.json` and have been since the initial commit.
- **Config file:** `eslint.config.mjs`, a *flat config* written for ESLint 9 and Next 15+:

  ```js
  import { defineConfig, globalIgnores } from "eslint/config";
  import nextVitals from "eslint-config-next/core-web-vitals";
  import nextTs from "eslint-config-next/typescript";
  export default defineConfig([...nextVitals, ...nextTs, globalIgnores([...])]);
  ```

- **`npm run lint`** (`eslint`) crashed before linting anything:
  `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './config' is not defined by "exports" in node_modules/eslint/package.json`
- No `.eslintrc*` file existed.

### Mobile (`pcmb-paper/`)

- **Installed:** `eslint` **9.39.5** and `eslint-config-expo` ~57.0.2, with flat config `eslint.config.js` (`eslint-config-expo/flat`). **This setup is correct and works.** `npx expo lint` ran and reported real code violations:
  - 1 error: `react-hooks/set-state-in-effect` at `src/app/questions.tsx:279`.
  - 9 warnings: all `@typescript-eslint/no-unused-vars`.

The two projects had different problems. The backend's *tooling* was broken, while the mobile tooling worked and found genuine *code* issues.

---

## 2. Root causes

**Backend:** the config was written for a newer stack than the one installed. There were three separate incompatibilities:

1. `eslint/config` (`defineConfig`, `globalIgnores`) is not exported by ESLint 8.57.1, as the crash shows; it comes from ESLint 9.
2. `eslint-config-next@14` exports **legacy eslintrc objects** (`{ extends: [...] }`), not the flat-config arrays that `...nextVitals` spreads. Even on ESLint 9 this file would not have worked with eslint-config-next 14.
3. Next 14's built-in lint (`next lint` and the lint step of `next build`) looks only for `.eslintrc*` files (verified in `node_modules/next/dist/lib/eslint/runLintCheck.js`). So **`next build` was silently skipping ESLint**.

**Mobile:** no tooling problem. The error was a real React pattern issue, a synchronous `setState` at the start of an effect, and the warnings were genuinely unused imports and variables.

---

## 3. The fix and why it is the smallest stable one

**Backend:** switch to the config format that ESLint 8.57 and eslint-config-next 14 are built for, keeping exactly the same two rulesets (`next/core-web-vitals` + `next/typescript`) and the same ignores.

Options considered and rejected:

| Option | Why not |
|---|---|
| Upgrade to ESLint 9 + eslint-config-next 15/16 | eslint-config-next 15+ targets Next 15+ and would bring a larger ecosystem upgrade (typescript-eslint, plugins) that this task says to avoid. |
| Keep flat config on ESLint 8.57 with `FlatCompat` | Needs the extra `@eslint/eslintrc` package. It's also an experimental flat-config path on 8.x, and `next build` still couldn't detect it. |
| **`.eslintrc.json` (chosen)** | No new dependencies. This is the format Next 14's own docs, `next lint` and `next build` use. |

**Mobile:** small code fixes only. The config was left as it was.

---

## 4. ESLint configuration before and after

### Backend: before (`papers/eslint.config.mjs`, removed)

```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
export default eslintConfig;
```

`package.json`: `"lint": "eslint"`

### Backend: after (`papers/.eslintrc.json`, new)

```json
{
  "root": true,
  "extends": ["next/core-web-vitals", "next/typescript"],
  "ignorePatterns": [".next/", "out/", "build/", "next-env.d.ts"]
}
```

`package.json`: `"lint": "eslint . --ext .js,.jsx,.ts,.tsx,.mjs"`

ESLint 8 lints only `.js` by default, so the extensions are listed. This keeps the old command's whole-project scope (src, tests, scripts), whereas `next lint` would only cover `src/`. `root: true` stops ESLint from picking up configs from parent folders.

**Rules are preserved, and the new config was checked to be live, not passing trivially:**
- `--print-config` shows 98 active rules, including `@next/next/*`, `react-hooks/rules-of-hooks` (error), `react-hooks/exhaustive-deps` (warn), `@typescript-eslint/no-unused-vars` (error) and `@typescript-eslint/no-explicit-any` (error).
- A deliberately bad snippet is correctly reported (unused vars, `any`, `prefer-const`).

### Mobile: unchanged (`pcmb-paper/eslint.config.js`)

---

## 5. Files modified

### Backend (`papers/`)

| File | Change |
|---|---|
| `eslint.config.mjs` | **Removed**: incompatible with the installed ESLint 8 and eslint-config-next 14. Its content is shown above and recoverable from git. |
| `.eslintrc.json` | **New**: the same rulesets and ignores in the supported format. |
| `package.json` | `lint` script changed from `eslint` to `eslint . --ext .js,.jsx,.ts,.tsx,.mjs`. (The `test` script from Step 1 is unchanged.) |
| `STEP1_5_LINT_REPORT.md` | **New**: this report. |

No backend source file needed a change: the codebase already passes the Next and TypeScript rules.

### Mobile (`pcmb-paper/`)

| File | Change |
|---|---|
| `src/app/questions.tsx` | Fixed the `set-state-in-effect` error (see below). Removed the unused `insets` (`useSafeAreaInsets()`), the unused `isTablet` / `isDesktop` (`useResponsive()` call in `BrowseQuestions`), and the now-unused `useSafeAreaInsets` import. |
| `src/app/explore.tsx` | Removed the unused `MaxContentWidth` import. |
| `src/components/dropdown-select.tsx` | Removed the unused `Platform` and `Spacing` imports. |
| `src/components/edit-room-modal.tsx` | Removed the unused `Spacing` import. |
| `src/components/explanation.tsx` | Removed the unused `ExplanationChunk` type import. |
| `src/components/math-text.tsx` | Removed the unused `useEffect` import. |

No styling, layout, navigation or API code was touched.

---

## 6. Dependency changes

**None.** `package.json` dependencies and `package-lock.json` are unchanged in both projects.

---

## 7. Lint errors fixed

### `react-hooks/set-state-in-effect`: `pcmb-paper/src/app/questions.tsx` (question bank list)

**Before:** two separate states, with `loading` switched on synchronously inside the effect. That causes an extra render on every filter change, which is what the rule flags.

```tsx
const [questions, setQuestions] = useState<Question[]>([]);
const [loading, setLoading] = useState(false);

useEffect(() => {
  let isCancelled = false;
  setLoading(true);                       // ← synchronous setState in effect
  fetchQuestions(filters).then((qs) => {
    if (!isCancelled) { setQuestions(qs); setLoading(false); }
  });
  return () => { isCancelled = true; };
}, [filters]);
```

**After:** the underlying state was fixed rather than the rule being disabled. "Loading" is now *derived*: the screen is loading while the last results belong to older filters. State is only set in the async callback.

```tsx
const [loaded, setLoaded] = useState<{ filters: FilterState; questions: Question[] } | null>(null);
const questions = loaded?.questions ?? [];
const loading = loaded?.filters !== filters;

useEffect(() => {
  let isCancelled = false;
  fetchQuestions(filters).then((qs) => {
    if (!isCancelled) setLoaded({ filters, questions: qs });
  });
  return () => { isCancelled = true; };
}, [filters]);
```

Why the behavior is preserved:
- `filters` is `useState` in `TabProvider` (`src/context/tab-context.tsx`), so its identity changes only when a filter actually changes.
- While a new load runs, the previous results stay shown with the spinner and "Finding questions…", as before.
- `fetchQuestions` catches its own errors and always resolves, so the derived flag can't get stuck.
- The cancellation for out-of-order responses is kept.
- One small improvement: on first open, the screen now shows "Loading questions…" straight away. Before, the first frame briefly showed loading as false.

### Warnings fixed (9 × `@typescript-eslint/no-unused-vars`)

Each flagged name was confirmed to appear only in its declaration or import before removal, so removing it can't change behavior. The two dropped hook calls (`useSafeAreaInsets()`, and `useResponsive()` in `BrowseQuestions`) only returned the unused values; `useResponsive()` is still used elsewhere in the file.

---

## 8. Remaining warnings

**None** in either project.

---

## 9. Validation results (all executed)

### Backend (`papers/`)

| Command | Result |
|---|---|
| `npm run lint` | **Pass**: 159 files, 0 errors, 0 warnings |
| `npx tsc --noEmit` | **Pass** |
| `npm test` | **Pass**: 39 tests, 39 passed, 0 failed (in-memory MongoDB) |
| `next build` with a reachable database (throwaway in-memory MongoDB) | **Pass**: compiles, **runs ESLint**, type-checks, generates all pages |
| `npm run build` with no reachable database | **Fails at "Generating static pages" on `/api/papers`.** This is the same failure recorded in Step 1, and it isn't a lint issue. Next 14 tries to prerender `GET /api/papers` at build time, which needs the database. It compiles, lints and type-checks first. |

### Mobile (`pcmb-paper/`)

| Command | Result |
|---|---|
| `npx expo lint` | **Pass**: 0 errors, 0 warnings (was 1 error, 9 warnings) |
| `npx tsc --noEmit` | **Pass** |

All failures before this step were pre-existing. No new failures were introduced.

---

## 10. Remaining tooling limitations

1. **Backend build needs a database.** `GET /api/papers` has no `export const dynamic = "force-dynamic"`, so `next build` queries MongoDB while prerendering it. With a real `MONGODB_URI` this also bakes a paper list into the build. That's an API behavior change, so it's left for a later step: adding `force-dynamic`, as the neighbouring `/api/questions` already does, would fix both.
2. **Two ESLint majors.** The backend stays on ESLint 8.57 (end-of-life upstream) because eslint-config-next 14 is built for it, while mobile uses ESLint 9. Moving the backend to flat config and ESLint 9 should happen together with a Next 15+ upgrade.
3. **No root-level lint command.** Each project is linted from its own folder (`npm run lint` / `npx expo lint`).
4. The backend ESLint 8 run prints nothing on success; the `--format json` count above (159 files) confirms files are actually linted.
5. A note left by `next dev` in `papers/AGENTS.md` mentions `node_modules/next/dist/docs/`, which doesn't exist in Next 14.2.35. It has no effect on tooling.

Step 2A has not been started.
