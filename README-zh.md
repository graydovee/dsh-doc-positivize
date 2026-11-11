# dsh-doc-positivize

一个 DeepSeek Harness（DSH）插件，让文档保持正向且只描述当前状态：常驻系统提示词的英文护栏负责每次生成；`/positivize` 命令负责把已有文档、注释、提交文案中的否定式或历史式表达改写为正面描述。

## What it does

`apply` 注册两个贡献：

- 全局系统提示词段落 `doc-positivize:guard`（order `6000`），通过 `ctx.systemPrompt.section()`；
- 人类命令 `/positivize`，通过 `ctx.commands.register()`。

开启护栏后，护栏每轮生效；命令只在用户输入时生效，并在宿主进程内运行。

## Why doc-positivize

名字由范围和动作组成：文档 + 正向化。护栏在每次模型请求时执行这条规则；`/positivize` 命令把已有产物也改成同一标准。

参考项目给出的标准是：直接陈述被接受的设计，只描述当前状态。

## The guard contract

内置护栏是英文的——和全部一等公民 prompt 段落一致——并且满足标记检索式：

- **只表达最终状态**——代码、注释、Commit 与 MR/PR 标题与描述、文档与 Prompt 只描述当前生效的设计，如同最初即如此设计。
- **只保留最终设计**——功能、行为或方案更新时，代码、文案、注释、Commit/MR 与 Prompt 同步只保留最终采纳的设计。
- **正面即标准**——规则、Prompt、Tool Schema 与注释直接声明唯一正面做法与触发条件。

`tests/guard.test.ts` 把这份契约钉死：默认文本满足参考项目的标记检索式、保持英文、且花括号保持字面。

## The /positivize command

```text
/positivize                      把当前工作区改写为正面描述
/positivize README*.md           把匹配该范围的文件改写为正面描述
```

在 Web GUI 中，命令按标记检索式扫描范围，逐文件向当前会话的模型请求一份最小 JSON 编辑方案，就地应用，然后立即返回以清空输入框。结果卡片承载结构化 Diff、运行中的**终止**按钮，以及每个被修改文件上的**撤销**按钮。扫描发生在模型对话之外，调用会话的对话内容保持不变。

没有 Connection 服务的宿主（CLI 与 headless）走前台路径：命令等待扫描结束并返回完整文本报告。

扫描受 `maxFiles`、`maxFileBytes`、`timeoutMs` 限制；报告会列出留给下次运行的文件。它遵守参考项目的豁免：程序逻辑与测试断言、公开 SDK 的 Semver 弃用期声明、高危操作（改写为正面前置条件）、用户原话字面量。它会直接编辑文件；涉及代码的扫描结束后请自行运行项目测试。

## Result card, undo, and stop

结果卡片由插件自己渲染统一 Diff：包含 hunk 头、行号和主题的增删配色；默认展开第一个修改文件，其余折叠；文件行显示 `+added` / `-deleted` 统计。

- **终止**会中止正在运行的扫描。终止前已修改的文件仍然列出并保留撤销按钮；不会再有新的模型请求或写入开始。
- **撤销**只恢复该文件到扫描前的内容。如果文件当前内容已经不等于扫描输出，撤销会拒绝覆盖；撤销也只接受本次运行记录过的路径。
- 只有扫描结束后才能撤销；没有全部撤销，也没有重做。
- 没有修改时只显示一行紧凑提示，不出现空卡片。
- 运行态保存在 Host 进程内：Host 重启后卡片回退为命令的紧凑摘要，不再提供动作。

卡片使用 Connection 提供的三个精确、仅 owner 可调用的路由：`GET /api/doc-positivize.state?runId=…`、`POST /api/doc-positivize.cancel`、`POST /api/doc-positivize.undo`。撤销请求只选择一个本次运行已经改过的文件，不能引入新的写入目标。

## Compatibility

| Surface | Status |
|---|---|
| Harness | DeepSeek Harness `0.2.2-rc.1`；提供 `systemPrompt.section()`、`ctx.commands` 与 `ctx.llm` 的 0.2.x 版本 |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Services | `systemPrompt`、`commands` 与 `llm`，都属于 `@deepseek-ai/dsh-base`；可选的 `connection` 用于结果卡片的终止/撤销路由 |
| Client | Web GUI：包内提供 `dsh.client` 设置卡片与 `/positivize` 结果卡片，挂到插件页 |
| Runtime imports | `@deepseek-ai/schemastery` |
| Config | Schemastery `Config` schema；非法值在加载期失败 |

## Install

仓库直接提交了构建产物，因此从 GitHub 安装只需一步，不需要任何构建授权：

```sh
# 直接从 GitHub 安装，无需 allowBuilds 授权
dsh plugin --profile <profile> add github:graydovee/dsh-doc-positivize

# 确认 bundle 行已挂载
dsh --profile <profile> --dump-config | grep dsh-doc-positivize
```

Web 端「插件 → 添加插件」里粘贴 `github:graydovee/dsh-doc-positivize`（或仓库 URL）也是同样的一次安装。要改源码，或改用离线打包的 tarball：

```sh
pnpm install
pnpm build          # 重新生成 lib/；改源码时一并提交
pnpm pack --pack-destination ./.pack

# 本地 spec 必须是绝对路径
dsh plugin --profile <profile> add "$PWD/.pack/dsh-doc-positivize-0.1.0-alpha.10.tgz"
```

