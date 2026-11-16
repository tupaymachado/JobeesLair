// MODIFIED (tupay): what the catalog refresh's toast says (ui/FeedToast.jsx), apart from the component so it is tested
// without rendering.

  var CHANGED_MS = 9e3, SAME_MS = 4e3, FAILED_MS = 12e3;
  // A failed catalog as one line: its name and what went wrong, short enough for the toast.
  var failure = ({ name, error }) => error ? `${name}: ${error}`.slice(0, 120) : name;
  // Toast's props for a run, and how long it stays (null: until the run moves on).
  function toastOf(t2, run) {
    if (run.phase === "running") return [{ icon: "restart", status: t2("feeds.toast.running", { done: String(run.done + 1), total: String(run.total) }), title: run.name }, null];
    if (run.failed.length) {
      const [first, ...rest] = run.failed;
      return [{
        icon: "alert",
        failed: true,
        status: t2("feeds.toast.failed"),
        title: [failure(first), ...rest.map((item) => item.name)].join(" · "),
        detail: run.changed.length ? `${t2("feeds.toast.changed")}: ${run.changed.join(", ")}` : t2("feeds.toast.failedDetail"),
        duration: FAILED_MS
      }, FAILED_MS];
    }
    if (run.changed.length) return [{ icon: "circleCheck", status: t2("feeds.toast.changed"), title: t2("feeds.toast.changedTitle"), detail: run.changed.join(", "), duration: CHANGED_MS }, CHANGED_MS];
    return [{ icon: "circleCheck", status: t2("feeds.toast.same"), title: t2("feeds.toast.sameTitle"), duration: SAME_MS }, SAME_MS];
  }

export { toastOf };
