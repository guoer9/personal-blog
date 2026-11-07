# 阶段 1 续：搜索失败态的重复通知验证

日期：2026-11-01（Asia/Shanghai）

## 本轮范围

本轮仍处于阶段 1“现有站点体验审计”，只推进第 7 轮留下的唯一优先假设：搜索请求失败时，页面内固定的 `role="alert"` 与请求拦截器产生的全局 Element Plus toast 是否重复传达同一失败，并据此决定是否对搜索请求抑制全局 toast。

覆盖范围：

- 桌面视口 `1280 × 720`。
- 移动视口 `390 × 844`。
- 移动视口 `390 × 844` 且 `prefers-reduced-motion: reduce`。
- Playwright CLI 驱动的 Chromium；本地 Vite 开发服务器 `http://127.0.0.1:5173/`。
- 搜索请求通过页面路由拦截确定性返回 `503`，重试第 2 次返回结构完整的成功空结果。
- 相关文件：`frontend/src/api/posts.ts`、`frontend/src/utils/request.ts`、`frontend/src/types/axios.d.ts`、`frontend/src/utils/request.test.ts`、`frontend/src/views/blog/Search.vue`。

本轮不进入 DDW 结构拆解，不复制参考站点的素材、着色器、模型、音频或文案。

## 证据

### E1：修复前的重复通知

原始输出：

- `output/playwright/baseline-audit-20261101/browser-search-toast-round8-lifecycle.json`
- `output/playwright/baseline-audit-20261101/browser-search-toast-round8-recovery.json`

在确定性 `503` 路径下，`0 / 100 / 500 / 1000 / 2000 ms` 均同时存在：

- 页面内 `.inline-error[role="alert"]`：`搜索暂时不可用网络或服务异常，请稍后重试。重试 ↗`。
- 页面外 `.el-message[role="alert"]`：接口详情 `round8 lifecycle failure`。

约 `2900 ms` 时 toast 进入淡出，`3400 ms` 后从 DOM 移除；页面内错误仍保留。两者在没有角色重复的情况下也会在同一失败发生后的数秒内形成两个独立 assertive 通知，因此可确认页面存在重复失败反馈结构。该证据不能单独证明真实读屏软件实际播报了几次。

第 7 轮记录的 Chromium 无障碍树也显示两个独立 alert。本轮未重新捕获该修复前树，原因是最新日志没有成功落盘；不引用不存在的 `browser-search-toast-round8-a11y.txt`。

### E2：源码与单元测试

实现变更：

- `frontend/src/api/posts.ts:54-60`：`searchPosts()` 传入 `suppressErrorToast: true`，并在注释中说明搜索页已有固定页面内错误状态。
- `frontend/src/utils/request.ts:34-75`：响应拦截器读取请求配置；普通 HTTP 错误和网络错误仍显示全局 toast，只有显式抑制的请求跳过普通错误提示。
- `frontend/src/utils/request.ts:42-62`：`401` 刷新/退出路径保持在抑制判断之前，搜索请求不会因本变更跳过登录失效处理。
- `frontend/src/types/axios.d.ts:1-11`：为 `AxiosRequestConfig` 与 `InternalAxiosRequestConfig` 扩展 `suppressErrorToast`。
- `frontend/src/utils/request.test.ts:27-57`：两个确定性 adapter 测试分别验证普通请求仍弹 toast、带抑制标记的搜索请求不弹 toast。

测试记录：

- 红灯：`output/playwright/baseline-audit-20261101/request-suppress-red-round8.txt`。实现尚未接通时，搜索请求仍触发全局提示，测试失败。
- 绿灯：`output/playwright/baseline-audit-20261101/request-suppress-green-round8.txt`。目标测试 `2/2` 通过。
- 全量测试：`output/playwright/baseline-audit-20261101/test-round8.txt`。`7` 个测试文件、`32` 个测试通过。
- 生产构建：`output/playwright/baseline-audit-20261101/build-round8.txt`。类型检查与 Vite 构建通过；主 JS `1,067.83 kB`（gzip `353.16 kB`），`liquidScene` `526.43 kB`（gzip `131.99 kB`），`PostEdit` `673.50 kB`（gzip `225.32 kB`）。构建仍有大于 `500 kB` 的分块警告，属于已有性能问题，本轮不处理。
- 差异检查：`output/playwright/baseline-audit-20261101/diff-check-round8.txt`。`git diff --check` 通过。

诊断期间首次“绿灯”日志实际仍为失败，原因是测试请求漏传抑制标记；该文件已被真正通过的日志覆盖。另有一次误创建的声明文件路径 `frontend/frontend/src/types/axios.d.ts` 已移正，未留下重复类型目录。

### E3：历史证据

- 第 7 轮记录：`docs/archive/research/07-search-live-region-semantics.md`。
- 第 7 轮已把结果容器降为普通 region，使摘要 `status` 与错误 `alert` 并列；本轮抽查未发现该结构回退。
- 第 6 轮的重试与焦点恢复路径在本轮浏览器脚本中再次覆盖。

