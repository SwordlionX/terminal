import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

const getSnapshot = () => window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
const getServerSnapshot = () => false;

export function useIsMobile() {
  // Hydration must start with the same layout as the server, then observe the viewport.
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
