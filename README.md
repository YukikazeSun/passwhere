# 我密码呢

Windows 10 及以上平台使用的绿色便携式本地账号信息记事本。

## 当前版本已实现

- 软件/网站分区和多个独立账号；
- 层级分类、彩色多选标签、关键词搜索和组合筛选；
- 账号、密码、长识别码、密保问答、备注及自定义字段；
- 一键复制、登录网址跳转和备注超链接；
- 图片选择、截图粘贴、图片网址加载和本地实体化保存；
- 可选加密 `data\images` 和 `data\icons` 中的图片文件，开启或关闭时原路径迁移；
- 密码修改三项确认、最多三个去重历史密码；
- 分类右键子分类管理、标签扳手管理和拖拽排序；
- SQLite 加密信封存储、可选启动密码与 16 位恢复码；
- 加密 `.anb` 完整备份与恢复、10 MB 修改日志轮换；
- 标准 `.xlsx` 完整导出与安全导入、只读 `.docx` 查看/打印导出；
- 分类、标签、分区和账号回收站，支持完整恢复、永久删除和清空；
- AppData v6 记录 revision、删除墓碑、加密回收站、本机设备 ID 和保守冲突规划；
- 浏览器演示模式仅使用内存数据，关闭页面后不保留账号信息。

顶部“数据交换”统一提供加密备份、数据导入和 Office 导出。Excel/Word 文件包含明文账号密码；桌面版保存到 `data\exports`，Excel 导入仍会先创建加密回滚备份。Word 仅用于查看和打印，不支持导入。

## 绿色版

生成不含演示数据的绿色解压版：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-portable.ps1
```

当前源码和正式绿色包版本均为 v0.4.0，产物位于 `release\我密码呢-v0.4.0-绿色版.zip`。解压后双击 `我密码呢.exe`；首次启动会在程序旁创建空白 `data` 目录。v0.4.0 正式包 SHA256：`6063132EEBD6C5D6797809FBCCA159207C4947D3177D963224DE271C1B650312`。

版本变更见 [`CHANGELOG.md`](CHANGELOG.md)，历史绿色包的文件名、大小、SHA256 和源码可追溯状态见 [`docs/release-archive-2026-09-14.md`](docs/release-archive-2026-09-14.md)。

只检查版本元数据、构建工具和使用说明，不执行测试或打包：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-portable.ps1 -ValidateOnly
```

对已有 ZIP 执行独立验收（路径按实际版本填写）：校验两文件白名单，解压到系统临时目录，确认程序窗口与首次启动数据结构，使用程序内同一套解密逻辑验证 SQLite payload 为加密格式且初始业务数组为空，再关闭程序并清理临时目录。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\package-portable.ps1 -SmokeTestArchive ".\release\我密码呢-v0.4.0-绿色版.zip"
```

## 开发

Windows 下可直接双击项目根目录的 `启动开发版.cmd`。脚本会检查运行环境和项目自带 Rust 工具链（先执行 `cargo --version`），在缺少 `node_modules` 时自动安装依赖，并启动 Tauri 开发窗口；启动失败时窗口会保留错误信息。

启动器会监督开发窗口的完整生命周期：关闭窗口后自动停止本项目的 Vite、Cargo 和 Tauri 进程并释放 1422 端口；异常中断后再次启动时会先清理本项目的残留进程，不影响其他项目。诊断日志保存在 `output\start-dev-launcher.log`、`output\start-dev.stdout.log` 和 `output\start-dev.stderr.log`。

也可以手动运行：

```powershell
cmd /c npm install
cmd /c npm run dev
cmd /c npm run tauri dev
cmd /c npm test
cmd /c npm run build
```

构建后可检查 Office 浏览器包未携带 ExcelJS 的 Node 侧依赖：

```powershell
cmd /c npm run audit:office
```

浏览器开发地址为 `http://127.0.0.1:1422/`。浏览器模式只用于界面开发；正式桌面版使用 SQLite 和可执行文件旁的 `data` 目录。

## 数据保护边界

数据库中的账号字段使用 AES-256-GCM 加密。设置 > 安全中的“加密本地图片文件”可将图片和图标转换为带认证的二进制密文容器；文件名及路径保持不变，软件内预览、备份和 Office 导出仍使用原始图片字节。该选项默认关闭，单张图片迁移时会短暂占用约两倍内存，不建立额外缩略图缓存。

未启用启动密码时，本地安全配置保存自动解锁密钥，以维持打开即用；数据库和图片加密只能避免直接打开文件阅读，不抵御同时复制整个程序目录的人员。此状态下创建可携带的 `.anb` 导出备份时，会要求单独设置备份密码，密码不会保存到配置文件；导入前自动创建的回滚备份仅绑定当前安装。启用启动密码后使用 Argon2id 派生包装密钥，恢复码只在生成时显示一次。启动密码、恢复码和导出备份密码分别丢失时，对应数据不可恢复。

同步和安卓端已完成前置数据模型，但仍未连接网络服务或建立安卓应用。同步提供方未来只能传输加密 `.anb` 快照，不能接触明文账号数据；详见 `docs\安卓端与同步接口方案.md`。当前完成度与限制见 `docs\功能完成度与使用习惯审计-2026-07-27.md`。

## 构建便携版

项目内 `.tooling` 保存隔离的 Rust 工具链，不修改系统 PATH。运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\build-portable.ps1
```

脚本会自动探测 Visual Studio 2022/2019 C++ Build Tools，并把本地构建用 EXE 复制到 `release-demo`。该目录属于本地产物，不纳入 Git 提交；对外分发请使用上面的绿色版打包脚本。
