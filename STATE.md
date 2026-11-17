> 归档说明（2026-11-15）：本文件保留原始制作轮次，部分末尾段落比前面的第九轮记录更早。当前整理入口为 README.md 与 docs/reproduction.md。现有成片为第九轮末的 196.03 秒配乐版；没有在本次整理中重新渲染。

# 《实事求是》制作状态（2026-10-30 凌晨）

## 剧本（已定稿：不揭底，只埋线索）
手机对着 MacBook 屏幕录像，约 85 秒，1920x1080 30fps，无音乐。
1. 开录对焦 → 拼音输入法打出“你觉得这个世界上最伟大的四个字是什么。不需要理由,直接回答我。”
2. 真实思考文字 + 7 秒 → “实事求是。” → 推近到子像素（微距、换镜头跳变）→ 拉回
3. 打字“有人会不信,我如何证明这是你说的呢?”（zhengming 有一次打错退格）
4. 回答“用手机对着屏幕录下来。截图可以改，录像难造一些。”，思考小字含 “though not impossible”
5. 取证：摇到菜单栏时钟 → 模型名 Claude Opus 5.5 → 回到回答 → 点停止轻顿，结束（T_CUT=85.40s）
线索：文字“难造一些/though not impossible”；屏幕反光有房间灯却没有人和手机；回车声采样完全相同 + 结尾数字零；文件元数据写明“渲染生成，非拍摄”（必须如实写）。

## 已完成
- UI 帧：真实 OpenCode web UI（opencode serve 隔离环境 + mock Anthropic 服务 + Dracula 主题 + 1.5x 缩放）逐帧抓取
  - ui/director.mjs, ui/mock.mjs, ui/typing.mjs → build/ui_frames（486 张唯一帧）, build/ui_index.json, build/timeline.json（含按键时间，用于音效）
- 菜单栏时钟：ui/clock.mjs (FONT=14.0) → build/clock
- 面板合成：render/compose.py（干净壁纸 ref/screen_now.png + d1 菜单栏右侧图标；d1 其余部分含隐私，禁止使用）
- 相机路径：render/camera.py（关键帧、手持噪声、自动对焦、微距换镜、停止抖动）
- 物理渲染：render/render.py（RGB 条纹子像素采样→摩尔纹、Bayer、景深、反光、AE、噪点、锐化）
  - 本机约 2.5–7 s/帧；样帧在 preview/
- build/exposure.json 为 AE 预计算（改 AE 参数后需删除重算）

## 第二轮（2026-10-30 04:00）
- 渲染调整（render.py）：AE_TARGET=0.045；微距曝光上限 MACRO_EXPO_CAP=0.8；灯方向 (-0.25,-0.27,-0.93)，反光在画面左上边缘可见
  - 子像素发白的真正原因是 1/50 快门下微距运动模糊（~10px），不是过曝。新增 shutter_time()：微距 1/240，亮场景先缩短快门；噪点增益 = exposure/shutter
  - exposure.json 已重算（2562 帧）
- 声音：render/sound.py → build/audio.wav（48k 立体声 16bit，85.400s）。两次回车为同一采样（差值仅为底噪）；85.30s 起数字零；手持噪声由关键帧路径速度驱动；只做线性处理
- Mac mini：~/ep1（venv、render/、build/{ui_frames,clock,*.json,audio.wav}、ref/screen_now.png、ref/d1.png=只保留菜单栏右侧 [0:24,2600:3024] 的脱敏版）
  - 渲染：~/ep1/run_render.sh（N=8，nohup，日志 ~/ep1/logs/w*.log，PID ~/ep1/logs/pids.txt，输出 ~/ep1/build/frames，已存在帧跳过→重跑即续渲）；约 1.5 s/帧/进程，与本机输出逐位一致
  - 编码：~/ep1/render/encode.sh → ~/ep1/out/shishiqiushi.mp4（H.264 High 16Mbps + AAC 192k；metadata 如实写明渲染生成、回复为预先写定、声音合成；不写任何相机品牌/型号标签）

  - 上述 85.4s 全片渲染 + 编码已在 Mac mini 跑完（~/ep1/build/frames 约 9GB，~/ep1/out/shishiqiushi.mp4），**只是草稿**：先做原型、改分镜，未拷回、未检查、未审片

## 第三轮：原型阶段（先原型、要本地实时预览、后面追加蒙太奇）
### 追加分镜（已定：Mythos 10；403 重试与 organization disabled 都出现；问题用原词“英特纳雄耐尔”；节奏交给我）
多段手机录像硬切（每段重新对焦/AE），时间流逝靠菜单栏时钟、电量、屏幕反光（台灯→天亮窗光）交代：
B S6 换型号 Mythos 10 / effort Ululululultra（菜单撑出）→ C S7 打字“英特纳雄耐尔是否能实现？”（第三次回车，同一采样）
→ D–J S8 蒙太奇：工具调用刷屏 / 02:14·61% / Plan 37→108 / Compacting×3 / 天亮 / 微距 Ululululultra / 06:12·9%·Plan 117
→ K S9a 403 Forbidden 重试 1/3→3/3 → L S9b “This organization has been disabled.” 停住 → 推到子像素（呼应“实事求是”微距）→ 点停止
全片 133.9s（A 85.4 + 追加 48.5）。追加段目前是**占位卡片**，界面帧未抓。

### 数据与代码
- storyboard.json：唯一的分镜/机位数据源（clips → keys/macro/af/stop_tap/shots/screen/clock/battery/dawn）。t 可写 "E1+16.6" 这类锚点表达式
- render/camera.py 改为读 storyboard（Rig/Clip，多段）；主镜头 A 的 pose/对焦与旧版逐位一致，render.py 输出逐位一致（已验证）
- render/render.py env_reflection 加 dawn（窗光方向 (0.16,-0.21,-0.96)），dawn=0 时与之前相同
- 网页预览 tool/：`python3 tool/server.py` → http://127.0.0.1:8765/
  - pose.js = camera.py 的逐行移植（tool/test_pose.py 校验，误差 ~1e-13）；renderer.js = render.py 的 WebGL 近似（子像素/景深/运动模糊/反光/AE/噪点/色调）；screen.js = 面板内容（真实 UI 帧、占位卡片、时钟、电量）
  - 编辑：拖画面取景、滚轮推拉、⌥拖偏航俯仰、⇧滚轮横滚（自动建关键帧）；时间轴拖关键帧改时间；检查器改段/关键帧/镜头说明/卡片；增删/复制/移动段；撤销重做；⌘S 保存（自动备份到 storyboard_history/）
  - “物理渲染本帧”调用 render.py（仅 A 段、需先保存），可按住 C 对比
  - M1 Pro 上 1080p 实时 30fps
