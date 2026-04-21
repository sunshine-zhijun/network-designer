/**
 * 网规工具前端核心逻辑
 * 功能：户型图导入、墙体绘制/识别、AP放置、信号热力图
 * 数据持久化：data_service.js
 */

// ============================================================
// 后端配置
// ============================================================
const BACKEND_HOST = '192.168.18.123';
const BACKEND_PORT = '8766';
const API_BASE = `http://${BACKEND_HOST}:${BACKEND_PORT}/api`;

// 后端可用性检测（如果后端不可用，将自动降级到本地存储）
let BACKEND_AVAILABLE = false; // 默认关闭，检测到后端后再开启

// 启动时检测后端可用性
(async function checkBackend() {
  try {
    const response = await fetch(`${API_BASE}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    if (response.ok) {
      BACKEND_AVAILABLE = true;
      console.log('[API] ✅ Backend connected:', API_BASE);
    } else {
      console.log('[API] ⚠️  Backend returned error:', response.status);
    }
  } catch (e) {
    console.log('[API] ❌ Backend not available, using offline mode');
    console.log('[API]    Error:', e.message);
  }
})();

// 引入数据服务（内联，因为是单文件部署）
// 如需分离，请创建 <script src="data_service.js"></script> 并删除以下代码

const State = {
  tool: 'select',           // 当前工具
  zoom: 1.0,
  panX: 0, panY: 0,
  isPanning: false,
  panStart: null,

  // 户型图
  floorplanImage: null,
  floorplanW: 0, floorplanH: 0,

  // 画布尺寸
  canvasW: 1200, canvasH: 800,

  // 数据
  walls: [],
  aps: [],
  links: [],              // 网线连接 [{id, fromId, toId, route: [{x,y}...]}]
  scale_m_per_px: 0.05,   // 默认5cm/px

  // 比例尺绘制
  scalePoint1: null,
  scalePoint2: null,
  scalePending: false,
  scaleGuideMode: false,  // 引导模式标记

  // 墙体绘制
  wallDrawing: false,
  wallStart: null,

  // 网线连接绘制
  linkDrawing: false,      // 是否处于布线模式
  linkStartDevice: null,   // 布线起点设备 {id, type, x, y}
  linkPreviewEnd: null,    // 布线预览终点 {x, y}

  // 墙体绘制模式：manual=手动绘制, detect=自动识别
  wallMode: 'manual',

// 选中元素
  selectedType: null,   // 'wall' | 'ap'
  selectedId: null,

  // AP拖拽（点击vs拖拽区分）
  draggingAP: null,
  dragOffX: 0, dragOffY: 0,
  clickStartX: 0, clickStartY: 0,  // 记录点击起点用于判断是否拖拽
  _apWasDragged: false,             // 是否真正发生了拖拽

  // 设备放置

  // 热力图
  heatmapData: null,
  heatmapCanvas: null,
  heatmapFreq: 'all',  // 'all' | 2.4 | 5 | 6

  // 当前选择的墙体材质
  currentMaterial: 'brick',

  // 图层可见性
  layers: {
    floorplan: true,
    walls: true,
    aps: true,
    heatmap: false,
    links: true,
  },

  // AP悬停tooltip
  hoveredAP: null,
  tooltipEl: null,
  heatmapTimer: null,

  // 撤回/复原历史记录
  history: [],        // 操作历史栈
  historyIndex: -1,   // 当前历史位置
  maxHistory: 50,     // 最大历史记录数
};

// 材质配置（与后端同步）
const MATERIALS = {
  concrete: { name: '混凝土承重墙', color: '#888', atten2g: 15, atten5g: 20, atten6g: 24 },
  brick:    { name: '砖墙',         color: '#c47c4a', atten2g: 12, atten5g: 17, atten6g: 20 },
  wood:     { name: '木质隔断',     color: '#a0642a', atten2g: 4,  atten5g: 6,  atten6g: 8  },
  glass:    { name: '玻璃幕墙',     color: '#88ccff', atten2g: 3,  atten5g: 5,  atten6g: 6  },
  gypsum:   { name: '石膏板',       color: '#d4d0c8', atten2g: 3.5,atten5g: 5.5,atten6g: 7},
  metal:    { name: '金属',         color: '#9e9e9e', atten2g: 20, atten5g: 25, atten6g: 28 },
  floor:    { name: '楼板/天花板',  color: '#666',    atten2g: 18, atten5g: 22, atten6g: 26 },
};

// 设备类型定义
const DEVICE_TYPES = {
  ap: {
    name: 'AP',
    nameCn: '无线AP',
    icon: '⊙',
    color: '#4a9eff',
    hasSignal: true,
    description: '发射WiFi信号',
  },
  switch: {
    name: 'Switch',
    nameCn: '交换机',
    icon: '▣',
    color: '#ff9f4a',
    hasSignal: false,
    description: '有线网络交换机',
  },
  router: {
    name: 'Router',
    nameCn: '路由器',
    icon: '◈',
    color: '#4aff9f',
    hasSignal: true,
    description: '带路由功能的AP',
  },
};

const AP_ICONS = {
  ceiling: '⊙',
  wall:    '▣',
  desktop: '□',
};

// ============================================================
// 初始化
// ============================================================
const canvas = document.getElementById('main-canvas');
const ctx = canvas.getContext('2d');
const container = document.getElementById('canvas-container');

// 离屏热力图canvas
State.heatmapCanvas = document.createElement('canvas');

// ============================================================
// 撤回/复原功能
// ============================================================

// 保存当前状态快照
function saveHistorySnapshot(description) {
  // 如果当前不在历史末尾，删除后面的记录
  if (State.historyIndex < State.history.length - 1) {
    State.history = State.history.slice(0, State.historyIndex + 1);
  }
  // 添加新快照
  State.history.push({
    description: description,
    walls: JSON.parse(JSON.stringify(State.walls)),
    aps: JSON.parse(JSON.stringify(State.aps)),
    links: JSON.parse(JSON.stringify(State.links)),
  });
  State.historyIndex = State.history.length - 1;
  // 限制历史记录数量
  if (State.history.length > State.maxHistory) {
    State.history.shift();
    State.historyIndex--;
  }
  updateUndoRedoButtons();
}

// 撤回上一步
function undo() {
  if (State.historyIndex <= 0) return;
  State.historyIndex--;
  const snap = State.history[State.historyIndex];
  State.walls = JSON.parse(JSON.stringify(snap.walls));
  State.aps = JSON.parse(JSON.stringify(snap.aps));
  State.links = JSON.parse(JSON.stringify(snap.links));
  State.selectedType = null;
  State.selectedId = null;
  updateCountBadges();
  updateAPList();
  updateLinkList();
  updateWallList();
  render();
  updateUndoRedoButtons();
  showStatus('已撤回: ' + snap.description);
}

// 复原下一步
function redo() {
  if (State.historyIndex >= State.history.length - 1) return;
  State.historyIndex++;
  const snap = State.history[State.historyIndex];
  State.walls = JSON.parse(JSON.stringify(snap.walls));
  State.aps = JSON.parse(JSON.stringify(snap.aps));
  State.links = JSON.parse(JSON.stringify(snap.links));
  State.selectedType = null;
  State.selectedId = null;
  updateCountBadges();
  updateAPList();
  updateLinkList();
  updateWallList();
  render();
  updateUndoRedoButtons();
  showStatus('已复原: ' + snap.description);
}

// 更新撤回/复原按钮状态
function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');
  if (undoBtn) {
    undoBtn.disabled = State.historyIndex <= 0;
    undoBtn.style.opacity = State.historyIndex <= 0 ? '0.5' : '1';
  }
  if (redoBtn) {
    redoBtn.disabled = State.historyIndex >= State.history.length - 1;
    redoBtn.style.opacity = State.historyIndex >= State.history.length - 1 ? '0.5' : '1';
  }
}

// 初始化历史记录
function initHistory() {
  State.history = [];
  State.historyIndex = -1;
  // 保存初始空白状态
  saveHistorySnapshot('初始状态');
}

function init() {
  initHistory();  // 初始化撤回/复原历史
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  setupToolbar();
  setupCanvas();
  setupPanels();
  renderMaterialList();
  loadFromBackend();
  requestAnimationFrame(renderLoop);
}

function resizeCanvas() {
  const rect = container.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  State.canvasW = rect.width;
  State.canvasH = rect.height;
  State.heatmapCanvas.width = rect.width;
  State.heatmapCanvas.height = rect.height;
  render();
}

// ============================================================
// 坐标转换（画布坐标 ↔ 世界坐标）
// ============================================================
function toWorld(cx, cy) {
  return {
    x: (cx - State.panX) / State.zoom,
    y: (cy - State.panY) / State.zoom,
  };
}

function toCanvas(wx, wy) {
  return {
    x: wx * State.zoom + State.panX,
    y: wy * State.zoom + State.panY,
  };
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    cx: e.clientX - rect.left,
    cy: e.clientY - rect.top,
  };
}

// ============================================================
// 后端通信
// ============================================================

// 获取带 project_id 的 API 路径
function apiPath(path) {
  const projectId = State.projectId || 'default';
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}project_id=${projectId}`;
}

async function apiGet(path) {
  try {
    const r = await fetch(API_BASE + path);
    return await r.json();
  } catch (e) {
    console.warn('API GET failed:', path, e.message);
    return null;
  }
}

async function apiPost(path, body) {
  try {
    const r = await fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    console.warn('API POST failed:', path, e.message);
    return null;
  }
}

async function apiPut(path, body) {
  try {
    const r = await fetch(API_BASE + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await r.json();
  } catch (e) {
    console.warn('API PUT failed:', path, e.message);
    return null;
  }
}

async function apiDelete(path) {
  try {
    const r = await fetch(API_BASE + path, { method: 'DELETE' });
    return await r.json();
  } catch (e) {
    console.warn('API DELETE failed:', path, e.message);
    return null;
  }
}

// loadFromBackend() 在 data_service.js 中定义，会被调用来加载后端数据

// ============================================================
// 工具栏设置
// ============================================================
function setupToolbar() {
  // 画墙/识别墙体 下拉菜单
  const wallBtn = document.getElementById('tool-wall-btn');
  const wallMenu = document.getElementById('wall-tool-menu');
  wallBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    wallMenu.classList.toggle('open');
  });

  // 画墙下拉选项
  document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', () => {
      const mode = item.dataset.mode;
      State.wallMode = mode;

      // 更新下拉UI
      document.querySelectorAll('.dropdown-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      wallMenu.classList.remove('open');

      if (mode === 'detect') {
        // 自动识别模式
        detectWalls();
        setTool('select');
      } else {
        // 手动绘制模式
        setTool('wall');
      }
    });
  });

  // 关闭下拉（点击其他地方）
  document.addEventListener('click', () => {
    wallMenu.classList.remove('open');
  });

  // 选择工具按钮
  document.getElementById('tool-select').addEventListener('click', () => setTool('select'));
  document.getElementById('tool-place').addEventListener('click', () => {
    State.placingDevice = true;
    onPlaceToolClick();
  });
  document.getElementById('tool-scale').addEventListener('click', () => setTool('scale'));

  // 导入图纸
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });
  document.getElementById('file-input').addEventListener('change', onFileImport);

  // 清空
  document.getElementById('btn-clear-all').addEventListener('click', clearAll);

  // 导出
  document.getElementById('btn-export').addEventListener('click', exportReport);

  // 设备清单按钮
  document.getElementById('btn-show-inventory').addEventListener('click', showDeviceInventoryPanel);

  // 主题切换按钮
  document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

  // 热力图开关
  document.getElementById('btn-heatmap').addEventListener('click', toggleHeatmap);

  // 热力图频段按钮
  document.querySelectorAll('.freq-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      // 更新按钮状态
      document.querySelectorAll('.freq-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // 更新状态
      const freq = btn.dataset.freq;
      State.heatmapFreq = freq === 'all' ? 'all' : parseFloat(freq);
      if (State.heatmapVisible) requestHeatmap();
    });
  });

  // 缩放
  document.getElementById('btn-zoom-in').addEventListener('click', () => adjustZoom(1.2));
  document.getElementById('btn-zoom-out').addEventListener('click', () => adjustZoom(0.8));
  document.getElementById('btn-zoom-fit').addEventListener('click', fitView);

  // 比例尺应用
  document.getElementById('btn-apply-scale').addEventListener('click', applyScaleFromInputs);

  // 图层下拉
  const layerBtn = document.getElementById('btn-layer-toggle');
  const layerMenu = document.getElementById('layer-dropdown-menu');
  layerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    layerMenu.classList.toggle('show');
  });
  document.addEventListener('click', () => {
    layerMenu.classList.remove('show');
  });

  // 图层复选框
  ['fp', 'walls', 'aps', 'heatmap', 'links'].forEach(id => {
    const el = document.getElementById('layer-' + id);
    if (el) el.addEventListener('change', () => {
      const map = { fp: 'floorplan', walls: 'walls', aps: 'aps', heatmap: 'heatmap', links: 'links' };
      State.layers[map[id]] = el.checked;
      if (map[id] === 'heatmap') {
        State.heatmapVisible = el.checked;
        if (el.checked) requestHeatmap();
        document.getElementById('heatmap-legend').classList.toggle('hidden', !el.checked);
      }
      render();
    });
  });
  
  // 布线按钮
  document.getElementById('btn-link').addEventListener('click', toggleLinkMode);

  // 撤回/复原按钮
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-redo').addEventListener('click', redo);

  // 键盘快捷键
  document.addEventListener('keydown', onKeyDown);

  // 分析按钮
  document.getElementById('btn-analyze').addEventListener('click', doSignalAnalysis);

  // 导出设备清单按钮
  document.getElementById('btn-export-inventory').addEventListener('click', exportDeviceInventory);

  // 信号面板关闭按钮
  document.getElementById('btn-close-signal').addEventListener('click', () => {
    document.getElementById('signal-panel-mini').style.display = 'none';
  });

  // 产品分类切换
  document.querySelectorAll('.product-category').forEach(cat => {
    cat.addEventListener('click', () => {
      const category = cat.dataset.category;
      document.querySelectorAll('.product-category').forEach(c => c.classList.remove('active'));
      cat.classList.add('active');
      renderProductList(category);
    });
  });
}

function setTool(tool) {
  State.tool = tool;
  State.wallDrawing = false;
  State.wallStart = null;
  State.scalePending = false;
  State.scalePoint1 = null;

  // 更新工具按钮高亮
  document.querySelectorAll('.tool-btn').forEach(b => {
    if (b.id === 'tool-wall-btn') {
      // 画墙按钮特殊处理：始终高亮当wallMode=manual
      b.classList.toggle('active', tool === 'wall');
    } else {
      b.classList.toggle('active', b.dataset.tool === tool);
    }
  });

  // 光标
  container.className = '';
  container.classList.add('tool-' + tool);

  // 关闭右侧面板
  document.getElementById('right-panel').classList.remove('open');
  document.getElementById('wall-list-panel').classList.remove('open');

  updateStatus(toolHint(tool));

  // 画墙模式 - 显示墙体列表
  if (tool === 'wall') {
    showWallListPanel();
  }

  // 设备放置模式
  if (tool === 'place') {
    State.placingDevice = true;
    onPlaceToolClick();
  } else {
    State.placingDevice = false;
    closeProductPanel();
  }
}

// 显示墙体列表面板
function showWallListPanel() {
  const panel = document.getElementById('wall-list-panel');
  panel.classList.add('open');
  renderWallListPanel();
}

function renderWallListPanel() {
  // 渲染材质选择
  renderMaterialList();

  // 渲染墙体列表
  const list = document.getElementById('wall-items-list');
  const count = document.getElementById('wall-list-count');
  count.textContent = State.walls.length;

  list.innerHTML = State.walls.map(wall => {
    const matId = getMaterialId(wall);
    const mat = MATERIALS[matId] || MATERIALS.brick;
    const lenM = (Math.hypot(wall.x2-wall.x1, wall.y2-wall.y1) * State.scale_m_per_px / 100).toFixed(2);
    return `
      <div class="wall-item ${State.selectedType === 'wall' && State.selectedId === wall.id ? 'selected' : ''}" data-wall-id="${wall.id}">
        <div class="wall-item-color" style="background:${mat.color}"></div>
        <div class="wall-item-info">
          <div class="wall-item-name">${mat.name}</div>
          <div class="wall-item-len">${lenM}m</div>
        </div>
      </div>
    `;
  }).join('');

  // 点击墙体选中
  list.querySelectorAll('.wall-item').forEach(item => {
    item.addEventListener('click', () => {
      const wallId = item.dataset.wallId;
      selectElement('wall', wallId);
      // 居中跳转
      const wall = State.walls.find(w => w.id === wallId);
      if (wall) {
        const cx = (wall.x1 + wall.x2) / 2;
        const cy = (wall.y1 + wall.y2) / 2;
        const cp = toCanvas(cx, cy);
        State.panX += canvas.width / 2 - cp.x;
        State.panY += canvas.height / 2 - cp.y;
        render();
      }
      renderWallListPanel();
    });
  });
}

