import { supabase } from '../lib/supabase.js';
import { getWorkspaceAccount } from '../services/partners.js';
import { createDevelopmentOtpRuntime } from './developmentOtp.js';
import { DEVELOPMENT_OTP_ENABLED } from './config.js';

export const authRuntime = DEVELOPMENT_OTP_ENABLED && !supabase
  ? createDevelopmentOtpRuntime(globalThis.sessionStorage)
  : { client: supabase, loadAccount: getWorkspaceAccount };
