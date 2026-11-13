window.__ModuleLoader__.load({
  id: "dsh-doc-positivize",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const h = React.createElement;

    // The design-system primitives are a shell baseline module; token-styled
    // native controls render the settings card on a module load error.
    let primitives = null;
    try {
      primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    } catch {
      primitives = null;
    }

    const name = "doc-positivize-settings";
    const inject = ["slots", "locale", "configForms"];
    const SETTINGS_NS = "docPositivize";
    const ENTRY_ID = "dsh-doc-positivize";
    const ROW_SLOT_KEY = "dsh-doc-positivize#dsh-doc-positivize";
    const RUN_COMMAND = "positivize-run";
    const STATE_ROUTE = "/api/doc-positivize.state";
    const CANCEL_ROUTE = "/api/doc-positivize.cancel";
    const UNDO_ROUTE = "/api/doc-positivize.undo";
    const MAX_DIFF_ROWS = 1500;

    const en = {
      name: "Positivize docs",
      nav: "Positivize docs",
      title: "Positivize docs",
      summary: "Doc-positivize guard and ignore list",
      sectionHint: "The settings live in this plugin's profile entry, so the guard and the sweep share one configuration.",
      guard: "Enable the doc-positivize guard",
      guardHint: "Mounts the doc-positivize rule in the system prompt.",
      ignores: "Ignored files and directories",
      ignoresHint:
        "One name, path, or glob per line, so a list can be pasted in whole. The built-in list covers node_modules, .git, build output, package stores, caches, and lockfiles.",
      resultHint: "Positivize results support per-file undo, and a running scan can be stopped from its card.",
      save: "Save",
      saving: "Saving…",
      saved: "Saved",
      reset: "Reset",
      restore: "Restore defaults",
      loading: "Loading configuration…",
      unavailable: "This configuration is read-only here.",
      rejected: "The host rejected the change.",
      running: "Scanning…",
      preparing: "Preparing the scan…",
      runningFile: "Reviewing {path} ({index}/{total})",
      stopping: "Stopping…",
      doneFiles: "Edited {count} file(s)",
      doneSingle: "Edited {name}",
      cancelledFiles: "Stopped · {count} file(s) edited",
      cancelledNone: "Scan stopped",
      stoppedNoFiles: "The scan stopped before any file changed.",
      failed: "Scan failed",
      noChanges: "No files needed changes",
      noFiles: "No negative phrasing was found in scope.",
      scanSummary: "Scanned {scanned} file(s); {candidates} carried markers.",
      undo: "Undo",
      undoing: "Undoing…",
      undone: "Undone",
      allUndone: "All changes undone",
      cancel: "Stop",
      cancelHint: "Stop this scan",
      fileChanged: "The file changed after the scan; nothing was overwritten.",
      fileMissing: "The file no longer exists.",
      stillRunning: "Wait for the scan to stop before undoing.",
      writeFailed: "Could not restore the file.",
      undoFailed: "Undo failed.",
      cancelFailed: "Stop failed.",
      scope: "Scope",
      workspaceScope: "the current workspace",
      details: "Details",
      hideDetails: "Hide details",
      skipped: "{count} file(s) skipped",
      remaining: "{count} marker hit(s) left",
      notes: "Notes",
      diffUnavailable: "No line diff is available.",
      diffTruncated: "Diff truncated.",
      waitingHost: "Waiting for the host result…",
      resultUnavailable: "The host no longer holds this scan result.",
      resultFallback: "The host served the text report.",
      showDiff: "Show diff",
      hideDiff: "Hide diff",
      on: "Guard on",
      off: "Guard off",
      ignored: "ignored",
    };
    const zh = {
      name: "文档正向化",
      nav: "文档正向化",
      title: "文档正向化",
      summary: "文档正向化护栏与扫描忽略",
      sectionHint: "这些设置保存在本插件的 profile 条目里，护栏与扫描共用同一份配置。",
      guard: "开启文档正向化护栏",
      guardHint: "把文档正向化规则挂载到系统提示词。",
      ignores: "忽略的文件与目录",
      ignoresHint:
        "每行一个名称、路径或 glob，方便整段列表直接粘贴。默认列表覆盖 node_modules、.git、构建产物、包存储、缓存与锁文件。",
      resultHint: "扫描结果支持逐文件撤销；扫描进行中可在卡片上终止。",
      save: "保存",
      saving: "保存中…",
      saved: "已保存",
      reset: "重置",
      restore: "恢复默认",
      loading: "正在加载配置…",
      unavailable: "此处不可编辑该配置。",
      rejected: "宿主拒绝了这次修改。",
      running: "正在扫描…",
      preparing: "正在准备扫描…",
      runningFile: "正在分析 {path}（{index}/{total}）",
      stopping: "正在终止…",
      doneFiles: "已修改 {count} 个文件",
      doneSingle: "已修改 {name}",
      cancelledFiles: "已终止 · 已修改 {count} 个文件",
      cancelledNone: "已终止扫描",
      stoppedNoFiles: "扫描在修改任何文件前已终止。",
      failed: "扫描失败",
      noChanges: "没有需要修改的文件",
      noFiles: "范围内没有发现文档正向化。",
      scanSummary: "已扫描 {scanned} 个文件；{candidates} 个带有标记。",
      undo: "撤销",
      undoing: "撤销中…",
      undone: "已撤销",
      allUndone: "已撤销全部修改",
      cancel: "终止",
      cancelHint: "终止本次扫描",
      fileChanged: "文件在扫描后已被修改，未覆盖。",
      fileMissing: "文件已不存在。",
      stillRunning: "请等待扫描终止后再撤销。",
      writeFailed: "无法恢复文件。",
      undoFailed: "撤销失败。",
      cancelFailed: "终止失败。",
      scope: "范围",
      workspaceScope: "整个工作区",
      details: "详情",
      hideDetails: "收起详情",
      skipped: "跳过 {count} 个文件",
      remaining: "剩余 {count} 处标记",
      notes: "备注",
      diffUnavailable: "没有可显示的行差异。",
      diffTruncated: "差异已截断。",
      waitingHost: "正在等待宿主结果…",
      resultUnavailable: "宿主已不再持有本次扫描结果。",
      resultFallback: "宿主返回了文本报告。",
      showDiff: "展开差异",
      hideDiff: "收起差异",
      on: "护栏开启",
      off: "护栏关闭",
      ignored: "项忽略",
    };

    function apply(ctx) {
      ctx.effect(() => injectStyles(), "doc-positivize: styles");
      ctx.effect(() => ctx.locale.register(SETTINGS_NS, { en, zh }), "doc-positivize: settings locale");
      const t = ctx.locale.bind(SETTINGS_NS);
      const form = ctx.configForms.get(ENTRY_ID);

      // A first-class settings section: Settings → Doc Positivize.
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "doc-positivize",
            order: 40,
            label: () => t("nav"),
            locale: SETTINGS_NS,
          },
          (props) => h(DocPositivizeSection, { ...props, t, form }),
        ),
      );

      // The real slash command settles immediately; its card owns the progress,
      // Stop control and per-file undo. A settled success with no text is hidden.
      ctx.slots.inject("conversation.chat.commandview", () =>
        ctx.slots.register(
          {
            name: "conversation.chat.commandview",
            key: "positivize",
            locale: SETTINGS_NS,
          },
          DocPositivizeCommandCard,
        ),
      );

      // The detached progress lifecycle renders the structured result card.
      ctx.slots.inject("conversation.chat.commandview", () =>
        ctx.slots.register(
          {
            name: "conversation.chat.commandview",
            key: RUN_COMMAND,
            locale: SETTINGS_NS,
          },
          DocPositivizeRunCard,
        ),
      );

      // The same editor as the plugin row's configuration card, for profiles
      // that mount the plugin-manager page.
      ctx.slots.inject("plugins.row.config", () =>
        ctx.slots.register(
          {
            name: "plugins.row.config",
            key: ROW_SLOT_KEY,
            locale: SETTINGS_NS,
          },
          DocPositivizeConfigCard,
        ),
      );
    }

    function useT(props) {
      return typeof props.t === "function" ? props.t : (key) => key;
    }

    function renderIcon(name, props) {
      const component = primitives && primitives[name];
      return component ? h(component, props || {}) : null;
    }

    function basename(path) {
      const parts = String(path).replace(/\\/g, "/").split("/");
      return parts[parts.length - 1] || String(path);
    }

    function replace(template, values) {
      let text = String(template);
      for (const [key, value] of Object.entries(values)) text = text.replace(`{${key}}`, String(value));
      return text;
    }

    function messageOf(error, t, fallbackKey) {
      const code = error && error.code;
      if (code === "file-changed") return t("fileChanged");
      if (code === "file-missing") return t("fileMissing");
      if (code === "still-running") return t("stillRunning");
      if (code === "write-failed") return t("writeFailed");
      if (code === "run-not-found") return t("resultUnavailable");
      return (error && error.message) || t(fallbackKey);
    }

    async function readJson(response) {
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok) {
        const error = new Error(data && data.error ? data.error : `HTTP ${response.status}`);
        error.code = data && data.code;
        error.status = response.status;
        throw error;
      }
      return data;
    }

    async function requestRun(runId, signal) {
      const response = await fetch(`${STATE_ROUTE}?runId=${encodeURIComponent(runId)}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      return readJson(response);
    }

    async function postAction(path, body) {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(response);
      return data && data.run ? data.run : data;
    }

    function useRunView(runId, outcome) {
      const [state, setState] = React.useState({ status: "loading", view: null, error: null });
      React.useEffect(() => {
        if (typeof runId !== "string" || runId.length === 0) {
          setState({ status: "unavailable", view: null, error: null });
          return undefined;
        }
        const controller = new AbortController();
        let alive = true;
        let timer = null;
        const load = async () => {
          try {
            const view = await requestRun(runId, controller.signal);
            if (!alive) return;
            setState({ status: "ready", view, error: null });
            if (view.status === "running" && alive) timer = setTimeout(load, 1000);
          } catch (error) {
            if (!alive || controller.signal.aborted) return;
            setState((previous) => ({
              status: previous.view ? "ready" : "unavailable",
              view: previous.view,
              error: error && error.message ? error.message : String(error),
            }));
            if (!outcome && alive) timer = setTimeout(load, 1200);
          }
        };
        load();
        return () => {
          alive = false;
          controller.abort();
          if (timer !== null) clearTimeout(timer);
        };
      }, [runId, outcome]);
      return [state, setState];
    }

    function DocPositivizeCommandCard(props) {
      const node = props.node || {};
      const t = useT(props);
      const outcome = node.outcome;
      if (outcome === null || outcome === undefined) return null;
      if (outcome.kind === "error") {
        return h(StatusLine, {
          tone: "error",
          iconName: "IconWarningOutlineRegular",
          title: t("failed"),
          detail: outcome.text || "",
        });
      }
      if (!outcome.text || outcome.text.trim() === "") return null;
      return h(LegacyReport, { text: outcome.text, t });
    }

    function DocPositivizeRunCard(props) {
      const node = props.node || {};
      const t = useT(props);
      const outcome = node.outcome;
      const runId = node.commandId;
      const [state, setState] = useRunView(runId, outcome);
      const [cancelling, setCancelling] = React.useState(false);
      const [cancelError, setCancelError] = React.useState("");
      const [undoing, setUndoing] = React.useState(null);
      const [undoErrors, setUndoErrors] = React.useState({});

      const onCancel = React.useCallback(async () => {
        if (cancelling) return;
        setCancelling(true);
        setCancelError("");
        try {
          const next = await postAction(CANCEL_ROUTE, { runId });
          setState({ status: "ready", view: next, error: null });
        } catch (error) {
          setCancelError(messageOf(error, t, "cancelFailed"));
        } finally {
          setCancelling(false);
        }
      }, [cancelling, runId, setState, t]);

      const onUndo = React.useCallback(
        async (path) => {
          setUndoing(path);
          setUndoErrors((previous) => {
            const next = { ...previous };
            delete next[path];
            return next;
          });
          try {
            const next = await postAction(UNDO_ROUTE, { runId, path });
            setState({ status: "ready", view: next, error: null });
          } catch (error) {
            setUndoErrors((previous) => ({ ...previous, [path]: messageOf(error, t, "undoFailed") }));
          } finally {
            setUndoing(null);
          }
        },
        [runId, setState, t],
      );

      const view = state.view;
      if (outcome && outcome.kind === "error") {
        return h(StatusLine, {
          tone: "error",
          iconName: "IconWarningOutlineRegular",
          title: t("failed"),
          detail: outcome.text || "",
        });
      }
      if (!view) {
        if (outcome && typeof outcome.text === "string" && outcome.text.trim() !== "") {
          return h(LegacyReport, { text: outcome.text, t });
        }
        if (outcome) return h(StatusLine, { tone: "muted", iconName: "IconInfoOutlineRegular", title: t("resultUnavailable") });
        return h(RunningCard, {
          view: null,
          t,
          cancel: null,
          cancelling: false,
          actionError: "",
          waiting: true,
        });
      }
      if (view.status === "running") {
        return h(RunningCard, {
          view,
          t,
          cancel: onCancel,
          cancelling: Boolean(view.cancelling || cancelling),
          actionError: cancelError,
        });
      }
      if (view.status === "failed") {
        return h(StatusLine, {
          tone: "error",
          iconName: "IconWarningOutlineRegular",
          title: t("failed"),
          detail: view.error || "",
          children: h(Details, { view, t }),
        });
      }
      if (view.files.length === 0) {
        const cancelled = view.status === "cancelled";
        const detail = cancelled
          ? t("stoppedNoFiles")
          : view.candidates > 0
            ? replace(t("scanSummary"), { scanned: view.scanned, candidates: view.candidates })
            : t("noFiles");
        return h(StatusLine, {
          tone: "muted",
          iconName: cancelled ? "IconStopFillRegular" : "IconCheckOutlineRegular",
          title: cancelled ? t("cancelledNone") : t("noChanges"),
          detail,
          children: h(Details, { view, t }),
        });
      }
      return h(RunCard, {
        view,
        t,
        undo: onUndo,
        undoing,
        undoErrors,
      });
    }

    function LegacyReport({ text, t }) {
      const [open, setOpen] = React.useState(false);
      const first = String(text).split("\n")[0] || t("resultFallback");
      return h(
        "div",
        { className: "dp-status", "data-tone": "muted" },
        h(
          "div",
          { className: "dp-status-head" },
          h("span", { className: "dp-status-icon" }, renderIcon("IconApiOutlineRegular", { size: 14 })),
          h(
            "div",
            { className: "dp-status-copy" },
            h("div", { className: "dp-status-title" }, first),
            h("div", { className: "dp-status-detail" }, t("resultFallback")),
          ),
          h(
            "button",
            {
              type: "button",
              className: "dp-text-button",
              "aria-expanded": open,
              onClick: () => setOpen((value) => !value),
            },
            t(open ? "hideDetails" : "details"),
          ),
        ),
        open ? h("pre", { className: "dp-report" }, text) : null,
      );
    }

    function StatusLine({ tone, iconName, title, detail, actions, children }) {
      return h(
        "div",
        { className: "dp-status", "data-tone": tone || "muted" },
        h(
          "div",
          { className: "dp-status-head" },
          h("span", { className: "dp-status-icon" }, renderIcon(iconName, { size: 14 })),
          h(
            "div",
            { className: "dp-status-copy" },
            h("div", { className: "dp-status-title" }, title),
            detail ? h("div", { className: "dp-status-detail" }, detail) : null,
          ),
          actions ? h("div", { className: "dp-header-actions" }, actions) : null,
        ),
        children || null,
      );
    }

    function RunningCard({ view, t, cancel, cancelling, actionError, waiting }) {
      const progress = view && view.progress;
      const subtitle = cancelling
        ? t("stopping")
        : progress
          ? replace(t("runningFile"), { path: progress.path, index: progress.index, total: progress.total })
          : waiting
            ? t("waitingHost")
            : t("preparing");
      const title = `${t("name")} · ${cancelling ? t("stopping") : t("running")}`;
      const shimmer = primitives && primitives.TextShimmer;
      return h(
        "div",
        { className: "dp-card", "data-state": "running" },
        h(
          "div",
          { className: "dp-header" },
          h(
            "div",
            { className: "dp-tile" },
            h("span", { className: "dp-spin" }, renderIcon("IconLoadingOutlineRegular", { size: 18 })),
          ),
          h(
            "div",
            { className: "dp-titles" },
            h("div", { className: "dp-title" }, title),
            h(
              "div",
              { className: "dp-subtitle" },
              h("span", { className: "dp-subtitle-text" }, shimmer ? h(shimmer, null, subtitle) : subtitle),
            ),
          ),
          cancel
            ? h(
                "div",
                { className: "dp-header-actions" },
                h(
                  "button",
                  {
                    type: "button",
                    className: "dp-cancel",
                    disabled: cancelling,
                    "aria-label": t("cancelHint"),
                    onClick: cancel,
                  },
                  renderIcon("IconStopFillRegular", { size: 13 }),
                  h("span", null, t(cancelling ? "stopping" : "cancel")),
                ),
              )
            : null,
        ),
        actionError ? h("p", { className: "dp-action-error" }, actionError) : null,
      );
    }

    function RunCard({ view, t, undo, undoing, undoErrors }) {
      const [openPaths, setOpenPaths] = React.useState(() => new Set());
      const expanded = React.useRef(false);
      React.useEffect(() => {
        if (!expanded.current && view.files.length > 0) {
          expanded.current = true;
          setOpenPaths(new Set([view.files[0].path]));
        }
      }, [view]);

      const active = view.files.filter((file) => !file.undone);
      const cancelled = view.status === "cancelled";
      const title =
        active.length === 0
          ? t("allUndone")
          : cancelled
            ? replace(t("cancelledFiles"), { count: active.length })
            : active.length === 1
              ? replace(t("doneSingle"), { name: basename(active[0].path) })
              : replace(t("doneFiles"), { count: active.length });
      const scope = view.target || t("workspaceScope");
      const counts =
        active.length === 0
          ? h("span", { className: "dp-subtitle-text" }, scope)
          : h(
              React.Fragment,
              null,
              h(
                "span",
                { className: "dp-counts" },
                h("span", { className: "dp-added" }, `+${view.added}`),
                h("span", { className: "dp-deleted" }, `-${view.deleted}`),
              ),
              h("span", { className: "dp-subtitle-text" }, scope),
            );
      const tile =
        renderIcon(cancelled ? "IconStopFillRegular" : "IconListPenOutlineRegular", { size: 18 }) ||
        h("span", { className: "dp-file-glyph" }, "</>");

      return h(
        "div",
        { className: "dp-card", "data-state": cancelled ? "cancelled" : "done" },
        h(
          "div",
          { className: "dp-header" },
          h("div", { className: "dp-tile" }, tile),
          h("div", { className: "dp-titles" }, h("div", { className: "dp-title" }, title), h("div", { className: "dp-subtitle" }, counts)),
        ),
        h(
          "div",
          { className: "dp-list" },
          view.files.map((file) =>
            h(FileRow, {
              key: file.path,
              file,
              t,
              open: openPaths.has(file.path),
              onToggle: () =>
                setOpenPaths((previous) => {
                  const next = new Set(previous);
                  if (next.has(file.path)) next.delete(file.path);
                  else next.add(file.path);
                  return next;
                }),
              onUndo: undo,
              undoing: undoing === file.path,
              undoError: undoErrors[file.path],
            }),
          ),
        ),
        h(Details, { view, t }),
      );
    }

    function FileRow({ file, t, open, onToggle, onUndo, undoing, undoError }) {
      return h(
        "div",
        { className: "dp-file", "data-undone": file.undone || undefined },
        h(
          "div",
          { className: "dp-file-head" },
          h(
            "button",
            {
              type: "button",
              className: "dp-file-path",
              "aria-expanded": open,
              "aria-label": `${file.path} ${t(open ? "hideDiff" : "showDiff")}`,
              onClick: onToggle,
            },
            h(
              "span",
              { className: "dp-file-glyph" },
              renderIcon("FileTypeIcon", { path: file.path, size: 16 }) || "</>",
            ),
            h("span", { className: "dp-file-name" }, file.path),
            h(
              "span",
              { className: "dp-file-chevron" },
              renderIcon(open ? "IconChevronUpOutlineRegular" : "IconChevronDownOutlineRegular", { size: 14 }),
            ),
          ),
          h(
            "span",
            { className: "dp-file-counts" },
            h("span", { className: "dp-added" }, `+${file.added}`),
            h("span", { className: "dp-deleted" }, `-${file.deleted}`),
          ),
          h(
            "button",
            {
              type: "button",
              className: "dp-undo",
              "data-undone": file.undone || undefined,
              disabled: file.undone || undoing,
              "aria-label": `${t("undo")} ${file.path}`,
              onClick: () => onUndo(file.path),
            },
            file.undone
              ? renderIcon("IconCheckOutlineRegular", { size: 13 })
              : renderIcon("IconRefreshOutlineRegular", { size: 13 }),
            h("span", null, t(file.undone ? "undone" : undoing ? "undoing" : "undo")),
          ),
        ),
        undoError ? h("p", { className: "dp-file-error", role: "alert" }, undoError) : null,
        open ? h(DiffBlock, { file, t }) : null,
      );
    }

    function DiffBlock({ file, t }) {
      const rows = [];
      let rendered = 0;
      let truncated = Boolean(file.truncated);
      if (file.hunks.length === 0) {
        return h("div", { className: "dp-diff" }, h("div", { className: "dp-truncated" }, t("diffUnavailable")));
      }
      for (const [hunkIndex, hunk] of file.hunks.entries()) {
        rows.push(
          h(
            "div",
            { className: "dp-hunk", key: `hunk-${hunkIndex}` },
            `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
          ),
        );
        let oldNumber = hunk.oldStart;
        let newNumber = hunk.newStart;
        for (const [lineIndex, line] of hunk.lines.entries()) {
          if (rendered >= MAX_DIFF_ROWS) {
            truncated = true;
            break;
          }
          const sign = line.slice(0, 1);
          const text = line.slice(1);
          const oldLine = sign === "+" ? null : oldNumber++;
          const newLine = sign === "-" ? null : newNumber++;
          const kind = sign === "+" ? "add" : sign === "-" ? "del" : "context";
          rows.push(
            h(
              "div",
              { className: "dp-line", "data-kind": kind, key: `line-${hunkIndex}-${lineIndex}` },
              h("span", { className: "dp-num" }, oldLine === null ? "" : oldLine),
              h("span", { className: "dp-num" }, newLine === null ? "" : newLine),
              h("span", { className: "dp-sign" }, sign === " " ? "" : sign),
              h("span", { className: "dp-code" }, text),
            ),
          );
          rendered += 1;
        }
        if (truncated) break;
      }
      return h(
        "div",
        { className: "dp-diff", role: "region", "aria-label": file.path },
        rows,
        truncated ? h("div", { className: "dp-truncated" }, t("diffTruncated")) : null,
      );
    }

    function Details({ view, t }) {
      const [open, setOpen] = React.useState(false);
      const hasDetails = view.skipped.length > 0 || view.remaining.length > 0 || view.notes.length > 0;
      if (!hasDetails) return null;
      return h(
        "div",
        { className: "dp-details" },
        h(
          "button",
          {
            type: "button",
            className: "dp-details-toggle",
            "aria-expanded": open,
            onClick: () => setOpen((value) => !value),
          },
          h("span", null, t(open ? "hideDetails" : "details")),
          renderIcon(open ? "IconChevronUpOutlineRegular" : "IconChevronDownOutlineRegular", { size: 14 }),
        ),
        open
          ? h(
              "div",
              { className: "dp-details-body" },
              view.skipped.length > 0
                ? h(
                    "div",
                    null,
                    h("strong", null, replace(t("skipped"), { count: view.skipped.length })),
                    h(
                      "ul",
                      null,
                      view.skipped.map((skip) => h("li", { key: `${skip.path}:${skip.reason}` }, `${skip.path}: ${skip.reason}`)),
                    ),
                  )
                : null,
              view.remaining.length > 0
                ? h(
                    "div",
                    null,
                    h("strong", null, replace(t("remaining"), { count: view.remaining.length })),
                    h(
                      "ul",
                      null,
                      view.remaining.map((remaining) =>
                        h(
                          "li",
                          { key: `${remaining.path}:${remaining.line}` },
                          `${remaining.path}:${remaining.line} ${JSON.stringify(remaining.snippet)}`,
                        ),
                      ),
                    ),
                  )
                : null,
              view.notes.length > 0
                ? h(
                    "div",
                    null,
                    h("strong", null, t("notes")),
                    h("ul", null, view.notes.map((note, index) => h("li", { key: `note-${index}` }, note))),
                  )
                : null,
            )
          : null,
      );
    }

    function DocPositivizeSection(props) {
      const { form, t } = props;
      const [snapshot, setSnapshot] = React.useState(form.getSnapshot());
      React.useEffect(() => {
        const off = form.subscribe(setSnapshot);
        setSnapshot(form.getSnapshot());
        return off;
      }, [form]);
      const ready = snapshot.status === "ready" && snapshot.writable;
      return h(
        "div",
        { style: styles.section },
        h("h2", { style: styles.sectionTitle }, t("title")),
        h("p", { style: styles.sectionHint }, t("sectionHint")),
        h(ConfigEditor, {
          value: snapshot.value || {},
          ready,
          loading: snapshot.status === "loading",
          t,
          revision: snapshot.revision,
          mutate: (operations, revision) => form.mutate(operations, revision),
        }),
      );
    }

    function DocPositivizeConfigCard(props) {
      const state = props.form && props.form.state;
      const t = typeof props.t === "function" ? props.t : (key) => key;
      const value = (state && state.value) || {};
      if (props.view === "summary") {
        const count = Array.isArray(value.ignoredPaths) ? value.ignoredPaths.length : 0;
        return h("span", null, `${t(value.guardEnabled ? "on" : "off")} · ${count} ${t("ignored")}`);
      }
      // The Settings section and the Plugins-page row page both pass a settings
      // form snapshot ({ status, value, revision, writable }) — there is no `mode`
      // field, so readiness is status + writable for both surfaces.
      const ready = Boolean(state && state.status === "ready" && state.writable);
      return h(ConfigEditor, {
        value,
        ready,
        loading: state && state.status === "loading",
        t,
        revision: state && state.revision,
        mutate: (operations, revision) => props.form.mutate(operations, revision),
      });
    }

    function ConfigEditor(props) {
      const { value, ready, loading, t, revision, mutate } = props;
      const [guard, setGuard] = React.useState(Boolean(value.guardEnabled));
      const [ignores, setIgnores] = React.useState(
        Array.isArray(value.ignoredPaths) ? value.ignoredPaths.join("\n") : "",
      );
      const [dirty, setDirty] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [focused, setFocused] = React.useState(false);
      const [message, setMessage] = React.useState("");

      React.useEffect(() => {
        if (dirty) return;
        setGuard(Boolean(value.guardEnabled));
        setIgnores(Array.isArray(value.ignoredPaths) ? value.ignoredPaths.join("\n") : "");
      }, [revision, ready, dirty, value.guardEnabled, value.ignoredPaths]);

      if (!ready) {
        return h("p", { role: "status", style: styles.hint }, t(loading ? "loading" : "unavailable"));
      }

      async function save(operations) {
        if (busy) return;
        setBusy(true);
        setMessage("");
        try {
          const accepted = await mutate(operations, revision);
          setMessage(t(accepted ? "saved" : "rejected"));
          if (accepted) setDirty(false);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : String(error));
        } finally {
          setBusy(false);
        }
      }

      const saveAll = () =>
        save([
          { op: "set", path: ["guardEnabled"], value: guard },
          {
            op: "set",
            path: ["ignoredPaths"],
            value: ignores
              .split("\n")
              .map((line) => line.trim())
              .filter((line) => line.length > 0),
          },
        ]);

      return h(
        "div",
        { style: styles.form },
        h(
          "section",
          { style: styles.field, "aria-labelledby": "doc-positivize-guard" },
          h(
            "div",
            { style: styles.fieldHead },
            h(
              "div",
              null,
              h("h3", { id: "doc-positivize-guard", style: styles.label }, t("guard")),
              h("p", { style: styles.hint }, t("guardHint")),
            ),
            h(Switch, {
              checked: guard,
              label: t("guard"),
              disabled: busy,
              onChange: (event) => {
                setGuard(Boolean(event && event.target ? event.target.checked : event));
                setDirty(true);
                setMessage("");
              },
            }),
          ),
        ),
        h(
          "section",
          { style: styles.field, "aria-labelledby": "doc-positivize-ignores" },
          h("h3", { id: "doc-positivize-ignores", style: styles.label }, t("ignores")),
          h("p", { style: styles.hint }, t("ignoresHint")),
          h("textarea", {
            value: ignores,
            rows: 12,
            spellCheck: false,
            disabled: busy,
            "aria-label": t("ignores"),
            style: focused ? styles.textareaFocused : styles.textarea,
            onFocus: () => setFocused(true),
            onBlur: () => setFocused(false),
            onChange: (event) => {
              setIgnores(event.target.value);
              setDirty(true);
              setMessage("");
            },
          }),
        ),
        h("p", { style: styles.hint }, t("resultHint")),
        h(
          "div",
          { style: styles.actions },
          h(Button, { variant: "primary", disabled: busy || !dirty, onClick: saveAll }, t(busy ? "saving" : "save")),
          h(
            Button,
            {
              variant: "outline",
              disabled: busy,
              onClick: () => {
                setDirty(false);
                save([{ op: "unset", path: ["ignoredPaths"] }]);
              },
            },
            t("restore"),
          ),
          h(
            Button,
            {
              variant: "outline",
              disabled: busy,
              onClick: () => {
                setDirty(false);
                setMessage("");
              },
            },
            t("reset"),
          ),
        ),
        message ? h("p", { role: "status", style: styles.hint }, message) : null,
      );
    }

    // Token-styled native controls keep the card renderable on a module load error.
    function FallbackSwitch(props) {
      return h(
        "label",
        { style: styles.switchRow },
        h("input", {
          type: "checkbox",
          checked: Boolean(props.checked),
          disabled: Boolean(props.disabled),
          onChange: props.onChange,
        }),
        props.label ? h("span", null, props.label) : null,
      );
    }

    function FallbackButton(props) {
      return h(
        "button",
        {
          type: "button",
          disabled: Boolean(props.disabled),
          "aria-label": props["aria-label"],
          style: props.variant === "primary" ? styles.primaryButton : styles.outlineButton,
          onClick: props.onClick,
        },
        props.children,
      );
    }

    const Switch = (primitives && primitives.Switch) || FallbackSwitch;
    const Button = (primitives && primitives.Button) || FallbackButton;

    const textareaBase = {
      width: "100%",
      minHeight: "220px",
      boxSizing: "border-box",
      padding: "10px 12px",
      fontFamily: "inherit",
      fontSize: "13px",
      lineHeight: 1.5,
      color: "var(--dsw-alias-label-primary)",
      background: "var(--dsw-alias-bg-primary)",
      border: ".5px solid var(--dsw-alias-border-l4)",
      borderRadius: "var(--dsw-radius-md)",
      outline: "none",
      resize: "vertical",
    };

    const styles = {
      section: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "720px" },
      sectionTitle: { margin: 0, fontSize: "18px", fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
      sectionHint: { margin: 0, fontSize: "12px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)" },
      form: { display: "flex", flexDirection: "column", gap: "16px" },
      field: {
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        padding: "16px",
        border: ".5px solid var(--dsw-alias-border-l2)",
        borderRadius: "var(--dsw-radius-lg)",
        background: "var(--dsw-alias-bg-module-platform)",
      },
      fieldHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" },
      label: { margin: 0, fontSize: "13px", lineHeight: 1.5, fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
      hint: { margin: 0, fontSize: "12px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)" },
      actions: { display: "flex", gap: "8px", alignItems: "center" },
      switchRow: { display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" },
      textarea: textareaBase,
      textareaFocused: {
        ...textareaBase,
        borderColor: "var(--dsw-alias-state-business-primary)",
        boxShadow: "0 0 0 1px var(--dsw-alias-state-business-primary)",
      },
      primaryButton: {
        height: "32px",
        padding: "0 14px",
        fontSize: "13px",
        borderRadius: "var(--dsw-radius-md)",
        border: "none",
        background: "var(--dsw-alias-label-primary)",
        color: "var(--dsw-alias-bg-primary)",
        cursor: "pointer",
      },
      outlineButton: {
        height: "32px",
        padding: "0 14px",
        fontSize: "13px",
        borderRadius: "var(--dsw-radius-md)",
        border: ".5px solid var(--dsw-alias-border-l4)",
        background: "transparent",
        color: "var(--dsw-alias-label-primary)",
        cursor: "pointer",
      },
    };

    const STYLE_ID = "dsh-doc-positivize/result-card.css";
    const STYLES = `
.dp-card{--dp-fill:var(--dsw-static-neutral-50);--dp-hover:var(--dsw-static-neutral-100);box-sizing:border-box;display:flex;flex-direction:column;min-width:0;margin:4px 0;overflow:hidden;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
body[data-ds-dark-theme] .dp-card{--dp-fill:var(--dsw-static-neutral-850);--dp-hover:var(--dsw-static-neutral-800)}
.dp-header{box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;min-width:0;min-height:60px;padding:8px 12px;background:var(--dp-fill)}
.dp-tile{box-sizing:border-box;display:grid;place-items:center;width:40px;height:40px;flex:none;border:.5px solid var(--dsw-alias-border-l1);border-radius:10px;background:color-mix(in srgb,var(--dsw-static-neutral-00) 50%,transparent);color:var(--dsw-alias-state-business-primary)}
body[data-ds-dark-theme] .dp-tile{background:color-mix(in srgb,var(--dsw-static-neutral-00) 5%,transparent)}
.dp-titles{display:flex;flex-direction:column;flex:1;gap:2px;min-width:0}
.dp-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:500;line-height:20px}
.dp-subtitle{display:flex;align-items:center;gap:8px;min-width:0;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.dp-subtitle-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dp-counts{display:inline-flex;gap:6px;flex:none;font-family:var(--ds-font-family-code);font-size:10px}
.dp-added{color:var(--dsw-alias-state-success-primary)}
.dp-deleted{color:var(--dsw-alias-state-error-primary)}
.dp-header-actions{display:flex;align-items:center;gap:6px;flex:none}
.dp-cancel{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 10px;flex:none;border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:12px;cursor:pointer}
.dp-cancel:disabled{opacity:.6;cursor:default}
.dp-cancel:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dp-list{display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l2)}
.dp-file{border-top:.5px solid var(--dsw-alias-border-l2)}
.dp-file:first-child{border-top:0}
.dp-file-head{display:flex;align-items:center;gap:10px;min-width:0;padding:5px 12px 5px 14px}
.dp-file-path{display:flex;align-items:center;gap:6px;flex:1;min-width:0;padding:2px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dp-file-glyph{display:inline-flex;flex:none;color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-markdown-code-block-small)}
.dp-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:18px}
.dp-file-chevron{display:inline-flex;flex:none;color:var(--dsw-alias-label-tertiary)}
.dp-file-counts{display:inline-flex;gap:6px;flex:none;font-family:var(--ds-font-family-code);font-size:11px}
.dp-undo{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;flex:none;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.dp-undo:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dp-undo:disabled{opacity:.55;cursor:default}
.dp-undo[data-undone=true]{border-color:transparent;background:transparent;color:var(--dsw-alias-label-tertiary)}
.dp-file[data-undone=true] .dp-file-name,.dp-file[data-undone=true] .dp-file-counts{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}
.dp-file-error{margin:0;padding:0 14px 8px 36px;color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:16px}
.dp-diff{margin:0;padding:4px 0 10px;max-height:360px;overflow:auto;background:var(--dsw-alias-markdown-code-block);font:var(--dsw-font-markdown-code-block-small)}
.dp-hunk{padding:4px 16px;color:var(--dsw-alias-label-tertiary);white-space:pre}
.dp-line{display:grid;grid-template-columns:3.5em 3.5em 1.2em minmax(0,1fr);min-height:22px;line-height:22px;white-space:pre}
.dp-num{user-select:none;padding-right:8px;color:var(--dsw-alias-label-tertiary);text-align:right}
.dp-sign{user-select:none;text-align:center}
.dp-code{min-width:0;padding-right:16px;overflow-wrap:normal}
.dp-line[data-kind=add]{--dp-gutter:var(--dsw-alias-file-diff-added-gutter);--dp-marker:var(--dsw-alias-file-diff-added-marker);background:var(--dsw-alias-file-diff-added-bg)}
.dp-line[data-kind=del]{--dp-gutter:var(--dsw-alias-file-diff-deleted-gutter);--dp-marker:var(--dsw-alias-file-diff-deleted-marker);background:var(--dsw-alias-file-diff-deleted-bg)}
.dp-line[data-kind=add] .dp-num,.dp-line[data-kind=del] .dp-num{background:var(--dp-gutter);color:var(--dp-marker)}
.dp-line[data-kind=add] .dp-num:first-child,.dp-line[data-kind=del] .dp-num:first-child{box-shadow:inset 3px 0 0 var(--dp-marker)}
.dp-line[data-kind=add] .dp-sign,.dp-line[data-kind=del] .dp-sign{color:var(--dp-marker)}
.dp-line[data-kind=context] .dp-code{color:var(--dsw-alias-label-secondary)}
.dp-truncated{padding:4px 16px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.dp-details{border-top:.5px solid var(--dsw-alias-border-l2);padding:4px 14px 6px}
.dp-details-toggle{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dp-details-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dp-details-body{display:flex;flex-direction:column;gap:8px;padding:4px 0 2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.dp-details-body ul{margin:0;padding-left:18px}
.dp-details-body strong{font-weight:500;color:var(--dsw-alias-label-primary)}
.dp-status{display:flex;flex-direction:column;gap:4px;min-width:0;margin:4px 0;padding:4px 2px}
.dp-status-head{display:flex;align-items:flex-start;gap:8px;min-width:0}
.dp-status-icon{display:inline-flex;flex:none;margin-top:1px;color:var(--dsw-alias-label-tertiary)}
.dp-status-copy{display:flex;flex:1;flex-direction:column;gap:2px;min-width:0}
.dp-status-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.dp-status-detail{margin:0;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;white-space:pre-wrap;overflow-wrap:anywhere}
.dp-status[data-tone=error] .dp-status-icon,.dp-status[data-tone=error] .dp-status-title,.dp-status[data-tone=error] .dp-status-detail{color:var(--dsw-alias-state-error-primary)}
.dp-text-button{padding:2px 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dp-text-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dp-report{margin:6px 0 0;padding:10px 12px;max-height:50vh;overflow:auto;white-space:pre-wrap;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-markdown-code-block);color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small)}
.dp-action-error{margin:0;padding:6px 14px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.dp-spin{display:inline-flex;animation:dp-spin 1s linear infinite}
@keyframes dp-spin{to{transform:rotate(360deg)}}
.dp-file-path:focus-visible,.dp-undo:focus-visible,.dp-cancel:focus-visible,.dp-details-toggle:focus-visible,.dp-text-button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
@media (hover:hover){.dp-file-path:hover .dp-file-name{color:var(--dsw-alias-label-primary)}}
@media (pointer:coarse){.dp-file-head{min-height:44px}.dp-undo{min-height:32px}.dp-cancel{min-height:36px}.dp-details-toggle,.dp-text-button{min-height:36px}}
`;

    function injectStyles() {
      if (typeof document === "undefined") return () => {};
      let tag = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`);
      const created = tag === null;
      if (created) {
        tag = document.createElement("style");
        tag.dataset.plugin = "dsh-doc-positivize";
        tag.dataset.pluginCss = STYLE_ID;
        document.head.appendChild(tag);
      }
      tag.textContent = STYLES;
      // Own the tag exactly as long as this fiber lives, so disabling the plugin
      // removes its CSS instead of waiting for a page reload.
      return () => {
        if (created) tag.remove();
      };
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  },
});