function toolHint(tool) {
  const hints = {
    select: '点击选择元素；拖拽AP移动位置；空白处拖拽平移视图',
    wall:   '点击起点，再点击终点完成一段墙体；右键/Esc取消绘制',
    place:  '选择设备类型，点击图纸放置 | 右键取消',
    scale:  '点击两个参考点设置比例尺',
    link:   '点击一个设备作为起点，再点击另一个设备完成连接',
  };
  return hints[tool] || '';
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    State.wallDrawing = false;
    State.wallStart = null;
    State.scalePending = false;
    State.scalePoint1 = null;
    // 取消布线
    if (State.linkDrawing) {
      State.linkStartDevice = null;
      State.linkPreviewEnd = null;
    }
    // 关闭下拉菜单
    document.getElementById('wall-tool-menu').classList.remove('show');
    document.getElementById('layer-dropdown-menu').classList.remove('show');
    render();
    return;
  }
  // 撤回/复原快捷键
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); return; }
  if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); redo(); return; }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const keyMap = { v: 'select', w: 'wall', p: 'place', s: 'scale', l: 'link' };
  if (keyMap[e.key.toLowerCase()]) setTool(keyMap[e.key.toLowerCase()]);
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
}

// ============================================================
// 画布事件
// ============================================================
function setupCanvas() {
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

function onMouseDown(e) {
  const { cx, cy } = getCanvasPos(e);
  const world = toWorld(cx, cy);

  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    // 中键/Alt+左键平移
    State.isPanning = true;
    State.panStart = { cx, cy, px: State.panX, py: State.panY };
    container.classList.add('dragging');
    return;
  }

  if (e.button === 2) {
    // 右键取消当前操作
    State.wallDrawing = false;
    State.wallStart = null;
    State.scalePending = false;
    State.scalePoint1 = null;
    State.scalePoint2 = null;

    // 退出设备放置模式
    if (State.placingDevice) {
      State.placingDevice = false;
      closeProductPanel();
      setTool('select');
    }

    // 关闭下拉菜单
    document.getElementById('wall-tool-menu').classList.remove('open');

    render();
    return;
  }

  // 左键
  if (State.tool === 'select') {
    handleSelectDown(world, cx, cy);
  } else if (State.tool === 'wall') {
    handleWallDown(world);
  } else if (State.tool === 'place') {
    handlePlaceDown(world);
  } else if (State.tool === 'scale') {
    handleScaleDown(world);
  } else if (State.tool === 'link') {
    handleLinkDown(world);
  }
}

function onMouseMove(e) {
  const { cx, cy } = getCanvasPos(e);
  const world = toWorld(cx, cy);

  // 更新坐标状态栏
  const realX = (world.x * State.scale_m_per_px).toFixed(2);
  const realY = (world.y * State.scale_m_per_px).toFixed(2);
  document.getElementById('status-coords').textContent =
    `X: ${realX}m, Y: ${realY}m`;

  // 布线预览
  if (State.linkStartDevice && State.tool === 'link') {
    State.linkPreviewEnd = { x: world.x, y: world.y };
  }

  if (State.isPanning && State.panStart) {
    State.panX = State.panStart.px + (cx - State.panStart.cx);
    State.panY = State.panStart.py + (cy - State.panStart.cy);
    render();
    return;
  }

  if (State.draggingAP) {
    // 移动AP
    State.draggingAP.x = world.x - State.dragOffX;
    State.draggingAP.y = world.y - State.dragOffY;
    
    // 检测是否真正拖拽了（超过阈值）
    if (!State._apWasDragged) {
      const dist = Math.hypot(State.draggingAP.x - State.clickStartX, State.draggingAP.y - State.clickStartY);
      if (dist > 5) State._apWasDragged = true;
    }
    
    scheduleHeatmapUpdate();
    
    // 实时显示鼠标位置信号强度
    updateSignalTooltip(world.x, world.y);
    
    render();
    return;
  }

  // hover检测
  if (State.tool === 'select') {
    detectHover(world);
  }

  render(); // 绘制绘图预览
  State._mouseWorld = world;
}

function onMouseUp(e) {
  if (State.isPanning) {
    State.isPanning = false;
    State.panStart = null;
    container.classList.remove('dragging');
    return;
  }

  if (State.draggingAP) {
    const moved = State.draggingAP;
    
    if (State._apWasDragged) {
      // 真正拖拽了：更新位置，不弹属性面板
      apiPut('/devices/' + moved.id, { x: moved.x, y: moved.y });
      requestHeatmapIfVisible();
    } else {
      // 只是点击：弹出属性面板
      selectElement('ap', moved.id);
    }
    
    State.draggingAP = null;
    hideSignalTooltip();
    render();
    return;
  }
}

function onWheel(e) {
  e.preventDefault();
  const { cx, cy } = getCanvasPos(e);
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const newZoom = Math.max(0.1, Math.min(10, State.zoom * factor));

  // 以鼠标为中心缩放
  State.panX = cx - (cx - State.panX) * (newZoom / State.zoom);
  State.panY = cy - (cy - State.panY) * (newZoom / State.zoom);
  State.zoom = newZoom;

  document.getElementById('zoom-display').textContent =
    Math.round(State.zoom * 100) + '%';
  render();
}

function onDblClick(e) {
  // 双击空白处重置视图
  const { cx, cy } = getCanvasPos(e);
  const world = toWorld(cx, cy);
  const hit = hitTest(world);
  if (!hit) fitView();
}

// ============================================================
// 选择工具逻辑
// ============================================================
function handleSelectDown(world, cx, cy) {
  const hit = hitTest(world);
  
  // 记录点击起点（用于区分点击和拖拽）
  State.clickStartX = world.x;
  State.clickStartY = world.y;
  State._apWasDragged = false;
  
  if (hit) {
    if (hit.type === 'ap') {
      const ap = State.aps.find(a => a.id === hit.id);
      if (ap) {
        State.draggingAP = ap;
        State.dragOffX = world.x - ap.x;
        State.dragOffY = world.y - ap.y;
        container.classList.add('dragging');
        // 不在这里selectElement，等mouseup根据是否拖拽决定
      }
    } else {
      // 墙体直接选中（墙体不支持拖拽）
      selectElement(hit.type, hit.id);
    }
  } else {
    // 点击空白取消选择
    selectElement(null, null);
    // 恢复设备列表显示
    const deviceSection = document.getElementById('device-list-section');
    if (deviceSection && State.aps.length > 0) deviceSection.style.display = 'block';
    // 开始平移
    State.isPanning = true;
    State.panStart = { cx, cy, px: State.panX, py: State.panY };
  }
}

function hitTest(world) {
  // 先测试AP（优先级高）
  if (State.layers.aps) {
    for (const ap of State.aps) {
      const dist = Math.hypot(world.x - ap.x, world.y - ap.y);
      if (dist < 20 / State.zoom) return { type: 'ap', id: ap.id };
    }
  }
  // 再测试墙体
  if (State.layers.walls) {
    for (const wall of State.walls) {
      if (pointToSegmentDist(world, wall) < 6 / State.zoom)
        return { type: 'wall', id: wall.id };
    }
  }
  return null;
}

function pointToSegmentDist(pt, wall) {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(pt.x - wall.x1, pt.y - wall.y1);
  const t = Math.max(0, Math.min(1,
    ((pt.x - wall.x1) * dx + (pt.y - wall.y1) * dy) / len2));
  return Math.hypot(pt.x - (wall.x1 + t * dx), pt.y - (wall.y1 + t * dy));
}

function detectHover(world) {
  const hit = hitTest(world);
  State.hoveredAP = null;
  if (hit && hit.type === 'ap') {
    State.hoveredAP = State.aps.find(a => a.id === hit.id) || null;
  }
  canvas.style.cursor = hit ? (hit.type === 'ap' ? 'grab' : 'pointer') : 'default';
}

// ============================================================
// 墙体绘制
// ============================================================
function handleWallDown(world) {
  if (!State.wallDrawing) {
    // 第一点
    State.wallDrawing = true;
    State.wallStart = { x: world.x, y: world.y };
    updateStatus('📐 点击第二个点完成墙体，Shift=水平/垂直约束 | 右键/Esc取消');
  } else {
    // 第二点，生成墙体
    let end = { ...world };
    if (isShiftKey()) end = snapAngle(State.wallStart, end);
    addWall(State.wallStart.x, State.wallStart.y, end.x, end.y);
    // 连续绘制：上一段终点变新起点
    State.wallStart = { ...end };
    updateStatus('📐 墙体已添加，继续绘制下一段 | 右键/Esc结束');
  }
}

let _shiftHeld = false;
document.addEventListener('keydown', e => { if (e.key === 'Shift') _shiftHeld = true; });
document.addEventListener('keyup', e => { if (e.key === 'Shift') _shiftHeld = false; });
function isShiftKey() { return _shiftHeld; }

function snapAngle(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  const len = Math.hypot(dx, dy);
  // snap to 0/45/90/135/180/...
  const snapped = Math.round(angle / 45) * 45;
  const rad = snapped * Math.PI / 180;
  return { x: from.x + len * Math.cos(rad), y: from.y + len * Math.sin(rad) };
}

async function addWall(x1, y1, x2, y2) {
  const newWall = {
    x1, y1, x2, y2,
    material_id: State.currentMaterial,
    id: 'local-' + Date.now(),
    material_name: MATERIALS[State.currentMaterial]?.name || '砖墙',
    atten_2g: MATERIALS[State.currentMaterial]?.atten2g || 12,
    atten_5g: MATERIALS[State.currentMaterial]?.atten5g || 17,
  };

  // 本地先渲染
  saveHistorySnapshot('绘制墙体');
  State.walls.push(newWall);
  updateCountBadges();
  render();

  // 同步后端（如果可用）
  if (BACKEND_AVAILABLE) {
    try {
      const res = await apiPost('/walls', {
        project_id: State.projectId || 'default',
        x1: x1.toString(),
        y1: y1.toString(),
        x2: x2.toString(),
        y2: y2.toString(),
        thickness: (MATERIALS[State.currentMaterial]?.thickness || 10).toString(),
        material: State.currentMaterial,
        color: MATERIALS[State.currentMaterial]?.color || null,
        elevation: '0'
      });
      console.log('[API] 墙体创建响应:', res);
      if (res && res.data && res.data[0]) newWall.id = res.data[0].id;
    } catch (e) {
      console.error('[API] 墙体创建失败:', e);
    }
  }
  requestHeatmapIfVisible();
}

// ============================================================
// 产品数据
// ============================================================
const PRODUCTS = {
  ap: [
    { id: 'ap-1', name: 'TL-XAP3000', spec: 'AX3000 双频', freq: ['2.4G', '5G'], power: 20, img: 'ap1' },
    { id: 'ap-2', name: 'TL-XAP6000', spec: 'AX6000 三频', freq: ['2.4G', '5G', '6G'], power: 23, img: 'ap2' },
    { id: 'ap-3', name: 'TL-XAP1800', spec: 'AX1800 单频', freq: ['2.4G', '5G'], power: 18, img: 'ap3' },
    { id: 'ap-4', name: 'TL-XAP5400', spec: 'AX5400 双频', freq: ['2.4G', '5G'], power: 22, img: 'ap4' },
  ],
  switch: [
    { id: 'sw-1', name: 'TL-SG2008', spec: '8口千兆', freq: [], power: 0, img: 'sw1' },
    { id: 'sw-2', name: 'TL-SG2016', spec: '16口千兆', freq: [], power: 0, img: 'sw2' },
    { id: 'sw-3', name: 'TL-SG2428', spec: '24口PoE', freq: [], power: 0, img: 'sw3' },
  ],
  router: [
    { id: 'rt-1', name: 'TL-XDR6088', spec: 'WiFi6 万兆', freq: ['2.4G', '5G', '6G'], power: 24, img: 'rt1' },
    { id: 'rt-2', name: 'TL-XDR5470', spec: 'WiFi6 双频', freq: ['2.4G', '5G'], power: 22, img: 'rt2' },
  ],
};

// ============================================================
// 设备放置 - 新版
// ============================================================

// 点击布点按钮
function onPlaceToolClick() {
  State.tool = 'place';
  State.placingDevice = true;
  State.selectedProduct = null;
  
  // 打开右侧面板，显示产品选择
  const rightPanel = document.getElementById('right-panel');
  const panelTitle = document.getElementById('right-panel-title');
  const panelContent = document.getElementById('right-panel-content');
  
  // 隐藏额外列表区域
  document.getElementById('device-list-section').style.display = 'none';
  document.getElementById('device-inventory-section').style.display = 'none';
  document.getElementById('link-list-section').style.display = 'none';
  
  panelTitle.textContent = '📍 布点选设备';
  panelContent.innerHTML = `
    <div class="panel-section">
      <div class="section-title">选择设备类型</div>
      <div class="product-categories-inline">
        <button class="product-cat-btn active" data-cat="ap">📶 AP</button>
        <button class="product-cat-btn" data-cat="switch">🔌 交换机</button>
        <button class="product-cat-btn" data-cat="router">🌐 路由器</button>
      </div>
    </div>
    <div class="panel-section">
      <div class="section-title">选择型号</div>
      <div id="product-list-inline"></div>
    </div>
    <div class="place-mode-hint">💡 选择产品后点击图纸放置 | 右键退出布点</div>
  `;
  
  // 产品分类切换
  panelContent.querySelectorAll('.product-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panelContent.querySelectorAll('.product-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderProductListInline(btn.dataset.cat);
    });
  });
  
  // 渲染默认AP列表
  renderProductListInline('ap');
  
  rightPanel.classList.add('open');
  
  // 更新工具按钮高亮
  document.querySelectorAll('.tool-btn').forEach(b => {
    if (b.id === 'tool-wall-btn') b.classList.remove('active');
    else b.classList.toggle('active', b.dataset.tool === 'place');
  });
  
  updateStatus('💡 选择设备型号，点击图纸布点 | 右键退出');
}

// 关闭产品面板
function closeProductPanel() {
  document.getElementById('product-panel').classList.add('hidden');
  State.placingDevice = false;
  State.selectedProduct = null;
  
  // 清除选中状态
  document.querySelectorAll('.product-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  // 退出布点模式切回选择
  if (State.tool === 'place') {
    State.tool = 'select';
    document.querySelectorAll('.tool-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tool === 'select');
    });
  }
  
  // 取消布点时关闭右侧面板，不显示额外列表
  document.getElementById('right-panel').classList.remove('open');
}

