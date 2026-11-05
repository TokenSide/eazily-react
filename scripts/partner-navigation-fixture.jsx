import React from 'react';
import { createRoot } from 'react-dom/client';
import PartnerApp from '../src/pages/PartnerApp.jsx';
import { AccountContext } from '../src/lib/account.js';
import { RealtimeProvider } from '../src/lib/realtime.jsx';
import '../src/styles.css';
import '../src/experience.css';
import '../src/partner.css';

const root=createRoot(document.getElementById('root'));
const realtime={available:false,connectionState:'Offline',networkOnline:true,revision:0,scopes:[],lastSyncedAt:null,setPublicAudience:()=>{},retry:()=>{}};
window.renderRole=role=>{
  history.replaceState({eazilyDepth:0},'',location.href);
  const account={user:{id:`navigation-${role}`},profile:{id:`navigation-${role}`,full_name:'Pending Partner',account_status:'active'},roles:[role],applications:[{id:`application-${role}`,role,status:'submitted',details:{name:'Pending Partner',businessName:'Pending Partner',creatorName:'Pending Partner',city:'Bhopal',stage:5}}],assessments:{},staff:null,isAdmin:false};
  root.render(<AccountContext.Provider value={{...account,logout:async()=>{}}}><RealtimeProvider value={realtime}><div className="phone-shell"><PartnerApp role={role} account={account} notify={message=>window.lastNotice=message} onWorkspace={()=>{}} onAddRole={()=>{}} onEditRegistration={()=>window.registrationRequested=true}/></div></RealtimeProvider></AccountContext.Provider>);
};
