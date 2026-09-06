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

// "operator" is the data-entry role (formerly "admin").
export function isOperator() {
    return ['master_admin', 'operator'].includes(getCurrentUser()?.role);
}

export function isPlanner() {
    return ['master_admin', 'operator', 'planner'].includes(getCurrentUser()?.role);
}

// planner ranks above operator: everything operator can edit, plus plan/schedule edits.
export function canWrite() {
    return isPlanner();
}

export function canEditPlan() {
    return isMasterAdmin() || getCurrentUser()?.role === 'planner';
}
