# 网规工具 (Network Planning Tool)

无线网络规划与仿真工具，支持户型图导入、墙体识别、AP覆盖热力图仿真。

## 功能特性

| 功能 | 说明 |
|------|------|
| 📁 导入户型图 | 支持 JPG / PNG / PDF / DXF 等格式 |
| 🔍 墙体识别 | 基于 Sobel 边缘检测自动识别墙体线段 |
| ✏️ 手动绘墙 | 点击绘制线段，Shift 约束水平/垂直/45° |
| 🧱 墙体材质 | 混凝土/砖墙/木质/玻璃/石膏板/金属，含衰减参数 |
| 📏 比例尺 | 两点标定实际距离，精确换算空间尺寸 |
| 📶 放置AP | 点击放置，支持吸顶/壁挂/桌面安装方式 |
| 🌡️ 热力图 | 实时信号强度热力图，拖动AP即时更新 |
| 📊 信号分析 | 覆盖率（>-70dBm）、最强/最弱/平均信号统计 |
| 💾 导出报告 | 导出PNG格式规划图 |

## 系统架构

```
network-planner/
├── frontend/           # 前端（HTML + Canvas + JS）
│   ├── index.html      # 主界面
│   ├── style.css       # 样式
│   ├── app.js          # 核心逻辑
│   └── offline_engine.js # 离线信号计算引擎
│
├── backend/            # 后端（C++ REST API）
│   ├── src/
│   │   └── main.cpp    # 主程序（WinSock HTTP服务器）
│   ├── include/
│   │   ├── signal_model.h   # 信号传播模型
│   │   ├── json_helper.h    # JSON工具
│   │   └── httplib.h        # HTTP库说明
│   └── build.bat       # 编译脚本
│
└── start.bat           # 一键启动
```

## 快速开始

### 方式一：纯前端模式（无需编译，开箱即用）

```bash
# 进入frontend目录，启动本地HTTP服务器
cd frontend
python -m http.server 8080
# 浏览器访问: http://localhost:8080
```

或者直接双击 `start.bat`

### 方式二：前后端完整模式

**1. 编译后端**

需要 Visual Studio 2019+ 或 MinGW-w64 (GCC 8+)

```bash
cd backend
build.bat
```

**2. 启动服务**

```bash
# 项目根目录
start.bat
```

后端服务运行在 `http://localhost:8766`

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET/POST | /api/walls | 获取/添加墙体 |
| POST | /api/walls/batch | 批量导入墙体 |
| PUT | /api/walls/:id | 更新墙体（材质等）|
| DELETE | /api/walls/:id | 删除墙体 |
| GET/POST | /api/aps | 获取/添加AP |
| PUT | /api/aps/:id | 更新AP属性 |
| DELETE | /api/aps/:id | 删除AP |
| POST | /api/heatmap | 计算热力图数据 |
| GET/POST | /api/scale | 获取/设置比例尺 |
| GET | /api/materials | 获取墙体材质列表 |
| POST | /api/clear | 清空所有数据 |

## 信号模型

采用对数距离路径损耗模型 (Log-Distance Path Loss Model):

```
RSSI = Tx_Power - PL(d) - Wall_Attenuation
PL(d) = FSPL(1m) + 10·n·log10(d)
n = 3.0（室内传播指数）
```

### 墙体衰减参数

| 材质 | 2.4GHz衰减 | 5GHz衰减 |
|------|-----------|---------|
| 混凝土承重墙 | 15 dB | 20 dB |
| 砖墙 | 12 dB | 17 dB |
| 木质隔断 | 4 dB | 6 dB |
| 玻璃幕墙 | 3 dB | 5 dB |
| 石膏板 | 3.5 dB | 5.5 dB |
| 金属 | 20 dB | 25 dB |
| 楼板/天花板 | 18 dB | 22 dB |

## 操作说明

### 键盘快捷键

| 按键 | 功能 |
|------|------|
| V | 选择/移动工具 |
| W | 绘制墙体 |
| A | 放置AP |
| S | 设置比例尺 |
| Shift | 绘墙时约束角度 |
| Esc | 取消当前操作 |
| Delete/Backspace | 删除选中元素 |
| 鼠标滚轮 | 缩放 |
| 中键拖拽 | 平移视图 |
| 双击空白 | 适应视图 |

### 使用流程

1. **导入图纸** → 点击「导入图纸」按钮，选择户型图文件
2. **设置比例尺** → 选择「比例尺」工具，点击图中两个参考点
3. **识别/绘制墙体** → 点击「识别墙体」自动识别，或用「画墙」手动绘制
4. **修改材质** → 点击选中墙体，在右侧属性面板修改材质
5. **放置AP** → 选择「放AP」工具，点击合适位置
6. **查看热力图** → 点击「热力图」按钮或勾选图层
7. **调整AP位置** → 直接拖动AP，热力图实时更新
8. **查看分析** → 右侧面板显示覆盖率等统计信息
9. **导出** → 点击「导出」保存PNG格式规划图
