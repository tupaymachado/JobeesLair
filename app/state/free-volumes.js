// Whether a RAR set extracted while it downloads deletes each part once it is extracted (on by default), so
// the drive holds the game and at most one part more instead of the whole set beside it. Kept in
// settings.json beside the other settings; the download queue asks each time a set starts extracting.

import { useEffect, useState } from 'react';
import { loadList, saveList } from './saved.js';

  var SETTINGS = "settings.json";
  var value = null;
  var listeners = /* @__PURE__ */ new Set();
  function freeVolumesWhileExtracting() {
    if (value === null) value = loadList(SETTINGS, "settings").freeVolumes !== false;
    return value;
  }
  function setFreeVolumesWhileExtracting(on) {
    value = Boolean(on);
    saveList(SETTINGS, "settings", { ...loadList(SETTINGS, "settings"), freeVolumes: value });
    for (const listener of listeners) listener(value);
  }
  function useFreeVolumesWhileExtracting() {
    const [on, setOn] = useState(freeVolumesWhileExtracting);
    useEffect(() => {
      listeners.add(setOn);
      return () => {
        listeners.delete(setOn);
      };
    }, []);
    return on;
  }

export { freeVolumesWhileExtracting, setFreeVolumesWhileExtracting, useFreeVolumesWhileExtracting };
