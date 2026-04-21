# 网规工具 - 数据存储设计文档

## 一、数据库设计 (SQLite)

### 1.1 数据库Schema

```sql
-- 项目表（顶层容器）
CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 户型图表
CREATE TABLE floorplans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT,
    image_data TEXT NOT NULL,        -- Base64编码的图片数据
    image_width INTEGER,
    image_height INTEGER,
    offset_x REAL DEFAULT 0,        -- 图片在画布上的偏移
    offset_y REAL DEFAULT 0,
    scale_x REAL DEFAULT 1,         -- 图片缩放
    scale_y REAL DEFAULT 1,
    rotation REAL DEFAULT 0,        -- 旋转角度
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 墙体表
CREATE TABLE walls (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    floorplan_id TEXT,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    x2 REAL NOT NULL,
    y2 REAL NOT NULL,
    thickness REAL DEFAULT 10,       -- 厚度(cm)
    material TEXT DEFAULT 'brick',   -- 材质
    color TEXT,                      -- 自定义颜色
    elevation REAL DEFAULT 0,       -- 高度（楼层）
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (floorplan_id) REFERENCES floorplans(id)
);

-- 设备表（AP/交换机/路由器）
CREATE TABLE devices (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    device_type TEXT NOT NULL,       -- 'ap' | 'switch' | 'router'
    model TEXT,                      -- 具体型号
    name TEXT,                       -- 自定义名称
    x REAL NOT NULL,
    y REAL NOT NULL,
    freq_bands TEXT,                 -- 支持的频段，逗号分隔: "2.4,5,6"
    power_dbm INTEGER DEFAULT 20,   -- 发射功率
    angle REAL DEFAULT 0,            -- 方向角（AP定向天线）
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 网线连接表
CREATE TABLE links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    from_device_id TEXT NOT NULL,
    to_device_id TEXT NOT NULL,
    route_points TEXT,               -- JSON数组: [{"x":10,"y":20},...]
    cable_type TEXT DEFAULT 'CAT6', -- 网线类型
    length_m REAL,                  -- 计算出的长度
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id),
    FOREIGN KEY (from_device_id) REFERENCES devices(id),
    FOREIGN KEY (to_device_id) REFERENCES devices(id)
);

-- 比例尺表
CREATE TABLE scales (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    x2 REAL NOT NULL,
    y2 REAL NOT NULL,
    real_distance_cm REAL NOT NULL, -- 实际距离（厘米）
    m_per_px REAL NOT NULL,         -- 像素到米的转换
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

-- 配置表（通用键值对）
CREATE TABLE config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 示例数据（默认项目）
INSERT INTO projects (id, name, description) VALUES 
    ('default', '默认项目', '网规工具默认项目');

INSERT INTO config (key, value) VALUES
    ('theme', 'dark'),
    ('canvas_width', '1200'),
    ('canvas_height', '800');
```

### 1.2 实体关系图

```
┌─────────────┐
│  projects   │ 1:N ┌──────────────┐
│─────────────│◄────│  floorplans  │
│ id (PK)     │     │──────────────│
│ name        │     │ id (PK)      │
│ description │     │ project_id(FK)
└─────────────┘     │ image_data   │
      │             └──────────────┘
      │ N                   │
      │                     │
      ├──────────────┬──────┴───────┐
      │              │              │
      ▼              ▼              ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│    walls    │ │   devices   │ │    links    │
│─────────────│ │─────────────│ │─────────────│
│ id (PK)     │ │ id (PK)     │ │ id (PK)     │
│ project_id  │ │ project_id  │ │ project_id  │
│ floorplan_id│ │ device_type │ │ from_device │
│ x1,y1,x2,y2 │ │ x, y        │ │ to_device   │
│ material    │ │ model       │ │ route_points│
└─────────────┘ │ freq_bands  │ └─────────────┘
                └─────────────┘
                       ▲
                       │
                ┌─────────────┐
                │   scales    │
                │─────────────│
                │ id (PK)     │
                │ x1,y1,x2,y2 │
                │ m_per_px    │
                └─────────────┘
```

---

## 二、API 接口规范

### 2.1 基础信息
- **Base URL**: `http://localhost:8766/api`
- **Content-Type**: `application/json`
- **编码**: UTF-8

### 2.2 响应格式

```json
// 成功响应
{
    "code": 0,
    "message": "success",
    "data": { ... }
}

// 错误响应
{
    "code": -1,
    "message": "错误描述",
    "data": null
}
```

### 2.3 接口列表

#### 健康检查
```
GET /health
Response: { "code": 0, "message": "ok" }
```

---

#### 项目管理

