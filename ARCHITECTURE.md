# admin_web_react architecture

A React port of the Flutter `admin_web` panel. How it is layered, why, and how
to add a feature. The exercise catalogue is the worked example — copy it.

## The layers

```
Page / Component       UI + ephemeral state (search text, filter chips, tab index)
      ↓ useQuery                              ↑ mutateAsync
Hooks                  wiring + read-only views          src/hooks/
      ↓
Repository / Service   typed models in/out; the ONLY layer that
                       knows whether data is API or Firestore   src/services/
      ↓
adminApi               one fetch client, one base URL, auth header,
                       401-retry, error unwrapping              src/lib/api-client.ts
```

Types (`src/types/`) are plain TypeScript, no Firebase imports, and cross every
layer.

## What replaced what

| Flutter | React |
|---|---|
| Riverpod `FutureProvider` / `AsyncNotifier` | TanStack Query `useQuery` / `useMutation` |
| Riverpod `StreamProvider` (Firestore) | `onSnapshot` inside a `useEffect` hook |
| `ExerciseCatalogController` | `useSaveExercise` / `useUploadExerciseMedia` (`onSettled` reload) |
| `dio` + `AdminApiClient` | `fetch` + `adminApi` (same retry/unwrap semantics) |
| `fl_chart` + `CustomPainter` | Recharts |
| `ScaffoldMessenger` snackbars | `sonner` toasts |
| `showDialog` | Radix Dialog (shadcn/ui) |
| `image_picker` / `web_file_pick` | hidden `<input type="file">` |
| Material 3 widgets | Tailwind v4 + shadcn/ui primitives |

## Why a repository layer

This panel is migrating feature by feature from direct-Firestore reads to the
backend API. The repository is the seam that makes that a one-file change
instead of a page rewrite.

The second job is **error normalization**. Firestore throws `FirebaseError`, the
API throws `ApiException`. Without a repository, every page has to know which
backend it is talking to in order to catch correctly. Repositories catch and
re-throw `ApiException` and nothing else — see `guard` in
`services/exercise-catalog-repository.ts`.

## Why mutations own the reload

Reads are not realtime. Nothing puts a change on screen by itself, so **every
write must be followed by a reload**, and that rule belongs in one place —
`onSettled` on the mutation, not in each `onClick`.

It has been forgotten before. Two bugs this structurally prevents:

- Media upload refreshed the exercise rows but not the signed preview URLs, so a
  newly uploaded video showed nothing until a page reload.
- Uploading a file and then hitting Cancel discarded the refresh, even though the
  upload had already written server-side.

`onSettled` fires on success *and* failure, on purpose: a save that returned 409
or timed out may still have landed, and a stale list after an ambiguous write is
worse than one extra fetch.

Mutations use `mutateAsync` so the error reaches the caller: a form needs to show
"that id is taken" next to its own save button, not in the page behind it.

## Reads are typed, writes are patches

`Exercise` is a read model. Saves go through `ExercisePatch` instead, because the
API distinguishes three states per field and an object with nullable fields can
only express two:

| body contains | server does |
|---|---|
| field absent | leaves the stored value alone |
| field with a value | writes it |
| field explicitly `null` | **deletes** it |

Only the third state lets an admin blank a field. Omitting it is why blanking
used to appear to succeed and change nothing.

The patch is also what protects fields the panel doesn't model. The backend
schema is `.catchall(z.unknown())`, so unknown keys pass through untouched — and
a patch never mentions `alternatives`, `duration`, or anything a future seeder
adds. A full-document write would silently drop them.

## Adding a feature

1. **Types** in `src/types/` — a `parseX` function, no Firebase imports. Add a
   patch type if it is writable.
2. **Repository** in `src/services/` — typed in and out, `ApiException` only.
3. **Hooks** in `src/hooks/` — a `useQuery` for the read, a `useMutation` per
   write with `onSettled` reloading the query.
4. **Page** in `src/pages/` — call the hooks, keep only ephemeral state local.

