import { accountState, clearAccountStorage, confirmedPhone, EMPTY_ACCOUNT, normalizeIndianPhone, safeAuthError, validOtp } from './policy.js';

// One SDK listener per mounted controller. Tokens remain owned by the SDK.
export function createAuthController({ client, loadAccount, sessionStorage, localStorage, now=Date.now }) {
  const IDLE_LINK=Object.freeze({status:'idle',phone:'',error:'',resendAt:0});
  let snapshot={status:client?'initialising':'configuration_required',account:EMPTY_ACCOUNT,error:'',phone:'',contact:'',contactType:'phone',resendAt:0,developmentOtp:client?.auth?.developmentOtp===true,otpLength:client?.auth?.otpLength||6,phoneLink:IDLE_LINK};
  let generation=0,intent=0,linkIntent=0,subscription,active=false,loading=0,operation=false,loggedOut=false,lastUser=null;
  const listeners=new Set();
  const emit=patch=>{snapshot={...snapshot,...patch};listeners.forEach(fn=>fn());};
  const clear=()=>{clearAccountStorage(sessionStorage);clearAccountStorage(localStorage);};
  const refresh=async()=>{
    if (!client||!active) return EMPTY_ACCOUNT;
    const ticket=++generation; loading++;
    const previousAccount=snapshot.account;
    // Keep an authenticated form mounted during routine account refreshes.
    // Sign-in, sign-out and token-expiry events still clear the account explicitly.
    if (snapshot.account.user) emit({error:''});
    else emit({status:'initialising',account:EMPTY_ACCOUNT,error:''});
    try {
      const account=await loadAccount();
      if (!active||ticket!==generation) return EMPTY_ACCOUNT;
      if(lastUser&&lastUser!==account.user?.id)clear();
      lastUser=account.user?.id||null;
      emit({account,status:accountState(account)});
      return account;
    } catch (error) {
      if (active&&ticket===generation) {
        const expired=['bad_jwt','session_not_found','refresh_token_not_found','refresh_token_already_used'].includes(error?.code)||error?.status===401;
        if(expired)clear();
        emit({account:expired?EMPTY_ACCOUNT:previousAccount.user?previousAccount:EMPTY_ACCOUNT,
          status:expired?'session_expired':previousAccount.user?accountState(previousAccount):'error',
          error:'Account access could not be checked. Please retry.'});
      }
      return EMPTY_ACCOUNT;
    } finally {loading--;}
  };
  return {
    getSnapshot:()=>snapshot,
    subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
    start(){
      if(active)return()=>{};active=true;
      if(client){
        subscription=client.auth.onAuthStateChange((event,session)=>{
          if(!active)return;
          if(event==='SIGNED_OUT'||(!session&&event==='TOKEN_REFRESHED')){
            generation++;linkIntent++;clear();emit({account:EMPTY_ACCOUNT,status:event==='SIGNED_OUT'?'signed_out':'session_expired',phone:'',error:'',phoneLink:IDLE_LINK});
          } else if((event==='TOKEN_REFRESHED'||event==='USER_UPDATED')&&!loggedOut&&session?.user?.id&&session.user.id===snapshot.account.user?.id){
            // A renewed token or an update (e.g. phone verification) for the same account
            // must not reset an in-progress form.
            queueMicrotask(()=>{if(active)void refresh();});
          } else if(event==='SIGNED_IN'||event==='USER_UPDATED'||event==='TOKEN_REFRESHED'){
            if(loggedOut){queueMicrotask(()=>{void client.auth.signOut({scope:'local'}).catch(()=>{});});return;}
            generation++;clear();emit({account:EMPTY_ACCOUNT,status:'initialising'});
            // Do not await SDK calls inside its authentication callback/lock.
            queueMicrotask(()=>{if(active)void refresh();});
          }
        }).data.subscription;
        void refresh();
      }
      return()=>{active=false;generation++;intent++;subscription?.unsubscribe();subscription=null;};
    },
    refresh,
    async sendOtp(input){
      if(!client){emit({status:'configuration_required',error:'Phone verification is not configured in this environment.'});return false;}
      if(operation||loading||now()<snapshot.resendAt)return false;
      const request=typeof input==='object'&&input!==null?input:{contact:input};
      const raw=String(request.contact||'').trim();
      const isEmail=raw.includes('@');
      let contact;
      try {
        if(isEmail){
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw))throw new Error();
          if(snapshot.developmentOtp)throw new Error('development_email');
          contact=raw.toLowerCase();
        } else contact=normalizeIndianPhone(raw);
      } catch(error) {
        emit({error:error.message==='development_email'?'Local OTP testing requires a mobile number.':isEmail?'Enter a valid email address.':'Enter a valid Indian mobile number.'});return false;
      }
      loggedOut=false;operation=true;const ticket=generation;
      emit({status:'otp_sending',phone:isEmail?'':contact,contact,contactType:isEmail?'email':'phone',error:''});
      try {
        const data=request.data&&typeof request.data==='object'?request.data:undefined;
        const {error}=await client.auth.signInWithOtp({[isEmail?'email':'phone']:contact,options:{shouldCreateUser:request.shouldCreateUser!==false,...(data?{data}:{})}});
        if(error)throw error;
        if(ticket!==generation)return false;
        emit({status:'otp_sent',resendAt:now()+60000});return true;
      }catch(error){if(ticket===generation)emit({status:'error',error:safeAuthError(error),resendAt:now()+60000});return false;}
      finally{operation=false;}
    },
    async verifyOtp(code){
      const codeIsValid=client?.auth?.isOtpValid?client.auth.isOtpValid(code):validOtp(code);
      if(!client||operation||!snapshot.contact||!codeIsValid){emit({error:`Enter the ${snapshot.otpLength}-digit verification code.`});return false;}
      operation=true;const ticket=intent;emit({status:'verifying',error:''});
      try{
        const isEmail=snapshot.contactType==='email';
        const {error}=await client.auth.verifyOtp({[isEmail?'email':'phone']:snapshot.contact,token:code,type:isEmail?'email':'sms'});
        if(error)throw error;
        if(!active||ticket!==intent)return false;
        const account=await refresh();return Boolean(account.user);
      }catch(error){if(active&&ticket===intent)emit({status:'otp_sent',error:safeAuthError(error)});return false;}
      finally{operation=false;}
    },
    async signInWithGoogle(){
      if(!client?.auth?.signInWithOAuth){emit({error:'Google sign-in is not configured in this environment.'});return false;}
      if(operation)return false;
      operation=true;emit({error:''});
      try {
        const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:globalThis.location?.origin||undefined}});
        if(error)throw error;
        return true;
      } catch {emit({error:'Google sign-in is unavailable. Check the authentication provider configuration and try again.'});return false;}
      finally{operation=false;}
    },
    // Adds or changes the mobile number of a signed-in (e.g. email/Google) account through
    // Supabase's phone_change OTP. The SMS is sent by the server-side provider only.
    async startPhoneVerification(input){
      const link=snapshot.phoneLink;
      if(!client?.auth?.updateUser||snapshot.developmentOtp){emit({phoneLink:{...link,status:'error',error:'Mobile verification is not configured in this environment.'}});return false;}
      if(!snapshot.account.user){emit({phoneLink:{...link,status:'error',error:'Sign in before verifying a mobile number.'}});return false;}
      if(operation||now()<link.resendAt)return false;
      let phone;
      try{phone=normalizeIndianPhone(input);}catch{emit({phoneLink:{...link,status:'error',error:'Enter a valid Indian mobile number.'}});return false;}
      operation=true;const ticket=++linkIntent;
      emit({phoneLink:{status:'sending',phone,error:'',resendAt:link.resendAt}});
      try{
        const {error}=await client.auth.updateUser({phone});
        if(error)throw error;
        if(ticket!==linkIntent)return false;
        emit({phoneLink:{status:'sent',phone,error:'',resendAt:now()+60000}});return true;
      }catch(error){if(ticket===linkIntent)emit({phoneLink:{status:'error',phone,error:safeAuthError(error),resendAt:now()+60000}});return false;}
      finally{operation=false;}
    },
    async confirmPhoneVerification(code){
      const link=snapshot.phoneLink;
      if(!client||operation||link.status!=='sent'&&link.status!=='error'||!link.phone||!validOtp(code)){emit({phoneLink:{...link,error:'Enter the 6-digit verification code.'}});return false;}
      operation=true;const ticket=++linkIntent,originalId=snapshot.account.user?.id;emit({phoneLink:{...link,status:'verifying',error:''}});
      try{
        const {error}=await client.auth.verifyOtp({phone:link.phone,token:code,type:'phone_change'});
        if(error)throw error;
        if(!active||ticket!==linkIntent)return false;
        // Verified only when a fresh server user has the same account ID, the expected phone
        // and phone_confirmed_at; a phone value alone is never enough.
        const fresh=await client.auth.getUser();
        if(!active||ticket!==linkIntent)return false;
        const serverUser=fresh?.data?.user;
        const serverConfirmed=!fresh?.error&&originalId&&serverUser?.id===originalId&&confirmedPhone(serverUser)===link.phone;
        const account=serverConfirmed?await refresh():null;
        if(ticket!==linkIntent)return false;
        const verified=Boolean(serverConfirmed&&account?.user?.id===originalId&&confirmedPhone(account.user)===link.phone);
        emit({phoneLink:verified?IDLE_LINK:{...link,status:'sent',error:'Verification could not be confirmed. Please try again.'}});
        return verified;
      }catch(error){if(active&&ticket===linkIntent)emit({phoneLink:{...link,status:'sent',error:safeAuthError(error)}});return false;}
      finally{operation=false;}
    },
    cancelPhoneVerification(){linkIntent++;emit({phoneLink:{...IDLE_LINK,resendAt:snapshot.phoneLink.resendAt}});},
    changeNumber(){generation++;intent++;emit({status:client?'signed_out':'configuration_required',phone:'',contact:'',contactType:'phone',error:'',resendAt:0});},
    async logout(){
      generation++;intent++;linkIntent++;loggedOut=true;lastUser=null;clear();emit({account:EMPTY_ACCOUNT,status:'signed_out',phone:'',contact:'',contactType:'phone',error:'',resendAt:0,phoneLink:IDLE_LINK});
      // Local sign-out clears the SDK's own token storage even when remote revocation
      // is unavailable; do not retain a custom session/token copy.
      if(client){try{await client.auth.signOut({scope:'local'});}catch{ /* SDK storage is cleared below through configured adapter storage. */ }
        try { for(const key of Object.keys(localStorage||{}))if(/^sb-.*-auth-token(?:-code-verifier)?$/.test(key))localStorage.removeItem(key); }catch{ /* restricted storage */ }
      }
    }
  };
}