##### 获取项目列表
```
GET /projects
Response: {
    "data": [
        { "id": "xxx", "name": "项目名", "created_at": "..." }
    ]
}
```

##### 创建项目
```
POST /projects
Body: { "name": "项目名", "description": "描述" }
Response: { "data": { "id": "xxx", ... } }
```

##### 获取项目详情
```
GET /projects/:id
Response: { "data": { "id": "...", "walls": [], "devices": [], ... } }
```

##### 删除项目
```
DELETE /projects/:id
Response: { "code": 0 }
```

---

#### 户型图

##### 上传户型图
```
POST /floorplans
Content-Type: multipart/form-data

fields:
  - project_id: string
  - name: string (optional)
  - image: base64 string
  - width: number
  - height: number

Response: {
    "data": {
        "id": "xxx",
        "image_data": "data:image/png;base64,...",
        "width": 1920,
        "height": 1080
    }
}
```

##### 更新户型图位置/缩放
```
PUT /floorplans/:id
Body: { "offset_x": 100, "offset_y": 50, "scale_x": 1.2 }
Response: { "code": 0 }
```

##### 删除户型图
```
DELETE /floorplans/:id
Response: { "code": 0 }
```

---

#### 墙体

##### 批量添加墙体
```
POST /walls/batch
Body: {
    "project_id": "xxx",
    "walls": [
        { "x1": 0, "y1": 0, "x2": 100, "y2": 0, "material": "brick" },
        { "x1": 100, "y1": 0, "x2": 100, "y2": 100, "material": "concrete" }
    ]
}
Response: { "data": { "count": 2, "ids": ["id1", "id2"] } }
```

##### 更新墙体
```
PUT /walls/:id
Body: { "x1": 10, "y1": 20, "material": "glass" }
Response: { "code": 0 }
```

##### 删除墙体
```
DELETE /walls/:id
Response: { "code": 0 }
```

##### 获取所有墙体
```
GET /walls?project_id=xxx
Response: { "data": [...] }
```

---

#### 设备

##### 添加设备（AP/交换机/路由器）
```
POST /devices
Body: {
    "project_id": "xxx",
    "device_type": "ap",           -- 'ap' | 'switch' | 'router'
    "model": "TL-XAP3000",
    "name": "客厅AP",
    "x": 500,
    "y": 300,
    "freq_bands": ["2.4", "5"],    -- 频段数组
    "power_dbm": 20,
    "angle": 0
}
Response: { "data": { "id": "xxx", ... } }
```

##### 更新设备
```
PUT /devices/:id
Body: { "x": 600, "y": 400, "angle": 45 }
Response: { "code": 0 }
```

##### 删除设备
```
DELETE /devices/:id
Response: { "code": 0 }
```

##### 获取所有设备
```
GET /devices?project_id=xxx
Response: { "data": [...] }
```

---

#### 网线连接

##### 添加连接
```
POST /links
Body: {
    "project_id": "xxx",
    "from_device_id": "dev1",
    "to_device_id": "dev2",
    "route_points": [{"x": 100, "y": 200}, {"x": 150, "y": 250}],
    "cable_type": "CAT6"
}
Response: { "data": { "id": "xxx", "length_m": 7.5 } }
```

##### 更新连接
```
PUT /links/:id
Body: { "route_points": [...] }
Response: { "code": 0 }
```

##### 删除连接
```
DELETE /links/:id
Response: { "code": 0 }
```

##### 获取所有连接
```
GET /links?project_id=xxx
Response: { "data": [...] }
```

---

#### 比例尺

##### 设置比例尺
```
POST /scales
Body: {
    "project_id": "xxx",
    "x1": 100, "y1": 100,
    "x2": 300, "y2": 100,
    "real_distance_cm": 200
}
Response: { "data": { "id": "xxx", "m_per_px": 0.01 } }
```

##### 获取比例尺
```
GET /scales?project_id=xxx
Response: { "data": { "m_per_px": 0.05, ... } }
```

---

#### 全量数据（完整保存/加载）

##### 保存完整项目数据
```
POST /projects/:id/save
Body: {
    "floorplan": { ... },
    "walls": [...],
    "devices": [...],
    "links": [...],
    "scale": { ... }
}
Response: { "code": 0 }
```

##### 加载完整项目数据
```
GET /projects/:id/load
Response: {
    "data": {
        "project": { ... },
        "floorplan": { ... },
        "walls": [...],
        "devices": [...],
        "links": [...],
        "scale": { ... }
    }
}
```

---

#### 配置

##### 获取配置
```
GET /config?key=xxx
Response: { "data": { "key": "theme", "value": "dark" } }
```