// ============================================================
// 产品SVG图片生成
// ============================================================
function getProductSVG(img, category) {
  const svgMap = {
    // AP系列 - 吸顶式圆形面板
    ap1: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ap1-bg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#1e3a5f"/>
          <stop offset="100%" stop-color="#0a1628"/>
        </radialGradient>
        <radialGradient id="ap1-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#4a9eff" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#4a9eff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <!-- 底座阴影 -->
      <ellipse cx="32" cy="52" rx="18" ry="4" fill="rgba(0,0,0,0.3)"/>
      <!-- 主体圆形 -->
      <circle cx="32" cy="30" r="22" fill="url(#ap1-bg)" stroke="#4a9eff" stroke-width="1.5"/>
      <!-- 呼吸光环 -->
      <circle cx="32" cy="30" r="20" fill="url(#ap1-glow)"/>
      <!-- 信号弧线 -->
      <path d="M22 20 Q32 10 42 20" stroke="#4a9eff" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M18 14 Q32 2 46 14" stroke="#4a9eff" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.5"/>
      <!-- 中心指示灯 -->
      <circle cx="32" cy="30" r="5" fill="#4a9eff"/>
      <circle cx="32" cy="30" r="3" fill="#80c0ff"/>
      <!-- 状态点 -->
      <circle cx="44" cy="18" r="3" fill="#00ff88" opacity="0.9"/>
    </svg>`,
    ap2: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ap2-bg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#1a2a4a"/>
          <stop offset="100%" stop-color="#080e1a"/>
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="54" rx="20" ry="4" fill="rgba(0,0,0,0.3)"/>
      <!-- 方形主体圆角 -->
      <rect x="10" y="10" width="44" height="44" rx="10" fill="url(#ap2-bg)" stroke="#ff6b35" stroke-width="1.5"/>
      <!-- 信号指示 -->
      <path d="M22 8 Q32 -2 42 8" stroke="#ff6b35" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M18 3 Q32 -8 46 3" stroke="#ff6b35" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.5"/>
      <!-- 三频段标识 -->
      <circle cx="20" cy="32" r="4" fill="#ff6b35" opacity="0.9"/>
      <circle cx="32" cy="32" r="4" fill="#ffd93d" opacity="0.9"/>
      <circle cx="44" cy="32" r="4" fill="#4a9eff" opacity="0.9"/>
      <circle cx="26" cy="44" r="3" fill="#ff6b35" opacity="0.6"/>
      <circle cx="38" cy="44" r="3" fill="#ffd93d" opacity="0.6"/>
      <circle cx="32" cy="50" r="2.5" fill="#00ff88" opacity="0.9"/>
    </svg>`,
    ap3: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ap3-bg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#0f2027"/>
          <stop offset="100%" stop-color="#04090f"/>
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="52" rx="16" ry="3" fill="rgba(0,0,0,0.25)"/>
      <!-- 椭圆形主体 -->
      <ellipse cx="32" cy="32" rx="20" ry="22" fill="url(#ap3-bg)" stroke="#4aff9f" stroke-width="1.5"/>
      <!-- 简洁信号 -->
      <path d="M24 12 Q32 4 40 12" stroke="#4aff9f" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <circle cx="32" cy="32" r="6" fill="#4aff9f"/>
      <circle cx="32" cy="32" r="3" fill="#1a3a2a"/>
      <circle cx="44" cy="16" r="2.5" fill="#4aff9f" opacity="0.8"/>
    </svg>`,
    ap4: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="ap4-bg" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#1a1040"/>
          <stop offset="100%" stop-color="#0a0620"/>
        </radialGradient>
      </defs>
      <ellipse cx="32" cy="52" rx="18" ry="3.5" fill="rgba(0,0,0,0.3)"/>
      <!-- 八边形主体 -->
      <polygon points="32,8 50,18 56,36 50,54 32,60 14,54 8,36 14,18" fill="url(#ap4-bg)" stroke="#b060ff" stroke-width="1.5"/>
      <!-- 信号 -->
      <path d="M20 6 Q32 -4 44 6" stroke="#b060ff" stroke-width="1.5" fill="none" stroke-linecap="round"/>
      <path d="M16 2 Q32 -10 48 2" stroke="#b060ff" stroke-width="1.5" fill="none" stroke-linecap="round" opacity="0.4"/>
      <!-- 中心MESH -->
      <circle cx="32" cy="34" r="10" fill="none" stroke="#b060ff" stroke-width="1.5"/>
      <circle cx="32" cy="34" r="4" fill="#b060ff"/>
      <circle cx="48" cy="24" r="2" fill="#b060ff" opacity="0.8"/>
      <circle cx="16" cy="24" r="2" fill="#b060ff" opacity="0.8"/>
      <circle cx="48" cy="44" r="2" fill="#b060ff" opacity="0.8"/>
      <circle cx="16" cy="44" r="2" fill="#b060ff" opacity="0.8"/>
    </svg>`,
    // 交换机系列
    sw1: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sw-bg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#1e2530"/>
          <stop offset="100%" stop-color="#0d1117"/>
        </linearGradient>
      </defs>
      <rect x="6" y="20" width="52" height="28" rx="4" fill="url(#sw-bg)" stroke="#ff9f4a" stroke-width="1.5"/>
      <!-- 8个网口 -->
      ${[10,18,26,34,42,50].map((x,i) => `<rect x="${x}" y="26" width="5" height="8" rx="1" fill="#ff9f4a" opacity="${0.4+i*0.1}"/>`).join('')}
      <!-- 指示灯 -->
      <circle cx="14" cy="40" r="2" fill="#00ff88"/>
      <circle cx="22" cy="40" r="2" fill="#00ff88" opacity="0.5"/>
      <circle cx="30" cy="40" r="2" fill="#ffd93d"/>
      <circle cx="38" cy="40" r="2" fill="#00ff88" opacity="0.7"/>
      <!-- 端口标签 -->
      <rect x="6" y="18" width="52" height="4" rx="2" fill="#ff9f4a" opacity="0.2"/>
    </svg>`,
    sw2: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sw2-bg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#1e2530"/>
          <stop offset="100%" stop-color="#0d1117"/>
        </linearGradient>
      </defs>
      <rect x="4" y="16" width="56" height="36" rx="4" fill="url(#sw2-bg)" stroke="#ff9f4a" stroke-width="1.5"/>
      <!-- 16口分布 -->
      ${Array.from({length:8},(_,i)=>`<rect x="${8+i*6}" y="22" width="4" height="6" rx="1" fill="#ff9f4a" opacity="${0.3+i*0.08}"/>`).join('')}
      ${Array.from({length:8},(_,i)=>`<rect x="${8+i*6}" y="32" width="4" height="6" rx="1" fill="#ff9f4a" opacity="${0.3+i*0.08}"/>`).join('')}
      <!-- 状态灯 -->
      <circle cx="10" cy="46" r="1.5" fill="#00ff88"/>
      <circle cx="16" cy="46" r="1.5" fill="#00ff88"/>
      <circle cx="22" cy="46" r="1.5" fill="#ffd93d"/>
      <circle cx="28" cy="46" r="1.5" fill="#00ff88" opacity="0.6"/>
    </svg>`,
    sw3: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="sw3-bg" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#1e2530"/>
          <stop offset="100%" stop-color="#0d1117"/>
        </linearGradient>
      </defs>
      <rect x="4" y="12" width="56" height="44" rx="4" fill="url(#sw3-bg)" stroke="#ff9f4a" stroke-width="1.5"/>
      <!-- PoE标识 -->
      <rect x="4" y="12" width="12" height="8" rx="2" fill="#ff9f4a" opacity="0.3"/>
      <text x="10" y="18" font-size="6" fill="#ff9f4a" text-anchor="middle" font-weight="bold">P</text>
      <!-- 24口 -->
      ${Array.from({length:6},(_,r)=>Array.from({length:4},(_,c)=>`<rect x="${10+c*12}" y="${22+r*8}" width="4" height="5" rx="1" fill="#ff9f4a" opacity="${0.25+r*0.1+c*0.05}"/>`).join('')).join('')}
      <circle cx="8" cy="52" r="2" fill="#00ff88"/>
      <circle cx="16" cy="52" r="2" fill="#00ff88" opacity="0.6"/>
      <circle cx="24" cy="52" r="2" fill="#ffd93d"/>
    </svg>`,
    // 路由器系列
    rt1: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="rt-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1a1a2e"/>
          <stop offset="100%" stop-color="#0a0a15"/>
        </linearGradient>
      </defs>
      <rect x="4" y="24" width="56" height="22" rx="6" fill="url(#rt-bg)" stroke="#ffd93d" stroke-width="1.5"/>
      <!-- 4根天线 -->
      <rect x="12" y="8" width="3" height="20" rx="1.5" fill="#ffd93d" opacity="0.8" transform="rotate(-15, 13.5, 24)"/>
      <rect x="24" y="6" width="3" height="22" rx="1.5" fill="#ffd93d"/>
      <rect x="37" y="6" width="3" height="22" rx="1.5" fill="#ffd93d"/>
      <rect x="49" y="8" width="3" height="20" rx="1.5" fill="#ffd93d" opacity="0.8" transform="rotate(15, 50.5, 24)"/>
      <!-- 信号波 -->
      <path d="M16 18 Q20 14 24 18" stroke="#ffd93d" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <path d="M28 16 Q32 12 36 16" stroke="#ffd93d" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <path d="M40 18 Q44 14 48 18" stroke="#ffd93d" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <!-- 端口 -->
      <rect x="8" y="30" width="6" height="4" rx="1" fill="#ffd93d" opacity="0.6"/>
      <rect x="16" y="30" width="6" height="4" rx="1" fill="#ffd93d" opacity="0.6"/>
      <rect x="24" y="30" width="6" height="4" rx="1" fill="#ffd93d" opacity="0.6"/>
      <rect x="32" y="30" width="6" height="4" rx="1" fill="#ffd93d" opacity="0.6"/>
      <!-- 万兆标识 -->
      <text x="46" y="38" font-size="6" fill="#ffd93d" font-weight="bold">10G</text>
      <circle cx="56" cy="34" r="2.5" fill="#00ff88"/>
    </svg>`,
    rt2: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="rt2-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1a1a2e"/>
          <stop offset="100%" stop-color="#0a0a15"/>
        </linearGradient>
      </defs>
      <rect x="4" y="26" width="56" height="20" rx="5" fill="url(#rt2-bg)" stroke="#4aff9f" stroke-width="1.5"/>
      <!-- 2根天线 -->
      <rect x="18" y="10" width="3" height="20" rx="1.5" fill="#4aff9f" opacity="0.8" transform="rotate(-10, 19.5, 26)"/>
      <rect x="43" y="10" width="3" height="20" rx="1.5" fill="#4aff9f" opacity="0.8" transform="rotate(10, 44.5, 26)"/>
      <path d="M22 16 Q25 12 28 16" stroke="#4aff9f" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <path d="M36 16 Q39 12 42 16" stroke="#4aff9f" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <!-- 端口 -->
      <rect x="8" y="32" width="5" height="4" rx="1" fill="#4aff9f" opacity="0.5"/>
      <rect x="15" y="32" width="5" height="4" rx="1" fill="#4aff9f" opacity="0.5"/>
      <rect x="22" y="32" width="5" height="4" rx="1" fill="#4aff9f" opacity="0.5"/>
      <rect x="29" y="32" width="5" height="4" rx="1" fill="#4aff9f" opacity="0.5"/>
      <!-- WiFi6 -->
      <text x="42" y="40" font-size="6" fill="#4aff9f" font-weight="bold">WiFi6</text>
      <circle cx="56" cy="34" r="2.5" fill="#00ff88"/>
    </svg>`,
  };
  return svgMap[img] || svgMap.ap1;
}

// ============================================================
// 渲染产品列表到右侧面板
function renderProductListInline(category) {
  const list = document.getElementById('product-list-inline');
  if (!list) return;
  const products = PRODUCTS[category] || [];
  
  list.innerHTML = products.map(prod => {
    const freqHtml = prod.freq.length > 0 
      ? `<div class="product-freq">${prod.freq.map(f => `<span class="freq-tag sel">${f}</span>`).join('')}</div>`
      : '<div class="product-freq"><span class="freq-tag">无WiFi</span></div>';
    
    return `
      <div class="product-item product-item-inline ${State.selectedProduct?.id === prod.id ? 'selected' : ''}" 
           data-product-id="${prod.id}" data-category="${category}">
        <div class="product-image-wrap">
          ${getProductSVG(prod.img, category)}
        </div>
        <div class="product-name">${prod.name}</div>
        <div class="product-spec">${prod.spec}</div>
        ${freqHtml}
      </div>
    `;
  }).join('');
  
  // 添加点击事件
  list.querySelectorAll('.product-item-inline').forEach(item => {
    item.addEventListener('click', () => {
      list.querySelectorAll('.product-item-inline').forEach(p => p.classList.remove('selected'));
      item.classList.add('selected');
      
      const productId = item.dataset.productId;
      const cat = item.dataset.category;
      const product = PRODUCTS[cat].find(p => p.id === productId);
      
      State.selectedProduct = product;
      State.selectedDeviceType = cat;
      
      updateStatus(`已选择 ${product.name} — 点击图纸布点 | 右键退出`);
    });
  });
}

// ============================================================
// 渲染产品列表（带SVG图片，可选渲染到指定容器）
function renderProductList(category, targetId) {
  const list = document.getElementById(targetId || 'product-list');
  if (!list) return;
  const products = PRODUCTS[category] || [];
  
  list.innerHTML = products.map(prod => {
    const freqHtml = prod.freq.length > 0 
      ? `<div class="product-freq">${prod.freq.map(f => `<span class="freq-tag sel">${f}</span>`).join('')}</div>`
      : '<div class="product-freq"><span class="freq-tag">无WiFi</span></div>';
    
    return `
      <div class="product-item" data-product-id="${prod.id}" data-category="${category}">
        <div class="product-image-wrap">
          ${getProductSVG(prod.img, category)}
        </div>
        <div class="product-name">${prod.name}</div>
        <div class="product-spec">${prod.spec}</div>
        ${freqHtml}
      </div>
    `;
  }).join('');
  
  // 添加点击事件
  list.querySelectorAll('.product-item').forEach(item => {
    item.addEventListener('click', () => {
      // 选中产品
      document.querySelectorAll('.product-item').forEach(p => p.classList.remove('selected'));
      item.classList.add('selected');
      
      const productId = item.dataset.productId;
      const category = item.dataset.category;
      const product = PRODUCTS[category].find(p => p.id === productId);
      
      State.selectedProduct = product;
      State.selectedDeviceType = category;
      
      updateStatus(`已选择: ${product.name} - 点击图纸布点 | 右键取消`);
    });
  });
}

// 设备放置点击处理
function handlePlaceDown(world) {
  if (!State.placingDevice) return;
  
  // 先检测是否点击了已有AP/设备 — 点击显示属性
  if (State.layers.aps) {
    for (const ap of State.aps) {
      const dist = Math.hypot(world.x - ap.x, world.y - ap.y);
      if (dist < 20 / State.zoom) {
        selectElement('ap', ap.id);
        return;
      }
    }
  }
  
  // 没点设备则布点
  if (!State.selectedProduct) {
    updateStatus('💡 请先在右侧选择产品');
    return;
  }
  
  placeDevice(world.x, world.y, State.selectedProduct, State.selectedDeviceType);
}

// 放置设备
async function placeDevice(wx, wy, product, deviceType) {
  const bands = [];
  const power = product.power;
  
  if (product.freq.includes('2.4G')) {
    bands.push({ freq: 2.4, power: power });
  }
  if (product.freq.includes('5G')) {
    bands.push({ freq: 5, power: power });
  }
  if (product.freq.includes('6G')) {
    bands.push({ freq: 6, power: power });
  }
  
  let newDevice;
  if (bands.length === 1) {
    newDevice = {
      id: 'local-' + Date.now(),
      x: wx, y: wy,
      type: deviceType,
      name: product.name,
      model: product.name,
      freq_ghz: bands[0].freq,
      tx_power_dbm: power,
      mount_type: 'ceiling',
      product_id: product.id,
      enabled: true,
    };
  } else if (bands.length > 1) {
    newDevice = {
      id: 'local-' + Date.now(),
      x: wx, y: wy,
      type: deviceType,
      name: product.name,
      model: product.name,
      bands: bands,
      tx_power_dbm: power,
      mount_type: 'ceiling',
      product_id: product.id,
      enabled: true,
    };
  } else {
    // 交换机等无WiFi设备
    newDevice = {
      id: 'local-' + Date.now(),
      x: wx, y: wy,
      type: deviceType,
      name: product.name,
      model: product.name,
      product_id: product.id,
      enabled: true,
    };
  }
  
  saveHistorySnapshot('放置' + deviceType);
  State.aps.push(newDevice);
  updateCountBadges();
  updateAPList();
  render();
  
  // 布点后自动打开右侧设备列表
  const rightPanel = document.getElementById('right-panel');
  if (rightPanel) {
    rightPanel.classList.add('open');
    // 更新右侧AP计数
    const rightCount = document.getElementById('ap-count-right');
    if (rightCount) rightCount.textContent = State.aps.length;
  }
  
  // 同步后端
  if (BACKEND_AVAILABLE) {
    try {
      const res = await apiPost('/devices', {
        project_id: State.projectId || 'default',
        x: wx.toString(),
        y: wy.toString(),
        device_type: deviceType,
        name: product.name,
        model: product.name,
        freq_bands: (newDevice.freqBands || ['2.4', '5']).join(','),
        power_dbm: power.toString(),
        angle: '0'
      });
      console.log('[API] 设备创建响应:', res);
      if (res && res.data && res.data[0]) newDevice.id = res.data[0].id;
    } catch (e) {
      console.error('[API] 设备创建失败:', e);
    }
  }
  
  requestHeatmapIfVisible();
  // 不自动弹出属性面板，只更新设备列表
  // 用户可继续布点或点击设备查看属性
  updateStatus(`已放置: ${product.name} — 继续布点或点击设备查看属性`);
}

// ============================================================
// 比例尺设置
// ============================================================
function handleScaleDown(world) {
  if (!State.scalePoint1) {
    State.scalePoint1 = { x: world.x, y: world.y };
    State.scalePending = true;
    updateStatus('点击第二个参考点');
  } else {
    State.scalePoint2 = { x: world.x, y: world.y };
    const pxDist = Math.hypot(
      State.scalePoint2.x - State.scalePoint1.x,
      State.scalePoint2.y - State.scalePoint1.y
    );
    
    // 如果是导入后的引导模式：弹出输入实际距离的弹窗
    if (State.scaleGuideMode) {
      State.guideScalePx = pxDist; // 保存像素距离
      showGuideScaleInputModal(pxDist);
    } else {
      // 普通比例尺工具
      document.getElementById('scale-px').value = Math.round(pxDist);
      showScaleModal(pxDist);
      State.scalePending = false;
      State.scalePoint1 = null;
    }
  }
}

// 引导模式：弹出输入实际距离的弹窗
function showGuideScaleInputModal(pxDist) {
  const modal = document.getElementById('modal-scale');
  modal.classList.remove('hidden');
  
  document.getElementById('modal-scale-value').value = '3';
  document.getElementById('scale-px').value = Math.round(pxDist);
  
  const realDist = (pxDist * State.scale_m_per_px).toFixed(2);
  updateStatus(`已选两点: ${Math.round(pxDist)}px ≈ ${realDist}m（当前比例）`);

  document.getElementById('modal-scale-confirm').onclick = async () => {
    modal.classList.add('hidden');
    const realM = parseFloat(document.getElementById('modal-scale-value').value);
    if (realM > 0 && pxDist > 0) {
      State.scale_m_per_px = realM / pxDist;
      await apiPost('/scales', {
        project_id: State.projectId || 'default',
        m_per_px: State.scale_m_per_px.toString()
      });
      updateScaleDisplay();
      requestHeatmapIfVisible();
    }
    State.scaleGuideMode = false;
    State.scalePending = false;
    State.scalePoint1 = null;
    State.scalePoint2 = null;
    setTool('select');
    updateStatus(`比例尺已设置: 1px = ${(State.scale_m_per_px * 100).toFixed(2)}cm`);
  };

  document.getElementById('modal-scale-cancel').onclick = () => {
    modal.classList.add('hidden');
    State.scaleGuideMode = false;
    State.scalePending = false;
    State.scalePoint1 = null;
    State.scalePoint2 = null;
    setTool('select');
  };
}

// 导入后立即弹出比例尺引导设置
function showScaleSetupModal() {
  const modal = document.getElementById('modal-scale-guide');
  if (!modal) return;
  modal.classList.remove('hidden');
  
  // 重置引导状态
  State.scalePoint1 = null;
  State.scalePoint2 = null;
  State.scaleGuideMode = true; // 标记为引导模式
  
  // 切换到比例尺工具模式
  setTool('scale');
  
  // 更新确认按钮文案
  const confirmBtn = document.getElementById('modal-scale-guide-confirm');
  const inputVal = document.getElementById('guide-scale-value');
  
  confirmBtn.textContent = '下一步：点击图纸';
  confirmBtn.onclick = () => {
    // 关闭弹窗，进入比例尺绘制模式
    modal.classList.add('hidden');
    updateStatus('📏 请在图纸上点击两个参考点（建议选择有标注尺寸的位置）');
    State.scaleGuideMode = true;
    // 已切换到 scale 工具，等待用户点击
  };
  
  // 跳过按钮
  document.getElementById('modal-scale-guide-cancel').onclick = () => {
    modal.classList.add('hidden');
    State.scaleGuideMode = false;
    setTool('select');
    updateStatus('已使用默认比例 5cm/px');
  };
}

function showScaleModal(pxDist) {
  const modal = document.getElementById('modal-scale');
  modal.classList.remove('hidden');

  document.getElementById('modal-scale-confirm').onclick = async () => {
    modal.classList.add('hidden');
    const realM = parseFloat(document.getElementById('modal-scale-value').value);
    if (realM > 0 && pxDist > 0) {
      State.scale_m_per_px = realM / pxDist;
      await apiPost('/scales', {
        project_id: State.projectId || 'default',
        m_per_px: State.scale_m_per_px.toString()
      });
      updateScaleDisplay();
      requestHeatmapIfVisible();
    }

    // 引导模式下完成后切回选择工具
    if (State.scaleGuideMode) {
      State.scaleGuideMode = false;
      setTool('select');
    }
  };

  document.getElementById('modal-scale-cancel').onclick = () => {
    modal.classList.add('hidden');
    if (State.scaleGuideMode) {
      State.scaleGuideMode = false;
      setTool('select');
    }
  };
}

function applyScaleFromInputs() {
  const realM = parseFloat(document.getElementById('scale-real').value);
  const px = parseFloat(document.getElementById('scale-px').value);
  if (realM > 0 && px > 0) {
    State.scale_m_per_px = realM / px;
    apiPost('/scales', {
      project_id: State.projectId || 'default',
      m_per_px: State.scale_m_per_px.toString()
    });
    updateScaleDisplay();
    requestHeatmapIfVisible();
  }
}

function updateScaleDisplay() {
  const cm = (State.scale_m_per_px * 100).toFixed(1);
  document.getElementById('scale-value').textContent = cm;
  document.getElementById('status-scale').textContent = `比例: ${cm}cm/px`;
  document.getElementById('scale-real').value = (State.scale_m_per_px * 100).toFixed(2);
}

// ============================================================
// 墙体识别（基于Canvas图像分析）
// ============================================================
async function detectWalls() {
  if (!State.floorplanImage) {
    alert('请先导入户型图');
    return;
  }

  const modal = document.getElementById('modal-detect');
  const msg = document.getElementById('detect-msg');
  const progress = document.getElementById('detect-progress');
  modal.classList.remove('hidden');

  msg.textContent = '二值化处理...';
  progress.style.width = '20%';

  const offscreen = document.createElement('canvas');
  const scale = Math.min(800 / State.floorplanW, 600 / State.floorplanH, 1);
  offscreen.width = Math.round(State.floorplanW * scale);
  offscreen.height = Math.round(State.floorplanH * scale);
  const octx = offscreen.getContext('2d');
  octx.drawImage(State.floorplanImage, 0, 0, offscreen.width, offscreen.height);

  progress.style.width = '40%';
  msg.textContent = '二值化 + 闭运算（3轮）...';
  await new Promise(resolve => setTimeout(resolve, 50));

  const imageData = octx.getImageData(0, 0, offscreen.width, offscreen.height);
  const walls = detectWallsFromImageData(imageData, 1 / scale);

  progress.style.width = '70%';
  msg.textContent = '行/列投影分析（找高密度墙线）...';
  await new Promise(resolve => setTimeout(resolve, 50));

  progress.style.width = '85%';
  msg.textContent = '扫描线段 + 聚类合并...';
  await new Promise(resolve => setTimeout(resolve, 50));

  progress.style.width = '95%';
  msg.textContent = `发现 ${walls.length} 条墙体线段...`;
  await new Promise(resolve => setTimeout(resolve, 100));

  if (walls.length > 0) {
    // 本地先渲染（离线模式必须）
    for (const w of walls) {
      State.walls.push({
        id: 'local-' + Date.now() + '-' + Math.random(),
        x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2,
        material_id: State.currentMaterial,
        material_name: MATERIALS[State.currentMaterial]?.name || '砖墙',
        atten_2g: MATERIALS[State.currentMaterial]?.atten2g || 12,
        atten_5g: MATERIALS[State.currentMaterial]?.atten5g || 17,
      });
    }
    updateCountBadges();
    render();

    // 尝试同步后端（可选，失败不影响本地）
    if (BACKEND_AVAILABLE) {
      await apiPost('/walls/batch', { walls });
      await loadFromBackend();
    }
  }

  progress.style.width = '100%';
  msg.textContent = `识别完成，共检测到 ${walls.length} 条墙体`;
  await new Promise(resolve => setTimeout(resolve, 800));
  modal.classList.add('hidden');
  requestHeatmapIfVisible();
}

/**
 * 户型图墙体识别（专业版 — 对标华为WLAN Planner / 锐捷地勘系统）
 *
 * 核心策略：
 * 1. 自适应二值化（处理不同深浅的户型图）
 * 2. 形态学闭运算（连接断线）
 * 3. 墙角检测（专业网规软件的核心：找拐点/墙角）
 * 4. 投影分析（行/列深色像素密度分布）
 * 5. 线段合并与过滤（去掉过短/不合理的线）
 */
function detectWallsFromImageData(imageData, scaleBack) {
  const { width, height, data } = imageData;

  // ============================================================
  // Step 1: 灰度化
  // ============================================================
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = (data[i*4] * 0.299 + data[i*4+1] * 0.587 + data[i*4+2] * 0.114) / 255;
  }

  // ============================================================
  // Step 2: 自适应二值化 — 两种策略并行，取交集更可靠
  // ============================================================

  // 策略A: Otsu自动阈值
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[Math.round(gray[i] * 255)]++;
  let total = 0, sum = 0;
  for (let i = 0; i < 256; i++) { total += hist[i]; sum += i * hist[i]; }
  let maxVar = 0, otsuT = 128, sumB = 0, wB = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (wB === 0) continue;
    sumB += t * hist[t];
    const wF = total - wB; if (wF === 0) break;
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > maxVar) { maxVar = v; otsuT = t; }
  }

  const binaryA = new Uint8Array(width * height);
  const tA = Math.round(otsuT * 0.45);
  for (let i = 0; i < gray.length; i++) {
    binaryA[i] = gray[i] * 255 < tA ? 1 : 0;
  }

  // 策略B: 全局暗像素检测（直接取深灰阈值 80）
  const binaryB = new Uint8Array(width * height);
  for (let i = 0; i < gray.length; i++) {
    binaryB[i] = gray[i] * 255 < 80 ? 1 : 0;
  }

  // 取交集（两种策略都认为是墙的像素更可靠）
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    binary[i] = (binaryA[i] && binaryB[i]) ? 1 : 0;
  }

  // ============================================================
  // Step 3: 形态学闭运算（3轮，逐次扩大核半径）
  // ============================================================
  let img = morphologicalClose(binary, width, height, 2);
  img = morphologicalClose(img, width, height, 3);
  img = morphologicalClose(img, width, height, 4);

  // ============================================================
  // Step 4: 行/列投影分析 — 统计每行每列的深色像素密度
  // 户型图的墙体在投影上形成高密度峰，家具/文字密度较低
  // ============================================================
  const rowDensity = new Float32Array(height);
  const colDensity = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    let cnt = 0;
    for (let x = 0; x < width; x++) if (img[y * width + x]) cnt++;
    rowDensity[y] = cnt / width;
  }
  for (let x = 0; x < width; x++) {
    let cnt = 0;
    for (let y = 0; y < height; y++) if (img[y * width + x]) cnt++;
    colDensity[x] = cnt / height;
  }

  // 计算均值和标准差，找出高密度行/列（墙体所在行）
  const rowMean = rowDensity.reduce((a, b) => a + b, 0) / height;
  const rowStd = Math.sqrt(rowDensity.reduce((s, v) => s + (v - rowMean) ** 2, 0) / height);
  const colMean = colDensity.reduce((a, b) => a + b, 0) / width;
  const colStd = Math.sqrt(colDensity.reduce((s, v) => s + (v - colMean) ** 2, 0) / width);

  // 墙线阈值：均值 + 1.2倍标准差（只保留高密度行/列）
  const rowThresh = rowMean + rowStd * 1.2;
  const colThresh = colMean + colStd * 1.2;

  // 找出高密度行（水平墙所在行）
  const wallRows = [];
  for (let y = 0; y < height; y++) {
    if (rowDensity[y] >= rowThresh) wallRows.push(y);
  }
  // 找出高密度列（垂直墙所在列）
  const wallCols = [];
  for (let x = 0; x < width; x++) {
    if (colDensity[x] >= colThresh) wallCols.push(x);
  }

  // ============================================================
  // Step 5: 从高密度行/列扫描，提取精确线段起止点
  // ============================================================
  const rawH = []; // 水平墙
  const rawV = []; // 垂直墙

  // 对每条高密度行，扫描深色段
  for (const y of wallRows) {
    let start = -1;
    for (let x = 0; x < width; x++) {
      const isDark = img[y * width + x] === 1;
      if (isDark && start < 0) start = x;
      if (!isDark && start >= 0) {
        if (x - start > 5) rawH.push({ x1: start, x2: x, y });
        start = -1;
      }
    }
    if (start >= 0 && width - start > 5) rawH.push({ x1: start, x2: width, y });
  }

  // 对每条高密度列，扫描深色段
  for (const x of wallCols) {
    let start = -1;
    for (let y = 0; y < height; y++) {
      const isDark = img[y * width + x] === 1;
      if (isDark && start < 0) start = y;
      if (!isDark && start >= 0) {
        if (y - start > 5) rawV.push({ y1: start, y2: y, x });
        start = -1;
      }
    }
    if (start >= 0 && height - start > 5) rawV.push({ y1: start, y2: height, x });
  }

  // ============================================================
  // Step 6: 合并相邻线段（聚类）
  // ============================================================
  const minWallLen = Math.min(width, height) * 0.04;
  // axisGap=3 更严格，防止同一面墙被识别为多条
  const mergedH = mergeLineSegments(rawH, 'y', 'x1', 'x2', minWallLen, 3, 10);
  const mergedV = mergeLineSegments(rawV, 'x', 'y1', 'y2', minWallLen, 3, 10);

  // ============================================================
  // Step 7: 过滤过短墙线，输出
  // ============================================================
  const walls = [];
  for (const s of mergedH) {
    if (s.x2 - s.x1 >= minWallLen) {
      walls.push({ x1: s.x1, y1: s.y, x2: s.x2, y2: s.y, dir: 'h' });
    }
  }
  for (const s of mergedV) {
    if (s.y2 - s.y1 >= minWallLen) {
      walls.push({ x1: s.x, y1: s.y1, x2: s.x, y2: s.y2, dir: 'v' });
    }
  }

  return walls.map(l => ({
    x1: Math.round(l.x1 * scaleBack),
    y1: Math.round(l.y1 * scaleBack),
    x2: Math.round(l.x2 * scaleBack),
    y2: Math.round(l.y2 * scaleBack),
    material_id: 'concrete',
  }));
}

/**
 * 形态学闭运算（先膨胀后腐蚀）
 */
function morphologicalClose(binary, width, height, radius) {
  const diam = radius * 2 + 1;

  // 膨胀
  const dilated = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (binary[y * width + x] === 1) {
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            if (nx >= 0 && nx < width) dilated[ny * width + nx] = 1;
          }
        }
      }
    }
  }

  // 腐蚀
  const result = new Uint8Array(width * height);
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let ok = true;
      outer:
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (!dilated[(y+dy) * width + (x+dx)]) { ok = false; break outer; }
        }
      }
      result[y * width + x] = ok ? 1 : 0;
    }
  }
  return result;
}

/**
 * 合并相邻平行线段（防止同一面墙被多次绘制）
 * 优化：更严格的合并条件，减少重复墙体
 */
function mergeLineSegments(segs, axisKey, startKey, endKey, minLen, axisGap, rangeGap) {
  if (segs.length === 0) return [];
  
  // 按位置排序
  const sorted = [...segs].sort((a, b) => a[axisKey] - b[axisKey]);
  const groups = [];
  let currentGroup = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentGroup[currentGroup.length - 1];
    const curr = sorted[i];
    const axisDiff = Math.abs(curr[axisKey] - prev[axisKey]);
    
    // 检查当前段是否与前一段在范围内有交集
    const prevStart = Math.min(prev[startKey], prev[endKey]);
    const prevEnd = Math.max(prev[startKey], prev[endKey]);
    const currStart = Math.min(curr[startKey], curr[endKey]);
    const currEnd = Math.max(curr[startKey], curr[endKey]);
    
    // 如果位置接近（axisDiff < axisGap）且范围有重叠，则合并
    const hasOverlap = !(currEnd < prevStart - rangeGap || currStart > prevEnd + rangeGap);
    
    if (axisDiff < axisGap && hasOverlap) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup);

  // 对每个组计算合并后的线段
  return groups.map(group => {
    const axisVals = group.map(s => s[axisKey]).sort((a, b) => a - b);
    // 取中位数位置
    const axisMed = axisVals[Math.floor(axisVals.length / 2)];
    // 范围取并集
    const allStarts = group.flatMap(s => [s[startKey], s[endKey]]);
    return {
      [axisKey]: axisMed,
      [startKey]: Math.min(...allStarts),
      [endKey]: Math.max(...allStarts),
    };
  });
}

// ============================================================
// 文件导入
// ============================================================
function onFileImport(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';

  const ext = file.name.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'svg'].includes(ext)) {
    importImageFile(file);
  } else if (ext === 'pdf') {
    importPDF(file);
  } else if (['dxf', 'dwg'].includes(ext)) {
    importCAD(file);
  } else {
    alert('不支持该格式，请使用 JPG/PNG/PDF/DXF');
  }
}

function importImageFile(file) {
  console.log('[导入] 开始导入文件:', file.name);
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      console.log('[导入] 图片加载完成:', img.width, 'x', img.height);
      State.floorplanImage = img;
      State.floorplanW = img.width;
      State.floorplanH = img.height;
      fitView();
      updateStatus(`已导入: ${file.name} (${img.width}×${img.height}px)`);
      console.log('[导入] 调用 render()');
      render();
      console.log('[导入] render() 完成');

      // 保存户型图到后端
      if (BACKEND_AVAILABLE) {
        saveFloorplanToBackend(img);
      }

      // ✅ 立即弹出比例尺设置对话框
      setTimeout(() => showScaleSetupModal(), 100);
    };
    img.onerror = () => console.error('[导入] 图片加载失败');
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// 保存户型图到后端
async function saveFloorplanToBackend(img) {
  const projectId = State.projectId || 'default';
  const imageData = img.src; // Base64 数据

  try {
    const result = await apiPost('/floorplans', {
      project_id: projectId,
      image_data: imageData,
      image_width: img.width,
      image_height: img.height,
      name: '户型图',
      offset_x: 0,
      offset_y: 0,
      scale_x: 1,
      scale_y: 1,
      rotation: 0
    });
    console.log('[API] 户型图已保存到后端', result);
  } catch (e) {
    console.warn('[API] 户型图保存失败:', e.message);
  }
}

function importPDF(file) {
  // 依赖pdf.js库（通过CDN引入）
  if (typeof pdfjsLib === 'undefined') {
    // 动态加载pdf.js
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      doImportPDF(file);
    };
    document.head.appendChild(script);
  } else {
    doImportPDF(file);
  }
}

async function doImportPDF(file) {
  updateStatus('正在加载PDF...');
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 2.0 });

  const offscreen = document.createElement('canvas');
  offscreen.width = viewport.width;
  offscreen.height = viewport.height;
  const octx = offscreen.getContext('2d');

  await page.render({ canvasContext: octx, viewport }).promise;

  const img = new Image();
  img.onload = () => {
    State.floorplanImage = img;
    State.floorplanW = img.width;
    State.floorplanH = img.height;
    fitView();
    updateStatus(`PDF导入完成: ${file.name} (${img.width}×${img.height}px)`);
    render();
  };
  img.src = offscreen.toDataURL();
}

function importCAD(file) {
  // CAD文件简化处理：提示用户转换为图片
  updateStatus(`CAD导入: ${file.name} — 建议先转换为PNG/PDF格式以获得最佳效果`);
  alert('CAD格式建议先导出为PDF或PNG，然后再导入。\n如需深度支持，请联系技术团队集成DXF解析库。');
}

// ============================================================
// 热力图
// ============================================================
function toggleHeatmap() {
  State.heatmapVisible = !State.heatmapVisible;
  const layerCb = document.getElementById('layer-heatmap');
  if (layerCb) layerCb.checked = State.heatmapVisible;
  State.layers.heatmap = State.heatmapVisible;
  document.getElementById('heatmap-legend').classList.toggle('hidden', !State.heatmapVisible);

  if (State.heatmapVisible) {
    requestHeatmap();
  }
  render();
}

// ============================================================
// 网线连接（布线）
// ============================================================
function toggleLinkMode() {
  State.linkDrawing = !State.linkDrawing;
  State.linkStartDevice = null;
  State.linkPreviewEnd = null;
  
  const btn = document.getElementById('btn-link');
  btn.classList.toggle('active', State.linkDrawing);
  
  if (State.linkDrawing) {
    setTool('link');
    updateStatus('🔗 布线模式：点击一个设备作为起点');
  } else {
    setTool('select');
    updateStatus('已退出布线模式');
  }
  render();
}

function handleLinkDown(world) {
  // 检查是否点击了设备
  const hitDevice = findDeviceAt(world);
  if (!hitDevice) {
    updateStatus('请点击一个设备（AP/交换机/路由器）作为起点');
    return;
  }
  
  if (!State.linkStartDevice) {
    // 第一步：选择起点
    State.linkStartDevice = hitDevice;
    updateStatus(`🔗 已选起点: ${hitDevice.name || hitDevice.type}，点击目标设备连接`);
  } else {
    // 第二步：选择终点
    if (hitDevice.id === State.linkStartDevice.id) {
      updateStatus('不能连接同一个设备，请点击其他设备');
      return;
    }
    
    // 检查是否已存在连接
    const existingLink = State.links.find(l => 
      (l.fromId === State.linkStartDevice.id && l.toId === hitDevice.id) ||
      (l.fromId === hitDevice.id && l.toId === State.linkStartDevice.id)
    );
    if (existingLink) {
      updateStatus('该连接已存在！');
      State.linkStartDevice = null;
      render();
      return;
    }
    
    // 创建新连接
    const newLink = {
      id: 'link-' + Date.now(),
      fromId: State.linkStartDevice.id,
      toId: hitDevice.id,
      from: { x: State.linkStartDevice.x, y: State.linkStartDevice.y },
      to: { x: hitDevice.x, y: hitDevice.y },
      route: null, // 稍后计算路径
    };
    
    // 计算简单直线路径（或A*避障路径）
    newLink.route = computeLinkRoute(newLink.from, newLink.to);
    
    saveHistorySnapshot('添加网线连接');
    State.links.push(newLink);
    updateLinkCount();
    updateStatus(`✅ 已连接: ${State.linkStartDevice.name || State.linkStartDevice.type} ↔ ${hitDevice.name || hitDevice.type}`);
    
    // 同步后端
    if (BACKEND_AVAILABLE) {
      apiPost('/links', {
        fromId: newLink.fromId,
        toId: newLink.toId,
      });
    }
    
    // 重置布线状态
    State.linkStartDevice = null;
    State.linkPreviewEnd = null;
    render();
  }
}

// 查找世界坐标处的设备
function findDeviceAt(world) {
  const hitRadius = 20 / State.zoom;
  for (const ap of State.aps) {
    const dist = Math.hypot(world.x - ap.x, world.y - ap.y);
    if (dist < hitRadius) return ap;
  }
  return null;
}

// 计算连接路径（简单直线或带避障）
function computeLinkRoute(from, to) {
  return [from, to]; // 简化版：直线连接
}

// 绘制所有连接线
function drawLinks() {
  if (!State.layers.links || State.links.length === 0) return;
  
  for (const link of State.links) {
    const fromDev = State.aps.find(a => a.id === link.fromId);
    const toDev = State.aps.find(a => a.id === link.toId);
    if (!fromDev || !toDev) continue;
    
    const fromX = fromDev.x, fromY = fromDev.y;
    const toX = toDev.x, toY = toDev.y;
    
    // 确定连接线颜色
    const lineColor = '#00cc66'; // 绿色网线
    
    // 绘制主线
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2 / State.zoom;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    
    // 绘制连接点（小圆圈）
    const dotR = 4 / State.zoom;
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(fromX, fromY, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(toX, toY, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
  
  // 绘制预览线（如果正在布线）
  if (State.linkStartDevice && State.linkPreviewEnd) {
    ctx.strokeStyle = '#00cc6680';
    ctx.lineWidth = 2 / State.zoom;
    ctx.setLineDash([5 / State.zoom, 5 / State.zoom]);
    ctx.beginPath();
    ctx.moveTo(State.linkStartDevice.x, State.linkStartDevice.y);
    ctx.lineTo(State.linkPreviewEnd.x, State.linkPreviewEnd.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// 更新连接计数
function updateLinkCount() {
  const countEl = document.getElementById('link-count');
  if (countEl) countEl.textContent = State.links.length;
}

// 删除连接的设备时同时删除相关连接
function removeLinksForDevice(deviceId) {
  State.links = State.links.filter(l => l.fromId !== deviceId && l.toId !== deviceId);
  updateLinkCount();
  updateLinkList();
}

// 更新连接列表UI
function updateLinkList() {
  const container = document.getElementById('link-list');
  const countEl = document.getElementById('link-count-panel');
  if (!container) return;
  
  if (countEl) countEl.textContent = State.links.length;
  
  if (State.links.length === 0) {
    container.innerHTML = '<div class="empty-hint-small">暂无连接</div>';
    return;
  }
  
  container.innerHTML = State.links.map(link => {
    const fromDev = State.aps.find(a => a.id === link.fromId);
    const toDev = State.aps.find(a => a.id === link.toId);
    const fromName = fromDev?.hostname || fromDev?.name || fromDev?.type || '未知';
    const toName = toDev?.hostname || toDev?.name || toDev?.type || '未知';
    
    return `
      <div class="link-item" data-link-id="${link.id}">
        <span class="link-icon">🔗</span>
        <span class="link-names">${fromName} ↔ ${toName}</span>
        <button class="link-delete-btn" onclick="deleteLink('${link.id}')">✕</button>
      </div>
    `;
  }).join('');
}

// 删除单个连接
async function deleteLink(linkId) {
  saveHistorySnapshot('删除网线连接');
  State.links = State.links.filter(l => l.id !== linkId);
  updateLinkCount();
  updateLinkList();
  render();
  
  if (BACKEND_AVAILABLE) {
    await apiDelete('/links/' + linkId);
  }
  
  updateStatus('已删除连接');
}

// 暴露deleteLink到全局
window.deleteLink = deleteLink;

function requestHeatmapIfVisible() {
  if (State.heatmapVisible) requestHeatmap();
}

// 拖动AP时使用实时低分辨率模式
function scheduleHeatmapUpdate() {
  if (!State.heatmapVisible) return;
  clearTimeout(State.heatmapTimer);
  
  if (State.draggingAP) {
    // 拖动中：立即更新（低分辨率，快速响应）
    requestHeatmapRT();
  } else {
    // 静止时：200ms防抖
    State.heatmapTimer = setTimeout(requestHeatmap, 200);
  }
}

// 实时热力图（低分辨率，快速计算）
async function requestHeatmapRT() {
  if (State.aps.length === 0) {
    State.heatmapData = null;
    render();
    return;
  }
  
  // 低分辨率步长（2倍于正常模式）
  const step = Math.max(8, Math.round(16 / State.zoom));
  
  const w = Math.round(State.canvasW);
  const h = Math.round(State.canvasH);
  
  const points = OfflineEngine.computeHeatmap({
    aps: State.aps,
    walls: State.walls,
    scaleMPerPx: State.scale_m_per_px,
    width: Math.round(w / State.zoom + 100),
    height: Math.round(h / State.zoom + 100),
    step: step,
    targetFreq: State.heatmapFreq,
  });
  
  if (!points) return;
  
  // 快速渲染
  const hc = State.heatmapCanvas;
  const heatRadius = step * 2.5;
  
  hc.width = w;
  hc.height = h;
  const hctx = hc.getContext('2d');
  hctx.clearRect(0, 0, w, h);
  
  for (const pt of points) {
    const cp = toCanvas(pt.x, pt.y);
    const alpha = Math.min(0.85, Math.max(0.15, (pt.rssi + 90) / 70));
    
    const grad = hctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, heatRadius);
    grad.addColorStop(0, `rgba(${pt.r},${pt.g},${pt.b},${alpha})`);
    grad.addColorStop(1, `rgba(${pt.r},${pt.g},${pt.b},0)`);
    hctx.fillStyle = grad;
    hctx.beginPath();
    hctx.arc(cp.x, cp.y, heatRadius, 0, Math.PI * 2);
    hctx.fill();
  }
  
  State.heatmapData = { points };
  render();
}

async function requestHeatmap() {
  if (State.aps.length === 0) {
    State.heatmapData = null;
    render();
    return;
  }

  const w = Math.round(State.canvasW);
  const h = Math.round(State.canvasH);
  const step = Math.max(4, Math.round(8 / State.zoom));

  let points = null;

  if (BACKEND_AVAILABLE) {
    // 后端计算（后端使用世界坐标）
    const res = await apiPost('/heatmap', { step, width: w, height: h });
    if (res && res.points) points = res.points;
  }

  // 降级：前端离线计算（使用世界坐标，再转画布坐标）
  if (!points) {
    // 如果有户型图，提取掩码只计算有效区域
    let floorplanMask = null;
    let floorplanOffset = null;
    
    if (State.floorplanImage) {
      const maskData = OfflineEngine.extractFloorplanMask(State.floorplanImage, 5);
      floorplanMask = {
        data: maskData,
        width: State.floorplanImage.width,
        height: State.floorplanImage.height
      };
      // 计算户型图在画布中的位置（世界坐标）
      floorplanOffset = { x: 0, y: 0 }; // 默认居中
    }
    
    points = OfflineEngine.computeHeatmap({
      aps: State.aps,
      walls: State.walls,
      scaleMPerPx: State.scale_m_per_px,
      width: Math.round(w / State.zoom + 100),
      height: Math.round(h / State.zoom + 100),
      step: Math.max(4, Math.round(step / State.zoom)),
      targetFreq: State.heatmapFreq,
      floorplanMask: floorplanMask,
      floorplanOffset: floorplanOffset,
    });
    // 离线引擎返回世界坐标
  }

  if (!points) return;

  // 热力图：使用高质量渲染策略
  // 1. 确保热力点半径覆盖到相邻点（重叠率 > 1.0）
  // 2. 使用 offscreen canvas 先渲染，再用高斯模糊消除像素感
  const hc = State.heatmapCanvas;
  
  // 计算合适的采样步长和热力半径
  // 热力半径 = step * 2.5（确保点与点重叠，消除间隙）
  const heatRadius = step * 2.5;
  
  hc.width = w;
  hc.height = h;
  const hctx = hc.getContext('2d');
  hctx.clearRect(0, 0, w, h);

  for (const pt of points) {
    // 将世界坐标转换到画布坐标
    const cp = toCanvas(pt.x, pt.y);
    const alpha = Math.min(0.85, Math.max(0.15, (pt.rssi + 90) / 70));

    // 热力渐变：从中心实心渐变到透明
    const grad = hctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, heatRadius);
    grad.addColorStop(0, `rgba(${pt.r},${pt.g},${pt.b},${alpha})`);
    grad.addColorStop(0.4, `rgba(${pt.r},${pt.g},${pt.b},${alpha * 0.6})`);
    grad.addColorStop(1, `rgba(${pt.r},${pt.g},${pt.b},0)`);
    hctx.fillStyle = grad;
    hctx.beginPath();
    hctx.arc(cp.x, cp.y, heatRadius, 0, Math.PI * 2);
    hctx.fill();
  }

  // 应用高斯模糊，让热力图更平滑
  if (heatRadius > 10) {
    hctx.filter = `blur(${heatRadius * 0.5}px)`;
    hctx.drawImage(hc, 0, 0);
    hctx.filter = 'none';
  }

  State.heatmapData = { points };
  render();

  // 更新信号分析
  updateSignalStats(points);
}

function updateSignalStats(points) {
  if (!points || points.length === 0) {
    document.getElementById('cov-bar-poor').style.width = '0%';
    document.getElementById('cov-bar-fair').style.width = '0%';
    document.getElementById('cov-bar-good').style.width = '0%';
    document.getElementById('cov-poor-pct').textContent = '0%';
    document.getElementById('cov-fair-pct').textContent = '0%';
    document.getElementById('cov-good-pct').textContent = '0%';
    document.getElementById('cov-summary').textContent = '暂无数据，请放置AP设备';
    return;
  }
  
  const rssi = points.map(p => p.rssi);
  const total = rssi.length;
  
  const poorCount = rssi.filter(r => r < -75).length;
  const fairCount = rssi.filter(r => r >= -75 && r <= -60).length;
  const goodCount = rssi.filter(r => r > -60).length;
  
  const poorPct = Math.round(poorCount / total * 100);
  const fairPct = Math.round(fairCount / total * 100);
  const goodPct = Math.round(goodCount / total * 100);
  
  document.getElementById('cov-bar-poor').style.width = poorPct + '%';
  document.getElementById('cov-bar-fair').style.width = fairPct + '%';
  document.getElementById('cov-bar-good').style.width = goodPct + '%';
  
  document.getElementById('cov-poor-pct').textContent = poorPct + '%';
  document.getElementById('cov-fair-pct').textContent = fairPct + '%';
  document.getElementById('cov-good-pct').textContent = goodPct + '%';
  
  const summary = document.getElementById('cov-summary');
  if (goodPct >= 80) {
    summary.textContent = '覆盖优秀，' + goodPct + '% 区域信号良好';
    summary.style.color = '#44bb44';
  } else if (goodPct >= 60) {
    summary.textContent = '覆盖一般，' + goodPct + '% 区域信号良好';
    summary.style.color = '#ff9944';
  } else {
    summary.textContent = '覆盖较差，建议增加AP设备';
    summary.style.color = '#ff5555';
  }
}

async function doSignalAnalysis() {
  await requestHeatmap();
}

// ============================================================
// 渲染循环
// ============================================================
function renderLoop() {
  // 只在需要时渲染（通过 render() 触发脏标记）
  requestAnimationFrame(renderLoop);
}

let _dirty = false;
function render() {
  _dirty = true;
  // 使用rAF合并渲染
  requestAnimationFrame(() => {
    if (!_dirty) return;
    _dirty = false;
    doDraw();
  });
}

function doDraw() {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // 背景
  ctx.fillStyle = '#111318';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(State.panX, State.panY);
  ctx.scale(State.zoom, State.zoom);

  // 网格
  drawGrid();

  // 户型图
  if (State.layers.floorplan && State.floorplanImage) {
    ctx.globalAlpha = 0.85;
    ctx.drawImage(State.floorplanImage, 0, 0);
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // 热力图（已经是画布坐标）
  if (State.layers.heatmap && State.heatmapData) {
    ctx.globalAlpha = 0.65;
    ctx.drawImage(State.heatmapCanvas, 0, 0);
    ctx.globalAlpha = 1;
  }

  ctx.save();
  ctx.translate(State.panX, State.panY);
  ctx.scale(State.zoom, State.zoom);

  // 墙体
  if (State.layers.walls) {
    drawWalls();
  }

  // 网线连接（绘制在设备和墙体之间）
  if (State.layers.links) {
    drawLinks();
  }

  // AP设备
  if (State.layers.aps) {
    drawAPs();
  }

  // 绘图预览
  drawPreview();

  ctx.restore();

  // Tooltip
  drawTooltip();
}

function drawGrid() {
  const step = 50; // 世界像素
  const startX = Math.floor(-State.panX / State.zoom / step) * step;
  const startY = Math.floor(-State.panY / State.zoom / step) * step;
  const endX = startX + canvas.width / State.zoom + step;
  const endY = startY + canvas.height / State.zoom + step;

  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = startX; x < endX; x += step) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y < endY; y += step) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();

  // 粗网格（每5格）
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let x = startX; x < endX; x += step * 5) {
    ctx.moveTo(x, startY);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y < endY; y += step * 5) {
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
  }
  ctx.stroke();
}

function drawWalls() {
  for (const wall of State.walls) {
    const isSelected = State.selectedType === 'wall' && State.selectedId === wall.id;
    const mat = MATERIALS[getMaterialId(wall)] || MATERIALS.brick;

    ctx.strokeStyle = isSelected ? '#4a9eff' : mat.color;
    ctx.lineWidth = isSelected ? 4 / State.zoom : 3 / State.zoom;
    ctx.lineCap = 'round';
    ctx.shadowColor = isSelected ? '#4a9eff' : 'transparent';
    ctx.shadowBlur = isSelected ? 8 : 0;

    ctx.beginPath();
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
    ctx.stroke();

    ctx.shadowBlur = 0;
  }
}

function getMaterialId(wall) {
  if (wall.material_id) return wall.material_id;
  // 反查
  for (const [id, mat] of Object.entries(MATERIALS)) {
    if (mat.name === wall.material_name) return id;
  }
  return 'brick';
}

function drawAPs() {
  for (const ap of State.aps) {
    const isSelected = State.selectedType === 'ap' && State.selectedId === ap.id;
    const isDragging = State.draggingAP && State.draggingAP.id === ap.id;
    
    // 获取设备类型信息
    const deviceType = ap.type || 'ap';
    const dev = DEVICE_TYPES[deviceType] || DEVICE_TYPES.ap;
    const icon = dev.icon;
    const devColor = ap.enabled ? dev.color : '#666';

    const cx = ap.x, cy = ap.y;
    const r = 14 / State.zoom; // 缩小设备图标半径

    // 外圈光晕（选中时）
    if (isSelected) {
      const gradient = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 2.2);
      gradient.addColorStop(0, `${devColor}60`);
      gradient.addColorStop(0.5, `${devColor}20`);
      gradient.addColorStop(1, `${devColor}00`);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // 卡通风格圆形底座（渐变效果）
    const bgGradient = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
    if (ap.enabled) {
      bgGradient.addColorStop(0, isSelected ? '#ffffff' : `${devColor}cc`);
      bgGradient.addColorStop(1, isSelected ? `${devColor}dd` : `${devColor}88`);
    } else {
      bgGradient.addColorStop(0, '#666');
      bgGradient.addColorStop(1, '#333');
    }
    
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bgGradient;
    ctx.fill();
    
    // 边框
    ctx.strokeStyle = isSelected ? '#fff' : (ap.enabled ? devColor : '#555');
    ctx.lineWidth = (isSelected ? 2.5 : 1.5) / State.zoom;
    ctx.stroke();

    // WiFi符号图标（卡通风格）
    ctx.fillStyle = ap.enabled ? (isSelected ? devColor : '#fff') : '#888';
    ctx.strokeStyle = ap.enabled ? (isSelected ? '#fff' : devColor) : '#666';
    ctx.lineWidth = 1.2 / State.zoom;
    
    // 绘制WiFi弧形符号
    const wifiR = r * 0.35;
    const wifiCenterY = cy - r * 0.1;
    
    // WiFi三弧形
    ctx.beginPath();
    ctx.arc(cx, wifiCenterY + r * 0.4, wifiR * 2.2, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(cx, wifiCenterY + r * 0.4, wifiR * 1.3, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.arc(cx, wifiCenterY + r * 0.4, wifiR * 0.5, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();

    // 中心小圆点
    ctx.beginPath();
    ctx.arc(cx, wifiCenterY + r * 0.4, wifiR * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = ap.enabled ? (isSelected ? '#fff' : devColor) : '#666';
    ctx.fill();

    // 信号波纹（仅AP/路由器显示）
    if (ap.enabled && !isDragging && dev.hasSignal) {
      const signalColor = deviceType === 'router' ? '#00ff88' : '#00aaff';
      for (let i = 1; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + i * 10 / State.zoom, 0, Math.PI * 2);
        ctx.strokeStyle = `${signalColor}${Math.max(0, Math.round((0.25 - i * 0.08) * 255)).toString(16).padStart(2, '0')}`;
        ctx.lineWidth = 1 / State.zoom;
        ctx.stroke();
      }
    }

    // 名称标签（优先显示hostname）
    const labelSize = Math.max(8, 9 / State.zoom);
    ctx.font = `bold ${labelSize}px 'Microsoft YaHei', sans-serif`;
    ctx.fillStyle = isSelected ? '#fff' : '#bbb';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const displayName = ap.hostname || ap.model || dev.nameCn;
    ctx.fillText(displayName, cx, cy + r + 4 / State.zoom);

    // 频段指示（仅AP/路由器显示）
    if (dev.hasSignal && ap.freq_ghz) {
      const freqLabel = ap.freq_ghz >= 5 ? '5G' : '2.4G';
      ctx.fillStyle = ap.freq_ghz >= 5 ? '#ff8800' : '#00dd88';
      ctx.font = `bold ${Math.max(7, 9 / State.zoom)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(freqLabel, cx, cy - r - 2 / State.zoom);
    }
  }
}

