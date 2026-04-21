# 网规工具 (Network Planning Tool)

无线网络规划与仿真工具，支持户型图导入、墙体识别、AP覆盖热力图仿真。

---

## 📋 目录

- [功能特性](#功能特性)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [前端实现](#前端实现)
- [后端实现](#后端实现)
- [数据结构](#数据结构)
- [墙体识别算法](#墙体识别算法)
- [信号传播模型](#信号传播模型)
- [API 接口](#api-接口)
- [键盘快捷键](#键盘快捷键)
- [常见问题](#常见问题)

---

## 功能特性

| 功能 | 说明 |
|------|------|
| 📁 导入户型图 | 支持 JPG / PNG / PDF / DXF 等格式 |
| 🔍 墙体识别 | 基于自适应二值化+投影分析自动识别墙体线段 |
| ✏️ 手动绘墙 | 点击绘制线段，Shift 约束水平/垂直/45° |
| 🧱 墙体材质 | 混凝土/砖墙/木质/玻璃/石膏板/金属，含频段衰减参数 |
| 📏 比例尺 | 两点标定实际距离，精确换算空间尺寸 |
| 📶 放置AP | 支持 AP/交换机/路由器，支持 2.4G/5G/6G 多频段 |
| 🌡️ 热力图 | 实时信号强度热力图，拖动AP即时更新 |
| 📊 信号分析 | 覆盖率（>-70dBm）、最强/最弱/平均信号统计 |
| 💾 导出报告 | 导出PNG格式规划图 |

---

## 系统架构

```
network-planner/
├── frontend/                      # 前端（HTML5 Canvas + 原生JS）
│   ├── index.html                 # 主界面
│   ├── style.css                  # 样式（CSS变量，支持亮/暗主题）
│   ├── app.js                     # 核心逻辑（3900+ 行）
│   ├── offline_engine.js          # 离线信号计算引擎
│   └── data_service.js           # 数据服务（支持后端/localStorage）
│
├── backend/                       # C++ 后端（SQLite + WinSock）
│   ├── CMakeLists.txt             # CMake 构建配置
│   ├── build.bat                  # Windows 编译脚本
│   ├── include/
│   │   ├── server_config.h        # 服务配置 & SQL 建表语句
│   │   ├── database.h/cpp         # SQLite 数据库管理
│   │   └── api_handlers.h/cpp     # RESTful API 路由与处理
│   └── src/
│       └── main_server.cpp        # WinSock HTTP 服务器
│
├── docs/
│   └── DATABASE_DESIGN.md         # 数据库设计文档
│
└── start.bat                      # 一键启动脚本
```

### 技术亮点

- **离线优先**：后端不可用时自动降级到浏览器端计算
- **实时热力图**：拖动 AP 时 200ms 防抖更新
- **智能识别**：多策略融合的墙体识别算法

---

## 快速开始

### 方式一：纯前端模式（无需编译，开箱即用）

```bash
cd network-planner/frontend
python -m http.server 8080
# 浏览器访问: http://localhost:8080
```

### 方式二：前后端完整模式

**1. 编译后端（CMake）**

```bash
cd backend
mkdir build && cd build
cmake .. -G "MinGW Makefiles"   # 或 "Visual Studio 16 2019"
cmake --build . --config Release
```

**2. 编译后端（原有 build.bat）**

```bash
cd backend
build.bat
```

**3. 编译后端（原有 build.bat）**

```bash
cd backend
build.bat
```

**4. Linux/macOS 编译**

```bash
# Ubuntu/Debian
sudo apt install build-essential cmake libsqlite3-dev
cd backend
chmod +x build.sh
./build.sh

# macOS
brew install cmake sqlite3
cd backend
./build.sh

# 运行
./build/bin/network_planner_server 8766
```

**5. 启动服务**

```bash
# Windows
start.bat
# 或手动启动
cd backend
network_planner_server.exe 8766

# Linux/macOS
./build/bin/network_planner_server 8766
```

服务运行：
- 前端 HTTP: `http://localhost:8080`
- 后端 API: `http://localhost:8766`

---

### 交叉编译（可选）

**在 Windows 上编译 Linux AMD64 版本：**

1. 安装 MSYS2 + MinGW-w64 交叉编译工具链：
   ```bash
   pacman -S mingw-w64-x86_64-cross-binutils mingw-w64-x86_64-cross-gcc
   ```

2. 使用工具链文件编译：
   ```bash
   cd backend
   mkdir build && cd build
   cmake .. -DCMAKE_TOOLCHAIN_FILE=../cmake/linux_amd64_toolchain.cmake
   cmake --build . --config Release
   ```

3. 将 `build/bin/network_planner_server` 复制到 Linux 服务器运行

---

## 前端实现

### 技术栈

- **HTML5 Canvas** - 底层绘图，无框架依赖
- **原生 JavaScript** - ES6+，无外部依赖
- **CSS 变量** - 主题切换、响应式设计

### 核心模块

```
app.js 主要模块（约 3900 行）
├── 状态管理 (State 对象)
│   ├── tool: 当前工具 (select/wall/place/scale/link)
│   ├── walls: 墙体数组
│   ├── devices: 设备数组（AP/交换机/路由器）
│   ├── links: 网线连接数组
│   ├── floorplanImage: 户型图图像
│   ├── scale_m_per_px: 比例尺（米/像素）
│   └── zoom/panX/panY: 视图变换
│
├── 绘图系统 (render 函数)
│   ├── 坐标系：世界坐标 ↔ 屏幕坐标转换
│   ├── 渲染顺序：户型图 → 墙体 → 热力图 → 设备 → 连接线
│   └── 裁剪区域：只渲染可视范围内的元素
│
├── 交互系统
│   ├── 鼠标事件：点击/拖拽/滚轮缩放
│   ├── 键盘快捷键：V/W/A/S/L 等
│   └── 手势约束：Shift 限定角度
│
└── 数据同步
    ├── 后端 API 调用（apiGet/apiPost）
    └── localStorage 兜底
```

### 数据服务（data_service.js）

```javascript
// 启动时检测后端可用性
if (BACKEND_AVAILABLE) {
    await loadFromBackend();  // 从服务器加载
} else {
    await loadFromLocalStorage();  // 从浏览器存储加载
}

// 操作后自动保存
async function saveWall(wall) {
    if (BACKEND_AVAILABLE) {
        await apiPost('/walls', wall);  // 保存到服务器
    }
    saveToLocalStorage();  // 同时保存到 localStorage
}
```

### 主题切换

```javascript
// setTheme('dark' | 'light')
// 1. 设置 document.documentElement.setAttribute('data-theme', theme)
// 2. JS 设置 canvas.style.backgroundColor
// 3. CSS 变量 [data-theme="light"] 自动生效
```

---

## 后端实现

### 技术栈

- **C++17** - 现代 C++ 特性
- **SQLite3** - 轻量级数据库
- **WinSock** - Windows 网络编程
- **CMake** - 跨平台构建

### 服务器架构

```
main_server.cpp
├── WinSock 初始化
├── 创建 TCP Socket (端口 8766)
├── listen() 监听连接
└── 多线程处理请求 (每连接一线程)
    ├── readRequest() 解析 HTTP 请求
    ├── ApiRouter.handle() 路由分发
    └── sendResponse() 返回 JSON
```

### 数据库设计

```
6 张核心表：
├── projects        项目
├── floorplans      户型图（Base64 编码图像）
├── walls           墙体（坐标 + 材质）
├── devices         设备（AP/交换机/路由器）
├── links           网线连接
└── scales          比例尺

1 张配置表：
└── config          键值对配置
```

详细设计见 [docs/DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md)

---

## 数据结构

### 墙体 (Wall)

```typescript
interface Wall {
    id: string;              // UUID
    x1: number;             // 起点 X（像素）
    y1: number;             // 起点 Y（像素）
    x2: number;             // 终点 X（像素）
    y2: number;             // 终点 Y（像素）
    thickness: number;      // 厚度（像素，默认 10）
    material_id: string;    // 材质 ID (concrete/brick/wood/glass/...)
    material_name: string;  // 材质名称
    atten_2g: number;       // 2.4GHz 衰减 (dB)
    atten_5g: number;       // 5GHz 衰减 (dB)
    atten_6g: number;       // 6GHz 衰减 (dB)
}
```

### 设备 (Device)

```typescript
interface Device {
    id: string;             // UUID
    device_type: 'ap' | 'switch' | 'router';
    model: string;         // 型号（如 TL-XAP3000）
    name: string;          // 自定义名称
    x: number;             // X 坐标
    y: number;             // Y 坐标
    mount_type: 'ceiling' | 'wall' | 'desktop';  // 安装方式
    mount_angle: number;   // 朝向角度（度）
    freq_bands: string[];  // 支持频段 ['2.4G', '5G', '6G']
    power_dbm: number;     // 发射功率 (dBm，默认 20)
}
```

### 比例尺 (Scale)

```typescript
interface Scale {
    x1: number;           // 参考点1 X
    y1: number;           // 参考点1 Y
    x2: number;           // 参考点2 X
    y2: number;           // 参考点2 Y
    real_distance_cm: number;  // 实际距离（厘米）
    m_per_px: number;     // 每像素等于多少米
}
```

### 热力图数据

```javascript
// 热点网格数据（32x32 采样点）
{
    width: number,       // 网格宽度
    height: number,      // 网格高度
    data: Float32Array   // RSSI 值数组（每个点一个 dBm 值）
}
```

### 材质参数

| 材质 ID | 名称 | 2.4GHz 衰减 | 5GHz 衰减 | 6GHz 衰减 |
|---------|------|------------|----------|----------|
| concrete | 混凝土承重墙 | 15 dB | 20 dB | 23 dB |
| brick | 砖墙 | 12 dB | 17 dB | 20 dB |
| wood | 木质隔断 | 4 dB | 6 dB | 8 dB |
| glass | 玻璃幕墙 | 3 dB | 5 dB | 7 dB |
| drywall | 石膏板 | 3.5 dB | 5.5 dB | 7 dB |
| metal | 金属 | 20 dB | 25 dB | 28 dB |
| floor | 楼板/天花板 | 18 dB | 22 dB | 25 dB |

---

## 墙体识别算法

### 算法概述

采用**自适应二值化 + 投影分析**策略，对标专业网规软件（华为WLAN Planner、锐捷地勘系统）。

### 处理流程

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: 灰度化                                                  │
│  RGB → 灰度 (公式: Y = 0.299R + 0.587G + 0.114B)                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: 自适应二值化（双策略取交集）                             │
│  ┌─────────────────┐    ┌─────────────────┐                     │
│  │ 策略A: Otsu自动  │    │ 策略B: 全局阈值 │                     │
│  │ 计算灰度直方图   │    │ 取灰度值<80的   │                     │
│  │ 找最大类间方差   │    │ 像素            │                     │
│  │ 阈值 = Otsu*0.45│    │                 │                     │
│  └────────┬────────┘    └────────┬────────┘                     │
│           └──────────┬───────────┘                              │
│                      ↓                                           │
│           [ 取交集: A && B ]                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: 形态学闭运算（3轮，逐次扩大核半径）                      │
│  目的：连接断线，填补细小缝隙                                     │
│  操作：膨胀 → 腐蚀                                               │
│  核半径：2 → 3 → 4                                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: 行/列投影分析                                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 统计每行/列的深色像素密度                                    ││
│  │ 墙体所在行/列形成高密度峰                                    ││
│  │ 阈值 = 均值 + 1.2 * 标准差                                   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  行投影示意图:                                                   │
│  ████                          ████                              │
│  ████  ████  ████████████      ████                              │
│  ████  ████  ████████████  ████████  ████                        │
│  ████████████████████████████████████████                        │
│  ████████████████████████████████████████ ← 高密度行（墙体）    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: 扫描线段起止点                                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 从高密度行扫描：                                           ││
│  │   遇到深色像素开始 → 遇到空白结束 → 记录 [x1, x2]          ││
│  │ 从高密度列扫描：                                           ││
│  │   遇到深色像素开始 → 遇到空白结束 → 记录 [y1, y2]          ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 6: 线段合并（聚类）                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 相邻且方向一致的线段合并                                    ││
│  │ 合并条件:                                                   ││
│  │   - 方向相同（水平/垂直）                                   ││
│  │   - 位置接近（间隔 < 3像素）                                ││
│  │   - 长度接近（长度差 < 10像素）                             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 7: 过滤输出                                               │
│  过滤条件: 长度 >= 图像尺寸 * 4%                                 │
│  输出: Wall[]                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 关键函数

```javascript
// 形态学闭运算
function morphologicalClose(binary, width, height, radius) {
    // 膨胀（扩大白色区域）
    const dilated = dilate(binary, width, height, radius);
    // 腐蚀（恢复形状）
    const eroded = erode(dilated, width, height, radius);
    return eroded;
}

// 线段合并
function mergeLineSegments(segments, axis, startKey, endKey, minLen, gap, lenDiff) {
    // 1. 按位置排序
    // 2. 遍历合并相邻线段
    // 3. 返回合并后的线段数组
}
```

### 算法优势

| 特性 | 说明 |
|------|------|
| 抗噪 | 双策略取交集减少误识别 |
| 鲁棒 | Otsu 自动适应不同深浅的户型图 |
| 智能 | 投影分析过滤文字和家具 |
| 精确 | 线段合并避免一面墙被切成多段 |

---

## 信号传播模型

### 对数距离路径损耗模型 (Log-Distance Path Loss)

```
RSSI = TxPower - PL(d) - WallAttenuation

其中：
  PL(d) = FSPL(1m) + 10 × n × log₁₀(d)
  n = 3.0（室内传播指数）

FSPL(1m) = 20 × log₁₀(4π/λ)
```

### 计算流程

```
┌─────────────────────────────────────────────┐
│  1. 计算距离                                 │
│     distM = sqrt((px-ap.x)² + (py-ap.y)²)   │
│              × scale_m_per_px               │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  2. 路径损耗                                 │
│     PL = 20×log₁₀(4π/λ) + 10×3×log₁₀(distM) │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  3. 墙体衰减（射线法）                       │
│     检查 AP → 目标点 线段与所有墙体相交      │
│     每穿过一面墙累加对应材质的衰减           │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  4. 安装方式衰减（可选）                      │
│     ceiling: 全向，向下略强                   │
│     wall: 定向，垂直墙面方向最强             │
│     desktop: 接近全向                        │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  5. 最终 RSSI                                │
│     RSSI = 20 - PL - wallAtten - mountAtten │
└─────────────────────────────────────────────┘
```

### 信号等级

| 等级 | RSSI 范围 | 描述 |
|------|----------|------|
| 极好 | > -50 dBm | 信号强度优秀 |
| 好 | -50 ~ -60 dBm | 可高速上网 |
| 一般 | -60 ~ -70 dBm | 正常浏览 |
| 差 | -70 ~ -80 dBm | 可能掉线 |
| 极差 | < -80 dBm | 基本不可用 |

---

## API 接口

### 健康检查

```
GET /api/health

Response:
{
    "code": 0,
    "message": "success",
    "data": { "status": "ok", "version": "1.0.0" }
}
```

### 项目

```
GET    /api/projects          # 获取所有项目
POST   /api/projects          # 创建项目
GET    /api/projects/:id      # 获取项目详情
DELETE /api/projects/:id      # 删除项目
POST   /api/projects/:id/save # 保存项目全量数据
GET    /api/projects/:id/load # 加载项目全量数据
```

### 户型图

```
GET    /api/floorplans?project_id=xxx  # 获取户型图列表
POST   /api/floorplans               # 上传户型图
PUT    /api/floorplans/:id           # 更新户型图
DELETE /api/floorplans/:id           # 删除户型图
```

### 墙体

```
GET    /api/walls?project_id=xxx      # 获取墙体列表
POST   /api/walls                     # 创建墙体
POST   /api/walls/batch               # 批量创建墙体
PUT    /api/walls/:id                 # 更新墙体
DELETE /api/walls/:id                 # 删除墙体
```

### 设备

```
GET    /api/devices?project_id=xxx    # 获取设备列表
POST   /api/devices                   # 创建设备
PUT    /api/devices/:id               # 更新设备
DELETE /api/devices/:id               # 删除设备
```

### 连接

```
GET    /api/links?project_id=xxx      # 获取连接列表
POST   /api/links                     # 创建连接
PUT    /api/links/:id                 # 更新连接
DELETE /api/links/:id                 # 删除连接
```

### 比例尺

```
GET    /api/scales?project_id=xxx     # 获取比例尺
POST   /api/scales                    # 创建/更新比例尺
```

### 配置

```
GET    /api/config?key=xxx            # 获取配置项
POST   /api/config                    # 设置配置项
GET    /api/config                    # 获取所有配置
```

---

## 键盘快捷键

| 按键 | 功能 |
|------|------|
| V | 选择/移动工具 |
| W | 绘制墙体 |
| P | 放置设备 |
| L | 绘制网线连接 |
| S | 设置比例尺 |
| Shift | 绘墙时约束角度（水平/垂直/45°） |
| Esc | 取消当前操作 |
| Delete/Backspace | 删除选中元素 |
| Ctrl+Z | 撤回 |
| Ctrl+Y | 复原 |
| 鼠标滚轮 | 缩放 |
| 中键拖拽 | 平移视图 |
| 双击空白 | 适应视图 |

---

## 常见问题

### Q: 编译失败，提示找不到 sqlite3.h

**Windows**: 下载 [SQLite Precompiled](https://sqlite.org/download.html)，或使用 `build.bat` 自动下载。

**Linux/macOS**:
```bash
sudo apt install libsqlite3-dev   # Ubuntu
brew install sqlite3               # macOS
```

### Q: 后端启动失败，端口被占用

```bash
# 查看端口占用
netstat -ano | findstr :8766

# 杀死进程或更换端口
network_planner_server.exe 8767
```

### Q: 热力图不显示

1. 检查是否已放置 AP 设备
2. 检查比例尺是否已设置
3. 查看浏览器控制台是否有错误

### Q: 墙体识别不准

- 导入清晰、高对比度的户型图
- 尽量使用标注尺寸的原始图纸
- 识别后可在右侧面板修改墙体材质

---

## 项目结构

```
network-planner/
├── frontend/
│   ├── index.html          # 入口
│   ├── app.js              # ~3900 行核心逻辑
│   ├── style.css           # ~2300 行样式
│   ├── offline_engine.js   # 信号计算引擎
│   └── data_service.js     # 数据服务
│
├── backend/
│   ├── CMakeLists.txt      # 构建配置
│   ├── build.bat           # Windows 编译脚本
│   ├── include/
│   │   ├── server_config.h # 配置 + SQL
│   │   ├── database.h/cpp # 数据库操作
│   │   └── api_handlers.h/cpp # API 路由
│   └── src/
│       └── main_server.cpp # HTTP 服务器
│
├── docs/
│   └── DATABASE_DESIGN.md  # 数据库设计
│
└── start.bat               # 启动脚本
```

---

## License

MIT License