## Conventions

- **No code generation.** Everything hand-written, including the parsers.
- **Layer-first, not feature-first.** At ~11 features the churn of reorganising
  isn't worth it.
- Query keys are arrays, narrowest last: `['program-catalog', id, 'media']`.
- TanStack Query owns server state. Ephemeral UI state stays in `useState`.
- `retry: false` globally — the API client already retries a 401 with a refreshed
  token, and everything else it throws is an `ApiException` the admin should see.

## Charts

Two charting surfaces: `components/common/workout-charts.tsx` (per-user tracker)
and `components/common/dashboard-charts.tsx` (home screen). Series colours are
the validated categorical slots `--chart-1…6` in `index.css`, assigned in **fixed
order and never cycled** — colour follows the entity, so filtering or switching
cohort must not repaint the survivors. A seventh muscle group folds into "Other"
rather than generating a hue, and a share bar indexes its segments *before*
dropping the empty ones for the same reason. Three light-mode slots sit under
3:1 contrast on the card surface, so every chart carries direct labels and a
legend; identity is never colour alone.

Entry animation is off on the dashboard chart. Its series is refetched on every
refresh and every cohort switch, and replaying a grow-in each time reads as the
data changing when only the filter did.

## The dashboard

`/dashboard` is application analytics, served whole by
`GET /api/admin/dashboard?cohort=customers|all`. Two definitions on it are load-
bearing and are stated on the screen itself rather than left to a reader's
assumption:

- **"Active" means trained recently, not opened the app recently.** Firestore
  holds no login or session timestamp — `lastWorkout` is the only presence signal
  the app writes — so this is a stricter bar than DAU and must never be relabelled
  as one. Subscription "active" is a separate question and is kept visually apart.
- **Rates are computed over customers by default**, excluding internal and QA
  accounts, with the excluded count always shown. Every headline here is a ratio,
  and a denominator padded with our own test accounts makes conversion read low
  while activity reads high.

Trials are always two cohorts (deliberate vs the old build's auto-grant at
signup) for the reason `classifyTrial` documents server-side. The counts are
computed in `modules/dashboard/service.ts`, which imports `userFromDoc` from the
conversion module — a second copy of the entitlement rules is how two screens end
up disagreeing about how many users are active.

## Rate limits worth knowing

`GET /api/admin/exercise-catalog` is capped at 30/min and signs ~314 SAS URLs per
call. The query holds it stale for 5 minutes and has `refetchOnWindowFocus` off —
it is refetched after a mutation, never on a whim.

`GET /api/admin/dashboard` is capped at 20/min and `/api/admin/conversion` at
12/min; both scan the whole `users` collection. The dashboard query is always
stale (landing on the home screen is a live scan) but `refetchOnWindowFocus` is
off, so alt-tabbing back does not re-scan.

## Not yet migrated

`users`, `payments`, `complaints`, `recipes` still read Firestore directly through
`src/services/*-service.ts`. That is deliberate, mirroring the mobile app's
patterns — a scope decision, not an oversight.

One caveat worth flagging when that changes: `admin-user-service.ts` performs
production user deletion and subscription grants by direct Firestore write,
bypassing the backend's `requireAdmin`, its validation, and its audit log. It is
the highest-risk direct-write path in the panel.

## Auth

Admin access is the `role: 'admin'` **custom claim** on the Firebase ID token —
not an email allowlist. `auth/admin-auth.ts` signs out any account without it, so
reaching the panel at all proves the claim is present.

The backend additionally requires `email_verified == true`, which the client does
*not* check. Google sign-in always sets it, but an admin created via
email/password without verifying would pass the panel's gate and then 403 on
every API call.

## Not ported

The Flutter panel's `pages/coupons/` (`CouponListPage`, `CouponFormPage`,
`CouponModel`, `CouponApiService` — ~1,100 lines) is unreachable dead code:
nothing in the shell's navigation or anywhere else references it, and the voucher
system superseded it. It was deliberately left out of this port.
