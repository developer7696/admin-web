import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/auth/auth-context';
import { Shell } from '@/app/shell';
import { LoginPage } from '@/pages/login';

/// Every pane is loaded on demand.
///
/// They used to be static imports, which meant one bundle containing all
/// fifteen panes plus Recharts — an admin opening the Dashboard downloaded the
/// recipe editor, the program editor and the exercise catalogue before anything
/// appeared. Recharts alone is ~420KB and only three panes ever draw a chart.
///
/// `login` and `shell` stay static on purpose: they are the first paint, and
/// code-splitting them would only add a network round trip in front of the
/// screen the admin is already waiting on.
const DashboardHome = lazy(() =>
  import('@/pages/dashboard-home').then((m) => ({ default: m.DashboardHome })),
);
const VouchersPage = lazy(() =>
  import('@/pages/vouchers').then((m) => ({ default: m.VouchersPage })),
);
const ConversionPage = lazy(() =>
  import('@/pages/conversion').then((m) => ({ default: m.ConversionPage })),
);
const UsersPage = lazy(() => import('@/pages/users').then((m) => ({ default: m.UsersPage })));
const PaymentsPage = lazy(() =>
  import('@/pages/payments').then((m) => ({ default: m.PaymentsPage })),
);
const AppleLinksPage = lazy(() =>
  import('@/pages/apple-links').then((m) => ({ default: m.AppleLinksPage })),
);
const ComplaintsPage = lazy(() =>
  import('@/pages/complaints').then((m) => ({ default: m.ComplaintsPage })),
);
const RecipesPage = lazy(() => import('@/pages/recipes').then((m) => ({ default: m.RecipesPage })));
const ProgramsPage = lazy(() =>
  import('@/pages/programs').then((m) => ({ default: m.ProgramsPage })),
);
const ExerciseCataloguePage = lazy(() =>
  import('@/pages/exercise-catalogue').then((m) => ({ default: m.ExerciseCataloguePage })),
);
const ArticlesPage = lazy(() =>
  import('@/pages/articles').then((m) => ({ default: m.ArticlesPage })),
);
const UserBillingPage = lazy(() =>
  import('@/pages/user-billing').then((m) => ({ default: m.UserBillingPage })),
);
const UserWorkoutTrackerPage = lazy(() =>
  import('@/pages/user-workout-tracker').then((m) => ({ default: m.UserWorkoutTrackerPage })),
);

/// Pathless layout route whose only job is to give the lazy panes a Suspense
/// boundary that sits INSIDE the shell's scroll container.
function PaneOutlet() {
  return <Outlet />;
}

function FullScreenSpinner() {
  return (
    <div className="flex h-full items-center justify-center py-24">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}

/// Routes to the dashboard or the login screen based on auth state — the direct
/// equivalent of the Flutter `_AuthGate`.
export function App() {
  const { user, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Authentication error: {error}
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <Routes>
      {/* One Suspense boundary inside the shell, not around it: the sidebar and
          navbar must stay on screen while a pane's chunk loads, or every
          navigation would blank the whole window. */}
      <Route element={<Shell />}>
        <Route
          element={
            <Suspense fallback={<FullScreenSpinner />}>
              <PaneOutlet />
            </Suspense>
          }
        >
          <Route path="/dashboard" element={<DashboardHome />} />
          <Route path="/vouchers" element={<VouchersPage />} />
          {/* Command Center was folded into the Dashboard — it had become the same
              numbers under a filter, and three screens disagreeing about "active"
              was worse than one screen with a filter row. Redirected rather than
              removed so existing links and bookmarks still land somewhere. */}
          <Route path="/growth" element={<Navigate to="/dashboard" replace />} />
          <Route path="/conversion" element={<ConversionPage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/users/:uid/billing" element={<UserBillingPage />} />
          <Route path="/users/:uid/workouts" element={<UserWorkoutTrackerPage />} />
          <Route path="/payments" element={<PaymentsPage />} />
          <Route path="/apple-links" element={<AppleLinksPage />} />
          <Route path="/complaints" element={<ComplaintsPage />} />
          <Route path="/recipes" element={<RecipesPage />} />
          <Route path="/programs" element={<ProgramsPage />} />
          <Route path="/programs/:id" element={<ProgramsPage />} />
          <Route path="/exercises" element={<ExerciseCataloguePage />} />
          <Route path="/articles" element={<ArticlesPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
