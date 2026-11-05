import { useEffect, useRef } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

export const IN_APP_BACK_EVENT = 'eazily-in-app-back';

export function pushNavigationState(values = {}, url = window.location.href) {
  const depth = Number(history.state?.eazilyDepth || 0) + 1;
  history.pushState({ ...history.state, ...values, eazilyDepth: depth }, '', url);
}

export function replaceNavigationState(values = {}, url = window.location.href) {
  history.replaceState({ ...history.state, ...values }, '', url);
}

export function requestInAppBack() {
  const detail = { handled: false };
  window.dispatchEvent(new CustomEvent(IN_APP_BACK_EVENT, { detail }));
  return detail.handled;
}

export function useNativeShellBack(onUnhandledBack, lightStatusBar = false) {
  const callback = useRef(onUnhandledBack);
  useEffect(() => { callback.current = onUnhandledBack; }, [onUnhandledBack]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    SystemBars.setStyle({ style: lightStatusBar ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => {});
  }, [lightStatusBar]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined;
    let listener;
    let active = true;
    NativeApp.addListener('backButton', async () => {
      const dialogs = [...document.querySelectorAll('[role="dialog"]')];
      const dialog = dialogs.at(-1);
      const closeButton = dialog?.querySelector('.sheet-close, [aria-label="Close"]');
      if (closeButton) {
        closeButton.click();
        return;
      }
      if (requestInAppBack() || callback.current?.()) return;
      if (window.confirm('Exit Eazily?')) await NativeApp.exitApp();
    }).then(handle => {
      if (active) listener = handle;
      else handle.remove();
    }).catch(() => {});
    return () => {
      active = false;
      listener?.remove();
    };
  }, []);
}
