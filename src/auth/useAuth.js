import { useEffect, useState, useSyncExternalStore } from 'react';
import { createAuthController } from './controller.js';
import { authRuntime } from './runtime.js';

// The app mounts useAuth once (App.jsx). Screens below it that only receive `account`
// reach the same controller through usePhoneVerification — never a second SDK listener.
let sharedController = null;
const sharedListeners = new Set();
const setShared = controller => { sharedController = controller; sharedListeners.forEach(listener => listener()); };
const subscribeShared = listener => { sharedListeners.add(listener); return () => sharedListeners.delete(listener); };
const getShared = () => sharedController;
const noSubscribe = () => () => {};
const noSnapshot = () => null;

export function useAuth(){
  const [controller]=useState(()=>createAuthController({...authRuntime,sessionStorage:window.sessionStorage,localStorage:window.localStorage}));
  const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  useEffect(()=>controller.start(),[controller]);
  useEffect(()=>{setShared(controller);return()=>{if(sharedController===controller)setShared(null);};},[controller]);
  useEffect(()=>{
    const check=()=>{if(document.visibilityState==='visible'&&controller.getSnapshot().account.user)void controller.refresh();};
    const timer=setInterval(check,60000);document.addEventListener('visibilitychange',check);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',check);};
  },[controller]);
  return {...state,controller};
}

export function usePhoneVerification(){
  const controller=useSyncExternalStore(subscribeShared,getShared,getShared);
  const snapshot=useSyncExternalStore(controller?controller.subscribe:noSubscribe,controller?controller.getSnapshot:noSnapshot,controller?controller.getSnapshot:noSnapshot);
  return {
    link: snapshot?.phoneLink || { status: 'idle', phone: '', error: '', resendAt: 0 },
    start: phone => controller ? controller.startPhoneVerification(phone) : Promise.resolve(false),
    confirm: code => controller ? controller.confirmPhoneVerification(code) : Promise.resolve(false),
    cancel: () => controller?.cancelPhoneVerification(),
    available: Boolean(controller),
  };
}
