<h1 align="center">Komari Emerald Globe Pro</h1>

<p align="center">面向 Komari Monitor 的资源与节点运营监控主题，在 Emerald Globe 的全球节点视图之上提供历史流量、资源压力、成本和续费分析。</p>

<p align="center">
  <a href="https://github.com/allen0039/komari-theme-emerald-globe-pro/releases/latest"><img src="https://img.shields.io/github/v/release/allen0039/komari-theme-emerald-globe-pro?style=flat-square" alt="Latest release"></a>
  <a href="https://github.com/allen0039/komari-theme-emerald-globe-pro/blob/main/LICENSE"><img src="https://img.shields.io/github/license/allen0039/komari-theme-emerald-globe-pro?style=flat-square" alt="License"></a>
  <a href="https://github.com/komari-monitor/komari"><img src="https://img.shields.io/badge/Komari-Monitor-10b981?style=flat-square" alt="Komari Monitor"></a>
</p>

![Komari Emerald Globe Pro 资源概况预览](docs/preview.png)

> 预览图来自主题实际界面，站点名称、节点名称、节点数量、流量、费用和状态均已替换为虚构示例。公开发布前请确认截图中不包含 IP、域名、账户信息、API 密钥或其他私有标识。

## 项目定位

`Komari Emerald Globe Pro` 是面向 [Komari Monitor](https://github.com/komari-monitor/komari) 的 Pro 版前端主题，基于 [Komari Emerald](https://github.com/Tokinx/komari-theme-emerald) 和 Emerald Globe 的交互地球体验继续扩展。

它把三类信息放在同一个监控工作台中：

- **实时状态**：节点在线状态、硬件资源、流量速率和三网质量。
- **历史分析**：近五日上下行趋势、节点负载、网络延迟和丢包历史。
- **运营管理**：流量额度、资源压力、成本、预算参考和即将续费的节点。

主题只负责浏览器端展示、数据整理和 Komari API/RPC 调用，不包含独立后端，也不会改变探针上报方式。

## 主要功能

### 全球节点视图

- 基于 Three.js 和 Globe.gl 的彩色交互地球。
- 支持自转地球、静止地球、点状世界地图、汇总卡片和隐藏头部。
- 根据节点地区显示节点标记、国家/地区旗帜和节点连线。
- 地球标记可显示在线状态、实时上行和下行速率。
- 页面不可见时会暂停部分渲染，降低后台标签页资源消耗。

### 节点监控

- 卡片视图和列表视图，支持按分组筛选、搜索和排序。
- 节点卡片展示操作系统、地区、CPU、内存、硬盘、流量、速率、在线时长、费用和标签。
- 支持按状态、系统、节点名称、CPU、内存、硬盘、流量和速率排序。
- 支持节点名称、地区、系统、分组、标签和公开备注搜索。
- 可将离线节点统一排到列表末尾。
- 节点详情页集中展示硬件、系统、网络、存储、流量和费用信息。

### 三网延迟与丢包

- **摘要模式**：快速查看多组网络的延迟、丢包和健康状态。
- **明细模式**：分别查看各网络的延迟、丢包和历史条形趋势。
- 可配置三网任务的显示顺序；摘要最多展示 6 条，明细最多展示 3 条。
- 点击延迟或丢包区域即可打开更完整的网络图表。
- 对无数据、历史记录关闭、保留时间不足、权限不足和接口不兼容进行区分。
- 不使用虚构流量或虚构历史记录填补缺失数据。

### 资源概况

资源概况页面将节点数据整理为五个相互配合的面板：

- **流量趋势**：按所选时区统计近 5 个自然日的上行、下行和合计流量。
- **资源压力热力图**：对 CPU、内存、磁盘和网络等资源进行横向比较。
- **流量额度排行**：按流量使用率展示最接近额度上限的节点。
- **实时流量**：展示当前节点的上行、下行速率和实时热点。
- **成本与续费**：汇总月均成本、年度预算参考、近期续费金额和到期时间线。

历史流量分析会优先使用 Komari 可用的批量 metrics 能力，在必要时回退到批量 records 查询。每个面板都会根据后端能力、数据保留时间、权限和记录完整性展示对应的状态说明。

### 成本与续费管理

- 支持统一换算为人民币、美元、欧元等常用币种。
- 展示月均成本、年度成本参考和有价格数据节点的覆盖情况。
- 支持按未来天数筛选近期续费节点，范围为 1-365 天。
- 支持查看节点价格、计费周期、自动续费状态和到期日期。
- 默认不向访客公开成本、价格覆盖率和续费金额；可由管理员在主题设置中显式开启。

成本模块是展示和估算工具，不等同于云服务商账单、实际结算金额或账期账单。汇率更新失败时会使用缓存或内置参考值，因此跨币种结果应作为参考。

### 个人价值计算

- 顶部钱袋入口用于查看个人选择的服务器价值统计。
- 支持全选、清空、搜索服务器和切换显示币种。
- 个人选择只影响当前浏览器中的钱袋面板，不改变面向访客的公开成本设置。
- 服务器 UUID、币种和相关界面偏好只保存在当前浏览器的 `localStorage` 中。

### 访客信息与界面体验

- 底部访客信息卡默认展示地区和浏览器概要。
- 用户主动展开后才显示设备、完整 IP、运营商和访问时间等详情。
- 可关闭访客信息卡，关闭后不再发起访客地理信息查询。
- 支持亮色、暗色和跟随系统主题。
- 支持公告、隐藏未登录后台入口、减弱过渡动画、备案信息和自定义图片/视频背景。
- 响应式适配桌面和移动设备。

## 安装

### 从 GitHub 远程导入

1. 登录 Komari 后台，进入 `设置 -> 主题管理`。
2. 选择 `导入主题 -> 导入远程主题`。
3. 填写仓库地址：

   ```text
   https://github.com/allen0039/komari-theme-emerald-globe-pro
   ```

4. 选择最新 GitHub Release 中的主题包并完成安装。

后续版本可以继续通过 Komari 主题管理页面更新。

### 从 ZIP 文件导入

1. 打开 [GitHub Releases](https://github.com/allen0039/komari-theme-emerald-globe-pro/releases/latest)。
2. 下载名称以 `komari-theme-emerald-globe-pro-build-` 开头的 ZIP 文件。
3. 在 Komari 后台的主题管理页面上传 ZIP 并完成导入。
4. 刷新前台页面；如果仍显示旧资源，请执行一次强制刷新。

不要上传 GitHub 自动生成的 `Source code (zip)` 或 `Source code (tar.gz)`。Komari 需要的是构建流程生成的主题包。

## 主题设置

完整配置定义见 [`komari-theme.json`](komari-theme.json)，由 Komari 后台管理。

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| 数据更新间隔 | `3` 秒 | 实时状态刷新间隔，建议 1-10 秒。 |
| RPC 连接模式 | `websocket` | 可切换为 `http`。WebSocket 不可用时使用 HTTP。 |
| 默认视图模式 | `card` | 首页默认使用卡片或列表视图。 |
| 公告 | 关闭 | 控制公告、标题和支持简单 Markdown 的内容。 |
| 头部展示模式 | `earth` | 自转地球、静止地球、点状地图、汇总卡片或隐藏头部。 |
| 访客信息卡片 | 开启 | 控制访客地区、浏览器和设备信息卡片。 |
| 隐藏后台入口 | 关闭 | 未登录时隐藏后台入口。 |
| 减弱过渡动画 | 关闭 | 减少页面过渡和数据更新动画。 |
| 延迟节点排序 | 空 | 使用英文逗号分隔任务名称，自定义三网显示顺序。 |
| 离线节点后置 | 关闭 | 将离线节点排到节点列表末尾。 |
| 资源统计时区 | `browser` | 支持浏览器时区、`UTC` 或 IANA 时区，如 `Asia/Shanghai`。 |
| 向访客公开成本 | 关闭 | 关闭时仅登录管理员可见成本和续费金额。 |
| 成本展示币种 | `CNY` | 资源概况成本模块使用的统一展示币种。 |
| 续费统计天数 | `30` | 续费面板统计未来天数，可设置 1-365。 |
| ICP/公安备案 | 关闭 | 可配置号码和跳转链接。 |
| 自定义背景 | 关闭 | 支持图片或视频、亮/暗色地址、模糊和遮罩。 |

首页搜索内容、节点分组、卡片/列表视图、三网摘要/明细模式、主题模式和个人价值选择属于当前浏览器的界面状态，不会写入 Komari 后端。

## 数据与兼容性

- 已针对 Komari `1.3.2` 和 `1.4.3` 的历史数据结构进行适配；其他版本会通过能力探测尽力兼容。
- 五日趋势按所选时区的自然日统计，而不是简单按最近 120 小时切片。
- 趋势展示的是 Komari 采集的探针流量，不等同于云服务商账单、计费周期或结算流量。
- 历史记录开关、保留时间、访问权限和后端接口能力会影响趋势的可用范围。
- 当历史数据不足时，界面会显示数据缺口或不可用原因，不会用当前瞬时值伪造历史趋势。
- 地球和地图效果需要浏览器支持 WebGL；不支持 WebGL 时，节点卡片、列表、详情和部分图表仍可使用。
- 推荐使用较新的 Chrome、Edge、Firefox 或 Safari。

## 隐私与外部请求

本主题不包含广告、统计分析或用户行为追踪代码，也不会将 Komari 登录凭据、节点数据或个人价值设置上传到作者服务器。

启用对应功能时，浏览器可能访问以下公开服务：

| 功能 | 可能访问的服务 | 用途 |
| --- | --- | --- |
| 访客信息卡片 | `api.ip.sb`、`ipwho.is`、`api.ipapi.is`、`ipapi.co`、`api.vore.top` | 获取访客公网 IP、运营商和大致地区。关闭访客信息卡可停止这类请求。 |
| 汇率换算 | `api.frankfurter.app`，失败时回退 `open.er-api.com` | 获取公开汇率，不发送节点价格或账单内容。 |
| 图标 | Iconify CDN | 按需加载图标资源。 |
| 点状世界地图 | jsDelivr、Fastly、Gcore 或 GitHub Raw | 下载 Apache ECharts 世界地图 JSON。 |
| 自定义背景 | 站点所有者填写的图片或视频地址 | 由访客浏览器直接请求。 |

浏览器本地存储用于保存主题模式、视图偏好、节点筛选、个人价值选择、币种以及短期趋势/地图缓存。这些数据不会由主题上传到作者服务器。

公开部署前建议：

- 保持“向访客公开成本”关闭，除非确实要公开节点价格、预算和续费金额。
- 不需要访客定位时关闭“访客信息卡片”；即使卡片折叠，启用后仍可能发起请求。
- 检查 Komari 公开接口中暴露的节点名称、地区、公开备注、流量额度和到期日。
- 发布截图前遮挡 IP、域名、UUID、真实节点名称、费用、账户信息和精确访问位置。
- 根据站点隐私政策审查第三方 IP、汇率、图标、地图和背景服务的使用。

## 本地开发

### 环境要求

- Node.js `^20.19.0` 或 `>=22.12.0`
- Bun `>=1.2.0`

项目使用 Bun 管理依赖，不建议混用 npm、pnpm 或 yarn。

### 安装、开发和验证

```bash
bun install
bun run dev
bun run type-check
bun run lint:check
bun run test
bun run build
bun run verify:package
```

其中：

- `bun run dev` 启动 Vite 开发服务器。
- `bun run type-check` 执行 Vue/TypeScript 类型检查。
- `bun run lint:check` 执行不修改文件的 ESLint 检查。
- `bun run test` 执行仓库中的 Bun 测试。
- `bun run build` 执行类型检查、生产构建和主题 ZIP 打包。
- `bun run verify:package` 检查主题 ZIP 的文件结构和必要文件。

### 构建产物

`bun run build` 会在仓库根目录生成：

```text
komari-theme-emerald-globe-pro-build-<git-hash>.zip
```

ZIP 根目录包含：

```text
komari-theme.json
preview.png
dist/
```

其中 `preview.png` 来自 `docs/preview.png`。不要修改主题包名称、清单文件名或预览图文件名，除非同步修改 `vite.config.ts` 和包校验脚本。

### 版本与发布准备

版本准备脚本会同步更新 `package.json` 和 `komari-theme.json` 的版本号，并将两个文件加入暂存区：

```bash
bun run publish -- --version 1.0.10
```

不传版本号时，脚本会询问是否自动递增 patch 版本。发布前建议按以下顺序操作：

1. 更新版本号并检查变更。
2. 运行类型检查、lint、测试、构建和包校验。
3. 检查生成 ZIP 的名称和根目录结构。
4. 提交代码并推送到 GitHub。
5. 创建与版本号一致的 GitHub Release，并上传 `komari-theme-emerald-globe-pro-build-*.zip`。

## 技术栈

Vue 3、Vite 7、TypeScript、Tailwind CSS 4、Pinia、reka-ui、ECharts、vue-echarts、Three.js、Globe.gl、vue-router、vue-sonner 和 Iconify。

## 致谢

- [Komari Monitor](https://github.com/komari-monitor/komari)
- [Komari Emerald](https://github.com/Tokinx/komari-theme-emerald)：主题直接上游
- [Komari Glassmorphism](https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism)：彩色地球、纹理和视觉实现参考
- [Komari Naive](https://github.com/lyimoexiao/komari-theme-naive)：Emerald 主题基座参考

## 许可证

本项目采用 [MIT License](LICENSE)。上游项目、图标、地图数据和第三方公共服务请同时遵守各自许可证与使用条款。
