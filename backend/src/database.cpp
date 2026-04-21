/**
 * 网规工具 - SQLite 数据库实现
 */

#include "database.h"
#include "server_config.h"
#include <iostream>
#include <sstream>
#include <algorithm>
#include <iterator>

// 跨平台 join 函数
inline std::string join(const std::vector<std::string>& vec, const std::string& delimiter) {
    std::ostringstream result;
    for (size_t i = 0; i < vec.size(); ++i) {
        if (i > 0) result << delimiter;
        result << vec[i];
    }
    return result.str();
}

// 静态成员初始化
std::unique_ptr<Database> Database::instance_;

Database::Database() : db_(nullptr) {}

Database::~Database() {
    close();
}

Database& Database::getInstance() {
    if (!instance_) {
        instance_ = std::make_unique<Database>();
    }
    return *instance_;
}

bool Database::initialize(const std::string& dbPath) {
    std::lock_guard<std::mutex> lock(mutex_);
    
    int rc = sqlite3_open(dbPath.c_str(), &db_);
    if (rc != SQLITE_OK) {
        std::cerr << "Cannot open database: " << sqlite3_errmsg(db_) << std::endl;
        return false;
    }
    
    // 启用外键约束
    sqlite3_exec(db_, "PRAGMA foreign_keys = ON", nullptr, nullptr, nullptr);
    
    // 执行初始化SQL
    char* errMsg = nullptr;
    rc = sqlite3_exec(db_, DB_INIT_SQL, nullptr, nullptr, &errMsg);
    if (rc != SQLITE_OK) {
        std::cerr << "SQL error: " << errMsg << std::endl;
        sqlite3_free(errMsg);
        return false;
    }
    
    std::cout << "[DB] Database initialized: " << dbPath << std::endl;
    return true;
}

void Database::close() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (db_) {
        sqlite3_close(db_);
        db_ = nullptr;
    }
}

std::string Database::escapeString(const std::string& s) {
    char* escaped = sqlite3_mprintf("%q", s.c_str());
    std::string result(escaped);
    sqlite3_free(escaped);
    return result;
}

int64_t Database::getLastInsertRowId() {
    return sqlite3_last_insert_rowid(db_);
}

DBResult Database::execute(const std::string& sql) {
    DBResult result;
    std::lock_guard<std::mutex> lock(mutex_);
    
    char* errMsg = nullptr;
    int rc = sqlite3_exec(db_, sql.c_str(), nullptr, nullptr, &errMsg);
    
    if (rc != SQLITE_OK) {
        result.success = false;
        result.error = errMsg;
        sqlite3_free(errMsg);
    } else {
        result.success = true;
        result.changes = sqlite3_changes(db_);
    }
    
    return result;
}

DBResult Database::query(const std::string& sql) {
    DBResult result;
    std::lock_guard<std::mutex> lock(mutex_);
    
    sqlite3_stmt* stmt;
    int rc = sqlite3_prepare_v2(db_, sql.c_str(), -1, &stmt, nullptr);
    
    if (rc != SQLITE_OK) {
        result.success = false;
        result.error = sqlite3_errmsg(db_);
        return result;
    }
    
    // 执行查询
    while ((rc = sqlite3_step(stmt)) == SQLITE_ROW) {
        std::map<std::string, std::string> row;
        int colCount = sqlite3_column_count(stmt);
        
        for (int i = 0; i < colCount; i++) {
            const char* colName = sqlite3_column_name(stmt, i);
            const char* colValue = (const char*)sqlite3_column_text(stmt, i);
            
            if (colName && colValue) {
                row[colName] = colValue;
            } else if (colName) {
                row[colName] = "";
            }
        }
        result.rows.push_back(row);
    }
    
    if (rc != SQLITE_DONE) {
        result.success = false;
        result.error = sqlite3_errmsg(db_);
    } else {
        result.success = true;
    }
    
    sqlite3_finalize(stmt);
    return result;
}