function drawPreview() {
  const mouse = State._mouseWorld;
  if (!mouse) return;

  // 墙体绘制预览
  if (State.tool === 'wall' && State.wallDrawing && State.wallStart) {
    let end = { ...mouse };
    if (_shiftHeld) end = snapAngle(State.wallStart, end);

    const mat = MATERIALS[State.currentMaterial] || MATERIALS.brick;
    ctx.strokeStyle = mat.color;
    ctx.lineWidth = 2 / State.zoom;
    ctx.setLineDash([6 / State.zoom, 4 / State.zoom]);
    ctx.beginPath();
    ctx.moveTo(State.wallStart.x, State.wallStart.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 起点标记
    ctx.fillStyle = '#4a9eff';
    ctx.beginPath();
    ctx.arc(State.wallStart.x, State.wallStart.y, 4 / State.zoom, 0, Math.PI * 2);
    ctx.fill();

    // 长度标注
    const dist = Math.hypot(end.x - State.wallStart.x, end.y - State.wallStart.y);
    const realM = (dist * State.scale_m_per_px).toFixed(2);
    const midX = (State.wallStart.x + end.x) / 2;
    const midY = (State.wallStart.y + end.y) / 2;
    ctx.fillStyle = '#fff';
    ctx.font = `${11 / State.zoom}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${realM}m`, midX, midY - 4 / State.zoom);
  }

  // 比例尺绘制预览
  if (State.tool === 'scale' && State.scalePoint1) {
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 2 / State.zoom;
    ctx.setLineDash([5 / State.zoom, 3 / State.zoom]);
    ctx.beginPath();
    ctx.moveTo(State.scalePoint1.x, State.scalePoint1.y);
    ctx.lineTo(mouse.x, mouse.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#ffcc00';
    ctx.beginPath();
    ctx.arc(State.scalePoint1.x, State.scalePoint1.y, 4 / State.zoom, 0, Math.PI * 2);
    ctx.fill();

    const px = Math.hypot(mouse.x - State.scalePoint1.x, mouse.y - State.scalePoint1.y);
    ctx.fillStyle = '#fff';
    ctx.font = `${11 / State.zoom}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(px)}px`, (State.scalePoint1.x + mouse.x) / 2,
                 (State.scalePoint1.y + mouse.y) / 2 - 6 / State.zoom);
  }

  // 布点预览（当已选产品时）
  if (State.tool === 'place' && State.selectedProduct) {
    ctx.strokeStyle = '#4a9eff';
    ctx.fillStyle = 'rgba(74,158,255,0.2)';
    ctx.lineWidth = 1.5 / State.zoom;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 16 / State.zoom, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${12 / State.zoom}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(State.selectedProduct.name || 'AP', mouse.x, mouse.y);
  }
}

