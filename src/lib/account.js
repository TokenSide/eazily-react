import { createContext, useContext } from 'react';

export const AccountContext = createContext({ user: null, profile: null, roles: [], requestAuth: () => window.dispatchEvent(new Event('eazily-sign-in')), refresh: async () => {} });
export function useAccount() { return useContext(AccountContext); }
export function requestSignIn() { window.dispatchEvent(new Event('eazily-sign-in')); }
