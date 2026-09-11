
import React, { useEffect, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { UserRole } from './types';
import ProtectedRoute from './components/auth/ProtectedRoute';
import { debugLog } from './config';

// -- Static imports: public/auth pages render immediately with no loading spinner --
import LanguageSelectionModal from './components/common/LanguageSelectionModal';
import SelectContextPage from './components/auth/SelectContextPage';
import OrganizationSetupWizard from './components/auth/AcademySetupWizard';
import LoginPage from './components/auth/LoginPage';
import RegistrationPage from './components/auth/RegistrationPage';
import OrganizationRegistrationPage from './components/auth/AcademyRegistrationPage';
import ResetPasswordPage from './components/auth/ResetPasswordPage';
import GoogleAuthCallbackPage from './components/auth/GoogleAuthCallbackPage';
import OrganizationAuthCallbackPage from './components/auth/AcademyAuthCallbackPage';
import VerifyAccountPage from './components/auth/VerifyAccountPage';
import UserApprovalPage from './components/auth/UserApprovalPage';
import LandingPage from './components/public/LandingPage';
import LegalPage from './components/legal/LegalPage';
import AccessibilityPage from './components/legal/AccessibilityPage';

// -- Lazy imports for the authenticated area (code-split by user role) --
const MainLayout = React.lazy(() => import('./components/layout/MainLayout'));

// DemoBoardPage and PublicBoardViewPage both statically import BoardViewPage — the single
// heaviest page in the app (the whole board grid: every cell type, GanttView, the dependency
// overlay, dnd-kit, formulaEngine, ...). Keeping these two eager (like the other public/auth
// pages above) pulled all of that into the main entry bundle for every visitor, since Rollup
// can't split a module into its own chunk while some route still reaches it via a static
// import chain — even though the normal `/boards/:id` route below already lazy-loads
// BoardViewPage on its own. Lazy-loading these two lets Rollup finally split BoardViewPage
// out into a real shared async chunk, at the cost of a brief spinner on these two
// (comparatively rare) routes instead of on every page load.
const DemoBoardPage = React.lazy(() => import('./components/demo/DemoBoardPage'));
const PublicBoardViewPage = React.lazy(() => import('./components/boards/PublicBoardViewPage'));

// -- User chunk --
const ProfilePage = React.lazy(() => import('./components/profile/ProfilePage'));

// -- Workspace/org-admin chunk --
const UserManagementPage = React.lazy(() => import('./components/admin/UserManagementPage'));
const AcademyHubPage = React.lazy(() => import('./components/admin/AcademyHubPage'));
const ThemeSettingsPage = React.lazy(() => import('./components/admin/ThemeSettingsPage'));

// -- Work management chunk --
const WorkspaceHomePage = React.lazy(() => import('./components/boards/WorkspaceHomePage'));
const BoardListPage = React.lazy(() => import('./components/boards/BoardListPage'));
const BoardViewPage = React.lazy(() => import('./components/boards/BoardViewPage'));
const PersonalHubPage = React.lazy(() => import('./components/personalHub/PersonalHubPage'));
const DashboardPage = React.lazy(() => import('./components/dashboard/DashboardPage'));
const FormsPage = React.lazy(() => import('./components/forms/FormsPage'));

// -- System-admin chunk --
const AcademyManagementPage = React.lazy(() => import('./components/admin/AcademyManagementPage'));
const TutorialSettingsPage = React.lazy(() => import('./components/admin/TutorialSettingsPage'));
const EmailTemplatesPage = React.lazy(() => import('./components/admin/EmailTemplatesPage'));

// -- Templates chunk --
const TemplatesPage = React.lazy(() => import('./components/boards/TemplatesPage'));
const PersonalHubTemplatePage = React.lazy(() => import('./components/admin/PersonalHubTemplatePage'));

const PageLoader: React.FC = () => (
  <div
    className="flex items-center justify-center min-h-screen bg-gray-50"
    role="status"
    aria-label="Loading page"
  >
    <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
  </div>
);

const App: React.FC = () => {
  const { user, contextSelectionMode, showLanguageModal, dismissLanguageModal } = useAuth();
  const userRole = user?.role ?? null;

  useEffect(() => {
    if (!userRole) return;
    if (
      userRole === UserRole.WORKSPACE_ADMIN ||
      userRole === UserRole.ORGANIZATION_ADMIN      ||
      userRole === UserRole.SYSTEM_ADMIN
    ) {
    }
    if (userRole === UserRole.ORGANIZATION_ADMIN) {
      void import('./components/admin/AcademyHubPage');
    }
    if (userRole === UserRole.SYSTEM_ADMIN) {
      void import('./components/admin/AcademyManagementPage');
    }
  }, [userRole]);

  // Global modal accessibility: Escape to close, focus-on-open, return-focus-on-close, focus trap
  useEffect(() => {
    const FOCUSABLE =
      'a[href],area[href],button:not([disabled]),input:not([disabled]),' +
      'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const CLOSE_TEXTS = new Set([
      // English
      'Close', 'Cancel', 'Go Back', 'Back', 'Skip',
      // Hebrew
      'סגור', 'ביטול', 'חזור', 'דלג',
    ]);

    const modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;

    const focusStack: Array<HTMLElement | null> = [];

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          focusStack.push(
            document.activeElement instanceof HTMLElement ? document.activeElement : null
          );
          requestAnimationFrame(() => {
            const first = node.querySelector<HTMLElement>(FOCUSABLE);
            first?.focus();
          });
        }
        for (const node of Array.from(mutation.removedNodes)) {
          if (!(node instanceof HTMLElement)) continue;
          const prev = focusStack.pop() ?? null;
          if (prev && document.contains(prev)) {
            requestAnimationFrame(() => prev.focus());
          }
        }
      }
    });

    observer.observe(modalRoot, { childList: true });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!modalRoot.lastElementChild) return;
      const topModal = modalRoot.lastElementChild;

      if (e.key === 'Escape') {
        const candidates = Array.from(
          topModal.querySelectorAll<HTMLButtonElement>('button:not([disabled])')
        ).filter(
          btn =>
            btn.hasAttribute('data-modal-escape') ||
            CLOSE_TEXTS.has(btn.textContent?.trim() ?? '')
        );
        if (candidates.length === 0) return;
        e.preventDefault();
        candidates[candidates.length - 1].click();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(topModal.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  debugLog('[App.tsx] Rendering with user:', 'color: #FFA500;', user);

  const firstLoginModal = showLanguageModal && user && !contextSelectionMode ? (
    <LanguageSelectionModal onClose={dismissLanguageModal} />
  ) : null;

  if (contextSelectionMode) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="*" element={<SelectContextPage />} />
        </Routes>
      </BrowserRouter>
    );
  }

  if (user && user.status === 'pending_setup') {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/setup-workspace" element={<OrganizationSetupWizard />} />
          <Route path="*" element={<Navigate to="/setup-workspace" replace />} />
        </Routes>
      </BrowserRouter>
    );
  }

  const redirectPath = user?.role === UserRole.SYSTEM_ADMIN ? '/admin' : '/WorkHubs';

  return (
    <>
      {firstLoginModal}
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={user ? <Navigate to={redirectPath} /> : <LoginPage />} />
        <Route path="/register" element={user ? <Navigate to={redirectPath} /> : <RegistrationPage />} />
        <Route path="/register-workspace" element={user ? <Navigate to={redirectPath} /> : <OrganizationRegistrationPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/google/callback" element={<GoogleAuthCallbackPage />} />
        <Route path="/auth/workspace/callback" element={<OrganizationAuthCallbackPage />} />
        <Route path="/verify-account" element={<VerifyAccountPage />} />
        <Route path="/approve-user" element={<UserApprovalPage />} />
        <Route path="/legal" element={<LegalPage />} />
        <Route path="/accessibility" element={<AccessibilityPage />} />
        <Route path="/demo-board/*" element={<Suspense fallback={<PageLoader />}><DemoBoardPage /></Suspense>} />
        <Route path="/public/board-view/:token/*" element={<Suspense fallback={<PageLoader />}><PublicBoardViewPage /></Suspense>} />

        {/* Authenticated routes */}
        <Route element={<Suspense fallback={<PageLoader />}><MainLayout /></Suspense>}>
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute allowedRoles={[UserRole.REGULAR_USER, UserRole.ORG_EDITOR, UserRole.WORKSPACE_ADMIN, UserRole.ORGANIZATION_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/WorkHubs"
              element={
                <ProtectedRoute allowedRoles={[UserRole.REGULAR_USER, UserRole.ORG_EDITOR, UserRole.WORKSPACE_ADMIN, UserRole.ORGANIZATION_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <WorkspaceHomePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/WorkHubs/:workspaceId/boards"
              element={
                <ProtectedRoute allowedRoles={[UserRole.REGULAR_USER, UserRole.ORG_EDITOR, UserRole.WORKSPACE_ADMIN, UserRole.ORGANIZATION_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <BoardListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/boards/:boardId"
              element={
                <ProtectedRoute allowedRoles={[UserRole.REGULAR_USER, UserRole.ORG_EDITOR, UserRole.WORKSPACE_ADMIN, UserRole.ORGANIZATION_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <BoardViewPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute allowedRoles={[UserRole.REGULAR_USER, UserRole.ORG_EDITOR, UserRole.WORKSPACE_ADMIN, UserRole.ORGANIZATION_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/forms"
              element={
                <ProtectedRoute allowedRoles={[UserRole.ORGANIZATION_ADMIN, UserRole.WORKSPACE_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <FormsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/personal-hub"
              element={
                <ProtectedRoute allowedRoles={[UserRole.REGULAR_USER, UserRole.ORG_EDITOR, UserRole.WORKSPACE_ADMIN, UserRole.ORGANIZATION_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <PersonalHubPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users/:userId/personal-hub"
              element={
                <ProtectedRoute allowedRoles={[UserRole.ORGANIZATION_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <PersonalHubPage />
                </ProtectedRoute>
              }
            />

            <Route path="/admin" element={<Navigate to="/dashboard" replace />} />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute allowedRoles={[UserRole.ORGANIZATION_ADMIN, UserRole.WORKSPACE_ADMIN]}>
                  <UserManagementPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users/:userId"
              element={
                <ProtectedRoute allowedRoles={[UserRole.ORGANIZATION_ADMIN, UserRole.WORKSPACE_ADMIN]}>
                  <ProfilePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/organization-hub"
              element={
                <ProtectedRoute allowedRoles={[UserRole.REGULAR_USER, UserRole.ORG_EDITOR, UserRole.WORKSPACE_ADMIN, UserRole.ORGANIZATION_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <AcademyHubPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/theme-settings"
              element={
                <ProtectedRoute allowedRoles={[UserRole.ORGANIZATION_ADMIN]}>
                  <ThemeSettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/organizations"
              element={
                <ProtectedRoute allowedRoles={[UserRole.SYSTEM_ADMIN]}>
                  <AcademyManagementPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/tutorials"
              element={
                <ProtectedRoute allowedRoles={[UserRole.SYSTEM_ADMIN]}>
                  <TutorialSettingsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/email-templates"
              element={
                <ProtectedRoute allowedRoles={[UserRole.SYSTEM_ADMIN]}>
                  <EmailTemplatesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/templates"
              element={
                <ProtectedRoute allowedRoles={[UserRole.ORGANIZATION_ADMIN, UserRole.WORKSPACE_ADMIN, UserRole.SYSTEM_ADMIN]}>
                  <TemplatesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/templates/personal-hub"
              element={
                <ProtectedRoute allowedRoles={[UserRole.ORGANIZATION_ADMIN]}>
                  <PersonalHubTemplatePage />
                </ProtectedRoute>
              }
            />
          </Route>

        {/* Catch-all */}
        <Route path="*" element={user ? <Navigate to={redirectPath} /> : <Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
    </>
  );
};

export default App;