function drawTooltip() {
  if (!State.hoveredAP) return;
  const ap = State.hoveredAP;
  const cp = toCanvas(ap.x, ap.y);

  const lines = [
    ap.model,
    `频段: ${ap.freq_ghz >= 5 ? '5GHz' : '2.4GHz'}`,
    `功率: ${ap.tx_power_dbm}dBm`,
    `安装: ${{ ceiling: '吸顶', wall: '壁挂', desktop: '桌面' }[ap.mount_type] || ap.mount_type}`,
  ];

  const pad = 8, lineH = 16;
  const w2 = 120, h2 = lines.length * lineH + pad * 2;
  let tx = cp.x + 20, ty = cp.y - h2 / 2;
  if (tx + w2 > canvas.width) tx = cp.x - w2 - 20;
  if (ty < 0) ty = 0;

  ctx.fillStyle = 'rgba(20,24,32,0.92)';
  ctx.strokeStyle = '#4a9eff';
  ctx.lineWidth = 1;
  const r = 6;
  ctx.beginPath();
  ctx.roundRect(tx, ty, w2, h2, r);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#fff';
  ctx.font = 'bold 12px Microsoft YaHei, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    if (i === 0) ctx.font = 'bold 12px Microsoft YaHei, sans-serif';
    else ctx.font = '11px Microsoft YaHei, sans-serif';
    ctx.fillStyle = i === 0 ? '#4a9eff' : '#ccc';
    ctx.fillText(line, tx + pad, ty + pad + i * lineH);
  });
}

