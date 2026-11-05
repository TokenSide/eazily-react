import { translate } from "../../lib/translate.js";
import { useEffect, useState } from 'react';
import { rpc } from '../../services/experience.js';
import { UserBusyLabel } from '../user-motion/UserLoading.jsx';
export default function WalletCheckout({
  booking,
  notify
}) {
  const [balance, setBalance] = useState(0);
  const [used, setUsed] = useState(Number(booking.wallet_used || 0));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    rpc('wallet_balance').then(setBalance).catch(e => notify(e.message));
  }, [notify]);
  async function apply() {
    setBusy(true);
    try {
      const result = await rpc('reserve_wallet', {
        p_booking: booking.id
      });
      setUsed(Number(result.wallet_used));
      setBalance(await rpc('wallet_balance'));
      notify('Wallet credit applied to this booking');
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="summary"><h3>{translate("Checkout")}</h3><div className="summary-row"><span>{translate("Confirmed quote")}</span><b>{translate("\u20B9 ")}{translate(booking.quoted_total)}</b></div><div className="summary-row"><span>{translate("Wallet credit used")}</span><b>{translate("\u20B9 ")}{translate(used.toFixed(2))}</b></div><div className="summary-row total"><span>{translate("Remaining payment")}</span><b>{translate("\u20B9 ")}{translate((Number(booking.quoted_total) - used).toFixed(2))}</b></div><p>{translate("Available wallet balance: \u20B9 ")}{translate(Number(balance).toFixed(2))}</p><button className="btn btn-outline full" disabled={busy || balance <= 0 || used > 0} onClick={apply}>{busy ? <UserBusyLabel>Applying…</UserBusyLabel> : translate('Apply eligible wallet credit')}</button><small>{translate("The server applies the programme redemption limit. Complete any remaining payment through the official payment option when available. Cancelled bookings return reserved wallet credit.")}</small></div>;
}
