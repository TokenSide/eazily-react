import { routeAccess, clearAccountStorage } from '../auth/policy.js';
export const workspacePaths = { customer: '/user/home', professional: '/seller/service/dashboard', influencer: '/seller/influencer/dashboard', consultant: '/seller/consultant/dashboard', admin: '/admin' };
export function sellerMemberships(account) { return [...new Set((account.applications || []).map(a=>a.role))].filter(r=>['professional','influencer','consultant'].includes(r)); }
export function canOpenWorkspace(account,role){return ['allowed','public'].includes(routeAccess(account,role));}
export function resolveWorkspace(account,requested){return requested?(canOpenWorkspace(account,requested)?requested:null):'customer';}
export function roleFromPath(path){return Object.keys(workspacePaths).find(role=>workspacePaths[role]===path);}
export function clearWorkspaceCache(){clearAccountStorage(sessionStorage);clearAccountStorage(localStorage);}
