# 制作与复现

当前成片：196.033333 秒，5881 帧，1920×1080，30 fps；AAC 48 kHz 双声道。镜头为 A / B / F / X / G / H / Q / K。正式入口是 `ui/director2.mjs`，旧脚本保留作为制作历史。

## 公开归档的范围

本仓库包含当前工作区的源码、分镜、配乐工程、输入法候选窗和已记录来源的音效。完整生产环境没有被打包：

| 本地输入或产物 | 来源与用途 | 公开状态 |
| --- | --- | --- |
| `ref/screen_now.png` | 3024×1890 的干净桌面与菜单栏底图 | 不发布；需自行准备 |
| `ref/d1.png` | 程序只读取 `[0:24,2600:3024]` 的状态栏区域 | 不发布；原始文件其余区域含私人内容 |
| `ref/cursor/{meta.json,arrow.png,ibeam.png,…}` | `ui/cursors.swift` 导出的系统指针 | 不发布；需在 macOS 重新导出 |
| `build/ui_frames/`、`ui_index.json` | OpenCode 抓帧和帧索引 | 不发布；当前本地界面帧目录也缺失 |
| `build/timeline.json` | `director2.mjs` 生成的时间轴 | 运行 `plan` 可生成 |
| `build/clock/`、`build/battery/` | `render/assets.py` 与 `ui/menubar.mjs` | 不发布；按时间轴重建 |
| `build/ztake/{take.mov,backdrop.png}` | 聚焦与地图的独立实录及背景 | 不发布；重新录制后需重标 `ui/zrec/zmap.json` |
| `build/ztake/layers/` | `render/zlayers.py` 生成的 RGBA 合成层 | 不发布 |
| `build/smudge.png` | `render/smudge.py` 生成的玻璃污渍 | 不发布；可重新生成 |
| `build/music.wav` | 配乐脚本与 Keyscape 离线渲染 | 不发布；音源需自行合法安装 |
| `build/audio.wav`、`build/frames/` | 最终混音与离线画面 | 不发布；可按完整输入重新生成 |

`ref/` 必须先检查隐私。状态栏输入只应保留实际读取的区域，其余像素可清空；不要把原始桌面截图直接提交。此处记录生产尺寸，并不保证其他系统版本会有相同字形、窗口边距或菜单行为。

## 环境与时间轴

```sh
python3 -m venv venv
venv/bin/python -m pip install -r requirements.txt
npm --prefix ui ci
npm --prefix ui run plan
venv/bin/python music/build.py --plan
```

依赖文件记录所需库，不是旧生产环境的逐版本锁定。完整制作需要 macOS；录屏依赖 PyObjC、系统权限与原屏幕几何，编码使用 macOS `aac_at`。当前抓帧脚本选择已安装的 Chrome。记录中的 OpenCode 网页版本是 1.19.5，没有随仓库固定其安装包和模型目录缓存。

## 界面抓帧

抓帧使用独立临时环境：OpenCode 在 `127.0.0.1:4398`，模型 mock 在 `4320`，网页占位代理在 `4321`。`film-mock` 和 `opencode:film` 是本地拍摄环境的固定占位凭据。

先安装 OpenCode、Chrome，并为隔离环境准备对应版本可用的模型目录缓存；代理会阻止在线更新和模型目录拉取，不会替你生成初始缓存。然后创建一次性代理证书：

```sh
mkdir -p /tmp/film2
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout /tmp/film2/mitm.key -out /tmp/film2/mitm.crt \
  -days 7 -subj '/CN=localhost'
node ui/mitm.mjs
```

代理保持运行，在另一终端执行：

```sh
bash ui/restart_oc2.sh
npm --prefix ui run capture
```

`restart_oc2.sh` 会清空 `/tmp/film2data` 与 `/tmp/film2state`，并重启匹配其命令的隔离实例。它保留模型目录缓存，把 `fakebin/` 放在该实例 PATH 最前面；画面中的 caffeinate / pmset 使用替身脚本。`mcp_computer.mjs` 仅记录工具输入。代理和暂时关闭 TLS 检查仅用于这个本地占位环境。

`ui/zrec/take.py` 是会实际输入键鼠并录制屏幕的独立采集工具，**不属于上述 mock 的电脑控制实现**。历史版本还依赖未归档的 `/tmp/film2/tis.py`，需补齐输入法切换工具；屏幕编号、窗口矩形与 macOS 版本也需重新确认。它不是一键复现入口。录制应在没有其他前台工作的时段进行，使用干净背板，并在采集后检查窗口内容与隐私。

## 桌面合成、预览与声音

准备好桌面素材、指针、界面帧和聚焦 / 地图实录后，从仓库根目录按序运行：

```sh
mkdir -p ref/cursor
swift ui/cursors.swift ref/cursor 16    # 系统指针，生产尺度 16 px/pt
venv/bin/python render/assets.py
node ui/menubar.mjs
venv/bin/python render/zlayers.py
venv/bin/python render/smudge.py
venv/bin/python render/sfx.py all
venv/bin/python tool/server.py          # http://127.0.0.1:8765/
```

网页工具可以改机位与关键帧，保存时备份到 `storyboard_history/`。预览是 WebGL 近似；按钮“物理渲染本帧”会启动离线渲染。

配乐与声音：

```sh
venv/bin/python music/build.py --plan
bash music/run.sh                       # 默认 SSH 主机 link，Mini 上 ~/ep1
venv/bin/python render/sound.py         # 默认混入已有 build/music.wav
# 无配乐：MUSIC=0 venv/bin/python render/sound.py
```

`music/run.sh` 需要 Mac mini 上合法安装的 Keyscape、`~/ep1/venv` 以及本机 Swift 编译环境。`HOST` 可改 SSH 主机；脚本中的远端工程目录固定为 `~/ep1`。每次改时间轴都应重建配乐和混音。

## 离线渲染与编码

在准备好全部素材的 Mac mini 上，从仓库目录运行：

```sh
bash render/run_render.sh
# 等所有 logs/pids.txt 中的进程结束并核对输出帧后再编码
bash render/encode.sh
```

可用 `EP1` 指定工程目录、`PY` 指定解释器、`N` 指定连续帧段的并发进程数；编码器可用 `FF` 指定。默认 Python 路径是工程内 `venv/bin/python3`。渲染脚本后台启动任务后即返回，不表示全片已完成；它会跳过已有帧，输入变化后需要自行区分旧帧。

默认先模拟一次 HEVC 录制代际，再编码 H.264；`PHONE_GEN=0` 可跳过该代际。`MUSIC=0` 只改变编码说明，应与生成 `audio.wav` 时的选择一致。输出默认在 `out/shishiqiushi.mp4`。整理和上传过程没有重新渲染影片。

> 路径说明：脚本里的 `/path/to/ep1` 是脱敏占位，使用时请改为本仓库的实际绝对路径。
