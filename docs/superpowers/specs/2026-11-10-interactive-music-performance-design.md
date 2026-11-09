# 陈果 / GUOER 互动音乐演出

用户已选择“可互动的音乐演出”，并授权先完成整体开发，个人素材后续补齐。2026-11-10。

## 目标与美术

网站本身展示前端技术、设计与审美。音乐人身份先于代码履历；长文和工具在后段及档案入口。深黑舞台、暖白大字、酸绿签名与小面积蓝色光线。既有球体是持续居中的舞台主体，保持基础尺寸、呼吸、点击/拖动/长按、玻璃与粒子。使用真实手写签名。临时使用原创抽象作品美术，不再以演示雕塑充当主视觉。

## 完整体验

1. 首页：全屏中央球体、GUOER/陈果、简短音乐身份、播放入口。滚动进入签名，尾线延伸到音乐节目区。球体保持中心，文字和图片围绕中心构图。现有两首音乐提供真实播放、进度、切换；没点播放也有完整动态。
2. 音乐节目区：简短曲名/时长、两首作品有主次地排列，选择作品改变封面及氛围，播放声音联动球体。保留进入单曲页的独立明确入口。
3. 影像区：现有两集线条时光以大画幅和错位展示。个人介绍、联系和档案放在末段。
4. 全屏菜单：所有公共页面统一使用主菜单，音乐、影像、关于为主入口，档案/搜索/代码/临时传输/账户为次级。菜单图片随聚焦变化；手机使用清楚的列表和单一视觉。保留登录/退出/搜索及焦点管理，不能出现恢复已移除的控制按钮。
5. Works：默认音乐优先，按音乐/影像/代码筛选；保留 all 查询和现有 URL。大画幅、较少边框和文字。音乐卡片整体进入详情，播放操作集中在首页和详情，减少重复按钮；各入口可键盘访问，不嵌套交互元素。
6. 音乐详情：曲名、抽象/后续正式封面、可交互播放器、真实音频响应。视频版可切换，切换时保证单一声音来源。代码/影像详情继续可用，保持统一美术。
7. About：真实姓名/签名与音乐身份优先，现有影像作为个人素材；技术说明后置，删除与实际动态策略矛盾的描述。不会虚构获奖、演出、职业经历。
8. 档案：前台入口收敛为“档案”，沿用现有 writing/documents/search/tag/article API 与兼容 URL；文章详情增加返回档案入口。不删除内容或改变后端模型。
9. 切页：持续的线条/遮罩作为过渡，保持共享 WebGL 生命周期；不要为切页再建立永久渲染循环。返回作品集保留筛选语义。

## 音频架构契约

新增 `src/audio/performanceAudio.ts`：导出 `createPerformanceAudio()`、`performanceAudioKey`、`usePerformanceAudio()`。实例由 MainLayout 创建/提供/销毁；独立挂载组件可获得组件范围后备实例。

`PerformanceAudio` 提供 `state: Ref<PerformancePlaybackState>`、`features: AudioFeatures`、`toggle(work?: Work): Promise<void>`、`select(work: Work): void`、`pause(): void`、`seek(progress: number): void`、`setVolume(value: number): void`、`tick(timeMs: number): void`、`dispose(): void`。`features` 是稳定对象，字段 `bass, mid, treble, energy, active`；前三者和 energy 归一化 0–1，active 为 boolean。`state.value` 至少包含 `work: Work|null, playing, loading, error: string, currentTime, duration, volume`。

只在明确播放操作之后创建音频源/AudioContext、请求媒体。一个共享 HTMLAudioElement 和至多一个 AudioContext；实际 AnalyserNode 频段能量在现有 MainLayout.beforeFrame 中采样。没有独立 RAF。切换歌曲的异步 play/resume 需要版本防护；错误/结束/隐藏页面都重置播放状态。没有 Web Audio 时仍可播放，features 为零。关闭/销毁释放事件、连接及媒体。

首页和音乐详情的场景读取同一 features。不会缩放球体基础大小，以细节形变和光照表达音频。视觉映射会平滑限幅，避免突然跳变。

新增 `components/performance/PerformancePlayer.vue`，props `{ work: Work; compact?: boolean }`，使用上述共享状态，提供播放/暂停、进度与音量，错误可重试。WorkPlayer 音频模式复用它；视频开始前暂停共享音频，切换/离开时暂停视频。公共布局离开音乐相关路由时暂停音频；进入同首详情可延续，进入另一首/影像详情必须暂停旧音轨。

## 素材替换

`src/data/stage.ts` 集中保存演出身份、主打曲 slug、可选 portrait 与作品美术覆盖；`public/stage/` 保存轻量原创抽象 SVG。现有 works API 仍是歌曲/视频/发布状态的唯一内容来源，无虚构作品回退。API 空/失败时呈现完整抽象舞台和真实的空态/重试，禁用无源播放。

素材清单保存于 `docs/content/music-performance-assets.md`。优先提供正式音频、两首歌曲封面、本人肖像/演奏片段；签名已具备。占位在配置和文档中明确，访客界面不塞实现说明。

## 范围与验证

在既有分支和未提交工作上继续，不撤销既有修改；不提交、推送、部署，不修改参考仓库，不写数据库。保留完整动态，不按系统 reduce 自动停用。

验证：音频频段/生命周期/竞态单测；菜单键盘与查询/空态既有测试；完整单元测试、生产构建；真实 API 桌面/手机截图和播放验证；网络请求确认播放前不加载音频；验证音频采样真实非零、暂停/隐藏/路由切换、WebGL 后备、签名连续性和无横向溢出。实际素材是否最终满意留给后续替换，功能和布局本轮完成。

## 已讨论的方向

声音剧场与个人影像展厅。用户选择声音剧场；影像展厅的画幅变化和菜单编排作为表现方法融入。代理负责颜色细调、间距、具体缓动和暂用抽象美术，素材暂缺不阻塞开发。
