# DSH-token-queue · 谷价待办队列

v1.0.0

把「现在不想花峰价 token 做的事」先记下来，等 DeepSeek 进入谷价时段，再一条一条自动派给 DSH 去干。

## 安装

这是一个 DSH 插件包（包名 `dsh-token-queue`），挂在 DSH 的 profile 上。没有原生依赖，也不需要编译。

1. 克隆到任意目录：

   ```bash
   git clone https://github.com/KaibuchiShuuki/DSH-token-queue.git
   ```

2. 在 profile 目录（例如 `~/.dsh/profiles/web`）的 `package.json` 里登记两处，路径换成你克隆到的位置：

   ```json
   "dependencies": {
     "dsh-token-queue": "link:D:/path/to/DSH-token-queue"
   },
   "dsh": {
     "profile": {
       "bundles": ["dsh-token-queue"]
     }
   }
   ```

3. 在 `~/.dsh/profiles/web/node_modules/` 下建一个指向插件目录的链接（Windows）：

   ```powershell
   cmd /c mklink /J "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-token-queue" "D:\path\to\DSH-token-queue"
   ```

   Linux / macOS 用 `ln -s`。

4. 重启 DSH（关闭窗口再打开）。设置里就会出现「谷价待办队列」。

如果所用 DSH 版本支持 `dsh plugin add`，也可以用 `dsh plugin add link:<路径>` 代替第 2、3 步。

## 依赖

- DSH Web GUI（0.2.x 线）
- profile 里的 `dsh-schedule`：派发靠它建一次性计划任务。缺了插件仍能加载，但界面会提示「Schedule 服务不可用」
- `dsh-session-query`：只影响「发给已有会话」的会话下拉；缺了就只能选「开新会话」

## 入口

DSH Web GUI → 设置 → **谷价待办队列**。

## 怎么用

1. 在输入框里写指令，**一行一条**，一次可以写很多条。
2. 选目标：
   - **开新会话**：到点后每条指令各开一个新会话开始工作（可选工作目录，不填就用 Host 的默认项目目录）。
   - **发给已有会话**：下拉里选一个会话，到点后这条指令作为用户消息发给它，由那个会话接着干。
3. 点「加入队列」。峰价时段只存不发，条目留在「待发送」里，可以随时改文字、改目标、删掉。
4. 到了谷价时段（或本来就在谷价时段），插件每 15 秒检查一次，把待发送的条目逐条交给 DSH 的 Schedule 服务投递；点「立即全部发送」可以跳过峰谷判断马上派。

已经派出去的条目会从「待发送」移到「已处理」，保留派发时间和错误信息；失败的可以「重试」。

## 时段规则

默认按 DeepSeek 现行价格政策（北京时间）：

- **峰价**：周一至周五 `09:00–12:00`、`14:00–18:00`（法定节假日除外）
- **谷价**：其余全部时间（含周末、法定节假日全天，半价）

设置区可以改：

- 高峰区间：`09:00-12:00, 14:00-18:00` 这样的文本，可以写多段；留空 = 全天谷价
- 周末整天算谷价：默认开
- 节假日：一行一个 `YYYY-MM-DD`，这些日期整天按谷价算（插件不自动推算中国法定节假日，需自己填）
- 派发间隔：多条任务之间错开的秒数（1–60）

面板顶部会显示当前是峰价还是谷价、离下一次切换还有多久。

## 派发是怎么实现的

每条队列项会被转成一个一次性的 **Schedule 任务**（`timing: { kind: 'at' }`，目标是新会话或指定会话）。所以：

- 派发出去的任务也能在 DSH 的「自动化任务」面板里看到、管理。
- 如果派发后想撤销，光删本地队列记录不够——还要去「自动化任务」里删掉那条对应的计划。
- 派发依赖 `dsh-schedule` 服务；如果某个配置档没加载它，界面会提示「Schedule 服务不可用」。

## 数据

`~/.dsh/token-queue/queue.json`

插件对这个文件做原子写（临时文件 + rename），坏 JSON 会退回默认设置而不是崩掉。

## 开发

```bash
node --test "tests/*.test.mjs"
```

- `tests/engine.test.mjs`：时段判断、窗口合并、设置净化、文件往返等纯逻辑
- `tests/host.test.mjs`：用假 ctx / req / res 跑真实路由处理（加入、编辑、删除、派发、失败重试、会话列表、信任栅栏）
