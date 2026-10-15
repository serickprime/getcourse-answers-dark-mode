// Toolbar popup: enable or disable the graphite dark theme.
//
// The popup only reads and writes the persisted preference in
// chrome.storage.local. It never touches page content and makes no network
// calls. On any storage failure it reports the error and avoids showing a state
// that was not actually saved.

(() => {
  "use strict";

  const STORAGE_KEY = "darkModeEnabled";
  const STORAGE_AREA = "local";

  // User-facing strings (Russian, as required for the extension UI).
  const TEXT = {
    on: "Включено",
    off: "Выключено",
    readError: "Не удалось прочитать настройку",
    writeError: "Не удалось сохранить настройку",
  };

  function resolveEnabled(storedValue) {
    return typeof storedValue === "boolean" ? storedValue : true;
  }

  function createPopup(env) {
    const doc = env.document;
    const chromeApi = env.chrome;
    const toggle = env.toggle || (doc ? doc.getElementById("dark-mode-toggle") : null);
    const status = env.status || (doc ? doc.getElementById("status") : null);

    let ready = null;
    let readFailed = false;

    function setStatus(text, isError) {
      if (!status) return;
      status.textContent = text;
      if (status.classList && typeof status.classList.toggle === "function") {
        status.classList.toggle("popup__hint--error", Boolean(isError));
      }
    }

    function render(enabled) {
      if (toggle) toggle.checked = enabled;
      setStatus(enabled ? TEXT.on : TEXT.off, false);
    }

    async function load() {
      try {
        const items = await chromeApi.storage[STORAGE_AREA].get(STORAGE_KEY);
        render(resolveEnabled(items ? items[STORAGE_KEY] : undefined));
      } catch (error) {
        readFailed = true;
        if (toggle) toggle.disabled = true;
        setStatus(TEXT.readError, true);
      }
    }

    async function onToggle() {
      if (!toggle) return;
      const desired = Boolean(toggle.checked);
      toggle.disabled = true;
      try {
        await chromeApi.storage[STORAGE_AREA].set({ [STORAGE_KEY]: desired });
        setStatus(desired ? TEXT.on : TEXT.off, false);
      } catch (error) {
        // Never display a success that did not happen: reflect the real state.
        toggle.checked = !desired;
        setStatus(TEXT.writeError, true);
      } finally {
        toggle.disabled = readFailed;
      }
    }

    function start() {
      if (ready) return ready;
      if (toggle && typeof toggle.addEventListener === "function") {
        toggle.addEventListener("change", onToggle);
      }
      ready = load();
      return ready;
    }

    return {
      start,
      load,
      onToggle,
      render,
      setStatus,
      get toggle() {
        return toggle;
      },
    };
  }

  let popup = null;

  function start(env) {
    if (popup) return popup.start();
    const resolved = env || {
      document: typeof document !== "undefined" ? document : null,
      chrome: typeof chrome !== "undefined" ? chrome : null,
    };
    popup = createPopup(resolved);
    return popup.start();
  }

  const api = {
    STORAGE_KEY,
    STORAGE_AREA,
    TEXT,
    resolveEnabled,
    createPopup,
    start,
    getPopup: () => popup,
  };

  globalThis.GCAnswersPopup = api;

  if (
    typeof document !== "undefined" &&
    typeof chrome !== "undefined" &&
    chrome &&
    chrome.storage
  ) {
    start();
  }
})();
