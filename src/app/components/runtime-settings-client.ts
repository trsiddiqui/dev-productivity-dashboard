'use client';

import { useEffect, useState } from 'react';
import {
  areCoreRuntimeSettingsComplete,
  areTestRailRuntimeSettingsComplete,
  buildRuntimeSettingsStorageKey,
  createStoredCoreRuntimeSettings,
  createStoredQaRuntimeSettings,
  getDefaultRuntimeSettingsFields,
  normalizeRuntimeSettingsFields,
  RUNTIME_QA_SETTINGS_COOKIE_NAME,
  RUNTIME_SETTINGS_COOKIE_NAME,
  serializeStoredCoreRuntimeSettings,
  serializeStoredQaRuntimeSettings,
  type RuntimeSettingsFields,
} from '@/lib/runtime-settings';

const SETTINGS_CHANGED_EVENT = 'dpd-runtime-settings-changed';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

interface RuntimeSettingsSnapshot {
  settings: RuntimeSettingsFields;
  configured: boolean;
}

function loadSettingsSnapshot(username: string): RuntimeSettingsSnapshot {
  if (!username || typeof window === 'undefined') {
    return { settings: getDefaultRuntimeSettingsFields(), configured: false };
  }

  try {
    const raw = window.localStorage.getItem(buildRuntimeSettingsStorageKey(username));
    if (!raw) {
      return { settings: getDefaultRuntimeSettingsFields(), configured: false };
    }

    const parsed = JSON.parse(raw) as Partial<RuntimeSettingsFields> | null;
    return {
      settings: normalizeRuntimeSettingsFields(parsed),
      configured: true,
    };
  } catch {
    return { settings: getDefaultRuntimeSettingsFields(), configured: false };
  }
}

function syncCookie(username: string, settings: RuntimeSettingsFields): void {
  if (!username || typeof document === 'undefined') return;

  const serializedCore = serializeStoredCoreRuntimeSettings(createStoredCoreRuntimeSettings(username, settings));
  document.cookie = `${RUNTIME_SETTINGS_COOKIE_NAME}=${serializedCore}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;

  if (areTestRailRuntimeSettingsComplete(settings)) {
    const serializedQa = serializeStoredQaRuntimeSettings(createStoredQaRuntimeSettings(username, settings));
    document.cookie = `${RUNTIME_QA_SETTINGS_COOKIE_NAME}=${serializedQa}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
  } else {
    document.cookie = `${RUNTIME_QA_SETTINGS_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}

function clearCookie(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${RUNTIME_SETTINGS_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
  document.cookie = `${RUNTIME_QA_SETTINGS_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;
}

function broadcastSettingsChanged(username: string): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_CHANGED_EVENT, {
    detail: { username },
  }));
}

export function useUserRuntimeSettings(username: string): {
  settings: RuntimeSettingsFields;
  configured: boolean;
  ready: boolean;
  save: (nextSettings: RuntimeSettingsFields) => RuntimeSettingsFields;
  reload: () => void;
} {
  const [state, setState] = useState<RuntimeSettingsSnapshot>({
    settings: getDefaultRuntimeSettingsFields(),
    configured: false,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const refresh = () => {
      const next = loadSettingsSnapshot(username);
      setState(next);
      if (next.configured && areCoreRuntimeSettingsComplete(next.settings)) {
        syncCookie(username, next.settings);
      } else {
        clearCookie();
      }
      setReady(true);
    };

    refresh();

    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== buildRuntimeSettingsStorageKey(username)) return;
      refresh();
    };

    const onCustom = (event: Event) => {
      const customEvent = event as CustomEvent<{ username?: string }>;
      if (customEvent.detail?.username && customEvent.detail.username !== username) return;
      refresh();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener(SETTINGS_CHANGED_EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SETTINGS_CHANGED_EVENT, onCustom as EventListener);
    };
  }, [username]);

  const save = (nextSettings: RuntimeSettingsFields): RuntimeSettingsFields => {
    const normalized = normalizeRuntimeSettingsFields(nextSettings);
    if (!username || typeof window === 'undefined') return normalized;

    window.localStorage.setItem(
      buildRuntimeSettingsStorageKey(username),
      JSON.stringify(normalized),
    );
    if (areCoreRuntimeSettingsComplete(normalized)) {
      syncCookie(username, normalized);
    } else {
      clearCookie();
    }
    setState({ settings: normalized, configured: true });
    broadcastSettingsChanged(username);
    setReady(true);
    return normalized;
  };

  const reload = () => {
    const next = loadSettingsSnapshot(username);
    setState(next);
    if (next.configured && areCoreRuntimeSettingsComplete(next.settings)) {
      syncCookie(username, next.settings);
    } else {
      clearCookie();
    }
    setReady(true);
  };

  return {
    settings: state.settings,
    configured: state.configured,
    ready,
    save,
    reload,
  };
}
