# 音符编辑器（Piano Roll Editor）使用说明

对标专业 DAW（如 FL Studio / Ableton）的 Piano Roll 视图，让你把刚录下的音符精细加工。
编辑器的数据来自 `Recorder` 的录制结果，**改动只在你点"✓ 应用"后才写回回放源**，原始录音事件不变；点"放弃/✕"则丢弃所有改动。

---

## 1. 进入/退出

- **进入**：右侧控制面板 → 录制区 → 点击 `音符编辑器` 按钮。
  - 自动停止当前演示曲、试听、录制（如果你正在录）。
  - 自动把"录制结果"或"上次编辑后的结果"载入编辑器。
- **退出（并保存）**：工具栏 → `✓ 应用`。编辑结果会替换 `Recorder` 的回放源；之后点 `循环播放` 会播放你编辑后的版本。
- **退出（并丢弃）**：工具栏 → `放弃`。编辑器关闭，录音/回放源**不被改动**，仍可再次进入。

> 编辑器不会修改原始录音事件（`Recorder.events` 保持原样）；它通过 `Recorder.setEditedNotes(...)` 写入可选覆盖层，旧版"清空"按钮只清原始事件。

---

## 2. 界面布局

```
┌────────────────────────────────────────────────────────────────┐
│  ▶ 播放  撤销  重做  删除  粘贴 | + - 适配 | 提示   | 放弃  ✓ 应用 │  ← 工具栏
├──────┬─────────────────────────────────────────────────────────┤
│ A#2  │                                                          │
│ A2   │ 0s           1s           2s           3s                │  ← 时间刻度
│ G#2  │                                                          │
│ C3   │  [C3][D3]                                                   │  ← 音符
│ D3   │           [E3]                                              │
│ ...  │                                                          │
├──────┴─────────────────────────────────────────────────────────┤
│ 选中 N · 音符 M                                                │  ← 底部状态
└────────────────────────────────────────────────────────────────┘
```

- **横轴**：时间（秒）。顶部白底刻度，竖向细线=0.5s，主线=1s。可滚轮横向滚动或 Shift+滚轮缩放。
- **纵轴**：音高（半音行）。白键行浅、黑键行带浅灰底纹（与真琴一致）。左侧刻度显示音名（如 C3、F#3）。Alt+滚轮可缩放音高范围，↑/↓ 平移可视音高。
- **音符 = 圆角矩形**：宽=时长（秒）、高=一个半音；**白键浅蓝、黑键深灰**；透明度随力度（力度越大越不透明）；选中后描金黄色描边。
- **被"白键/黑键"判定**：音符颜色与命名遵循通用 12 平均律（C#、D#、F#、G#、A# 为黑键）。

---

## 3. 操作与快捷键总览

| 操作 | 鼠标 / 触摸 | 键盘 | 触发接口 |
|---|---|---|---|
| 单选一个音符 | 单击该音符 | — | `selection.set(id)` |
| 增选 / 减选 | Shift/Ctrl + 单击 | — | 同上 |
| 全清选区 | 单击空白 | Esc | `selection.clear()` |
| 框选 / 拖选 | 在空白处按下拖动 | — | 内部 `marquee` + 命中测试 |
| 移动选中（音高 + 时间） | 在选中音符上按下拖动 | — | `NoteTimeline.translate(ids, dT, dM)` （commit:false 预览，pointerup 提交） |
| 改变时长（起点 / 终点） | 拖音符左 / 右边 4px | — | `NoteTimeline.resize(ids, 'start'\|'end', t)` |
| 双击新建 | 双击画布空白 | — | `NoteTimeline.insert(t, m)` |
| 删除 | `删除`按钮 或 | Delete / Backspace | `NoteTimeline.remove(ids)` |
| 复制 | — | Ctrl+C | 写入 `editor.clipboard` |
| 粘贴 | `粘贴`按钮 或 | Ctrl+V | 在选区首音 + 0.2s 处插入副本 |
| 撤销 | `撤销`按钮 | Ctrl+Z | `NoteTimeline.undo()` |
| 重做 | `重做`按钮 | Ctrl+Shift+Z / Ctrl+Y | `NoteTimeline.redo()` |
| 适配视图 | `适配`按钮 | — | `_fit()`（按音符数自动缩放） |
| 放大 / 缩小 | `+` / `-` 或 滚轮 | — | 调整 `ppSec`（像素/秒） |
| 横向滚动时间 | 鼠标右键拖时间轴 / Alt+滚轮 | ←/→ | — |
| 音高范围平移 | ↑ / ↓ | ↑/↓ | 调整 `viewLow/viewHigh` |
| 试听当前编辑结果 | `▶ 播放` 按钮 | — | `Recorder.audition(notes)`（单次不循环、不影响状态） |
| 退出（保留改动） | `✓ 应用` | — | `Recorder.setEditedNotes(notes)` |
| 退出（放弃） | `放弃` / `✕` | — | 直接销毁编辑器 |

---

## 4. 移动 / 拉伸的吸附与约束

