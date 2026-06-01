import { ROUTES } from './config.js';
import { getSession, hasSession } from './session.js';

export function requireSession(redirectTo = ROUTES.login) {
    if (hasSession()) return true;
    window.location.replace(redirectTo);
    return false;
}

export function redirectIfAuthenticated(redirectTo = ROUTES.app) {
    if (!hasSession()) return false;
    window.location.replace(redirectTo);
    return true;
}

export function getCurrentUser() {
    return getSession();
}

export function isMasterAdmin() {
    return getCurrentUser()?.role === 'master_admin';
}

export function isAdmin() {
    return ['master_admin', 'admin'].includes(getCurrentUser()?.role);
}

export function isPlanner() {
    return ['master_admin', 'admin', 'planner'].includes(getCurrentUser()?.role);
}

export function canWrite() {
    return isAdmin();
}

export function canEditPlan() {
    return isMasterAdmin() || getCurrentUser()?.role === 'planner';
}