// ============================================================
// 选中/属性面板（右侧侧边栏）
// ============================================================
function selectElement(type, id) {
  State.selectedType = type;
  State.selectedId = id;

  const rightPanel = document.getElementById('right-panel');
  const panelTitle = document.getElementById('right-panel-title');
  const panelContent = document.getElementById('right-panel-content');
  const deviceSection = document.getElementById('device-list-section');

  if (!type) {
    // 没有选中任何元素，关闭右侧面板
    rightPanel.classList.remove('open');
    return;
  }

  // 选中元素时隐藏设备列表，只显示属性面板
  if (deviceSection) deviceSection.style.display = 'none';

  // 打开右侧面板
  rightPanel.classList.add('open');

  if (type === 'wall') {
    panelTitle.textContent = '🧱 墙体属性';
    const wall = State.walls.find(w => w.id === id);
    if (wall) panelContent.innerHTML = getWallPanelHTML(wall);
    attachWallPanelEvents(wall);
  } else if (type === 'ap') {
    panelTitle.textContent = '📶 AP设备属性';
    const ap = State.aps.find(a => a.id === id);
    if (ap) panelContent.innerHTML = getAPPanelHTML(ap);
    attachAPPanelEvents(ap);
  }

  // 高亮AP列表
  document.querySelectorAll('.ap-list-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });

  render();
}

// 关闭右侧面板
document.getElementById('btn-close-right-panel').addEventListener('click', () => {
  document.getElementById('right-panel').classList.remove('open');
  selectElement(null, null);
});

function getWallPanelHTML(wall) {
  const matId = getMaterialId(wall);
  const matOptions = Object.entries(MATERIALS).map(([id, m]) =>
    `<option value="${id}" ${id === matId ? 'selected' : ''}>${m.name}</option>`
  ).join('');
  const lenM = (Math.hypot(wall.x2-wall.x1, wall.y2-wall.y1) * State.scale_m_per_px).toFixed(2);

  return `
    <div class="form-group">
      <label class="form-label">材质</label>
      <select id="wall-material-select" class="form-input">${matOptions}</select>
    </div>
    <div class="form-group">
      <label class="form-label">长度</label>
      <span class="form-value">${lenM} m</span>
    </div>
    <div class="form-group">
      <label class="form-label">衰减 (2.4G)</label>
      <span class="form-value">${wall.atten_2g || '--'} dB</span>
    </div>
    <div class="form-group">
      <label class="form-label">衰减 (5G)</label>
      <span class="form-value">${wall.atten_5g || '--'} dB</span>
    </div>
    <div class="form-group">
      <label class="form-label">衰减 (6G)</label>
      <span class="form-value">${wall.atten_6g || '--'} dB</span>
    </div>
    <div class="btn-row">
      <button class="btn btn-danger btn-small" id="btn-delete-wall">删除墙体</button>
    </div>
  `;
}

function attachWallPanelEvents(wall) {
  setTimeout(() => {
    const select = document.getElementById('wall-material-select');
    if (select) {
      select.addEventListener('change', () => {
        const newMatId = select.value;
        wall.material_id = newMatId;
        wall.material_name = MATERIALS[newMatId]?.name;
        wall.atten_2g = MATERIALS[newMatId]?.atten2g;
        wall.atten_5g = MATERIALS[newMatId]?.atten5g;
        wall.atten_6g = MATERIALS[newMatId]?.atten6g;
        apiPut('/walls/' + wall.id, { material_id: newMatId });
        requestHeatmapIfVisible();
        render();
        // 刷新面板
        document.getElementById('right-panel-content').innerHTML = getWallPanelHTML(wall);
        attachWallPanelEvents(wall);
      });
    }

    const btnDelete = document.getElementById('btn-delete-wall');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => deleteWall(wall.id));
    }
  }, 10);
}