- **音高**：拖动时**自动吸附到整半音**（每行 1 个 MIDI），即拖一个位置 = 改 1 半音。
- **时间**：拖动时按 `timeSnap = 0.05s` 吸附（约 50ms 一格）；你可以拖到任意位置，抬起时取最近吸附格落位。
- **时长**：调整起点时终点不动；调整终点时起点不动。最小时长 50ms（防止极短不可见的音）。
- **音高范围**：拖动时 `m` 受 `clampMidi = [28, 108]`（与八度音域对齐）夹紧。
- **一次拖拽 = 一次撤销**：拖动过程中以 `commit:false` 实时改数据但不写历史；`pointerup` 后若真的发生了改动，则把"拖动前快照"压入撤销栈一次 —— 按 Ctrl+Z 一次回到拖动前。

---

## 5. 数据结构与接口变更

编辑过程的所有变更**只在编辑期间内部结构上发生**，对外仍维持现有格式。

| 模块 | 改动 |
|---|---|
| `Recorder` (新增) | `editedNotes: Array<{t,d,m,v}>\|null` —— 可选覆盖层；`setEditedNotes(notes)` 写入纯 {t,d,m,v}；`editableNotes()` 优先返回编辑结果，否则返回编译原始事件的结果；新增 `audition(notes)` 做单次试听（不进入循环，不污染状态）。 |
| `Recorder` (兼容) | `play()` 数据源改为 `_sourceNotes()` —— 若有 `editedNotes` 用之，否则 `_compile()`。**两种来源输出同一种结构 `{t,d,m,v}`**，原有循环 / 试听 / 状态接口不变。 |
| `Recorder` 兼容性 | `events`(原始 on/off) 不被编辑器改动；编辑结果完全独立存在，需要"放弃"时只需 `setEditedNotes(null)` 即可回到原始录音。 |
| 新文件 `src/editor/NoteTimeline.js` | 可编辑音符文档模型（基于快照的撤销 / 重做栈）。每个音符带 `id`（仅编辑器内部使用），对外接口仍以 `{t,d,m,v}` 表示。原语：`apply/insert/remove/translate/resize/commitHistory` 等。 |
| 新文件 `src/editor/PianoRollEditor.js` | Canvas 2D 渲染 + 指针事件处理；输入控件完全在内存 / Canvas 上，无外部副作用。`onPlay` 回调把音符交给 `Recorder.audition`。 |
| 新文件 `src/editor/NoteEditorController.js` | 把 `Recorder` ↔ `NoteTimeline` ↔ `PianoRollEditor` 三者接起来：进入时把 Recorder 当前音符拷入 NoteTimeline（生成 id）；退出时把 NoteTimeline 音符剥掉 id、写回 Recorder。 |
| `index.html` | 新增 `<div class="editor-host" id="note-editor" hidden>` 覆盖层与 `.pro` 工具栏/画布骨架；新增 `btn-note-editor` 入口。 |
| `styles/main.css` | 新增 `.editor-host` 与 `.pro-toolbar/. .pro-body/. .pro-canvas` 样式（卡片化覆盖层、毛玻璃背景）。 |
| `ControlPanel` | 绑定 `btn-note-editor`：调用 `app.noteEditor.open()`（自动 ensureAudio 以便编辑器试听）。 |

---

## 6. 与现有回放的兼容性保证

1. **格式不变**：编辑器写入 `Recorder.editedNotes` 的音符是纯 `{t,d,m,v}` —— 与 `_compile()` 输出同形，与 `DEMO_SONGS.events[]` 同形（少了 `id`）。
2. **原数据不动**：`Recorder.events`（原始 on/off 序列）永远不被编辑器改写；"放弃"仅丢弃编辑覆盖层。
3. **回放一致**：`play()` 调 `_sourceNotes()`，若有覆盖则使用覆盖；否则编译原。两条路径都喂给同一段 setTimeout/AudioContext 调度逻辑，声音与循环时长（`duration`）计算统一 —— 编辑不会引入静默段，也不会破坏收尾静音（TAIL）。
4. **撤销 / 重做范围**：编辑器内的所有结构修改都进编辑器自身的撤销栈；**不会污染** `Recorder` 的状态（`recording/playing` 等）。
5. **再次录制**：用户开始新一轮录制时，`startRecord()` 把 `events` 清空。如果 `editedNotes` 仍在，系统会从 `events` 重新编译（因为新一次录制无原始事件）；如需彻底清空编辑覆盖，调用"清空"按钮（已实现的 `recorder.clear()`）即可。

---

## 7. 已知行为与边界

- **录制自动停止**（已存在行为）：原 `Recorder.autoStop` 在最后一个音松开时自动停止录制。因此**只能录制一段连续连贯的尾音段**；若想录多段独立乐句，请每次录完一段后再次点击 `● 录制`。编辑器对这段乐句的编辑独立、随时可改。
- **试听**：`Recorder.audition()` 单次不循环；多次试听会覆盖上一次（再次 `stopPlay()` 停掉前次残留音）。
- **多指 / 触摸**：指针事件使用 `pointerdown/move/up`，理论上支持触摸设备；缩放 / 平移靠滚轮或键盘。
- **大乐句性能**：当前为 Canvas 2D 全量重绘，长乐句（>1000 音）可能轻微卡顿；后续可改为按脏区 / WebGL 优化。
- **力度可改**：`NoteTimeline.translate` 仅移动位置；目前 UI 不提供"批量改力度"的手势，但数据层支持（`v` 字段），可在后续通过"按住 Ctrl + 上下键"等手势加入。