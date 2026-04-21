/**
 * 网规工具 - C++ 后端数据服务
 * 
 * 功能：
 *   - SQLite 数据库存储
 *   - RESTful API 接口
 *   - 项目/户型图/墙体/设备/连接/比例尺管理
 * 
 * 编译依赖:
 *   - sqlite3 (header-only 或 lib)
 *   - cpp-httplib: https://github.com/yhirose/cpp-httplib
 *   - RapidJSON: https://github.com/Tencent/rapidjson
 * 
 * 编译命令 (MinGW):
 *   g++ -std=c++17 -O2 -I include -I deps -o server.exe ^
 *     src/database.cpp src/api_handlers.cpp src/main_server.cpp ^
 *     -lws2_32 -lsqlite3
 * 
 * 编译命令 (MSVC):
 *   cl /EHsc /std:c++17 /O2 /I include /I deps ^
 *     src/database.cpp src/api_handlers.cpp src/main_server.cpp ^
 *     /Fe:server.exe ws2_32.lib sqlite3.lib
 */

#ifndef SERVER_CONFIG_H
#define SERVER_CONFIG_H

#include <string>

// 服务配置
constexpr int SERVER_PORT = 8766;
constexpr int MAX_REQUEST_SIZE = 50 * 1024 * 1024;  // 50MB (支持大图片)
constexpr int MAX_CONNECTIONS = 100;

// 数据库配置
constexpr const char* DB_PATH = "network_planner.db";
constexpr const char* DB_INIT_SQL = R"(
-- 项目表
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 户型图表
CREATE TABLE IF NOT EXISTS floorplans (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT,
    image_data TEXT NOT NULL,
    image_width INTEGER,
    image_height INTEGER,
    offset_x REAL DEFAULT 0,
    offset_y REAL DEFAULT 0,
    scale_x REAL DEFAULT 1,
    scale_y REAL DEFAULT 1,
    rotation REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 墙体表
CREATE TABLE IF NOT EXISTS walls (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    floorplan_id TEXT,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    x2 REAL NOT NULL,
    y2 REAL NOT NULL,
    thickness REAL DEFAULT 10,
    material TEXT DEFAULT 'brick',
    color TEXT,
    elevation REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (floorplan_id) REFERENCES floorplans(id) ON DELETE SET NULL
);

-- 设备表
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    device_type TEXT NOT NULL,
    model TEXT,
    name TEXT,
    x REAL NOT NULL,
    y REAL NOT NULL,
    freq_bands TEXT,
    power_dbm INTEGER DEFAULT 20,
    angle REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 网线连接表
CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    from_device_id TEXT NOT NULL,
    to_device_id TEXT NOT NULL,
    route_points TEXT,
    cable_type TEXT DEFAULT 'CAT6',
    length_m REAL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (from_device_id) REFERENCES devices(id) ON DELETE CASCADE,
    FOREIGN KEY (to_device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- 比例尺表
CREATE TABLE IF NOT EXISTS scales (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    x2 REAL NOT NULL,
    y2 REAL NOT NULL,
    real_distance_cm REAL NOT NULL,
    m_per_px REAL NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 配置表
CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_floorplans_project ON floorplans(project_id);
CREATE INDEX IF NOT EXISTS idx_walls_project ON walls(project_id);
CREATE INDEX IF NOT EXISTS idx_devices_project ON devices(project_id);
CREATE INDEX IF NOT EXISTS idx_links_project ON links(project_id);
CREATE INDEX IF NOT EXISTS idx_scales_project ON scales(project_id);

-- 默认项目
INSERT OR IGNORE INTO projects (id, name, description) VALUES ('default', '默认项目', '网规工具默认项目');
INSERT OR IGNORE INTO config (key, value) VALUES ('theme', 'dark');
)";

// API路径
namespace ApiPath {
    // 健康检查
    const std::string HEALTH = "/api/health";
    
    // 项目
    const std::string PROJECTS = "/api/projects";
    const std::string PROJECT_BY_ID = "/api/projects/";
    
    // 户型图
    const std::string FLOORPLANS = "/api/floorplans";
    const std::string FLOORPLAN_BY_ID = "/api/floorplans/";
    
    // 墙体
    const std::string WALLS = "/api/walls";
    const std::string WALL_BY_ID = "/api/walls/";
    const std::string WALLS_BATCH = "/api/walls/batch";
    
    // 设备
    const std::string DEVICES = "/api/devices";
    const std::string DEVICE_BY_ID = "/api/devices/";
    
    // 连接
    const std::string LINKS = "/api/links";
    const std::string LINK_BY_ID = "/api/links/";
    
    // 比例尺
    const std::string SCALES = "/api/scales";
    const std::string SCALE_BY_ID = "/api/scales/";
    
    // 配置
    const std::string CONFIG = "/api/config";
    
    // 全量数据
    const std::string PROJECT_SAVE = "/api/projects/*/save";
    const std::string PROJECT_LOAD = "/api/projects/*/load";
}

#endif // SERVER_CONFIG_H