function getAPPanelHTML(ap) {
  const hasBand24 = ap.bands?.some(b => Math.abs(b.freq - 2.4) < 0.5) || Math.abs((ap.freq_ghz || 2.4) - 2.4) < 0.5;
  const hasBand5 = ap.bands?.some(b => Math.abs(b.freq - 5) < 0.5) || ap.freq_ghz === 5;
  const hasBand6 = ap.bands?.some(b => Math.abs(b.freq - 6) < 0.5);

  return `
    <div class="form-group">
      <label class="form-label">主机名</label>
      <input type="text" id="ap-hostname" class="form-input" value="${ap.hostname || ''}" placeholder="如: AP-Lobby-01">
    </div>
    <div class="form-group">
      <label class="form-label">型号</label>
      <input type="text" id="ap-model" class="form-input" value="${ap.model || 'Generic AP'}">
    </div>
    <div class="form-group">
      <label class="form-label">安装方式</label>
      <select id="ap-mount" class="form-input">
        <option value="ceiling" ${ap.mount_type === 'ceiling' ? 'selected' : ''}>吸顶</option>
        <option value="wall" ${ap.mount_type === 'wall' ? 'selected' : ''}>壁挂</option>
        <option value="desktop" ${ap.mount_type === 'desktop' ? 'selected' : ''}>桌面</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">频段</label>
      <div class="freq-checkboxes">
        <label><input type="checkbox" id="edit-freq-24g" ${hasBand24 ? 'checked' : ''}> 2.4G</label>
        <label><input type="checkbox" id="edit-freq-5g" ${hasBand5 ? 'checked' : ''}> 5G</label>
        <label><input type="checkbox" id="edit-freq-6g" ${hasBand6 ? 'checked' : ''}> 6G</label>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">发射功率</label>
      <div class="input-with-unit">
        <input type="number" id="ap-power" class="form-input" value="${ap.tx_power_dbm || 20}" min="1" max="30">
        <span class="unit">dBm</span>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">启用</label>
      <input type="checkbox" id="ap-enabled" ${ap.enabled !== false ? 'checked' : ''}>
    </div>
    <div class="form-group">
      <label class="form-label">位置</label>
      <span class="form-value">(${ap.x.toFixed(0)}, ${ap.y.toFixed(0)})</span>
    </div>
    <div class="btn-row">
      <button class="btn btn-primary btn-small" id="btn-apply-ap">应用</button>
      <button class="btn btn-danger btn-small" id="btn-delete-ap">删除</button>
    </div>
  `;
}

function attachAPPanelEvents(ap) {
  setTimeout(() => {
    const btnApply = document.getElementById('btn-apply-ap');
    if (btnApply) {
      btnApply.addEventListener('click', () => {
        ap.hostname = document.getElementById('ap-hostname').value;
        ap.model = document.getElementById('ap-model').value;
        ap.mount_type = document.getElementById('ap-mount').value;
        ap.tx_power_dbm = parseFloat(document.getElementById('ap-power').value);
        ap.enabled = document.getElementById('ap-enabled').checked;

        // 更新频段
        const bands = [];
        if (document.getElementById('edit-freq-24g').checked) {
          bands.push({ freq: 2.4, power: ap.tx_power_dbm });
        }
        if (document.getElementById('edit-freq-5g').checked) {
          bands.push({ freq: 5, power: ap.tx_power_dbm });
        }
        if (document.getElementById('edit-freq-6g').checked) {
          bands.push({ freq: 6, power: ap.tx_power_dbm });
        }

        if (bands.length === 1) {
          ap.freq_ghz = bands[0].freq;
          ap.bands = null;
        } else {
          ap.freq_ghz = null;
          ap.bands = bands;
        }

        apiPut('/devices/' + ap.id, {
          hostname: ap.hostname, model: ap.model, mount_type: ap.mount_type,
          freq_ghz: ap.freq_ghz, tx_power_dbm: ap.tx_power_dbm,
          enabled: ap.enabled, bands: ap.bands,
        });
        updateAPList();
        requestHeatmapIfVisible();
        render();
        // 刷新面板
        document.getElementById('right-panel-content').innerHTML = getAPPanelHTML(ap);
        attachAPPanelEvents(ap);
      });
    }

    const btnDelete = document.getElementById('btn-delete-ap');
    if (btnDelete) {
      btnDelete.addEventListener('click', () => {
        deleteAP(ap.id);
        document.getElementById('right-panel').classList.remove('open');
      });
    }
  }, 10);
}

async function deleteWall(id) {
  saveHistorySnapshot('删除墙体');
  State.walls = State.walls.filter(w => w.id !== id);
  selectElement(null, null);
  updateCountBadges();
  updateWallList();
  render();
  await apiDelete('/walls/' + id);
  requestHeatmapIfVisible();
}

async function deleteAP(id) {
  saveHistorySnapshot('删除设备');
  State.aps = State.aps.filter(a => a.id !== id);
  // 同时删除该设备相关的连接
  removeLinksForDevice(id);
  selectElement(null, null);
  updateCountBadges();
  updateAPList();
  updateLinkList();
  render();
  await apiDelete('/devices/' + id);
  requestHeatmapIfVisible();
}

function deleteSelected() {
  if (State.selectedType === 'wall') deleteWall(State.selectedId);
  else if (State.selectedType === 'ap') deleteAP(State.selectedId);
}

// ============================================================
// 面板设置
// ============================================================
function setupPanels() {
  // 右侧面板关闭
  document.getElementById('btn-close-right-panel').addEventListener('click', () => {
    document.getElementById('right-panel').classList.remove('open');
    selectElement(null, null);
  });

  // 墙体列表面板关闭
  document.getElementById('btn-close-wall-panel').addEventListener('click', () => {
    document.getElementById('wall-list-panel').classList.remove('open');
  });

  // 信号面板拖拽
  initSignalPanelDrag();
}

// ============================================================
// 信号分析面板拖拽
// ============================================================
let _dragSignal = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };

function initSignalPanelDrag() {
  const panel = document.getElementById('signal-panel-mini');
  const dragBar = document.getElementById('signal-panel-drag');

  dragBar.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    _dragSignal.active = true;
    _dragSignal.startX = e.clientX;
    _dragSignal.startY = e.clientY;
    const rect = panel.getBoundingClientRect();
    _dragSignal.origX = rect.left;
    _dragSignal.origY = rect.top;
    panel.style.transition = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!_dragSignal.active) return;
    const dx = e.clientX - _dragSignal.startX;
    const dy = e.clientY - _dragSignal.startY;
    panel.style.left = (_dragSignal.origX + dx) + 'px';
    panel.style.top = (_dragSignal.origY + dy) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  });

  document.addEventListener('mouseup', () => {
    if (_dragSignal.active) {
      _dragSignal.active = false;
      panel.style.transition = '';
    }
  });
}