##### 设置配置
```
POST /config
Body: { "key": "theme", "value": "light" }
Response: { "code": 0 }
```

---

## 三、数据结构（JSON）

### 3.1 项目结构
```json
{
    "id": "uuid",
    "name": "项目名称",
    "description": "描述",
    "created_at": "2026-04-21T14:00:00Z",
    "updated_at": "2026-04-21T14:00:00Z"
}
```

### 3.2 户型图结构
```json
{
    "id": "uuid",
    "project_id": "project_uuid",
    "name": "户型图1",
    "image_data": "data:image/png;base64,...",
    "image_width": 1920,
    "image_height": 1080,
    "offset_x": 0,
    "offset_y": 0,
    "scale_x": 1.0,
    "scale_y": 1.0,
    "rotation": 0
}
```

### 3.3 墙体结构
```json
{
    "id": "uuid",
    "project_id": "project_uuid",
    "floorplan_id": "floorplan_uuid",
    "x1": 100,
    "y1": 200,
    "x2": 400,
    "y2": 200,
    "thickness": 10,
    "material": "brick",
    "color": "#FF0000",
    "elevation": 0
}
```

### 3.4 设备结构
```json
{
    "id": "uuid",
    "project_id": "project_uuid",
    "device_type": "ap",
    "model": "TL-XAP3000",
    "name": "客厅AP",
    "x": 500,
    "y": 300,
    "freq_bands": ["2.4", "5", "6"],
    "power_dbm": 20,
    "angle": 0
}
```

### 3.5 连接结构
```json
{
    "id": "uuid",
    "project_id": "project_uuid",
    "from_device_id": "device_uuid_1",
    "to_device_id": "device_uuid_2",
    "route_points": [
        { "x": 100, "y": 200 },
        { "x": 150, "y": 250 }
    ],
    "cable_type": "CAT6",
    "length_m": 7.5
}
```

### 3.6 比例尺结构
```json
{
    "id": "uuid",
    "project_id": "project_uuid",
    "x1": 100,
    "y1": 100,
    "x2": 300,
    "y2": 100,
    "real_distance_cm": 200,
    "m_per_px": 0.01
}
```

---

## 四、材质配置表

| 材质ID | 名称 | 2.4G衰减/dB | 5G衰减/dB | 6G衰减/dB |
|--------|------|-------------|----------|----------|
| concrete | 混凝土墙 | 15 | 20 | 25 |
| brick | 砖墙 | 10 | 14 | 18 |
| wood | 木质墙 | 5 | 7 | 9 |
| glass | 玻璃墙 | 3 | 5 | 7 |
| gypsum | 石膏板 | 4 | 5 | 6 |
| metal | 金属墙 | 30 | 35 | 40 |
| floor | 地板/天花板 | 8 | 12 | 15 |

---

## 五、设备型号表

### AP（无线接入点）
| 型号 | 频段支持 | 发射功率 | 适用场景 |
|------|----------|----------|----------|
| TL-XAP3000 | 2.4G+5G | 20dBm | 家庭/小型办公 |
| TL-XAP6000 | 2.4G+5G+6G | 23dBm | 中型办公 |
| TL-XAP1800 | 2.4G+5G | 20dBm | 入门级 |
| TL-XAP5400 | 2.4G+5G+6G | 23dBm | 高密度 |

### 交换机
| 型号 | 端口数 | PoE | 速率 |
|------|--------|-----|------|
| TL-SG2008 | 8口 | 否 | 千兆 |
| TL-SG2016 | 16口 | 否 | 千兆 |
| TL-SG2428 | 24口 | 是 | 千兆 |

### 路由器
| 型号 | 带机量 | 无线规格 |
|------|--------|----------|
| TL-XDR6088 | 200+ | WiFi 6E |
| TL-XDR5470 | 150+ | WiFi 6 |

---

## 六、前端数据结构（State）

```javascript
const State = {
    // 项目
    projectId: 'default',
    
    // 户型图
    floorplan: {
        id: null,
        imageData: null,
        width: 0,
        height: 0,
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        scaleY: 1
    },
    
    // 墙体
    walls: [
        { id, x1, y1, x2, y2, thickness, material, color }
    ],
    
    // 设备
    devices: [
        { id, type, model, name, x, y, freqBands, power, angle }
    ],
    
    // 连接
    links: [
        { id, fromId, toId, route: [{x,y}...], cableType }
    ],
    
    // 比例尺
    scale: {
        x1, y1, x2, y2,
        realDistanceCm,
        mPerPx
    },
    
    // 配置
    config: {
        theme: 'dark',
        canvasW: 1200,
        canvasH: 800
    }
};
```