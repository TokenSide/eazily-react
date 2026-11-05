import { requireBackend } from './experience.js';
let sdk;
export async function openOfficialCheckout(requestId) {
  const {data,error}=await requireBackend().functions.invoke('seller-create-payment',{body:{requestId}});
  if(error)throw error;if(data.error)throw new Error(data.error);
  if(!sdk)sdk=new Promise((resolve,reject)=>{if(window.Cashfree)return resolve();const script=document.createElement('script');script.src='https://sdk.cashfree.com/js/v3/cashfree.js';script.onload=resolve;script.onerror=()=>{sdk=null;reject(new Error('Payment checkout could not load. Please retry.'));};document.head.appendChild(script);});
  await sdk;
  // Closing/returning from checkout never marks a booking paid. The webhook does that.
  await window.Cashfree({mode:data.mode}).checkout({paymentSessionId:data.paymentSessionId,redirectTarget:'_modal'});
}
