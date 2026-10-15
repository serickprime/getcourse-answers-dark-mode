// GetCourse Answers — content script.
//
// This file decides whether the graphite dark theme applies to the current page
// and reflects that decision by toggling ONE attribute on <html>:
//
//     data-gc-answers-dark="on"
//
// The theme stylesheet (src/content/theme.css, injected by the manifest for the
// approved match pattern) has no effect unless that attribute is present. This
// keeps activation declarative and makes dynamically inserted content inherit
// the theme automatically, with no per-node processing.
//
// The theme is applied only when BOTH conditions hold:
//   1. the runtime pathname check passes (the exact "/teach/control/answers"
//      path or a descendant separated by "/"), and
//   2. the user's persisted preference (chrome.storage.local) is enabled.
//
// Privacy: this script never reads page text, never stores page data, never
// talks to any server, and writes nothing to the page except that single
// attribute on <html>. Disabling the theme removes the attribute, restoring the
// site's original appearance with no leftover inline styles or classes.

(() => {
  "use strict";

  const THEME_ATTRIBUTE = "data-gc-answers-dark";
  const THEME_ON = "on";
  const STORAGE_KEY = "darkModeEnabled";
  const STORAGE_AREA = "local";
  const APPROVED_PATH = "/teach/control/answers";

  // Accept only the exact approved path or a descendant separated by "/".
  //   "/teach/control/answers"       -> true
  //   "/teach/control/answers/"      -> true
  //   "/teach/control/answers/42"    -> true
  //   "/teach/control/answers-other" -> false
  //   "/teach/control/answers2"      -> false
  //   "/teach/control/answer"        -> false
  function isApprovedPath(pathname) {
    if (typeof pathname !== "string" || pathname.length === 0) return false;
    if (pathname === APPROVED_PATH) return true;
    return pathname.startsWith(APPROVED_PATH + "/");
  }

  // A stored boolean wins; anything else (missing key, invalid value, or a
  // failed read) falls back to the documented default: enabled.
  function resolveEnabled(storedValue) {
    return typeof storedValue === "boolean" ? storedValue : true;
  }

  // Pure decision used by the controller and by the tests.
  function shouldTheme(pathname, enabled) {
    return enabled === true && isApprovedPath(pathname);
  }

  function createController(env) {
    const doc = env.document;
    const win = env.window;
    const chromeApi = env.chrome;
    const location = env.location;

    let enabled = true;
    let started = false;
    let ready = null;
    let storageListener = null;
    let locationListener = null;
    let windowTarget = null;
    let navigationTarget = null;

    function currentPath() {
      const loc = location || (win && win.location) || null;
      return loc && typeof loc.pathname === "string" ? loc.pathname : "";
    }

    // Reflect the current (path, enabled) state onto <html>. Idempotent: it only
    // touches the DOM when the attribute actually has to change.
    function apply() {
      const root = doc && doc.documentElement;
      if (!root) return;
      if (shouldTheme(currentPath(), enabled)) {
        if (root.getAttribute(THEME_ATTRIBUTE) !== THEME_ON) {
          root.setAttribute(THEME_ATTRIBUTE, THEME_ON);
        }
      } else if (root.hasAttribute(THEME_ATTRIBUTE)) {
        root.removeAttribute(THEME_ATTRIBUTE);
      }
    }

    function setEnabled(value) {
      enabled = resolveEnabled(value);
      apply();
    }

    async function refreshFromStorage() {
      let stored;
      try {
        const items = await chromeApi.storage[STORAGE_AREA].get(STORAGE_KEY);
        stored = items ? items[STORAGE_KEY] : undefined;
      } catch (error) {
        // A failed read must not surface an error state; fall back to default.
        stored = undefined;
      }
      setEnabled(stored);
      return enabled;
    }

    function handleStorageChange(changes, areaName) {
      if (areaName && areaName !== STORAGE_AREA) return;
      if (!changes || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) return;
      const change = changes[STORAGE_KEY];
      setEnabled(change ? change.newValue : undefined);
    }

    // Re-check the path after a navigation. Deferred to a microtask because the
    // URL can update just after an SPA navigation event fires. No polling and no
    // timers, so this is cheap even on pages that navigate often.
    function scheduleReevaluate() {
      const run = () => apply();
      if (typeof queueMicrotask === "function") queueMicrotask(run);
      else Promise.resolve().then(run);
    }

    function start() {
      if (started) return ready;
      started = true;

      // Storage changes (popup toggle) apply immediately on already-open pages.
      storageListener = handleStorageChange;
      if (chromeApi && chromeApi.storage && chromeApi.storage.onChanged) {
        chromeApi.storage.onChanged.addListener(storageListener);
      }

      // Same-document navigation: filters, sorting, pagination, and SPA routes.
      // `popstate`/`hashchange` cover back/forward, but NOT
      // history.pushState/replaceState. The Navigation API's
      // `currententrychange` fires after the URL is committed (including for
      // pushState/replaceState), so it is the reliable signal; `navigate` is
      // kept for forward-compatibility. No polling and no history patching.
      locationListener = scheduleReevaluate;
      if (win && typeof win.addEventListener === "function") {
        windowTarget = win;
        windowTarget.addEventListener("popstate", locationListener);
        windowTarget.addEventListener("hashchange", locationListener);
      }
      if (win && win.navigation && typeof win.navigation.addEventListener === "function") {
        navigationTarget = win.navigation;
        navigationTarget.addEventListener("navigate", locationListener);
        navigationTarget.addEventListener("currententrychange", locationListener);
      }

      // Read the saved preference and apply it. The read is asynchronous; as
      // soon as it resolves (at document_start) the marker is set or removed,
      // so the page can paint once before the theme applies. The default is
      // enabled, which is the documented first-install behaviour.
      ready = refreshFromStorage();
      return ready;
    }

    function stop() {
      if (!started) return;
      started = false;
      if (chromeApi && chromeApi.storage && chromeApi.storage.onChanged && storageListener) {
        chromeApi.storage.onChanged.removeListener(storageListener);
      }
      if (windowTarget && locationListener) {
        windowTarget.removeEventListener("popstate", locationListener);
        windowTarget.removeEventListener("hashchange", locationListener);
      }
      if (navigationTarget && locationListener) {
        navigationTarget.removeEventListener("navigate", locationListener);
        navigationTarget.removeEventListener("currententrychange", locationListener);
      }
      storageListener = null;
      locationListener = null;
      windowTarget = null;
      navigationTarget = null;
    }

    return {
      apply,
      setEnabled,
      refreshFromStorage,
      start,
      stop,
      currentPath,
      isStarted: () => started,
      isEnabled: () => enabled,
    };
  }

  let controller = null;

  function start(env) {
    if (controller) return controller.start();
    const resolved = env || {
      document: typeof document !== "undefined" ? document : null,
      window: typeof window !== "undefined" ? window : null,
      chrome: typeof chrome !== "undefined" ? chrome : null,
      location: typeof location !== "undefined" ? location : null,
    };
    controller = createController(resolved);
    return controller.start();
  }

  const api = {
    THEME_ATTRIBUTE,
    THEME_ON,
    STORAGE_KEY,
    STORAGE_AREA,
    APPROVED_PATH,
    isApprovedPath,
    resolveEnabled,
    shouldTheme,
    createController,
    start,
    getController: () => controller,
  };

  globalThis.GCAnswersDark = api;

  if (
    typeof document !== "undefined" &&
    typeof chrome !== "undefined" &&
    chrome &&
    chrome.storage
  ) {
    start();
  }
})();
