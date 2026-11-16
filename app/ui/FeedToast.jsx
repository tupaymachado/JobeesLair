// MODIFIED (tupay): what a catalog refresh is doing (state/feeds.js subscribeFeedRun), as a toast: which catalog it
// is fetching while it runs, then whether anything changed (a new copy is shown from the next launch, so it says to
// reopen the app), or which catalogs failed and why. A refresh that brought nothing new says so briefly.

import { jsx } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';
import { subscribeFeedRun } from '../state/feeds.js';
import { Toast } from './Toast.jsx';
import { toastOf } from './feed-toast.js';
import { AnimatePresence } from '@ps5-react/core';

  function FeedToast() {
    const t2 = useT();
    const [run, setRun] = useState(null);
    useEffect(() => subscribeFeedRun((next) => setRun({ ...next, n: Date.now() })), []);
    const shown = run ? toastOf(t2, run) : null;
    const stay = shown?.[1];
    useEffect(() => {
      if (!run || stay == null) return void 0;
      const id = setTimeout(() => setRun(null), stay);
      return () => clearTimeout(id);
    }, [run]);
    // One toast for the whole run: it changes in place while running, and a new one comes for the result.
    return /* @__PURE__ */ (0, jsx)(AnimatePresence, { children: shown && /* @__PURE__ */ (0, jsx)(Toast, { ...shown[0], lower: true }, run.phase) });
  }

export { FeedToast };
