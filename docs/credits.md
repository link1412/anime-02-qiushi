# 外部素材与署名

## 音效

`assets/sfx/` 保留每份素材的来源、作者、下载地址和当时核对的 CC0 声明，见 [SOURCES.md](../assets/sfx/SOURCES.md)。当前片中使用的打火、吸烟、吐气和鸟叫来自 Joseph Sardin / BigSoundBank。目录也保留制作时比较过的 Freesound 候选素材。

CC0 文本：[Creative Commons CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)。此处依据项目在 2026-10-30 记录的来源信息，没有声称本次重新核实所有远端页面。

## 乐谱与配乐

作曲：Johann Sebastian Bach，*Goldberg Variations*, BWV 988。乐谱来源：[Mutopia Project](https://www.mutopiaproject.org/)，原版谱源为 Bach-Gesellschaft。`music/scores/` 中的 `.ly` 保留完整署名与许可标记；对应 `.mid` 用作脚本输入。

| 文件前缀 | 曲目 | 制谱维护者 | Mutopia 编号 |
| --- | --- | --- | --- |
| `bwv988-aria` | Aria | JD Erickson | 979，2013-01-22 |
| `bwv988-v05` | Variation 5 | Hajo Dezelski | 1406，2014-03-10 |
| `bwv988-v14` | Variation 14 | Hajo Dezelski | 1412，2013-02-21 |
| `bwv988-v16` | Variation 16, Ouverture | Hajo Dezelski | 1413，2013-03-22 |
| `bwv988-v30` | Variation 30 | Hajo Dezelski | 1422，2013-03-22 |

上述乐谱标注 [CC BY-SA 3.0 Unported](https://creativecommons.org/licenses/by-sa/3.0/)。重新分发或修改这些版本时应保留其署名并遵守该许可。

当前 cue sheet 使用 Aria 与 Variation 16 的片段，按影片锚点重新拟合速度、力度、时值及踏板，没有使用钢琴家的现成演奏录音。钢琴声音由合法安装的 **Spectrasonics Keyscape**（LA Custom C7 - Classical）离线渲染。商业音源、采样库、插件及其预置数据不在本仓库中。

## 界面、系统素材与工具

- **OpenCode**：用于抓取真实网页 UI。影片模型服务由本地 mock 代替，OpenCode 软件本身未复制到仓库。画面中的模型名称与回复不能作为真实服务行为的证据。
- **macOS / Apple**：输入法候选窗、系统指针、菜单栏、聚焦、地图及桌面素材由制作环境采集，权利归各自权利人。`assets/ime/` 与 `assets/oc/` 是用于影片合成的小型截图素材；原始桌面与地图录屏不随源码发布。这些内容不因仓库公开而获得新的通用素材许可。
- **字体**：使用制作机器的系统字体，不分发字体文件。
- **Python / NumPy / SciPy / OpenCV / SoundFile / PyObjC、Playwright、ffmpeg**：运行依赖，按各自许可证安装和使用，不随源码打包。

本仓库公开的是制作源码及有说明的素材归档。本次整理未为原创代码、剧本或成片新增统一的授权许可证；外部作品仍遵循其各自许可。
