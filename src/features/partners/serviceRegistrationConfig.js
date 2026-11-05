// Local UI preview only. Hide skipping unless the isolated demo flag is enabled.
import { PARTNER_DEMO_ENABLED } from './demo/config.js';
export const SERVICE_REGISTRATION_TEST_SKIP_ENABLED = PARTNER_DEMO_ENABLED
  && import.meta.env.VITE_ENABLE_SERVICE_REGISTRATION_TEST_SKIP !== 'false';
