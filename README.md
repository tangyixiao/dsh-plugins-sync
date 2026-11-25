# dsh-plugins-sync

[![Validate catalog](https://github.com/tangyixiao/dsh-plugins-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/tangyixiao/dsh-plugins-sync/actions/workflows/ci.yml)
[![Sync catalogs and markets](https://github.com/tangyixiao/dsh-plugins-sync/actions/workflows/sync.yml/badge.svg)](https://github.com/tangyixiao/dsh-plugins-sync/actions/workflows/sync.yml)

多端同步的 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 插件目录快照，数据来自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（13136 个插件）。

同时同步 Awesome、Open Plugin Market、DSH Marketplace、DSH Plugin Hub，以及 Tangyixiao 市场的稳定版和预览版原生索引。当前数量、来源状态和快照时间见 [多市场同步记录](markets/README.md)。

## 仓库结构

| 路径 | 说明 |
|---|---|
| `profiles/public-plugins.json` | 个人恢复清单：各 profile 的公开插件、精确版本与安装来源 |
| `data/plugins/*.yml` | 上游全量插件清单（13136 个，逐插件元数据） |
| `data/downloads.json` / `stars.json` / `capabilities.json` | 上游采集的下载量、stars、权限扫描数据 |
| `plugins.json` | 本仓库生成的扁平索引：名称/URL/分类/下载/stars/中英描述，已按 下载↓ stars↓ 排序 |
| `RANKING.md` | Top 200 排行榜（人类可读） |
| `package.json` → `top20` | **版本钉死的精选清单**（npm 精确版本 / github commit SHA） |
| `scripts/install-top.mjs` | 一键把 top20 装进指定 profile |
| `scripts/sync-catalog.mjs` | 从上游刷新 data/ 并重建 plugins.json + RANKING.md |
| `catalog-overrides.json` | 已审阅的本地条目修正，记录来源 PR，刷新后保留 |
| `catalog-snapshot.json` | 本次同步的上游提交、时间与条目数 |
| `markets.config.json` | 六个市场来源、独立通道及许可来源配置 |
| `markets/snapshots/*.json` | 各来源通过官方 format-1 解析器校验的独立快照 |
| `market-plugins.json` | 按包名聚合的来源位置与版本冲突记录；声明保留在来源快照中 |
| `markets/status.json` | 每个来源的 fresh / cached / unavailable 状态 |

## 按个人清单恢复

[个人插件清单](profiles/public-plugins.json) 按 profile 记录已安装的公开插件、精确版本和公开来源。同一插件在不同 profile 中可以使用不同版本。`profile-1` 等是自定义配置的匿名编号，在新设备上可按插件组合对应到本地 profile。

恢复时按 `source.spec` 安装 `origin: direct` 的条目。标为 `host` 的条目随相应版本的 DSH 提供。`enabled` 表示当时的配置已将该插件列入启用清单，`disabled` 表示已安装但未列入。安装完成后请核对这两种状态。

清单只包含公开软件信息。账号需要在新设备登录，文件路径和设备专用设置在本机配置。更新个人清单时从已安装版本重新核对；每六小时运行的市场同步更新目录和排行榜。

例如，Web 配置可以用下面的命令恢复清单中的 ZCode Plan Bridge。Desktop 的插件由 Desktop 自带的插件管理器安装。安装后按清单核对需要启用的条目。

```sh
dsh plugin --profile web add --save-exact dsh-zcode-plan-bridge@0.7.0
```

## 在新设备安装固定 Top 20

```sh
git clone https://github.com/tangyixiao/dsh-plugins-sync
cd dsh-plugins-sync
node scripts/install-top.mjs --profile web        # 装 top20（自动跳过已装）
node scripts/install-top.mjs --profile web --all  # 重装有精确来源的精选条目
```

也可以随时点名安装任意插件（清单在 `plugins.json`）：

```sh
dsh plugin --profile web add --save-exact <npm包名@版本 或 github:owner/repo#commit>
```

## 当前 Top 20（按下载量，已钉版本）

见 [package.json](package.json) 的 `top20` 字段——npm 包锁精确版本，github 源锁 commit SHA；`vectorize-io/hindsight` 与 `saya-ch/dsh-mobile` 无可解析的 dsh.bundle spec，未列入。

## 数据同步

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org/
npm run sync        # 全量目录、索引、排行榜及所有配置的市场来源
npm run validate    # 离线校验完整快照、来源完整性及聚合指针
npm test            # 同步保护、YAML 解析和版本冲突回归检查
```

已有上游检出时，可复用数据：`node scripts/sync-catalog.mjs --source-dir <上游目录> --source-ref <完整提交 SHA>`。同步先检查全部 YAML 与 JSON，再替换快照，并应用 `catalog-overrides.json` 中的修正，避免已合入的作者更正被覆盖。新增、更名和移除条目均按该次上游快照同步。

下载量、stars、权限扫描和截图数据沿用上游缓存；同步日期不代表这些字段的重新采集日期。`package.json` 的精选安装版本为单独维护的固定清单，不会随目录刷新自动升级或安装。

`npm run sync:catalog` 只更新 Awesome 完整目录；`npm run sync:markets` 只更新配置的六个原生市场索引。后者每个来源最多读取 20 MiB、超时 30 秒；不会安装或执行收录的插件。

多市场聚合按包名去重，同一版本的安装来源或宿主兼容声明不一致时保留所有来源指针。稳定版与预览版分别记录，未将预览版本替换成稳定版。来源失败时保留通过完整性验证的旧快照，标为 cached，并让本轮同步以失败状态结束；首次没有可用快照时，不生成缺少该来源的聚合结果。

## GitHub Actions

- **Validate catalog**：每次 PR、main 推送和手动运行时，在 Ubuntu / Windows 上执行语法检查、回归测试、全部 YAML/JSON 与市场指针校验、依赖审计。离线校验不依赖第三方市场在线。
- **Sync catalogs and markets**：每 6 小时自动运行，也可在 Actions 页面手动触发。计划时刻为北京时间 02:23 / 08:23 / 14:23 / 20:23，实际启动时间由 GitHub 调度决定。
- 自动同步使用单独的 `automation/catalog-sync` 分支，创建或更新同一个 PR；本轮抓取、测试、完整性校验和依赖审计全部通过，且所有来源均为 fresh 时，自动合入 `main`，无需逐次手动合并。分支通过保留前次提交为父提交来正常推进，不使用强制推送。
- 自动合并只接受生成目录、排行榜、市场快照及 README / package.json 中的插件数量变化。脚本、工作流、依赖、市场配置、精选安装版本或其他人工改动均被拒绝；PR 提交或 main 在校验后发生变化也会中止。该分支只用于生成数据，请在其他分支提交人工改动。Dependabot 依赖更新仍单独审阅。
- 内容未变化时保留快照时间，避免仅因时间戳变化创建更新。某个来源失败会在 Actions 中报告；若缓存完整，仍可生成带 cached 状态的更新 PR。
- 工作流使用内置 `GITHUB_TOKEN`，只给同步任务授予 contents / pull-requests / actions 写权限，不需要另填市场账号或 npm 密钥。仓库需要允许 GitHub Actions 创建 PR。机器人 PR 的额外 CI 可能显示待批准，自动同步任务本身已执行相同的校验；自动合入后显式触发 Ubuntu / Windows CI。来源 cached / unavailable、校验失败或合并受保护规则阻止时，保留待处理 PR 并报错。
- Dependabot 每周检查 npm 锁定依赖和 GitHub Actions 引用。

添加市场时，在 `markets.config.json` 中增加唯一来源 ID、HTTPS 原生 format-1 索引 URL、通道与许可链接，然后运行同步及全部校验。每个来源的原始索引、声明和归属分别保留；本仓库的脚本许可不覆盖市场数据，见 [市场数据许可说明](LICENSE.market-data)。

## 署名与来源

本仓库由 [Tangyixiao](https://github.com/tangyixiao) 维护，同步脚本与整理工作归相应贡献者；自动更新由 GitHub Actions 执行。每次 Action 生成的数据提交及自动合并提交均以 `github-actions[bot]` 为作者，并通过以下标准 Git trailer 与 Tangyixiao 联合署名，GitHub 可识别为共同作者：

```text
Co-authored-by: Tangyixiao <115929632+tangyixiao@users.noreply.github.com>
```

机器人提交同时保留 `Maintained-by` 与数据来源说明。没有数据变化时不创建空提交。

完整目录、下载量、stars 和权限扫描数据来自 [Awesome DSH Plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 及其贡献者。六个市场通道的原始来源、归属和许可分别列在[多市场同步记录](markets/README.md)、[来源配置](markets.config.json) 和 [市场数据许可说明](LICENSE.market-data)，每次自动刷新都会保留。

感谢 [Ultroncn](https://github.com/Ultroncn) 在 [PR #1](https://github.com/tangyixiao/dsh-plugins-sync/pull/1) 中修正其插件条目；这项贡献记录在 `catalog-overrides.json`，自动刷新继续保留。各插件、翻译和市场声明的版权归原作者或来源；目录收录不改变其署名与许可。

## 免责声明

本仓库只同步元数据与安装脚本。插件本体是第三方代码，安装即以你的权限运行；上游列表不做安全审查，安装前请自查源码（`data/capabilities.json` 提供每个插件的权限面扫描结果可作参考）。

## 许可

目录数据沿用上游 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的许可（见 `LICENSE.list-data`）；本仓库脚本部分 MIT。