function renderMaterialList() {
  // 渲染材质快捷选择到墙体面板
  const container = document.getElementById('material-list-compact');
  if (!container) return;
  container.innerHTML = '';
  for (const [id, mat] of Object.entries(MATERIALS)) {
    const chip = document.createElement('div');
    chip.className = 'material-chip' + (id === State.currentMaterial ? ' active' : '');
    chip.innerHTML = `<span class="material-swatch" style="background:${mat.color}"></span>${mat.name}`;
    chip.addEventListener('click', () => {
      State.currentMaterial = id;
      document.querySelectorAll('.material-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
    container.appendChild(chip);
  }
}

// ============================================================
// AP列表更新
// ============================================================
function updateAPList() {
  const list = document.getElementById('ap-list');
  const rightCount = document.getElementById('ap-count-right');
  const deviceSection = document.getElementById('device-list-section');
  if (rightCount) rightCount.textContent = State.aps.length;
  
  if (!list) return;
  list.innerHTML = '';
  
  if (State.aps.length === 0) {
    // 无设备时隐藏设备列表区域
    if (deviceSection) deviceSection.style.display = 'none';
    return;
  }
  
  // 有设备时显示设备列表区域
  if (deviceSection) deviceSection.style.display = 'block';
  
  State.aps.forEach(ap => {
    const item = document.createElement('div');
    item.className = 'ap-item' + (State.selectedId === ap.id ? ' selected' : '');
    item.dataset.id = ap.id;
    
    // 设备类型颜色
    const typeColor = { ap: '#4a9eff', switch: '#ff9f4a', router: '#4aff9f' }[ap.type] || '#4a9eff';
    const typeIcon = { ap: '📶', switch: '🔌', router: '🌐' }[ap.type] || '📶';
    const freqText = ap.bands 
      ? ap.bands.map(b => b.freq + 'G').join('/') + 'GHz'
      : (ap.freq_ghz ? ap.freq_ghz + 'GHz' : '无WiFi');
    
    // 显示hostname或model
    const displayName = ap.hostname || ap.model || ap.name || 'AP';
    
    item.innerHTML = `
      <div class="ap-icon" style="background:${typeColor}22;border:1.5px solid ${typeColor}66;color:${typeColor}">${typeIcon}</div>
      <div class="ap-info">
        <div class="ap-name">${displayName}</div>
        <div class="ap-detail">${freqText} · ${ap.tx_power_dbm || 0}dBm</div>
      </div>
      <div class="ap-status ${ap.enabled ? '' : 'disabled'}"></div>
    `;
    item.addEventListener('click', () => {
      selectElement('ap', ap.id);
      // 居中跳转到AP
      const cp = toCanvas(ap.x, ap.y);
      State.panX += canvas.width / 2 - cp.x;
      State.panY += canvas.height / 2 - cp.y;
      render();
    });
    list.appendChild(item);
  });
  
  // 同步到顶部计数
  const topCount = document.getElementById('ap-count');
  if (topCount) topCount.textContent = State.aps.length;
  
  // 更新设备清单汇总
  updateDeviceInventory();
  
  // 更新工具栏徽章
  updateInventoryBadge();
}

// 设备清单汇总
function updateDeviceInventory() {
  const invEl = document.getElementById('device-inventory');
  if (!invEl) return;
  
  if (State.aps.length === 0) {
    invEl.innerHTML = '<div class="inventory-empty">暂无设备数据</div>';
    return;
  }
  
  // 分类统计
  const stats = {
    ap: { count: 0, models: {} },
    switch: { count: 0, models: {} },
    router: { count: 0, models: {} }
  };
  
  State.aps.forEach(device => {
    const type = device.type || 'ap';
    if (!stats[type]) stats[type] = { count: 0, models: {} };
    stats[type].count++;
    const model = device.model || device.name || device.product_id || '未知型号';
    if (!stats[type].models[model]) {
      stats[type].models[model] = { count: 0, device: device };
    }
    stats[type].models[model].count++;
  });
  
  // 生成表格
  let html = `
    <table class="inventory-table">
      <thead>
        <tr>
          <th>类型</th>
          <th>型号</th>
          <th>数量</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  const typeConfig = {
    ap: { icon: '📶', color: '#4a9eff', label: 'AP' },
    switch: { icon: '🔌', color: '#ff9f4a', label: '交换机' },
    router: { icon: '🌐', color: '#4aff9f', label: '路由器' }
  };
  
  for (const [type, data] of Object.entries(stats)) {
    if (data.count === 0) continue;
    for (const [model, info] of Object.entries(data.models)) {
      const config = typeConfig[type] || typeConfig.ap;
      html += `
        <tr>
          <td>
            <div class="inv-type">
              <span class="inv-icon" style="background:${config.color}22;color:${config.color}">${config.icon}</span>
              ${config.label}
            </div>
          </td>
          <td>${model}</td>
          <td class="inv-total">${info.count}</td>
        </tr>
      `;
    }
  }
  
  html += `
      </tbody>
      <tfoot>
        <tr>
          <td colspan="2" style="text-align:right;font-weight:bold;">合计</td>
          <td class="inv-total">${State.aps.length}</td>
        </tr>
      </tfoot>
    </table>
  `;
  
  // 如果有网线连接，添加连接统计
  if (State.links.length > 0) {
    html += `
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
        <div class="section-title" style="margin-bottom:4px;">网线连接</div>
        <div style="font-size:12px;color:var(--text);">
          共 ${State.links.length} 条网线连接
        </div>
      </div>
    `;
  }
  
  invEl.innerHTML = html;
}

// 显示设备清单面板
function showDeviceInventoryPanel() {
  if (State.aps.length === 0) {
    updateStatus('暂无设备，请先布点');
    return;
  }
  
  // 打开右侧面板
  document.getElementById('right-panel').classList.add('open');
  document.getElementById('right-panel-title').textContent = '📋 设备清单';
  document.getElementById('right-panel-content').innerHTML = '';
  
  // 显示设备清单和连接列表
  document.getElementById('device-list-section').style.display = 'block';
  document.getElementById('device-inventory-section').style.display = 'block';
  document.getElementById('link-list-section').style.display = 'block';
  
  // 更新数据
  updateDeviceInventory();
  updateAPList();
  updateLinkList();
}

// 更新设备清单徽章
function updateInventoryBadge() {
  const badge = document.getElementById('inventory-badge');
  if (State.aps.length > 0) {
    badge.textContent = State.aps.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// 导出设备清单
function exportDeviceInventory() {
  if (State.aps.length === 0) {
    alert('暂无设备数据可导出');
    return;
  }
  
  // 生成CSV内容
  let csv = '类型,型号,发射功率(dBm),频段,安装方式,启用状态\n';
  
  State.aps.forEach(device => {
    const type = { ap: 'AP', switch: '交换机', router: '路由器' }[device.type] || 'AP';
    const model = device.model || device.name || device.product_id || '';
    const power = device.tx_power_dbm || device.tx_power || 0;
    const freq = device.bands 
      ? device.bands.map(b => typeof b === 'object' ? b.freq + 'G' : b + 'G').join('/')
      : (device.freq_ghz ? device.freq_ghz + 'G' : '无');
    const mount = { ceiling: '吸顶', wall: '壁挂', desktop: '桌面' }[device.mount_type] || '吸顶';
    const enabled = device.enabled ? '是' : '否';
    csv += `"${type}","${model}",${power},"${freq}","${mount}","${enabled}"\n`;
  });
  
  // 添加汇总行
  csv += `\n汇总:\n`;
  csv += `设备总数,${State.aps.length}\n`;
  csv += `网线连接数,${State.links.length}\n`;
  csv += `墙体数量,${State.walls.length}\n`;
  
  // 下载文件
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `设备清单_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  
  updateStatus('✅ 设备清单已导出');
}

function updateCountBadges() {
  document.getElementById('wall-count').textContent = State.walls.length;
  document.getElementById('ap-count').textContent = State.aps.length;
  // 如果墙体面板打开，刷新列表
  if (document.getElementById('wall-list-panel').classList.contains('open')) {
    renderWallListPanel();
  }
}

// ============================================================
// 视图控制
// ============================================================
function adjustZoom(factor) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const newZoom = Math.max(0.1, Math.min(10, State.zoom * factor));
  State.panX = cx - (cx - State.panX) * (newZoom / State.zoom);
  State.panY = cy - (cy - State.panY) * (newZoom / State.zoom);
  State.zoom = newZoom;
  document.getElementById('zoom-display').textContent = Math.round(State.zoom * 100) + '%';
  render();
}

function fitView() {
  if (State.floorplanImage) {
    const scaleX = canvas.width / State.floorplanW;
    const scaleY = canvas.height / State.floorplanH;
    State.zoom = Math.min(scaleX, scaleY) * 0.9;
    State.panX = (canvas.width - State.floorplanW * State.zoom) / 2;
    State.panY = (canvas.height - State.floorplanH * State.zoom) / 2;
  } else {
    State.zoom = 1;
    State.panX = 0;
    State.panY = 0;
  }
  document.getElementById('zoom-display').textContent = Math.round(State.zoom * 100) + '%';
  render();
}

// ============================================================
// 清空/导出
// ============================================================
async function clearAll() {
  if (!confirm('确定清空所有墙体和AP设备吗？此操作不可撤销。')) return;
  State.walls = [];
  State.aps = [];
  State.links = [];
  State.floorplanImage = null;
  State.heatmapData = null;
  selectElement(null, null);
  updateCountBadges();
  updateAPList();
  updateLinkList();
  render();
  await apiPost('/clear', {});
}

function exportReport() {
  updateStatus('正在准备报告数据...');
  
  // 准备报告数据
  const reportData = prepareReportData();
  
  // 尝试调用后端 PDF 服务
  if (BACKEND_AVAILABLE) {
    fetch(`${API_BASE}/report/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reportData)
    })
    .then(res => res.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `无线网络规划报告_${new Date().toLocaleDateString().replace(/\//g, '-')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      updateStatus('✅ 报告已导出 (PDF)');
    })
    .catch(err => {
      console.warn('PDF服务不可用，使用本地导出:', err);
      exportReportLocal(reportData);
    });
  } else {
    // 后端不可用时使用本地导出
    exportReportLocal(reportData);
  }
}

// 准备报告数据（生成各图表的 base64 图像）
function prepareReportData() {
  // 生成设备布点图画布
  const deviceCanvas = createDeviceCanvas(false);
  const deviceImage = deviceCanvas.toDataURL('image/png');
  
  // 生成布线图画布（包含设备+连线）
  const wiringCanvas = createDeviceCanvas(true);
  const wiringImage = wiringCanvas.toDataURL('image/png');
  
  // 生成热力图画布
  let heatmapImage = null;
  if (State.heatmapCanvas) {
    heatmapImage = State.heatmapCanvas.toDataURL('image/png');
  }
  
  // 户型图
  let floorplanImage = null;
  if (State.floorplanImage) {
    floorplanImage = State.floorplanImage.src;
  }
  
  return {
    project_name: '无线网络规划项目',
    floorplan_image: floorplanImage,
    device_canvas: deviceImage,
    wiring_canvas: wiringImage,
    heatmap_canvas: heatmapImage,
    devices: State.aps.map(ap => ({
      id: ap.id,
      type: ap.type || 'ap',
      name: ap.name || ap.model || ap.product_id || '',
      model: ap.model || ap.name || ap.product_id || '',
      tx_power_dbm: ap.tx_power_dbm || ap.tx_power || 20,
      freq_ghz: ap.freq_ghz,
      bands: ap.bands,
      mount_type: ap.mount_type || 'ceiling',
      x: ap.x,
      y: ap.y,
      enabled: ap.enabled !== false
    })),
    links: State.links.map(link => ({
      id: link.id,
      fromId: link.fromId,
      toId: link.toId,
      route: link.route
    })),
    walls: State.walls.map(wall => ({
      id: wall.id,
      x1: wall.x1,
      y1: wall.y1,
      x2: wall.x2,
      y2: wall.y2,
      material_id: wall.material_id
    })),
    scale: State.scale_m_per_px,
    generated_at: new Date().toISOString()
  };
}

// 创建设备布点/布线画布
function createDeviceCanvas(showLinks = false) {
  const w = State.floorplanImage ? State.floorplanImage.width : 1000;
  const h = State.floorplanImage ? State.floorplanImage.height : 800;
  
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  
  // 绘制底图
  if (State.floorplanImage) {
    ctx.drawImage(State.floorplanImage, 0, 0);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  
  // 绘制墙体
  ctx.strokeStyle = '#666666';
  ctx.lineWidth = 3;
  State.walls.forEach(wall => {
    ctx.beginPath();
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
    ctx.stroke();
  });
  
  // 绘制设备
  const typeColors = { ap: '#4a9eff', switch: '#ff9f4a', router: '#4aff9f' };
  
  State.aps.forEach((ap, i) => {
    const color = typeColors[ap.type] || '#4a9eff';
    
    // 绘制圆形背景
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ap.x, ap.y, 15, 0, Math.PI * 2);
    ctx.fill();
    
    // 绘制编号
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Microsoft YaHei';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((i + 1).toString(), ap.x, ap.y);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    
    // 绘制设备名称
    ctx.fillStyle = '#333333';
    ctx.font = '11px Microsoft YaHei';
    const label = ap.name || ap.model || `设备${i + 1}`;
    ctx.fillText(label, ap.x + 20, ap.y + 4);
  });
  
  // 如果显示连线，绘制网线连接
  if (showLinks && State.links.length > 0) {
    ctx.strokeStyle = '#888888';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    
    State.links.forEach(link => {
      if (link.route && link.route.length > 1) {
        ctx.beginPath();
        ctx.moveTo(link.route[0].x, link.route[0].y);
        for (let i = 1; i < link.route.length; i++) {
          ctx.lineTo(link.route[i].x, link.route[i].y);
        }
        ctx.stroke();
      }
    });
    
    ctx.setLineDash([]);
  }
  
  return canvas;
}

// 本地导出（当后端不可用时）- 使用 jsPDF 生成多页 PDF
async function exportReportLocal(reportData) {
  updateStatus('正在生成报告...');
  
  // 等待 jsPDF 加载
  if (typeof jspdf === 'undefined') {
    console.error('jsPDF 未加载');
    updateStatus('❌ jsPDF 库未加载');
    return;
  }
  
  const { jsPDF } = jspdf;
  
  // A4 横向
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });
  
  const pageW = 297;  // A4 landscape width
  const pageH = 210;   // A4 landscape height
  
  // ========== 第1页：封面 ==========
  pdf.setFillColor(26, 29, 35);
  pdf.rect(0, 0, pageW, pageH, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(28);
  pdf.text('无线网络规划报告', pageW / 2, 80, { align: 'center' });
  pdf.setFontSize(14);
  pdf.text(`生成日期: ${new Date().toLocaleDateString('zh-CN')}`, pageW / 2, 105, { align: 'center' });
  pdf.setFontSize(12);
  pdf.setTextColor(170, 170, 170);
  const apCount = reportData.devices.filter(d => d.type === 'ap').length;
  const switchCount = reportData.devices.filter(d => d.type === 'switch').length;
  const routerCount = reportData.devices.filter(d => d.type === 'router').length;
  pdf.text(`AP: ${apCount} 台  交换机: ${switchCount} 台  路由器: ${routerCount} 台`, pageW / 2, 130, { align: 'center' });
  pdf.text(`网线连接: ${reportData.links.length} 条  墙体: ${reportData.walls.length} 段`, pageW / 2, 145, { align: 'center' });
  
  // ========== 第2页：设备布点图 ==========
  pdf.addPage();
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, pageW, 20, 'F');
  pdf.setTextColor(50, 50, 50);
  pdf.setFontSize(16);
  pdf.text('1. 设备布点图', 10, 14);
  
  if (reportData.device_canvas) {
    try {
      pdf.addImage(reportData.device_canvas, 'PNG', 10, 25, pageW - 20, (pageW - 20) * 0.6);
    } catch (e) {
      console.warn('设备布点图添加失败:', e);
    }
  }
  
  // ========== 第3页：网线布线图 ==========
  pdf.addPage();
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, pageW, 20, 'F');
  pdf.setTextColor(50, 50, 50);
  pdf.setFontSize(16);
  pdf.text('2. 网线布线图', 10, 14);
  
  if (reportData.wiring_canvas) {
    try {
      pdf.addImage(reportData.wiring_canvas, 'PNG', 10, 25, pageW - 20, (pageW - 20) * 0.6);
    } catch (e) {
      console.warn('布线图添加失败:', e);
    }
  }
  
  // ========== 第4页：信号仿真图 ==========
  if (reportData.heatmap_canvas) {
    pdf.addPage();
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, 0, pageW, 20, 'F');
    pdf.setTextColor(50, 50, 50);
    pdf.setFontSize(16);
    pdf.text('3. 信号覆盖仿真图', 10, 14);
    
    try {
      pdf.addImage(reportData.heatmap_canvas, 'PNG', 10, 25, pageW - 20, (pageW - 20) * 0.6);
    } catch (e) {
      console.warn('热力图添加失败:', e);
    }
    
    pdf.setFontSize(10);
    pdf.setTextColor(100, 100, 100);
    pdf.text('信号强度: 红色(强) → 绿色(弱)', 10, pageH - 10);
  }
  
  // ========== 第5页：设备清单 ==========
  pdf.addPage();
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, pageW, 20, 'F');
  pdf.setTextColor(50, 50, 50);
  pdf.setFontSize(16);
  pdf.text('4. 设备清单', 10, 14);
  
  // 统计设备
  const stats = {};
  reportData.devices.forEach(device => {
    const model = device.model || device.name || '未知型号';
    if (!stats[model]) {
      stats[model] = { count: 0, type: device.type, power: device.tx_power_dbm || 0, freq: '' };
    }
    stats[model].count++;
    if (device.bands) {
      if (typeof device.bands[0] === 'object') {
        stats[model].freq = device.bands.map(b => b.freq + 'G').join('/');
      } else {
        stats[model].freq = device.bands.map(b => b + 'G').join('/');
      }
    } else if (device.freq_ghz) {
      stats[model].freq = device.freq_ghz + 'G';
    }
  });
  
  // 绘制表格
  const tableX = 20;
  const colWidths = [60, 35, 25, 45, 30];
  const rowH = 8;
  const typeLabels = { ap: 'AP', switch: '交换机', router: '路由器' };
  
  // 表头
  let yOffset = 30;
  pdf.setFillColor(240, 240, 240);
  pdf.rect(tableX, yOffset, 195, rowH, 'F');
  pdf.setFontSize(10);
  pdf.setTextColor(50, 50, 50);
  
  let xPos = tableX + 3;
  const headers = ['型号', '类型', '数量', '频段', '功率(dBm)'];
  headers.forEach((h, i) => {
    pdf.text(h, xPos, yOffset + 5.5);
    xPos += colWidths[i];
  });
  yOffset += rowH;
  
  // 数据行
  let row = 0;
  for (const [model, info] of Object.entries(stats)) {
    if (row % 2 === 1) {
      pdf.setFillColor(249, 249, 249);
      pdf.rect(tableX, yOffset, 195, rowH, 'F');
    }
    pdf.setTextColor(50, 50, 50);
    xPos = tableX + 3;
    pdf.text(model.substring(0, 20), xPos, yOffset + 5.5);
    xPos += colWidths[0];
    pdf.text(typeLabels[info.type] || 'AP', xPos, yOffset + 5.5);
    xPos += colWidths[1];
    pdf.text(info.count.toString(), xPos, yOffset + 5.5);
    xPos += colWidths[2];
    pdf.text(info.freq || '-', xPos, yOffset + 5.5);
    xPos += colWidths[3];
    pdf.text((info.power || 0).toString(), xPos, yOffset + 5.5);
    yOffset += rowH;
    row++;
  }
  
  // 合计行
  yOffset += 5;
  pdf.setFillColor(232, 244, 255);
  pdf.rect(tableX, yOffset, 195, rowH, 'F');
  pdf.setTextColor(50, 50, 50);
  pdf.setFontSize(11);
  pdf.text('合计: ' + reportData.devices.length + ' 台', tableX + 3, yOffset + 5.5);
  
  // ========== 第6页：统计信息 ==========
  pdf.addPage();
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, pageW, 20, 'F');
  pdf.setTextColor(50, 50, 50);
  pdf.setFontSize(16);
  pdf.text('5. 项目统计', 10, 14);
  
  yOffset = 40;
  pdf.setFontSize(12);
  
  const statsItems = [
    `设备总数: ${reportData.devices.length} 台`,
    `  - AP设备: ${apCount} 台`,
    `  - 交换机: ${switchCount} 台`,
    `  - 路由器: ${routerCount} 台`,
    ``,
    `网线连接数: ${reportData.links.length} 条`,
    `墙体数量: ${reportData.walls.length} 段`,
    ``,
    `比例尺: ${(reportData.scale * 100).toFixed(2)} cm/px`,
    `生成时间: ${new Date().toLocaleString('zh-CN')}`
  ];
  
  statsItems.forEach(item => {
    pdf.text(item, 20, yOffset);
    yOffset += 10;
  });
  
  // 下载 PDF
  updateStatus('正在导出报告...');
  pdf.save(`无线网络规划报告_${new Date().toLocaleDateString().replace(/\//g, '-')}.pdf`);
  updateStatus('✅ 报告已导出 (PDF格式)');
}


// ============================================================
// 状态栏
// ============================================================
function updateStatus(msg) {
  document.getElementById('status-msg').textContent = msg;
}

// ============================================================
// 实时信号强度提示
// ============================================================
function updateSignalTooltip(worldX, worldY) {
  const tooltip = document.getElementById('signal-tooltip');
  const tooltipRssi = document.getElementById('signal-tooltip-rssi');
  const tooltipLevel = document.getElementById('signal-tooltip-level');
  
  if (!State.scale_m_per_px) {
    tooltip.classList.add('hidden');
    return;
  }
  
  // 获取鼠标位置的信号强度
  const draggingAP = State.draggingAP;
  if (!draggingAP) {
    tooltip.classList.add('hidden');
    return;
  }
  
  const rssi = OfflineEngine.getRSSIAtPoint(
    draggingAP.x, draggingAP.y,
    worldX, worldY,
    draggingAP, State.scale_m_per_px, State.walls
  );
  
  // 更新显示
  tooltipRssi.textContent = rssi.toFixed(1) + ' dBm';
  tooltipRssi.style.color = rssi > -50 ? '#ff4444' : rssi > -60 ? '#ffaa00' : rssi > -70 ? '#44bb44' : '#4488ff';
  
  // 更新等级
  tooltipLevel.textContent = rssi > -50 ? '极好' : rssi > -60 ? '良好' : rssi > -70 ? '一般' : '较差';
  tooltipLevel.className = 'signal-level ' + (
    rssi > -50 ? 'signal-excellent' : 
    rssi > -60 ? 'signal-good' : 
    rssi > -70 ? 'signal-fair' : 'signal-poor'
  );
  
  // 跟随鼠标
  const { cx, cy } = getCanvasPosFromWorld(worldX, worldY);
  tooltip.style.left = (cx + 20) + 'px';
  tooltip.style.top = (cy + 20) + 'px';
  tooltip.classList.remove('hidden');
}

function hideSignalTooltip() {
  document.getElementById('signal-tooltip').classList.add('hidden');
}

function getCanvasPosFromWorld(worldX, worldY) {
  return {
    cx: worldX * State.zoom + State.panX,
    cy: worldY * State.zoom + State.panY
  };
}

// ============================================================
// 主题管理
// ============================================================
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'dark';
  setTheme(savedTheme);
  // 页面加载时也设置body背景
  document.body.style.background = savedTheme === 'light' ? '#f5f7fa' : '#1a1d23';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  
  // 设置 body 背景
  document.body.style.background = theme === 'light' ? '#f5f7fa' : '#1a1d23';
  
  // 强制刷新画布背景
  const canvas = document.getElementById('canvas-container');
  if (canvas) {
    canvas.style.backgroundColor = theme === 'light' ? '#fafbfc' : '#12151a';
  }
  
  // 更新图层下拉菜单样式
  const layerMenu = document.getElementById('layer-dropdown-menu');
  if (layerMenu) {
    if (theme === 'light') {
      layerMenu.style.background = '#ffffff';
      layerMenu.style.borderColor = '#d1d5db';
      layerMenu.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)';
    } else {
      layerMenu.style.background = '#22262e';
      layerMenu.style.borderColor = '#3a4050';
      layerMenu.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)';
    }
  }
  
  // 更新图层选项样式
  const layerOptions = document.querySelectorAll('.layer-option');
  layerOptions.forEach(opt => {
    if (theme === 'light') {
      opt.style.color = '#1a1d23';
      opt.style.background = 'transparent';
    } else {
      opt.style.color = '#e8e8e8';
      opt.style.background = 'transparent';
    }
  });
  
  const icon = document.querySelector('.theme-icon');
  if (icon) {
    icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  }
}

function toggleTheme() {
  const current = document.body.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
}

// ============================================================
// 启动
// ============================================================
function bootstrap() {
  console.log('[网规工具] 启动中...');
  // 初始化主题
  initTheme();
  // 初始化离屏热力图画布
  State.heatmapCanvas = document.createElement('canvas');
  init();
  console.log('[网规工具] 初始化完成, tool:', State.tool);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  // DOM已经加载完成（HTTP服务启动前页面可能已缓存）
  bootstrap();
}
