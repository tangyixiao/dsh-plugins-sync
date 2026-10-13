# dsh-plugins-sync

多端同步的 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 插件目录快照，数据来自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)（4579 个插件）。

## 仓库结构

| 路径 | 说明 |
|---|---|
| `data/plugins/*.yml` | 上游全量插件清单（4579 个，逐插件元数据） |
| `data/downloads.json` / `stars.json` / `capabilities.json` | 上游采集的下载量、stars、权限扫描数据 |
| `plugins.json` | 本仓库生成的扁平索引：名称/URL/分类/下载/stars/中英描述，已按 下载↓ stars↓ 排序 |
| `RANKING.md` | Top 200 排行榜（人类可读） |
| `package.json` → `top20` | **版本钉死的精选清单**（npm 精确版本 / github commit SHA） |
| `scripts/install-top.mjs` | 一键把 top20 装进指定 profile |
| `scripts/sync-catalog.mjs` | 从上游刷新 data/ 并重建 plugins.json + RANKING.md |

## 新设备一键恢复

```sh
git clone https://github.com/tangyixiao/dsh-plugins-sync
cd dsh-plugins-sync
node scripts/install-top.mjs --profile web        # 装 top20（自动跳过已装）
node scripts/install-top.mjs --profile web --all  # 忽略 skip 标记强装
```

也可以随时点名安装任意插件（清单在 `plugins.json`）：

```sh
dsh plugin add --profile web <npm包名@版本 或 github:owner/repo#commit>
```

## 当前 Top 20（按下载量，已钉版本）

见 [package.json](package.json) 的 `top20` 字段——npm 包锁精确版本，github 源锁 commit SHA；`vectorize-io/hindsight` 与 `saya-ch/dsh-mobile` 无可解析的 dsh.bundle spec，未列入。

## 数据同步

```sh
node scripts/sync-catalog.mjs   # 拉上游最新 data，重建索引与排行榜
git add -A && git commit -m "sync" && git push
```

## 免责声明

本仓库只同步元数据与安装脚本。插件本体是第三方代码，安装即以你的权限运行；上游列表不做安全审查，安装前请自查源码（`data/capabilities.json` 提供每个插件的权限面扫描结果可作参考）。

## 许可

目录数据沿用上游 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的许可（见 `LICENSE.list-data`）；本仓库脚本部分 MIT。