## 实验

**假设：** 搜索页已经提供固定、可操作且可聚焦的失败反馈，因此该请求应抑制全局 toast；普通请求仍应保留默认全局错误提示，避免把局部修复扩大成全站通知策略变更。

**唯一主要变量：** 是否对 `searchPosts()` 的请求配置抑制全局 toast。

**成功判据：**

- 搜索 `503` 时 `.el-message` 数量为 `0`。
- `.inline-error[role="alert"]` 与失败摘要仍存在。
- 键盘聚焦“重试 ↗”后触发重试，成功恢复时错误区消失、摘要显示 `0 RESULTS`，焦点回到 `.search-summary`。
- 桌面、移动端和 reduced-motion 均满足以上条件，横向溢出为 `0`。
- 普通请求失败的全局 toast 单测仍通过。
- 目标测试、全量测试、生产构建和 `git diff --check` 通过。

**停止条件：** 搜索失败态没有任何页面内反馈、重试无法恢复、重点路径焦点丢失、普通请求通知被误抑制、横向溢出、类型检查或构建失败时停止并记录；不扩展为全站错误通知重构。

## 复测结果

原始输出：`output/playwright/baseline-audit-20261101/browser-search-toast-round8-current.txt`。

| 场景 | 失败时全局 toast | 失败时页面内 alert | 焦点 | 重试请求数 | 恢复后摘要 | 恢复后焦点 | 横向溢出 |
| --- | ---: | ---: | --- | ---: | --- | --- | ---: |
| 桌面 `1280 × 720` | 0 | 1 | `.search-summary` | 2 | `QUERY / “round8-fixed” 0 RESULTS` | `.search-summary` | 0 |
| 移动 `390 × 844` | 0 | 1 | `.search-summary` | 2 | `QUERY / “round8-fixed” 0 RESULTS` | `.search-summary` | 0 |
| 移动 + reduced motion | 0 | 1 | `.search-summary` | 2 | `QUERY / “round8-fixed” 0 RESULTS` | `.search-summary` | 0 |

Chromium 无障碍树在三种场景下均一致为：

```text
region "搜索结果"
  status: QUERY / “round8-fixed” SEARCH UNAVAILABLE
  alert:
    heading "搜索暂时不可用" [level=2]
    paragraph: 网络或服务异常，请稍后重试。
    button "重试 ↗"
```

键盘焦点先落在“重试 ↗”时，活动元素为 `BUTTON`；点击重试后请求计数为 `2`，恢复成功空结果，焦点回到 `DIV.search-summary`。移动端摘要宽度为 `354 px`，桌面为 `1216 px`，页面横向溢出均为 `0`。

**结论：** 在本轮 Chromium 自动化范围内，搜索失败已从“页面内 alert + 全局 toast”收敛为单一页面内 alert；普通请求的全局 toast 保持；重试、桌面、移动端和 reduced-motion 路径未回退。由于没有在 VoiceOver、Safari 或其他读屏软件中实测，本结论仅证明 DOM/无障碍树和通知数量，不证明真实读屏设备的实际播报次数与停顿。

**尚未复测：** 真实后端失败响应、慢请求、超时、非空搜索结果、分页切换、滚动位置和浏览器后退/前进恢复。

## 下一步假设

**下一轮唯一优先假设：** 搜索结果非空并进行分页切换时，polite 状态摘要是否及时播报，翻页后的焦点与滚动位置是否让键盘用户保持上下文；下一轮只用确定性成功响应验证非空结果、上一页/下一页和恢复后的状态。

阻塞条件：若当前分页响应结构无法稳定模拟非空多页结果，则先补一个最小、可复查的分页夹具并记录失败输出，不扩大到全局状态提示或视觉改版。

## 本轮结论

### 完成项

- 复现并记录搜索失败同时出现页面内 alert 与全局 toast。
- 只对搜索请求抑制普通全局错误提示，保留普通请求默认提示和 `401` 处理路径。
- 用确定性单元测试锁定普通请求与搜索请求的差异。
- 完成桌面、移动、reduced-motion、键盘重试和恢复焦点复测。
- 完成目标测试、全量测试、生产构建和差异检查。
- 未进入 DDW 结构拆解，未复制参考站点资源。

### 未决项

- 未在真实 VoiceOver、Safari 或其他读屏软件中验证实际播报次数、顺序和停顿。
- 未使用真实后端验证失败、慢请求、超时和恢复。
- 未验证非空搜索结果、分页切换、滚动位置和浏览器历史恢复。
- 构建仍报告主包、编辑器与 WebGL 分块过大；属于后续性能审计，不在本轮处理。
- 搜索页、404 页面和主布局的焦点逻辑仍未共享化。

### 下一轮唯一优先假设

下一轮只验证：**非空搜索结果切换分页时，状态摘要、焦点和滚动位置是否共同维持可感知、可操作的上下文。**

完成该实验或达到停止条件后停止，等待下一次调度。
