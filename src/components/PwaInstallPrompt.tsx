"use client";

import { Download, Share2, Smartphone, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const STORAGE_KEY = "udharbook-install-prompt-v1";
const SESSION_KEY = `${STORAGE_KEY}-shown`;
const DISMISSAL_DAYS = 7;
const PROMPT_DELAY_MS = 1500;

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
}

type InstallPreference = {
  dismissedAt?: string;
  installed?: boolean;
};

function isStandalone() {
  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || standaloneNavigator.standalone === true;
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function readPreference(): InstallPreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) as InstallPreference : {};
  } catch {
    return {};
  }
}

function writePreference(preference: InstallPreference) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // Storage restrictions should not break the install flow.
  }
}

function wasRecentlyDismissed(preference: InstallPreference) {
  if (!preference.dismissedAt) return false;
  const dismissedAt = new Date(preference.dismissedAt).getTime();
  if (!Number.isFinite(dismissedAt)) return false;
  return Date.now() - dismissedAt < DISMISSAL_DAYS * 24 * 60 * 60 * 1000;
}

function manualInstallGuidance() {
  const userAgent = navigator.userAgent;

  if (/Edg\//.test(userAgent)) {
    return "Open the Edge menu and select Apps, then Install UdharBook.";
  }
  if (/Chrome|CriOS/.test(userAgent)) {
    return 'Open the browser menu and select "Install app" or "Add to Home screen".';
  }
  if (/Safari/.test(userAgent) && !/Chrome|CriOS|Edg\//.test(userAgent)) {
    return 'Open the File menu and select "Add to Dock", or use Safari on iPhone or iPad to add UdharBook to the Home Screen.';
  }
  if (/Firefox/.test(userAgent)) {
    return "For an installed app experience, open UdharBook in Chrome or Edge and use the browser install option.";
  }
  return 'Open your browser menu and look for "Install app" or "Add to Home screen".';
}

export function PwaInstallPrompt() {
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const ios = isIosDevice();
    setIsIos(ios);

    if (isStandalone()) {
      writePreference({ ...readPreference(), installed: true });
      return;
    }

    const preference = readPreference();
    let shownThisSession = false;
    try {
      shownThisSession = window.sessionStorage.getItem(SESSION_KEY) === "true";
    } catch {
      // Continue without session suppression if storage is unavailable.
    }

    if (preference.installed || wasRecentlyDismissed(preference) || shownThisSession) return;

    let timer: number | undefined;
    const schedulePromotion = () => {
      timer = window.setTimeout(() => {
        if (isStandalone()) return;
        try {
          window.sessionStorage.setItem(SESSION_KEY, "true");
        } catch {
          // A blocked session store should not prevent the prompt from opening.
        }
        setOpen(true);
      }, PROMPT_DELAY_MS);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      deferredPrompt.current = event as BeforeInstallPromptEvent;
      setCanInstall(true);
      setShowInstructions(false);
    };

    const handleInstalled = () => {
      deferredPrompt.current = null;
      setCanInstall(false);
      setOpen(false);
      writePreference({ installed: true });
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    if (document.readyState === "complete") {
      schedulePromotion();
    } else {
      window.addEventListener("load", schedulePromotion, { once: true });
    }

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("load", schedulePromotion);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function dismiss() {
    writePreference({ ...readPreference(), dismissedAt: new Date().toISOString() });
    setOpen(false);
    setShowInstructions(false);
  }

  async function install() {
    const prompt = deferredPrompt.current;
    if (!prompt) {
      setShowInstructions(true);
      return;
    }

    setInstalling(true);
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      deferredPrompt.current = null;
      setCanInstall(false);

      if (choice.outcome === "accepted") {
        writePreference({ installed: true });
        setOpen(false);
      } else {
        dismiss();
      }
    } catch {
      deferredPrompt.current = null;
      setCanInstall(false);
      setShowInstructions(true);
    } finally {
      setInstalling(false);
    }
  }

  if (!open) return null;

  const primaryLabel = canInstall
    ? installing ? "Opening..." : "Install App"
    : isIos ? "View Steps" : "Install Help";

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/45 px-3 pt-3 sm:items-center sm:p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section
        aria-labelledby="pwa-install-title"
        aria-modal="true"
        className="w-full max-w-sm overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        role="dialog"
        style={{ marginBottom: "max(12px, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-start gap-3 p-4 pb-3">
          <Image
            alt=""
            className="h-12 w-12 shrink-0 rounded-lg"
            height="48"
            src="/icon-192.png"
            width="48"
          />
          <div className="min-w-0 flex-1">
            <h2 id="pwa-install-title" className="text-base font-bold text-slate-950 dark:text-white">
              Install UdharBook App
            </h2>
            <p className="mt-1 text-sm leading-5 text-slate-600 dark:text-slate-300">
              Get faster access, a home-screen shortcut, and an app-like mobile experience.
            </p>
          </div>
          <button
            aria-label="Close install promotion"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
            onClick={dismiss}
            type="button"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        {showInstructions && (
          <div className="mx-4 mb-3 rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-slate-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-slate-200">
            {isIos ? (
              <ol className="space-y-2">
                <li className="flex gap-2">
                  <Share2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
                  <span>1. Tap the Share icon in Safari.</span>
                </li>
                <li className="flex gap-2">
                  <Smartphone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
                  <span>2. Select Add to Home Screen.</span>
                </li>
                <li className="pl-6">3. Tap Add.</li>
              </ol>
            ) : (
              <p>{manualInstallGuidance()}</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 p-4 dark:border-slate-700">
          <button
            className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-wait disabled:opacity-70"
            disabled={installing}
            onClick={install}
            type="button"
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            <span>{primaryLabel}</span>
          </button>
          <button
            className="min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={dismiss}
            type="button"
          >
            Not Now
          </button>
        </div>
      </section>
    </div>
  );
}