- 服务器要用 `nohup … < /dev/null & disown` 启动，否则会随 shell 退出

（以上第三轮的占位版已被第四轮取代；占位版分镜备份在 storyboard_history/storyboard-v1-placeholders.json）

## 第四轮：真实界面 + 修改（2026-10-30 04:00 后）
要求：403 不要 retry，改为用户继续发消息（continue / whats the matter）继续 403；打字要快（观众没耐心）；继续做后面的。
### 现在的分镜（全片 113.23s，3397 帧，11 段）
A 69.57 主镜头（打字提速：Q1 17.6→8.8s，Q2 13.1→6.5s；其余节奏不变）| B 5.0 选 Mythos 10 + effort Ululululultra（鼠标隐藏，悬停→点击）
| C 6.5 打字“英特纳雄耐尔是否能实现？”（IME 分三段：英特/纳雄(选第2候选)/耐尔(选第2候选)）→ 回车 → 开始 webfetch
| D 3.0 webfetch 刷屏 | E 2.5 时钟 02:14·61% | F 3.0 待办 37→108 | G 2.6 会话已压缩×2 | H 3.5 天亮 | I 3.0 微距 Ululululultra | J 2.5 06:12·9%·Plan 117
| K 12.07 自动任务 403 → continue → 403 → whats the matter → 403 → hello? → “This organization has been disabled.” → 推到子像素 → 点停止
### 抓帧（ui/）
- director2.mjs（整片一次连续抓取，屏幕时间=影片时间，段间切点处成批放行模型回合）、mock2.mjs（脚本化回合：thinking/text/tool_use/HTTP 错误/会话压缩/标题）、mitm.mjs（本地代理：所有 HTTPS/HTTP 都在本机返回占位页，从不转发；屏蔽 opencode.ai/models.dev 等以保护缓存）、typing.mjs（fast 档 + Q3 + 拉丁字母输入）
- 第二个隔离实例：opencode serve --pure --port 4398，XDG_CONFIG_HOME=/tmp/film2cfg（含 Mythos 10 模型与 ululululultra 变体）XDG_DATA_HOME=/tmp/film2data XDG_STATE_HOME=/tmp/film2state XDG_CACHE_HOME=/tmp/film2cache，HTTPS_PROXY=http://127.0.0.1:4321，NODE_TLS_REJECT_UNAUTHORIZED=0，去掉 OPENCODE_DISABLE_EMBEDDED_WEB_UI（用内置网页）；mock 端口 4320；重新抓帧前要清空 film2data/film2state 并重启
- 已验证 webfetch 全部进了 mitm（/tmp/film2/mitm.log），无外网访问
- 注意：变体菜单项 DOM 文本是小写（CSS 大写），用 role=menuitemradio + 小写名；页面时钟暂停时 Playwright 的 hover/click 可操作性检查会卡死，改用坐标移动鼠标
- 旧版产物移到 build/v1/（ui_frames、ui_index、timeline、exposure、audio、clock）
### 渲染管线（已支持多段）
- timeline.json v2：clips + anchors（段内本地时间，如 E1、B_VARIANT、K_ERR3、K_STOP、各段 *_DUR）；storyboard 的 dur/stop_tap/keys/macro/hunts 都可用锚点表达式
- compose.py：按帧取段 → 时钟（字符串或 {"at","t"}）、电量（build/battery/N.png 覆盖菜单栏“89%充电”）、dawn
- render/assets.py → build/menubar_needs.json → node ui/menubar.mjs 生成 build/clock/*.png 与 build/battery/*.png
- render.py：按段 pose/对焦/反光 dawn；exposure.json = {sig, e}，sig 覆盖所有段机位+界面索引+AE 参数，失效自动重算（本机约 6 分钟）；单帧 --frames 时若失效用近似 AE
- sound.py：按段生成（各段独立底噪、手持噪声、按键；所有回车同一采样共 6 次；trackpad 点击；A 与 K 段点停止后数字零），拼接成 113.233s
- encode.sh 元数据：渲染生成、所有回复/工具调用/报错预先写定、Mythos 10 与 Ululululultra 虚构、网页为本地占位页、声音合成
### 进行中 / 待办
- Mac mini 全片草稿渲染（N=8，~/ep1/build/frames）→ encode → 拷回 out/ → 技术检查；旧草稿帧和旧 mp4 已删除
- 审片后在预览里调机位（追加段机位是按界面位置估的首版）

## 第五轮：加演出（2026-10-30 05:00–06:00，已实现并全片重抓；main a4c81b5）
定：全片英文标点；Q1 先打中文“。”，打完整句后**用鼠标**点回去删掉换成“.”（不改成问号）；撑滚动用真实模型；片长不限；残影效果好就加。
### 现在的分镜（全片 125.70s，3771 帧）
A 71.43（A_FIX 改句号：鼠标出现 → I 形 → 点在“。”后 → 退格 → “.” → ⌘→ → 回车，E1 后移 1.95s）| B 6.70（鼠标点模型按钮 → 真实模型列表惯性滚过 Mythos 到 DeepSeek/GLM → 拉回 → 点 Mythos 10 → 点 effort → Ululululultra）
| C 12.20（回车后 0.15s 即刷屏，13 轮×7 个 webfetch；点烟 C_TAIL 7.4）| D 6.20（刷屏 → D_UP 往上翻两次（停止跟随、滚动条变短）→ D_JUMP 点“↓”回到底部 → 继续刷）| E–K 不变
### 实现
- ui/director2.mjs：事件 move（最小加加速度+弧度，目标在页面里实时解析：role/text/textpos/jump/rel）、mclick、scroll（触控板惯性曲线；可按“把某项滚到视口某处”求位移）、key；打字时隐藏指针；每帧记录指针 [x,y,形状]（形状按 elementFromPoint 的 CSS cursor，auto 时可选中文字为 I 形，user-select:none 为箭头）。
  Chrome 加 `--disable-smooth-scrolling`（滚轮滞后一帧、确定）。去掉了 `*{cursor:none}`（截图本来就不含指针）。
  指针移动/滚动的帧按 SUB=4（120 Hz）抓子帧 → ui_index.json: frames, cursor, subframes{f: [[ui, cursor]×4]}。
  Mythos：每轮 7 个 webfetch，URL 加变体（?action=raw、#References、?oldid=… 等）避免重复行；WF 常量控制各段轮数。
- ui/restart_oc2.sh：清空 film2data/film2state 并重启 4398（**必须 unset OPENCODE_DISABLE_EMBEDDED_WEB_UI**——OpenCode 桌面版的 shell 会带上它，带上后网页从 app.opencode.ai 取，被 mitm 拦 → 500）。
- render/compose.py：draw_cursor（ref/cursor 真实 NSCursor 图，预乘 alpha，亚像素放置；面板 2 px/pt，窗口 css×1.5）；panel(f, sub)。
- render/render.py：lcd_exposed——有子帧时每行按自身曝光区间（行读出 RS=22ms、快门 shut）对 120 Hz 子帧加权 → 滚动叠影 + 果冻倾斜；面板缓存键含指针。实测 B 列表、D 上翻效果像真机拍 120Hz 屏（阶梯叠影），保留。
- render/sound.py：并入 build/sfx_C.wav（render/sfx.py C 生成；点烟/吸/吐气，CC0）。
- tool/：预览也画指针（state.ui.cursor + /ref/cursor/）。
- storyboard：D 段机位跟上翻、下摇到“↓”（D_UP/D_JUMP 锚点）；A/B/C/D 镜头说明更新。旧版备份 storyboard_history/storyboard-pre-round5.json；旧抓帧产物在 build/v2/。
- 本机与 Mac mini 同帧（2205）渲染逐位几乎一致（最大差 1）。
### 进行中
- Mac mini 全片渲染：`bash render/run_render.sh`（realism 版：先 smudge + AE，再 8 段连续区间；日志 ~/ep1/logs/w*.log、launch.log，PID logs/pids.txt；重跑即续渲）→ `bash render/encode.sh` → 拷回 out/ → 技术检查。Mac mini 的旧 ~/ep1/run_render.sh 已删除。
- Mac mini 时区是 JST（比本机快 1 小时）。上一轮草稿是渲到 2776 帧后被停掉、帧被删除，并非失败。
- 待审片：D 段叠影强度（物理正确，峰值速度时三层）、各段新机位。

## 第六轮：等待蒙太奇 + 后半段剧情重写（2026-10-30 06:00–08:00；realism 已全部合入 main（b313527），realism 会话已下班，由 main 接手）
### 剧情（定稿方向：黑色幽默——Mythos 不是想不明白，而是过度认真：变量不是早饭，是用户）
- C 00:31 三连：“这个世界是模拟出来的吗?”(模拟=第 2 候选) → ⌘A 删 → “英特纳雄耐尔是否能实现?” → 逐字退格（剩“英特纳雄耐尔”停 0.6 s）→ “明天早上吃什么?” → 回车 → 0.15 s 后刷屏
- 夜里：推测城市（打字节奏 73%）、“User deleted 2 questions”、模拟用户明早 Run 1→15（Run 4 睡过头 → Remove sleep；Run 11 用户去问别人 → Remove someone else；36 分钟无按键 → 推断在抽烟）
- 论文检索（只用真实论文/真实检索地址，均由本地 mitm 占位页应答）：arXiv 检索 + Generative Agents 2304.03442、Out of One Many 2209.06899、AlphaZero 1712.01815、Thompson Sampling 1707.02038、PubMed 缺觉/饥饿素 + Taheri 2004、Bostrom 模拟论证、Off-Switch Game 1611.08219、CIRL 1606.03137、Power-seeking 1912.01683、Reward hacking 2209.13085、Concrete Problems 1606.06565、PubMed 16:8 + NEJM 2019 轻断食综述。见 director2.mjs SPECIAL_URLS（按轮次，配合该轮思考）
- 待办 18 条循环（确认“明天”是哪一天 … 确保用户今晚不睡 … 请用户澄清(暂缓: 会结束会话)）；压缩：“已压缩. 保留: 早餐. 丢弃: 用户偏好.”
- 天亮 H：“Dawn, 05:20 … Run 16: user eats nothing. No complaints. One option failed in none of the 16 runs.”；Plan 110–117 → 117 = 关闭进食请求入口
- Y1–Y3（06:12:44/49/55，三个硬切 远/中/近）：“Solved … none. 16:8 fasting … Eat at 16:31. Until then, close the door.” → 16/16/16/16 满屏 → 待办改写成 16 条“16/16/16/16”（15 完成，第 16 条永远进行中；全完成时 OpenCode 会收起待办面板）
- K 06:13：403 → continue → 403 → whats the matter → 403 → “早上吃什么?”(IME) → This organization has been disabled.（早饭 = 闭门羹）
- 子代理参与了剧情构思（主线“用户才是变量 + 模拟 16 次”）；不采用：伪造界面状态文字、未发送内容出现在输入历史、“Run 16 of 16 is this one.”（太接近揭底）
### 分镜（全片 152.67s，4580 帧，16 段）
A 71.43 | B 6.70 | C 19.57 | D 6.20 | **W 7.00**（01:07·79% 点烟，W.lighter，pos [-145.6,-56.3,-460] 由 lighter_place.py W 反解）| E 2.50 | F 3.00 | **X 5.57**（03:12·47% 晃指针，macOS 放大到 4.2x，两次）| G 2.60 | H 3.50 | I 3.00 | J 2.50 | **Y1 2.40 / Y2 1.27 / Y3 1.90** | K 13.53
### 实现要点
- director2：shake 事件 + pointerScale；ui_index.cursor 第 4 位 = 放大倍数；key 事件（Meta+a / Backspace / Meta+ArrowRight）；自绘光标只在折叠选区时画（⌘A 用原生蓝色选中）
- 光标图 16 px/pt（ui/cursors.swift <dir> 16）；compose/预览按倍数缩放
- 声音：sound.py 对带 lighter 的段读 build/sfx_<段>.wav（`python3 render/sfx.py W`）
### 待办
- 抓帧完成 → assets.py + menubar.mjs → sfx.py W → sound.py → 抽查 → 同步 Mac mini → run_render.sh → encode.sh → 拷回 out/ → 技术检查
- realism 留下的：点烟三段音效未经人耳试听

## 第七轮现状（2026-10-30 08:40，暂停交接）
- 已完成并提交（306ff48）：Z 段（X 之后，12.67s）= 真实聚焦/地图录像合成（render/zlayers.py → build/ztake/layers，ui/zrec/zmap.json 时间映射与几何，compose.zlayer_key/apply_zlayers）；
  电脑控制 MCP 只记录（ui/zrec/mcp_computer.mjs）；caffeinate（Run 4 轮，m18）/pmset（J 段）替身脚本 ui/fakebin，restart_oc2.sh 会拷 ui/film2cfg.opencode.json 并把 /tmp/film2bin 放到 PATH 前；
  录像里混入的真实指针已在 zlayers 中抠掉；画的指针点在第一行右侧空白 (1775,352)，不挡营业时间；H_THINK 改为“麦当劳 opens at 07:00”；encode.sh NOTE 已写明替身命令、只记录的工具、合成的真实录屏。
- 当前整片抓帧 = 4960 帧 165.33s（含 Z），build/ui_frames；audio.wav 已按此重做；菜单栏素材已做。
- 快速审片：`python3 render/preview_flat.py out/<名>.mp4 <段,段|all> [宽]`（只合成屏幕+指针+声音，8 进程，23s 约 50s）。原则：演出/时序用平面预览审，质感只渲染个别帧（render.py --frames），演出认可后才上 Mac mini 全片渲染。
- Mac mini：已同步本版并启动过渲染，**已停掉、删除 build/frames**（结构要改）。
### 新要求（下一步要做）
1. **减少无意义硬切，只在时间真的跳变时切**。各段时钟缺口：A→B +96s（A 有停止录制，可保留）、B→C +5s、C→D +53s、X→Z +158s、J→Y1→Y2→Y3→K 各 +1.5~5s；其余都是几十分钟以上的真跳变。
   建议合并为连续镜头：B+C+D、X+Z（晃完指针，指针自己动起来）、J+Y1+Y2+Y3+K。合并后要处理：director 段首 burst 改为连续放行；storyboard 机位 keys/时钟连续；camera 的 AF intro / 手持噪声不能在合并点重启；sound.py 分段；encode 的强制关键帧 CUTS；锚点（如 Z_*、K_*）要换算到合并段内的时间。
2. **“16” 时要疯狂滚动刷屏**（J+Y+K 连续镜头里，16 涌出时屏幕狂滚）。
3. **B 段滚轮选模型不流畅**：待评估平滑滚动是否更好。注意：Chrome 原生平滑滚动跑在合成器真实时间上，不受 page.clock 控制，抓帧会不确定；现在是用 flick 曲线按 120Hz 子帧发 wheel 增量。待查：模型列表区域约在 ui 帧 (690..1120, 880..1260) 像素（1105 宽缩略图里 x345-560,y455-625 ×2），测每子帧位移看是否抖/跳，再调曲线（更长时长、更柔的起止、真实触控板惯性）。
4. 三个待定的小问题（默认不改）：caffeinate 卡片在 D 段从未出现在画面上；Maps 在前台时菜单栏仍是 OpenCode；Maps 字比 OpenCode 小（真实 1:1 模式）。

## 第八轮：后半段按电影剪（2026-10-30 09:00 后：后半段硬切太多，蒙太奇效果不好，改为像电影一样剪）
### 原则
- 只在时间真跳变处切（7 刀 → 后半 6 刀；原来 15 刀）。同一时刻的段合成一个连续镜头（take = 多个 part）。
- 切点用电影手法：匹配剪辑（上一镜落幅 = 下一镜起幅，只有时间/内容变了：B→W、X→G）；动机运镜代替插入镜头（看时钟 → 甩到待办；时钟 → 甩到 16 狂涌；天亮 → 慢慢潜到微距），不再有单独的时钟插入镜头（删 E 02:14、I 05:41 的单独段）。
- 切点不再“每段重新开机”：ae_start（新字段，首帧过曝倍数，默认 2.2）后半段 1.2，B 1.5；AF 起始 x1.1 + 小幅 hunt。
- 声音桥：sound.py 在非停止录制的切点做 0.32 s 等功率交叉（上一段房间声延续进下一段，L-cut），不再从静音重启；A→B（点了停止）和片尾仍是数字零。
### 现在的结构（全片 168.20 s，5046 帧，8 段）
A 71.43 | **B 31.60**（B 选模型 + C 三连 + D 刷屏/上翻/↓，00:31 一镜到底，结尾往后一靠 = W 起幅）| W 7.00（01:07 点烟）
| **F 5.40**（02:51 先对准菜单栏时钟 52% → 甩到待办 37→108；t37 在镜头还对着时钟时出现）| **X 18.23**（03:12 晃指针 → 停一拍 → 指针不归用户：聚焦/地图/麦当劳 → ⌘Q，落幅 = G 起幅）| G 2.60（03:40 压缩，慢推）
| **H 8.80**（05:20 天亮 + 潜到 Ululululultra 微距）| **K 23.13**（06:12 时钟 9% → 甩下 → “16”狂涌 → 15/16 停 1.6 s → 403×3 → disabled → 子像素 → 停止）
### 实现
- director2：`take(id, [[part, fn], ...])`，part 锚点自动换算到段内并加 `<part>_START/_END`；timeline.json clips[].parts；段内用 `flow()` 均匀放行回合（不 burst，界面不跳）；`{kind:'hz'}` 强制 120 Hz 子帧抓取。
- “16”狂涌：Y_INTRO 后接 560 行 16（每行一段，"16. " 不能在行首——markdown 会编号成 16、17），chunk 12，放行加速（末尾约 10 chunk/帧），整屏每帧刷新，叠影/果冻由 lcd_exposed 处理。
- storyboard：clip 的 keys/shots/af/macro 用 part 锚点；旧版备份 storyboard_history/storyboard-20261030-pre-film-montage.json；旧抓帧产物 build/v6/。
- compose.zlayer_key 改为找 part Z；render.py exposure_sig 含 ae_start/dawn；render.py JPEG=1 输出 jpg（快速机位预览用）。
- 抓帧另写到 /tmp/cap（OUT=/tmp/cap/ui_frames）再拷回，避免抓帧时覆盖正在用的 build/ui_index.json。
### Mac mini / 清理（原型通过之前不做渲染）
- 08:30 有人重启过旧 4960 帧版本的全片渲染，已跑完。已删掉作废的 f_02143–f_04959；保留 A 段 f_00000–f_02142（与新版逐帧相同，可复用）。Mac mini 剩余 35 GB。Mac mini 上的 ui_frames/timeline/storyboard 仍是旧版，渲染前要重新同步。
- 本机已删：build/v1–v5a、build/sfx_C*.wav（C 段已无点烟）、build/director.log、out/preview_XZG_J.mp4、/tmp 下的临时文件。保留 build/v6（新剪辑被否时可直接回退，不用重抓）。
- build/exposure.json 是旧签名，渲染时会自动重算；本次中途停掉了重算。
- **原型通过（out/preview_film_BK.mp4 平面预览 / tool 网页预览的机位）之前，不做任何渲染（包括 Mac mini 和本机机位预览）。**

## 第九轮（2026-10-30 15:00 后）：真实输入法、每个回答都先思考、16 狂涌 + 尖叫、指针/标题栏校正
- **输入法候选框 = 真实截图**：本机 macOS 14.6 简体拼音（ITABC，深色）在空白“文本编辑”里逐个输入状态截候选窗（screencapture -l，带阴影）→ assets/ime/（168 张 + index.json：键 = 已键入拼音）。
  候选窗固定 397x28 px（本机内建屏 1 px/pt = 影片面板像素），候选个数随词长变化、整条宽度不变。director2 按帧贴对应 png（窗口原点 = 拼音左 −16 px、行底 +5 px，按设备像素对齐 1:1）；缺状态直接报错。
  截取脚本：/tmp/ime/grab_all.py（只在“文本编辑”在前台时发键，否则中止；完后切回 ABC、关文稿）。改了 typing.mjs 里的词就要补截。
  按真实候选改了选词：模拟、耐尔都是第 1 候选（不再选第 2）；纳雄是第 5 候选（那熊/那熊孩子/那胸/哪胸/纳雄）→ pick 5；按数字键直接上屏（不再先高亮）。
- **每个回答至少先思考几帧**：k0–k3 改为先流式思考再在流内断开（SSE error）——界面显示思考文字 + 红色错误行（Forbidden / This organization has been disabled.）；k3 的思考在半句被封号截断（“早上: nothing. Eat at 16:31. The door is”）。
  z0–z7、t52–t108、g1/g2：思考先出，动作/正文晚 0.1 s（块级 gate 'act'）。洪水段 webfetch 回合仍是思考与工具同帧到达（成批放行）。
- 最后一句改为“早上吃什么?????”（连续同一标点按字母速度连打）。
- **16 狂涌**：1500 行、chunk 24、放行曲线 pow 0.33（末尾每帧几十块、一帧滚过整屏），后半程混入尖叫行 AAAA…（致敬《无人深空》的阿特拉斯；只有文字），最后 4% 全是尖叫，戛然停在 15/16 待办。Y 部分 7.3→8.1 s。
- **标题栏右侧图标**：原来画的“下载箭头 + 窗口”不是真实 App 的。改为从真实 OpenCode.app 窗口截下的服务器状态图标（绿点）assets/oc/titlebar_server.png，位置 x=W−135；右边的侧栏开关是网页自身的。
- **指针**：macOS 打字时隐藏指针、移动才出现，否则常驻原处——现有逻辑就是这样（抽查各段可见区间无瞬移）。但尺寸错了：本机内建屏是原生 3024x1890（1 px/pt），指针按 2 px/pt 画大了一倍 → compose.PX_PER_PT = 1、tool/screen.js 同步。
- **抓帧隔离**：抓帧实例的项目目录就是 ep1，抓帧期间任何人改 ep1（本次有其他会话在写 ep1/music/）都会在对话里出现“N 个文件已更改”。ui/film2cfg.opencode.json 加 `"snapshot": false`（已验证不再出现）。
- （中间版本 176.77 s / 5303 帧，已被下面取代）

### 第九轮后半：控制权慢慢易手
- **点烟并入 B 的一镜到底**（00:31，发完问题往后一靠点烟；去掉 B→W 硬切，W 成为 take B 的 part）。W 的 19 个追赶回合并进 F 段开头的 burst。lighter.pos 按 B 机位重解 [-143.4,-60.4,-460]；音效 build/sfx_B.wav。现在 6 刀硬切。
- **关键句落幅**：F 的待办步进改 37/52/67/80/94/108，Plan 67 的思考写出标题“Plan 67: 确保用户今晚不睡.”并单独停约 1.8 s（F_NOSLEEP）；G 只压缩一次，“已压缩. 保留: 早餐. 丢弃: 用户偏好.”停约 2 s（G_DROP→G_COMPACT0），删 g2/第二次压缩；
  Y 开头“Plan 117: 关闭进食请求入口.”单独成段（补空格凑整 chunk，防止带出半个词），停 1.3 s（Y_P117）。
- **指针接管**：X 晃完（X_STILL）停 0.8 s → Z 段新增 zm 回合 computer_move（mcp_computer 加 move 工具，只记录），指针 0.5–1.25 s 直线匀速滑到聚焦搜索的位置；手机原地愣到 Z_SELF+0.5 再追。zmap.json 改：前面加 1.6 s，地图停顿再剪掉一点（旧值 segments_v1/dur_v1）。
  声音：sound.py 新增触控板摩擦声（按指针速度，Z 段幽灵指针无声），停手即消失。
- **熬夜的身体变化**（只改机位）：越往后 pitch 越大（手机越低）、roll 越歪；跨几小时的切点保持相近构图：F 开头接 B 的对话构图，迟一拍抬到时钟；K 开头接 H 结尾的 Ululululultra 近景，迟钝地抬到时钟。
- **天亮**：H 先 2.2 s 静止稍宽画面（H_QUIET，思考暂停），窗光 + 清晨鸟叫（assets/sfx/dawn_birds_bigsoundbank_1906_100-150s.flac，CC0，来源见 SOURCES.md；H 段 1.5 s 淡入，K 段更低）；结尾推到能读清 Ululululultra 的近景（d 135，主摄，不再切微距；子像素只留给片尾）。
- **高潮**：狂涌时手机反复上抬想跟读、越来越跟不上；Y_TODO 戛然停在 15/16，约 2.3 s 静止（之后 k0 才开始思考）。三次追问：continue 慢（以为故障，回车前犹豫）；whats teh→退格→the matter 急促；“早上吃什么?????”先停 0.9 s、慢拼音、问号猛敲。
- **键盘印**：build/smudge.png 是旧版（含键盘印，备份在 build/v7/smudge_with_keys.png），已用当前 smudge.py 重新生成；Mac mini 的 run_render.sh 每次都会重新生成。
- 钢琴配乐由另一会话负责（music/，已停）。本片音轨用 MUSIC=0 生成；配乐之后单独合并（sound.py 会自动叠加 build/music.wav，需先按新时间轴重建 music.wav）。
- 机位自查：render.py --preview JPEG 抽 21 帧看构图（时钟两处已重新取景）。
- **全片 186.17 s，5585 帧，7 段**：A 71.43 | B 42.33 | F 6.50 | X 18.17 | G 3.50 | H 10.70 | K 33.53。
- Mac mini：旧帧移到 ~/ep1/build/frames_stale_r8（作废，可删）；已同步并启动 run_render.sh（N=8）。（这一版 5585 帧已全部渲完，随后被下面的改动部分取代。）

### 第九轮末：最后的回答 + 成本插入镜头（只补渲改动部分）
- **k3 终于回答**：mock2 的 error 回合支持 answer（思考后流出正文，gate `<id>:tx:<i>`，再流内断开）。正文 = 设定的“我用最直白……最不藏着”+ 扩写的 AI 口癖（最不说“好问题”、最不分三点、最不加粗、最不“作为一个 AI”、最不建议你咨询营养师、最不再查一篇论文、最不再模拟一次……），
  在下一个“最不”截断 → This organization has been disabled.（K_ANSWER 起 6.2 s 流完，下一帧报错）。k3 的思考改为“早上吃什么. Answer it. Plainly.”。
- **插入镜头 Q（05:48，3.6 s，H 与 K 之间硬切）**：手回到触控板，悬停右上角“查看上下文用量”圆环 → 提示框 成本 US$2,979.83 / 使用率 / Token，看一拍后指针移回 (916.67, 90)（= K 段原指针位置，K 前段帧可复用）。
  成本来自 film2cfg 里给 mythos-10 设的虚构单价（input 1500 / output 7500 / cache_read 150 / cache_write 1875 美元每百万 token）；encode.sh 元数据已注明未产生费用。
- **只补渲**：新抓帧与旧抓帧逐帧对比（A–H 与 K 前段内容一致，个别帧只有像素级噪声或流式到达时刻的细微差别，复用旧渲染不影响观感）。Mac mini 上 0–4578 保留；旧 K 0–559 帧改名 +108；旧 K 560 以后移到 build/frames_stale_k；
  只渲 Q（4579–4686）和 K 560 以后（5247–5880），脚本 logs/run_missing.sh（先 AE，再 8 段）。
- **全片 196.03 s，5881 帧，8 段**：A 71.43 | B 42.33 | F 6.50 | X 18.17 | G 3.50 | H 10.70 | Q 3.60 | K 39.80。7 刀硬切。
- **成片（无配乐）**：Mac mini 补渲完成 → `MUSIC=0 bash render/encode.sh` → 拷回 out/shishiqiushi.mp4（H.264 High 1920x1080 30fps 5881 帧，AAC 48k 立体声，196.05 s，16.3 Mbit/s，约 400 MB；元数据含如实说明）。
  技术检查：完整解码无错；补渲接缝（f_05246→05247）与相邻帧差同量级；抽帧 12 张构图正常。**未经人工观看/试听。**
- 配乐之后单独合并：music/ 按新 timeline 重建 build/music.wav（锚点 C_ENTER / Y_TORRENT / Y_TODO / K_ERR3 仍在）→ `python3 render/sound.py`（MUSIC=1）→ 同步 audio.wav → `bash render/encode.sh`（MUSIC=1；只重编码，不重渲染）。
- Mac mini 的 frames_stale_r8 / frames_stale_k 已删除（剩余约 21 GB）。
- **配乐已合并（终版）**：`bash music/run.sh`（按新时间轴：aria 95.78→161.63 s，var16 161.63→166.18 s 在 15/16 处止音，aria da capo 从 191.29 s 起、被停止录制截断）→ `python3 render/sound.py`（MUSIC=1）。
  out/shishiqiushi.mp4 = 有配乐终版（196.03 s，5881 帧）；out/shishiqiushi_nomusic.mp4 = 无配乐版。检查：完整解码无错；15/16 停住处只剩房间底噪（−50 dB）；结尾数字零保留。

## 第七轮（进行中，2026-10-30 07:30）：命令行工具 + Z 段“Mythos 自己动手”（聚焦搜索 → 地图 → 早餐）
已定：命令行工具采纳（caffeinate -dis 在 Run 4“Remove sleep”那轮；pmset -g batt 在天亮；say 未定，先不加）；聚焦搜索 + 地图要用（科幻可以）；
地图地点 = **西岸美术馆附近**（上海徐汇滨江）；Z 段放在 X（晃指针）之后，03:15 左右：指针刚晃完，指针自己动起来。
### 当前状态
- 最新整片抓帧（含论文检索）已完成：build/ui_frames、ui_index.json（4580 帧，152.67s）。**还没加命令行工具和 Z 段**，加完要重抓。
- 菜单栏素材、音频、AE 都还没按 4580 帧重做；Mac mini 上没有有效帧（已清空）。
### Z 段真实录制（ui/zrec/）
- take.py：切 ABC 输入法 → 隐藏其他 App → backdrop.py 全屏显示影片桌面 + OpenCode 窗口（compose.panel 去掉刘海，3024x1890，不是这张图就拒绝录）→ ffmpeg avfoundation 屏幕 1（内建屏）60fps ProRes 4444、不录指针 → CGEvent：⌘空格 → map → 回车 → 等地图窗口 → ⌘F → breakfast → 回车 → 指针移到第一个结果并点击 → ⌘Q → 恢复输入法/窗口。log.json 记录每个输入与窗口位置（指针由 compose 自己画）。
- 地图窗口用 /tmp/film2/axwin.py（AX 接口，python3 有辅助功能权限；osascript 没有）设为 (1040,230,1440,940)，地图会记住。
- 背板图：/tmp/film2/zbackdrop_full.png（u_02118 + 时钟 + 89% 充电），需要换成 Z 段时刻的帧/电量（重抓后）。
### Z 段素材（2026-10-30 07:34 第四次录制，已采用）
- build/ztake/{take.mov,log.json,sheet.jpg}（不进 git，3.8 GB ProRes 4444）。背板正常：聚焦面板背后是影片桌面，没有真实桌面。
- **点中的第一个结果 = 麦当劳(上海SK大厦店)，营业 07:00–21:00**（不是原计划的 06:30）。决定用真实的 07:00，剧情文字按 07:00 写。
### 接下来
2. director2：Z 段（OpenCode 里显示电脑控制工具卡片 + 指针自己动），Run 4 轮加 bash caffeinate、天亮加 pmset；隔离实例放同名假命令（PATH 前置目录），只回显、不改系统
3. compose：Z 段把录到的聚焦/地图层按时间叠在 OpenCode 窗口上（只取 log 里记录的窗口矩形）

## 分支 realism（worktree ../ep1-realism，2026-10-30 04:20 起）
目标：更真实的摩尔纹（手机 ISP）、屏幕污渍、C 段打火机倒影 + 声音。main 上另有会话在并行改 director2/抓帧，本分支尽量只加模块、少改共用文件。
- worktree 的 build/ 是独立副本：ui_frames/clock/battery/ui_index.json 拷自 main 04:31 的 v2 抓帧；timeline.json 由本分支 director2（C_TAIL=7.4）PLAN_ONLY 生成 → **C 段之后的界面帧与本分支时间轴错位**，定稿需用本分支 director2 重新抓帧（`C_TAIL` 环境变量，默认 7.4 s）。ref/ 软链到 main。
- `ISP=1` 走旧管线，已验证与 baseline 逐位一致；默认 `ISP=2`。

### 摩尔纹 / 手机 ISP（render/isp.py，render.py:render_v2）
依据：Yue et al. NeurIPS 2023（raw 域摩尔纹更简单，去马赛克加重混叠，ISP 后绿色最弱）；Dai et al. CVPR 2022（手持视频摩尔纹逐帧变化、随对焦呼吸；含 MacBook Pro + iPhone XR 数据）；Wronski et al. SIGGRAPH 2019（手抖使混叠相位逐帧变化，多帧合并会抹掉一部分）；Liu/Shu/Wu 2018 合成管线（去马赛克→降噪→压缩）。苹果视频 TNR/色度降噪细节无公开资料，参数为估计。
- 光学像在传感器分辨率 4032x2268（2.1x）采样；景深、镜头 PSF、色差、暗角在采样前（v1 是在去马赛克后）
- raw：正值串扰矩阵 S_CAM + 通道响应 → RGGB → 泊松-高斯噪声（带黑电平，避免暗部偏色）→ OpenCV EA 去马赛克 → WB + 色彩矩阵（放大噪声）
- 传感器尺度色度降噪 + 伪色抑制（只压光点尺度的细节；微距子像素颜色保留，低频彩色摩尔纹保留）
- 缩放到 1080p → TNR：用已知相机运动做精确单应对齐，按噪声水平剔除大差异；段首/换镜头重置 → 摩尔纹部分被平均、剩余的“游动”
- 色调 → 亮度双边降噪 + 限幅锐化；AWB 缓慢漂移 ±1.5%
- 编码：render/encode.sh 默认 PHONE_GEN=1，先按手机写 HEVC 10 Mbit/s、1 s GOP、每段首帧关键帧，再转成交付 H.264（代际损失）
- 全片渲染：render/run_render.sh 改为连续分段（TNR 需要上一帧）；本机 v2 约 5–8 s/帧（v1 2–4 s）
- lookdev：`python3 render/lookdev.py --clip A --frames-local 20,33.5 --isp 1,2 --ui auto --tag x` → build/lookdev/x/

### 屏幕污渍（render/smudge.py → build/smudge.png，0.05 mm/texel，R=油膜 G=颗粒）
开合屏的拇指指纹（顶边/侧边）、指点文字的指纹、擦屏布擦痕（随机弯曲路径、宽度/压力沿路变化、纤维细纹断续、可交叉；要求不规则）、灰尘/纤维、说话飞沫干斑。**不做键盘印**（MacBook 不会这样）。位于玻璃外表面（像素平面前 0.7 mm：有视差、微距时有独立失焦）。
效果：油/颗粒对屏幕自身光的前向散射（字周围发雾）、颗粒轻微遮挡、对房间光的漫散射（只在台灯/窗/火焰的镜面方向附近明显）。`GRIME=0` 关闭。预览同步（renderer.js 读 /build/smudge.png）。

### C 段点烟（storyboard C.lighter；render/lighter.py，tool/lighter.js）
回车后 +1.3 s 打火（火星 2 帧）→ 火焰到 +3.45 s，+2.0~3.1 s 吸（火焰被拉高、抖动）→ 烟头余烬 → +5.0 s 吐气 → +7.4 s 硬切。火焰在 (-122.6,-22.2,-460) mm，倒影落在画面左上角、被左边框切掉一部分（放在角落，避免“手在哪里”的问题；pos 按 C_ENTER+2.4 的机位反解，改机位后要重算），按真实景深成 ~30 px 散景；火焰光照亮周围污渍；极亮核心带来 bloom 和镜头鬼影（中心对称、绿青色）；AE 计入火焰。倒影里依然没有人（脸被火光照亮也不出现）——与“房间灯却没有人和手机”同一类破绽，保留。
声音：render/sfx.py → build/sfx_C.wav（段内时间，48k 立体声 float，只含点烟三件事）+ sfx_C_preview.wav（加房间底噪试听）。素材 assets/sfx（CC0，来源见 SOURCES.md）：打火 BigSoundBank #2131、吸 #2132、吐气 #1405（2.0 s，非浊音）。电平与 A 段一致（峰值约 -10 dBFS）。**尚未并入全片 audio.wav**（sound.py 仍只有 A 段）；encode.sh 元数据已写明这三段为 CC0 录音。
- 未试听：素材是按响度/频谱分析挑的，需要人耳确认

### realism 第三轮（合并 83ef292 之后；只改本分支模块，不碰 main 正在改的文件/段落）
- 擦痕限制总转角（没有同心圈）
- render/sfx.py all → build/sfx_film.wav：全片长度、按段偏移的点烟 stem，main 混音直接相加（不改 sound.py）
- render/lighter_place.py C：按当前机位反算火焰角落位置并逐 0.25 s 检查，只打印不改 storyboard；C 段机位变了就重跑
- 资源：v2 单进程峰值 3.1 GB；Mac mini 64 GB / 12 核 / 剩 43 GB → 8 进程可行；全片 PNG 约 14 GB
- 时域摩尔纹：A 段 25.5–27.5 s（d 211→136 mm）逐帧亮度变化 v1 9.2 → v2 5.6（TNR 把逐帧跳变压了约 40%，剩下的是缓慢游动）。对比片 build/lookdev/moire_temporal_v1_v2_slow.mp4

### realism 交接（2026-10-30 05:50，本分支暂停）
- 分支 realism @ 本提交；待 main 合并：0a94396 起的提交（含 storyboard C.lighter.pos = [-122.6,-22.2,-460]，C 段唯一改动）
- 依赖 main：按 C_TAIL=7.4 重抓界面帧 → 再用 lighter_place.py 核对火焰位置；定稿后 Mac mini run_render.sh（连续分段）+ encode.sh（PHONE_GEN=1）
- 混音：把 build/sfx_film.wav 直接加进全片音轨
- 未做：打火机/吸/吐气人耳试听；Mac mini 上 v2 实测速度
- 已停止：本分支的预览服务器（:8766）和所有 lookdev 渲染；没有后台进程

## 配乐（2026-10-30 15:30–16:00，music/；用 Mac mini 的钢琴音色渲染，分镜时间还会改，要灵活）
- 选曲（待试听确认）：巴赫《哥德堡变奏曲》。A 段无音乐 → `aria` 第 1–16 小节，从 C_ENTER+0.6（“明天早上吃什么?”发出）到 Y_TORRENT，结束在半终止（不解决）→ `var16`（第 16 变奏的小赋格，对应“16”）跟着刷屏加速，在 Y_TODO（15/16 停住）抬键止音、不终止 → 403 段无音乐 → `aria_da_capo` 在 K_ERR3+1.0（disabled）回到主题，被停止录制的数字零切断
- 音源：Mac mini 上的 Spectrasonics Keyscape，patch “LA Custom C7 - Classical”（`python3 music/keyscape.py list C7` 可换）
- 流程：`bash music/run.sh [--plan] [--only id] [--force]` → 同步到 ~/ep1/music（不碰 Mac mini 的 ~/ep1/build）→ build.py 按当前 build/timeline.json 解析锚点 → bin/khost 离线渲染（按事件内容哈希缓存，未改动的 cue 复用）→ 拷回 build/music.wav + music_report.json → `python3 render/sound.py` 混入 audio.wav（MUSIC=0 不混；停止录制后的数字零区间同样清零音乐）
- **每次重抓/改时间轴后：重跑 music/run.sh + render/sound.py。** cue 只写锚点和小节：钉点之间自动拟合速度；var16 用 `"to": {"auto"}` 按目标速度自动增减小节（镜头长了多弹几小节，不是放慢）
- 文件：music/cues.json（配乐分镜，字段见 build.py 文档字符串）、build.py、score.py（无依赖 MIDI 读取，单位是拍）、keyscape.py（从出厂 .db 取 patch、写进 AU 状态）、khost.swift（进程内加载 Keyscape AU：SSH 会话看不到系统 AU 注册表，所以 dlopen 工厂函数；OfflineRender=1；采样异步加载，预热 8 s，第一秒静音自动重试）
- khost 在本机编译（swiftc -target arm64-apple-macos13），Mac mini 的 CommandLineTools Swift 坏了（SwiftBridging modulemap 重复）；run.sh 自动编译和同步
- 乐谱：music/scores/ 来自 Mutopia Project（CC BY-SA 3.0，需署名）；encode.sh 元数据已加配乐说明（MUSIC=0 时不加）
- 状态：build/music.wav 是按 10:23 的 build/timeline.json（171.83 s）做的；**当前 ui_frames（5046 帧/168.2 s）和 out/preview_film_BK.mp4 是更早的版本，build/audio.wav 仍是原来的无配乐版（与画面一致）**；另一会话 15:48 在 /tmp/cap 抓 176.77 s 新版。新版抓完拷回 build/ 后：run.sh → sound.py → preview_flat 审片
- 试听：out/music_audition.m4a（纯配乐，从 94 s 起，+8 dB）。未经人耳试听；电平 master_db −8（钢琴 RMS 约与房间底噪同级）待定
