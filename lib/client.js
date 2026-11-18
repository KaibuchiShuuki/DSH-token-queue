/**
 * dsh-token-queue —— 客户端半边：DSH「设置 → 谷价待办队列」这一页。
 *
 * 数据流：本页 ⇄ /dsh-token-queue/api/*（同源 fetch）⇄ 宿主 lib/index.js
 *        ⇄ ~/.dsh/token-queue/queue.json（队列）+ ctx.schedule（真正派发）
 * 只用 require("react")，dsh.client.inject 为空即可。
 */
window.__ModuleLoader__.load({
  id: "dsh-token-queue",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { createElement: h, useCallback, useEffect, useState } = React;

    const API = "/dsh-token-queue/api";
    const CSS_TAG = "dsh-token-queue/section.css";
    const CSS = [
      ".tq{max-width:820px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:6px}",
      ".tq-title{margin:0;font-size:16px;font-weight:500;line-height:24px}",
      ".tq-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 4px;font-size:13px;line-height:20px;white-space:pre-line}",
      ".tq-phase{display:flex;justify-content:space-between;align-items:center;gap:8px 14px;flex-wrap:wrap;border-radius:10px;padding:9px 12px;margin-top:8px;border:.5px solid var(--dsw-alias-border-l2);font-size:12.5px;line-height:19px}",
      ".tq-phase.tq-valley{background:rgba(34,160,107,.10);border-color:rgba(34,160,107,.42)}",
      ".tq-phase.tq-peak{background:rgba(217,119,6,.10);border-color:rgba(217,119,6,.42)}",
      ".tq-phase b{font-weight:600}",
      ".tq-dim{color:var(--dsw-alias-label-tertiary)}",
      ".tq-group{margin-top:16px;font-size:13px;font-weight:600;line-height:20px;display:flex;align-items:center;gap:8px}",
      ".tq-group .tq-count{font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:12px}",
      ".tq-compose textarea{width:100%;box-sizing:border-box;min-height:92px;resize:vertical;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:19px;padding:8px 10px;outline:none;font-family:inherit}",
      ".tq-compose textarea:focus-visible{border-color:var(--dsw-alias-brand-primary)}",
      ".tq-target{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px;font-size:12.5px;color:var(--dsw-alias-label-secondary)}",
      ".tq-tab{padding:3px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}",
      ".tq-tab.on{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}",
      ".tq-select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:28px;padding:0 6px;max-width:340px;outline:none}",
      ".tq-input{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:28px;padding:0 8px;outline:none}",
      ".tq-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;align-items:center}",
      ".tq-btn{background:var(--dsw-alias-brand-primary);color:#fff;border:none;border-radius:6px;font-size:12.5px;height:30px;padding:0 14px;cursor:pointer}",
      ".tq-btn:disabled{opacity:.5;cursor:default}",
      ".tq-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}",
      ".tq-item{border:.5px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;margin-top:8px}",
      ".tq-item-text{white-space:pre-wrap;font-size:12.5px;line-height:19px;word-break:break-word}",
      ".tq-meta{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px;margin-top:5px;display:flex;gap:4px 12px;flex-wrap:wrap;align-items:center}",
      ".tq-pill{display:inline-block;padding:0 6px;border-radius:999px;font-size:11px;line-height:17px;border:.5px solid currentColor}",
      ".tq-pending{color:var(--dsw-alias-brand-primary)}",
      ".tq-sent{color:#22a06b}",
      ".tq-failed{color:#d9534f}",
      ".tq-btnrow{display:flex;gap:6px;margin-top:7px;flex-wrap:wrap}",
      ".tq-mini{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;color:var(--dsw-alias-label-secondary);font-size:11.5px;height:24px;padding:0 9px;cursor:pointer}",
      ".tq-mini:hover{border-color:var(--dsw-alias-brand-primary)}",
      ".tq-mini.tq-danger:hover{border-color:#d9534f;color:#d9534f}",
      ".tq-item textarea{width:100%;box-sizing:border-box;min-height:64px;resize:vertical;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:19px;padding:7px 9px;outline:none;font-family:inherit;margin-top:2px}",
      ".tq-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;white-space:pre-line}",
      ".tq-ok{color:#22a06b;font-size:12px;line-height:18px;white-space:pre-line}",
      ".tq-empty{color:var(--dsw-alias-label-tertiary);font-size:12.5px;padding:10px 0}",
      ".tq-details{margin-top:16px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:10px;font-size:12.5px}",
      ".tq-details summary{cursor:pointer;font-size:13px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary)}",
      ".tq-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px 18px;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}",
      ".tq-row:last-child{border-bottom:none}",
      ".tq-row>div:first-child{flex:1;min-width:200px}",
      ".tq-label{font-size:12.5px;line-height:19px}",
      ".tq-hint{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px;margin-top:2px;white-space:pre-line}",
      ".tq-foot{margin-top:14px;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px;word-break:break-all}",
    ].join("");

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === "undefined") return;
        if (!document.getElementById(CSS_TAG)) {
          const el = document.createElement("style");
          el.id = CSS_TAG;
          el.textContent = CSS;
          document.head.appendChild(el);
        }
      }, []);
    }

    async function request(path, body) {
      const init =
        body === undefined
          ? { method: "GET", cache: "no-store" }
          : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
      const res = await fetch(API + path, init);
      let payload = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }
      if (!res.ok || !payload || payload.ok === false) {
        const detail = payload && payload.error ? payload.error : "HTTP " + res.status;
        throw new Error(detail);
      }
      return payload;
    }

    const pad = (n) => String(n).padStart(2, "0");
    const fmtClock = (ts) => {
      const d = new Date(ts);
      return pad(d.getHours()) + ":" + pad(d.getMinutes());
    };
    const fmtDay = (ts) => {
      const d = new Date(ts);
      const today = new Date();
      const tomorrow = new Date();
      tomorrow.setDate(today.getDate() + 1);
      const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      if (sameDay(d, today)) return "今天 " + fmtClock(ts);
      if (sameDay(d, tomorrow)) return "明天 " + fmtClock(ts);
      return d.getMonth() + 1 + "/" + d.getDate() + " " + fmtClock(ts);
    };
    const fmtLeft = (ms) => {
      const total = Math.max(0, Math.round(ms / 1000));
      const hours = Math.floor(total / 3600);
      const mins = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      if (hours > 0) return hours + " 小时 " + mins + " 分";
      if (mins > 0) return mins + " 分 " + pad(secs) + " 秒";
      return secs + " 秒";
    };
    const ago = (iso) => {
      const ms = Date.now() - new Date(iso).getTime();
      if (!Number.isFinite(ms)) return "";
      const min = Math.round(ms / 60000);
      if (min < 1) return "刚刚";
      if (min < 60) return min + " 分钟前";
      const hours = Math.round(min / 60);
      if (hours < 24) return hours + " 小时前";
      return Math.round(hours / 24) + " 天前";
    };
    const msg = (e) => (e && e.message ? e.message : String(e));

    function TargetBadge({ target, sessions }) {
      if (target && target.kind === "session") {
        const found = (sessions || []).find((s) => s.id === target.sessionId);
        const label = (found && found.title) || "已选会话 " + String(target.sessionId).slice(0, 8);
        return h("span", { title: target.sessionId }, "→ 已有会话 · " + label);
      }
      if (target && target.create && target.create.cwd) return h("span", null, "→ 新会话 · " + target.create.cwd);
      return h("span", null, "→ 新会话");
    }

    function StatusPill({ status }) {
      if (status === "sent") return h("span", { className: "tq-pill tq-sent" }, "已派发");
      if (status === "failed") return h("span", { className: "tq-pill tq-failed" }, "派发失败");
      return h("span", { className: "tq-pill tq-pending" }, "待发送");
    }

    function Row({ label, hint, children }) {
      return h("div", { className: "tq-row" },
        h("div", null,
          h("div", { className: "tq-label" }, label),
          hint ? h("div", { className: "tq-hint" }, hint) : null),
        h("div", null, children));
    }

    function windowsToText(windows) {
      return (windows || []).map((w) => w.start + "-" + w.end).join(", ");
    }

    function parseWindowsText(text) {
      const parts = String(text || "").split(/[,，]/).map((s) => s.trim()).filter(Boolean);
      const out = [];
      for (const part of parts) {
        const m = /^(\d{1,2}:\d{2})\s*[-~—]\s*(\d{1,2}:\d{2})$/.exec(part);
        if (!m) throw new Error("高峰区间要写成 09:00-12:00 这样：" + part);
        out.push({ start: m[1], end: m[2] });
      }
      if (!out.length) throw new Error("至少给一个高峰区间");
      return out;
    }

    function TokenQueueSection() {
      useStyleOnce();
      const [st, setSt] = useState(null);
      const [err, setErr] = useState("");
      const [notice, setNotice] = useState("");
      const [busy, setBusy] = useState("");
      const [draft, setDraft] = useState("");
      const [targetKind, setTargetKind] = useState("new");
      const [sessionId, setSessionId] = useState("");
      const [cwd, setCwd] = useState("");
      const [sessions, setSessions] = useState(null);
      const [sessionsBusy, setSessionsBusy] = useState(false);
      const [editing, setEditing] = useState(null);
      const [editText, setEditText] = useState("");
      const [showHistory, setShowHistory] = useState(false);
      const [cfg, setCfg] = useState(null);
      const [cfgErr, setCfgErr] = useState("");
      const [, setClock] = useState(0);

      const load = useCallback(async () => {
        try {
          const payload = await request("/state");
          setSt(payload);
          setCfg((cur) => cur || {
            enabled: payload.settings.enabled,
            peakText: windowsToText(payload.settings.peakWindows),
            weekendsValley: payload.settings.weekendsValley,
            holidaysText: (payload.settings.holidays || []).join("\n"),
            gap: payload.settings.dispatchGapSeconds,
          });
          setErr("");
        } catch (e) {
          setErr("读不到队列状态：" + msg(e) + "（宿主半边没加载？重启 DSH 试试）");
        }
      }, []);

      useEffect(() => {
        load();
        const t1 = setInterval(load, 20 * 1000);
        const t2 = setInterval(() => setClock(Date.now()), 1000);
        return () => {
          clearInterval(t1);
          clearInterval(t2);
        };
      }, [load]);

      const loadSessions = useCallback(async () => {
        setSessionsBusy(true);
        try {
          const payload = await request("/sessions");
          setSessions(payload.sessions);
        } catch (e) {
          setErr("读会话列表失败：" + msg(e));
        } finally {
          setSessionsBusy(false);
        }
      }, []);

      useEffect(() => {
        if (targetKind === "session" && !sessions && !sessionsBusy) loadSessions();
      }, [targetKind, sessions, sessionsBusy, loadSessions]);

      const add = async () => {
        setNotice("");
        setErr("");
        if (!draft.trim()) {
          setErr("先写点东西再加。");
          return;
        }
        if (targetKind === "session" && !sessionId) {
          setErr("选择了「发给已有会话」，先在下拉里挑一个会话。");
          return;
        }
        setBusy("add");
        try {
          const target = targetKind === "session" ? { kind: "session", sessionId } : { kind: "new", cwd: cwd.trim() };
          const payload = await request("/items", { texts: draft.split(/\r?\n/), target });
          setSt(payload.snapshot);
          setDraft("");
          const n = payload.added.length;
          setNotice("已加入 " + n + " 条。" + (payload.snapshot.phase.peak ? "现在是峰价时段，先存着，到谷价再发。" : "谷价时段，马上派发。"));
          setTimeout(load, 2500);
          setTimeout(load, 8000);
        } catch (e) {
          setErr("加入失败：" + msg(e));
        } finally {
          setBusy("");
        }
      };

      const dispatchNow = async () => {
        setNotice("");
        setErr("");
        setBusy("dispatch");
        try {
          const payload = await request("/dispatch", {});
          setSt(payload.snapshot);
          const done = (payload.results || []).filter((r) => r.ok).length;
          const bad = (payload.results || []).filter((r) => !r.ok);
          if (!payload.results || !payload.results.length) setNotice("没有待发送的任务。");
          else {
            setNotice("已派发 " + done + " 条。" + (bad.length ? "\n失败 " + bad.length + " 条：" + bad.map((b) => b.error).join("；") : ""));
          }
        } catch (e) {
          setErr("派发失败：" + msg(e));
        } finally {
          setBusy("");
        }
      };

      const remove = async (id) => {
        setErr("");
        setBusy("del:" + id);
        try {
          const payload = await request("/items/delete", { ids: [id] });
          setSt(payload.snapshot);
          if (editing === id) setEditing(null);
        } catch (e) {
          setErr("删除失败：" + msg(e));
        } finally {
          setBusy("");
        }
      };

      const retry = async (id) => {
        setErr("");
        setBusy("retry:" + id);
        try {
          const payload = await request("/items/retry", { ids: [id] });
          setSt(payload.snapshot);
          setTimeout(load, 2500);
        } catch (e) {
          setErr("重试失败：" + msg(e));
        } finally {
          setBusy("");
        }
      };

      const startEdit = (item) => {
        setEditing(item.id);
        setEditText(item.text);
        setErr("");
      };

      const saveEdit = async () => {
        if (!editText.trim()) {
          setErr("内容不能为空。");
          return;
        }
        setBusy("edit");
        try {
          const payload = await request("/items/update", { id: editing, text: editText });
          setSt(payload.snapshot);
          setEditing(null);
        } catch (e) {
          setErr("保存失败：" + msg(e));
        } finally {
          setBusy("");
        }
      };

      const saveCfg = async () => {
        setCfgErr("");
        setBusy("cfg");
        try {
          const peakWindows = parseWindowsText(cfg.peakText);
          const holidays = String(cfg.holidaysText || "")
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
          const payload = await request("/settings", {
            settings: {
              enabled: !!cfg.enabled,
              peakWindows,
              weekendsValley: !!cfg.weekendsValley,
              holidays,
              dispatchGapSeconds: Number(cfg.gap) || 3,
            },
          });
          setSt(payload.snapshot);
          setCfg({
            enabled: payload.settings.enabled,
            peakText: windowsToText(payload.settings.peakWindows),
            weekendsValley: payload.settings.weekendsValley,
            holidaysText: (payload.settings.holidays || []).join("\n"),
            gap: payload.settings.dispatchGapSeconds,
          });
          setNotice("设置已保存。");
        } catch (e) {
          setCfgErr("保存失败：" + msg(e));
        } finally {
          setBusy("");
        }
      };

      const pending = st ? st.items.filter((i) => i.status === "pending") : [];
      const history = st ? st.items.filter((i) => i.status !== "pending") : [];
      const phase = st ? st.phase : null;
      const changeIn = phase && phase.nextChangeAt ? Date.parse(phase.nextChangeAt) - Date.now() : null;

      return h("div", { className: "tq" },
        h("h3", { className: "tq-title" }, "谷价待办队列"),
        h("p", { className: "tq-intro" },
          "峰价时段先把要做的写进队列，到谷价时段自动开工——一条指令一个会话，也可以指定发给某个已有会话。\n" +
          "一行一条，空行忽略。"),

        err ? h("div", { className: "tq-err" }, err) : null,

        phase
          ? h("div", { className: "tq-phase " + (phase.peak ? "tq-peak" : "tq-valley") },
              h("div", null,
                "现在是 ", h("b", { style: { color: phase.peak ? "#d97706" : "#22a06b" } }, phase.peak ? "峰价时段" : "谷价时段"),
                phase.nextChangeAt
                  ? h("span", { className: "tq-dim" }, " · 距下次切换 " + fmtLeft(changeIn) + "（" + fmtDay(Date.parse(phase.nextChangeAt)) + " 转" + (phase.peak ? "谷价" : "峰价") + "）")
                  : null),
              h("div", { className: "tq-dim" },
                phase.peak ? "新增的指令会先存着" : "新增的指令马上派发",
                " · 待发送 " + pending.length + " 条"))
          : null,

        !st || st.scheduleReady
          ? null
          : h("div", { className: "tq-err" }, "Schedule 服务不可用，队列只能存不能发。检查这个配置档是否加载了 dsh-schedule。"),

        h("div", { className: "tq-group" }, "写点什么"),
        h("div", { className: "tq-compose" },
          h("textarea", {
            value: draft,
            placeholder: "一行一条，例如：\n把 D:\\proj 的单元测试补齐\n看看这次构建为什么失败\n写一份 README",
            onChange: (e) => setDraft(e.target.value),
          }),
          h("div", { className: "tq-target" },
            h("span", null, "本条："),
            h("button", { className: "tq-tab" + (targetKind === "new" ? " on" : ""), onClick: () => setTargetKind("new") }, "开新会话"),
            h("button", { className: "tq-tab" + (targetKind === "session" ? " on" : ""), onClick: () => setTargetKind("session") }, "发给已有会话"),
            targetKind === "new"
              ? h("input", {
                  className: "tq-input",
                  style: { minWidth: "260px" },
                  value: cwd,
                  placeholder: "工作目录（可空，默认当前项目目录）",
                  onChange: (e) => setCwd(e.target.value),
                })
              : h("select", {
                  className: "tq-select",
                  value: sessionId,
                  onChange: (e) => setSessionId(e.target.value),
                },
                  h("option", { value: "" }, sessionsBusy ? "读取中…" : sessions ? "选一个会话" : "点这里加载"),
                  (sessions || []).map((s) =>
                    h("option", { key: s.id, value: s.id },
                      ((s.title || "未命名会话") + " · " + fmtDay(s.createdAt) + (s.live ? " · 进行中" : "")).slice(0, 90))),
                ),
            targetKind === "session"
              ? h("button", { className: "tq-mini", onClick: loadSessions, disabled: sessionsBusy }, sessionsBusy ? "刷新中…" : "刷新列表")
              : null),
          h("div", { className: "tq-actions" },
            h("button", { className: "tq-btn", onClick: add, disabled: !!busy }, busy === "add" ? "加入中…" : "加入队列"),
            h("button", { className: "tq-btn tq-btn2", onClick: dispatchNow, disabled: !!busy || !pending.length }, busy === "dispatch" ? "派发中…" : "立即全部发送"),
            busy === "dispatch" ? h("span", { className: "tq-dim" }, "正在建任务，稍等…") : null)),

        notice ? h("div", { className: "tq-ok" }, notice) : null,

        h("div", { className: "tq-group" }, "待发送", h("span", { className: "tq-count" }, pending.length + " 条")),
        pending.length === 0
          ? h("div", { className: "tq-empty" }, st ? "队列是空的。峰价时段写进来，谷价一到就自动发。" : "读取中…")
          : pending.map((item) =>
              h("div", { className: "tq-item", key: item.id },
                editing === item.id
                  ? h("div", null,
                      h("textarea", { value: editText, onChange: (e) => setEditText(e.target.value) }),
                      h("div", { className: "tq-btnrow" },
                        h("button", { className: "tq-mini", onClick: saveEdit, disabled: !!busy }, "保存"),
                        h("button", { className: "tq-mini", onClick: () => setEditing(null), disabled: !!busy }, "取消")))
                  : h("div", { className: "tq-item-text" }, item.text),
                h("div", { className: "tq-meta" },
                  h(TargetBadge, { target: item.target, sessions }),
                  h(StatusPill, { status: item.status }),
                  h("span", null, ago(item.createdAt) + "加入")),
                editing === item.id
                  ? null
                  : h("div", { className: "tq-btnrow" },
                      h("button", { className: "tq-mini", onClick: () => startEdit(item), disabled: !!busy }, "编辑"),
                      h("button", { className: "tq-mini tq-danger", onClick: () => remove(item.id), disabled: !!busy }, "删除")))),

        history.length
          ? h("div", null,
              h("div", { className: "tq-group", style: { cursor: "pointer" }, onClick: () => setShowHistory((v) => !v) },
                (showHistory ? "▾ " : "▸ ") + "已处理", h("span", { className: "tq-count" }, history.length + " 条")),
              showHistory
                ? history.map((item) =>
                    h("div", { className: "tq-item", key: item.id },
                      h("div", { className: "tq-item-text" }, item.text),
                      h("div", { className: "tq-meta" },
                        h(TargetBadge, { target: item.target, sessions }),
                        h(StatusPill, { status: item.status }),
                        h("span", null, item.sentAt ? fmtDay(Date.parse(item.sentAt)) + " 派发" : ago(item.createdAt) + "加入"),
                        item.error ? h("span", { className: "tq-err" }, item.error) : null),
                      h("div", { className: "tq-btnrow" },
                        item.status === "failed"
                          ? h("button", { className: "tq-mini", onClick: () => retry(item.id), disabled: !!busy }, "重试")
                          : null,
                        h("button", { className: "tq-mini tq-danger", onClick: () => remove(item.id), disabled: !!busy }, "删除"))))
                : null)
          : null,

        h("details", { className: "tq-details" },
          h("summary", null, "时段规则与派发设置"),
          cfg
            ? h("div", null,
                h(Row, { label: "自动派发", hint: "关掉后只在你点「立即全部发送」时发" },
                  h("input", { type: "checkbox", checked: !!cfg.enabled, onChange: (e) => setCfg({ ...cfg, enabled: e.target.checked }) })),
                h(Row, { label: "高峰区间", hint: "本地时间，左闭右开；其余时间都算谷价。默认 09:00-12:00, 14:00-18:00" },
                  h("input", { className: "tq-input", style: { minWidth: "260px" }, value: cfg.peakText, onChange: (e) => setCfg({ ...cfg, peakText: e.target.value }) })),
                h(Row, { label: "周末整天算谷价", hint: "周六周日不按高峰算" },
                  h("input", { type: "checkbox", checked: !!cfg.weekendsValley, onChange: (e) => setCfg({ ...cfg, weekendsValley: e.target.checked }) })),
                h(Row, { label: "法定节假日", hint: "一行一个 YYYY-MM-DD，整天算谷价" },
                  h("textarea", {
                    style: { minHeight: "46px", width: "180px", background: "transparent", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "6px", color: "inherit", fontSize: "12px", padding: "4px 6px" },
                    value: cfg.holidaysText,
                    onChange: (e) => setCfg({ ...cfg, holidaysText: e.target.value }),
                  })),
                h(Row, { label: "派发间隔（秒）", hint: "多条任务在时间轴上错开，1–60，默认 3" },
                  h("input", {
                    className: "tq-input",
                    type: "number",
                    min: 1,
                    max: 60,
                    style: { width: "80px" },
                    value: String(cfg.gap),
                    onChange: (e) => setCfg({ ...cfg, gap: e.target.value === "" ? "" : Number(e.target.value) }),
                  })),
                cfgErr ? h("div", { className: "tq-err" }, cfgErr) : null,
                h("div", { className: "tq-actions" },
                  h("button", { className: "tq-btn", onClick: saveCfg, disabled: !!busy }, "保存设置")))
            : null),

        st && st.statePath ? h("div", { className: "tq-foot" }, "队列存在 " + st.statePath + "；派发走 DSH 的 Schedule 服务，可以在「自动化任务」里看到对应条目。") : null);
    }

    const inject = ["slots"];
    const NS = "token-queue";

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register({ name: "settings.section", id: NS, order: 8, label: () => "谷价待办队列" }, TokenQueueSection),
          ),
        "token-queue: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.TokenQueueSection = TokenQueueSection;
    return module.exports;
  },
});