`dsh plugin add` 成功后还会把该包记入 `dsh.profile.bundles`，下次启动即生效。重启应用（或重载 profile）后启用。

## Configuration

| Key | Type | Default | Description |
|---|---|---|---|
| `guardEnabled` | boolean | `true` | 是否挂载常驻护栏 |
| `guard` | string | 内置英文护栏 | 替换整段常驻护栏 |
| `extra` | string | `""` | 追加在护栏之后的项目专属指引 |
| `command` | boolean | `true` | 是否注册 `/positivize` 命令 |
| `ignoredPaths` | string[] | 内置列表 | 扫描跳过的名称、路径或 glob |
| `maxFiles` | number | `12` | 单次扫描最多处理的候选文件数 |
| `maxFileBytes` | number | `96000` | 单个文件发送给模型的最大字节数 |
| `timeoutMs` | number | `180000` | 单次扫描的时间预算（毫秒） |

可在 profile 的 patch 里覆盖（插件自带的 `cordis.patch.yml` 有注释示例）：

```yaml
- id: dsh-doc-positivize
  config:
    extra: |-
      In this repository, name the exact check that proves each step.
```

纯中文仓库可以把 `guard` 换成下面这份同样满足标记检索式的中文护栏（系统提示词默认英文是 DSH 惯例，这个覆盖是给全中文项目的可选项）：

```yaml
- id: dsh-doc-positivize
  config:
    guard: |-
      写任何产物时按以下三条执行。

      - 只表达最终状态：代码、注释、Commit、MR/PR 标题与描述、文档与 Prompt 只描述当前生效的设计规格与行为，如同最初即如此设计。
      - 只保留最终设计：功能、行为或方案更新时，代码、文案、注释、Commit/MR 与 Prompt 同步只包含最终采纳的方案（例如直接写「标题：番茄炒蛋」；重大破坏性迁移或用户明确要求时记录决策说明）。
      - 正面即标准：编写规则、Prompt、Tool Schema 与注释时，直接声明期望的唯一正面做法与触发条件。
```

## Settings

插件自带网页设置卡片，通过它调整护栏开关与扫描忽略列表：

- 打开 设置 → **文档正向化**；
- **开启文档正向化护栏**：切换常驻规则；
- **忽略的文件与目录**：多行文本，每行一个名称、路径或 glob，可整段复制粘贴；**保存**写入 profile 条目，**恢复默认**清除覆盖、重新使用内置列表。

保存后在下一次模型请求生效，插件保持运行。扫描结果支持逐文件撤销；扫描进行中可在卡片上终止。只有 Host 仍持有该次运行时，这两个动作才可用。

内置列表为 `node_modules`、`.git`、`dist`、`build`、`out`、`coverage`、`.next`、`.nuxt`、`.turbo`、`.cache`、`.pnpm-store`、`.pnpm-cache`、`.pack`、`target`、`vendor`、`.venv`、`__pycache__`，以及 pnpm、npm、yarn、bun 的锁文件。显式指定的文件即使位于忽略目录内也会被扫描。

## Where it applies

order `6000` 落在 `5000`–`9000` 的空档：排在全部工具指引之后、交付物与环境块之前。段落是全局的，所有 agent 都会继承；文本静态，渲染不变时保留提示词前缀缓存。护栏每请求约 210 tokens；扫描的模型调用在宿主进程内完成，当前会话只付出命令生命周期。

## Development

```sh
pnpm install
pnpm typecheck
pnpm test          # 单元测试 + 真实 SystemPrompt/Commands 集成测试
pnpm smoke:built   # 构建后把 lib/index.js 挂到真实注册表上验证
node <dsh-plugin-guide>/dist/dsh-plugin-dev.js check --cwd .
```

`check` 报告一条 `packageManager` 警告（本机 `pnpm@10.34.6`，规范偏好 `pnpm@11.7.0`）。

`0.1.0` 是首个正式版本。本地调试构建使用下一个版本号的 `-alpha.N` 后缀（例如 `0.1.0-alpha.10`）。

## Verify

`dsh-plugin-dev verify` 会打包并装进干净的临时 `DSH_HOME`。它的默认值面向 harness `0.1.5`，会被 `0.2.2-rc.1` 的兼容性检查拒绝，因此要同时固定这两个包：

```sh
node <dsh-plugin-guide>/dist/dsh-plugin-dev.js verify --cwd . \
  --base @deepseek-ai/dsh-base@0.2.2-rc.1 \
  --headless @deepseek-ai/dsh-headless@0.2.2-rc.1
```

这样 `pack`、`install`、`--dump-config` 都会通过。无凭据的临时 home 会在 headless smoke 阶段走到模型传输并报 `TRANSPORT: DeepSeek Messages transport failed`；启动过程仍会把渲染后的提示词写成 `system/message` 事件——grep 该事件里的护栏文本即可证明段落进入了模型可见的系统提示词。

## Attribution

护栏契约与扫描流程改编自参考项目 [ox01024/pink-elephant](https://github.com/ox01024/pink-elephant)（MIT，Copyright © 2026 ox01024）。见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

Apache-2.0，见 [LICENSE](LICENSE)。