bool Database::begin() {
    return execute("BEGIN TRANSACTION").success;
}

bool Database::commit() {
    return execute("COMMIT").success;
}

bool Database::rollback() {
    return execute("ROLLBACK").success;
}

// ========== 项目操作 ==========

DBResult Database::getProjects() {
    return query("SELECT * FROM projects ORDER BY updated_at DESC");
}

DBResult Database::getProjectById(const std::string& id) {
    std::string sql = "SELECT * FROM projects WHERE id = '" + escapeString(id) + "'";
    return query(sql);
}

DBResult Database::createProject(const std::string& id, const std::string& name,
                                 const std::string& description) {
    std::string sql = "INSERT INTO projects (id, name, description) VALUES ('" +
        escapeString(id) + "', '" + escapeString(name) + "', '" + 
        escapeString(description) + "')";
    return execute(sql);
}

DBResult Database::deleteProject(const std::string& id) {
    // 外键级联删除
    std::string sql = "DELETE FROM projects WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

// ========== 楼层操作 ==========

DBResult Database::getFloors(const std::string& projectId) {
    std::string sql = "SELECT * FROM floors WHERE project_id = '" + 
        escapeString(projectId) + "' ORDER BY floor_number ASC, created_at ASC";
    return query(sql);
}

DBResult Database::getFloorById(const std::string& id) {
    std::string sql = "SELECT * FROM floors WHERE id = '" + escapeString(id) + "'";
    return query(sql);
}

DBResult Database::createFloor(const std::map<std::string, std::string>& data) {
    std::string sql = "INSERT INTO floors (id, project_id, name, floor_number) VALUES ('" +
        escapeString(data.count("id") ? data.at("id") : "") + "', '" +
        escapeString(data.count("project_id") ? data.at("project_id") : "default") + "', '" +
        escapeString(data.count("name") ? data.at("name") : "新楼层") + "', " +
        (data.count("floor_number") ? data.at("floor_number") : "0") + ")";
    return execute(sql);
}

DBResult Database::updateFloor(const std::string& id,
                               const std::map<std::string, std::string>& data) {
    std::vector<std::string> setters;
    for (const auto& pair : data) {
        if (pair.first != "id") {
            setters.push_back(pair.first + " = '" + escapeString(pair.second) + "'");
        }
    }
    setters.push_back("updated_at = datetime('now')");
    
    std::string sql = "UPDATE floors SET " + 
        join(setters, ", ") + " WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

DBResult Database::deleteFloor(const std::string& id) {
    std::string sql = "DELETE FROM floors WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

// ========== 户型图操作 ==========

DBResult Database::getFloorplans(const std::string& projectId) {
    std::string sql = "SELECT * FROM floorplans WHERE project_id = '" + 
        escapeString(projectId) + "' ORDER BY created_at DESC";
    return query(sql);
}

DBResult Database::getFloorplanById(const std::string& id) {
    std::string sql = "SELECT * FROM floorplans WHERE id = '" + escapeString(id) + "'";
    return query(sql);
}

DBResult Database::createFloorplan(const std::map<std::string, std::string>& data) {
    // 使用默认值，避免 map::at 崩溃
    std::string offset_x = data.count("offset_x") ? data.at("offset_x") : "0";
    std::string offset_y = data.count("offset_y") ? data.at("offset_y") : "0";
    std::string scale_x = data.count("scale_x") ? data.at("scale_x") : "1";
    std::string scale_y = data.count("scale_y") ? data.at("scale_y") : "1";
    std::string rotation = data.count("rotation") ? data.at("rotation") : "0";
    
    std::string sql = "INSERT INTO floorplans (id, project_id, floor_id, name, image_data, " +
        std::string("image_width, image_height, offset_x, offset_y, scale_x, scale_y, rotation) VALUES ('") +
        escapeString(data.count("id") ? data.at("id") : "") + "', '" +
        escapeString(data.count("project_id") ? data.at("project_id") : "default") + "', '" +
        escapeString(data.count("floor_id") ? data.at("floor_id") : "") + "', '" +
        escapeString(data.count("name") ? data.at("name") : "户型图") + "', '" +
        escapeString(data.count("image_data") ? data.at("image_data") : "") + "', " +
        (data.count("image_width") ? data.at("image_width") : "0") + ", " +
        (data.count("image_height") ? data.at("image_height") : "0") + ", " +
        offset_x + ", " + offset_y + ", " +
        scale_x + ", " + scale_y + ", " +
        rotation + ")";
    return execute(sql);
}

DBResult Database::updateFloorplan(const std::string& id,
                                  const std::map<std::string, std::string>& data) {
    std::vector<std::string> setters;
    for (const auto& pair : data) {
        if (pair.first != "id") {
            setters.push_back(pair.first + " = '" + escapeString(pair.second) + "'");
        }
    }
    
    std::string sql = "UPDATE floorplans SET " + 
        join(setters, ", ") + " WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

DBResult Database::deleteFloorplan(const std::string& id) {
    std::string sql = "DELETE FROM floorplans WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

// ========== 墙体操作 ==========

DBResult Database::getWalls(const std::string& projectId) {
    std::string sql = "SELECT * FROM walls WHERE project_id = '" + 
        escapeString(projectId) + "' ORDER BY created_at";
    return query(sql);
}

DBResult Database::getWallById(const std::string& id) {
    std::string sql = "SELECT * FROM walls WHERE id = '" + escapeString(id) + "'";
    return query(sql);
}

DBResult Database::createWall(const std::map<std::string, std::string>& data) {
    // 使用默认值，避免 map::at 崩溃
    std::string thickness = data.count("thickness") ? data.at("thickness") : "10";
    std::string elevation = data.count("elevation") ? data.at("elevation") : "0";
    std::string material = data.count("material") ? data.at("material") : "brick";
    std::string x1 = data.count("x1") ? data.at("x1") : "0";
    std::string y1 = data.count("y1") ? data.at("y1") : "0";
    std::string x2 = data.count("x2") ? data.at("x2") : "0";
    std::string y2 = data.count("y2") ? data.at("y2") : "0";
    
    std::string sql = "INSERT INTO walls (id, project_id, floorplan_id, x1, y1, x2, y2, " +
        std::string("thickness, material, color, elevation) VALUES ('") +
        escapeString(data.count("id") ? data.at("id") : "") + "', '" +
        escapeString(data.count("project_id") ? data.at("project_id") : "default") + "', " +
        (data.count("floorplan_id") ? "'" + escapeString(data.at("floorplan_id")) + "'" : "NULL") + ", " +
        x1 + ", " + y1 + ", " +
        x2 + ", " + y2 + ", " +
        thickness + ", '" + escapeString(material) + "', " +
        (data.count("color") ? "'" + escapeString(data.at("color")) + "'" : "NULL") + ", " +
        elevation + ")";
    return execute(sql);
}

DBResult Database::createWallsBatch(const std::vector<std::map<std::string, std::string>>& walls) {
    begin();
    for (const auto& wall : walls) {
        auto result = createWall(wall);
        if (!result.success) {
            rollback();
            return result;
        }
    }
    commit();
    DBResult r;
    r.success = true;
    r.changes = walls.size();
    return r;
}

DBResult Database::updateWall(const std::string& id,
                             const std::map<std::string, std::string>& data) {
    std::vector<std::string> setters;
    for (const auto& pair : data) {
        if (pair.first != "id") {
            setters.push_back(pair.first + " = '" + escapeString(pair.second) + "'");
        }
    }
    
    std::string sql = "UPDATE walls SET " + 
        join(setters, ", ") + " WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

DBResult Database::deleteWall(const std::string& id) {
    std::string sql = "DELETE FROM walls WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

DBResult Database::deleteWallsByProject(const std::string& projectId) {
    std::string sql = "DELETE FROM walls WHERE project_id = '" + escapeString(projectId) + "'";
    return execute(sql);
}

// ========== 设备操作 ==========

DBResult Database::getDevices(const std::string& projectId) {
    std::string sql = "SELECT * FROM devices WHERE project_id = '" + 
        escapeString(projectId) + "' ORDER BY created_at";
    return query(sql);
}

DBResult Database::getDeviceById(const std::string& id) {
    std::string sql = "SELECT * FROM devices WHERE id = '" + escapeString(id) + "'";
    return query(sql);
}

DBResult Database::createDevice(const std::map<std::string, std::string>& data) {
    // 使用默认值，避免 map::at 崩溃
    std::string power_dbm = data.count("power_dbm") ? data.at("power_dbm") : "20";
    std::string angle = data.count("angle") ? data.at("angle") : "0";
    std::string x = data.count("x") ? data.at("x") : "0";
    std::string y = data.count("y") ? data.at("y") : "0";
    
    std::string sql = "INSERT INTO devices (id, project_id, device_type, model, name, x, y, " +
        std::string("freq_bands, power_dbm, angle) VALUES ('") +
        escapeString(data.count("id") ? data.at("id") : "") + "', '" +
        escapeString(data.count("project_id") ? data.at("project_id") : "default") + "', '" +
        escapeString(data.count("device_type") ? data.at("device_type") : "ap") + "', " +
        (data.count("model") ? "'" + escapeString(data.at("model")) + "'" : "NULL") + ", " +
        (data.count("name") ? "'" + escapeString(data.at("name")) + "'" : "NULL") + ", " +
        x + ", " + y + ", " +
        (data.count("freq_bands") ? "'" + escapeString(data.at("freq_bands")) + "'" : "'2.4,5'") + ", " +
        power_dbm + ", " + angle + ")";
    return execute(sql);
}

DBResult Database::updateDevice(const std::string& id,
                               const std::map<std::string, std::string>& data) {
    std::vector<std::string> setters;
    for (const auto& pair : data) {
        if (pair.first != "id") {
            setters.push_back(pair.first + " = '" + escapeString(pair.second) + "'");
        }
    }
    
    std::string sql = "UPDATE devices SET " + 
        join(setters, ", ") + " WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

DBResult Database::deleteDevice(const std::string& id) {
    std::string sql = "DELETE FROM devices WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

DBResult Database::deleteDevicesByProject(const std::string& projectId) {
    std::string sql = "DELETE FROM devices WHERE project_id = '" + escapeString(projectId) + "'";
    return execute(sql);
}

// ========== 连接操作 ==========

DBResult Database::getLinks(const std::string& projectId) {
    std::string sql = "SELECT * FROM links WHERE project_id = '" + 
        escapeString(projectId) + "' ORDER BY created_at";
    return query(sql);
}

DBResult Database::getLinkById(const std::string& id) {
    std::string sql = "SELECT * FROM links WHERE id = '" + escapeString(id) + "'";
    return query(sql);
}

DBResult Database::createLink(const std::map<std::string, std::string>& data) {
    std::string sql = "INSERT INTO links (id, project_id, from_device_id, to_device_id, " +
        std::string("route_points, cable_type, length_m) VALUES ('") +
        escapeString(data.count("id") ? data.at("id") : "") + "', '" +
        escapeString(data.count("project_id") ? data.at("project_id") : "default") + "', '" +
        escapeString(data.count("from_device_id") ? data.at("from_device_id") : "") + "', '" +
        escapeString(data.count("to_device_id") ? data.at("to_device_id") : "") + "', " +
        (data.count("route_points") ? "'" + escapeString(data.at("route_points")) + "'" : "NULL") + ", " +
        (data.count("cable_type") ? "'" + escapeString(data.at("cable_type")) + "'" : "'CAT6'") + ", " +
        (data.count("length_m") ? data.at("length_m") : "NULL") + ")";
    return execute(sql);
}

DBResult Database::updateLink(const std::string& id,
                             const std::map<std::string, std::string>& data) {
    std::vector<std::string> setters;
    for (const auto& pair : data) {
        if (pair.first != "id") {
            setters.push_back(pair.first + " = '" + escapeString(pair.second) + "'");
        }
    }
    
    std::string sql = "UPDATE links SET " + 
        join(setters, ", ") + " WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

DBResult Database::deleteLink(const std::string& id) {
    std::string sql = "DELETE FROM links WHERE id = '" + escapeString(id) + "'";
    return execute(sql);
}

DBResult Database::deleteLinksByProject(const std::string& projectId) {
    std::string sql = "DELETE FROM links WHERE project_id = '" + escapeString(projectId) + "'";
    return execute(sql);
}

// ========== 比例尺操作 ==========

DBResult Database::getScale(const std::string& projectId) {
    std::string sql = "SELECT * FROM scales WHERE project_id = '" + 
        escapeString(projectId) + "'";
    return query(sql);
}

DBResult Database::createOrUpdateScale(const std::map<std::string, std::string>& data) {
    // 先删除旧的
    std::string projectId = data.count("project_id") ? data.at("project_id") : "default";
    std::string delSql = "DELETE FROM scales WHERE project_id = '" + 
        escapeString(projectId) + "'";
    execute(delSql);
    
    // 获取字段，提供默认值
    std::string id = data.count("id") ? data.at("id") : "";
    std::string x1 = data.count("x1") ? data.at("x1") : "0";
    std::string y1 = data.count("y1") ? data.at("y1") : "0";
    std::string x2 = data.count("x2") ? data.at("x2") : "0";
    std::string y2 = data.count("y2") ? data.at("y2") : "0";
    std::string realDistanceCm = data.count("real_distance_cm") ? data.at("real_distance_cm") : "0";
    std::string mPerPx = data.count("m_per_px") ? data.at("m_per_px") : "0.05";
    
    // 再插入新的
    std::string sql = "INSERT INTO scales (id, project_id, x1, y1, x2, y2, " +
        std::string("real_distance_cm, m_per_px) VALUES ('") +
        escapeString(id) + "', '" +
        escapeString(projectId) + "', " +
        x1 + ", " + y1 + ", " +
        x2 + ", " + y2 + ", " +
        realDistanceCm + ", " + mPerPx + ")";
    return execute(sql);
}

// ========== 配置操作 ==========

DBResult Database::getConfig(const std::string& key) {
    std::string sql = "SELECT * FROM config WHERE key = '" + escapeString(key) + "'";
    return query(sql);
}

DBResult Database::setConfig(const std::string& key, const std::string& value) {
    std::string sql = "INSERT OR REPLACE INTO config (key, value, updated_at) VALUES ('" +
        escapeString(key) + "', '" + escapeString(value) + "', datetime('now'))";
    return execute(sql);
}

DBResult Database::getAllConfig() {
    return query("SELECT * FROM config");
}

// ========== 全量数据 ==========

DBResult Database::loadProjectData(const std::string& projectId) {
    DBResult result;
    result.success = true;
    
    // 获取项目
    result.data["project"] = getProjectById(projectId).rows;
    
    // 获取户型图
    result.data["floorplan"] = getFloorplans(projectId).rows;
    
    // 获取墙体
    result.data["walls"] = getWalls(projectId).rows;
    
    // 获取设备
    result.data["devices"] = getDevices(projectId).rows;
    
    // 获取连接
    result.data["links"] = getLinks(projectId).rows;
    
    // 获取比例尺
    result.data["scale"] = getScale(projectId).rows;
    
    return result;
}

DBResult Database::saveProjectData(const std::string& projectId,
                                   const std::map<std::string, std::string>& data) {
    begin();
    
    // TODO: 实现批量保存逻辑
    
    commit();
    DBResult r;
    r.success = true;
    return r;
}