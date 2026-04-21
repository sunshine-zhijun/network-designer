/**
 * 网规工具 - SQLite 数据库管理
 */

#ifndef DATABASE_H
#define DATABASE_H

#include <sqlite3.h>
#include <string>
#include <vector>
#include <map>
#include <mutex>
#include <memory>

// 数据库结果封装
struct DBResult {
    bool success;
    std::string error;
    std::vector<std::map<std::string, std::string>> rows;
    long long lastInsertId = 0;
    int changes = 0;
};

class Database {
private:
    sqlite3* db_;
    std::mutex mutex_;
    static std::unique_ptr<Database> instance_;
    
    Database();
    ~Database();
    
public:
    // 单例
    static Database& getInstance();
    
    // 初始化
    bool initialize(const std::string& dbPath);
    void close();
    
    // 基础操作
    DBResult execute(const std::string& sql);
    DBResult query(const std::string& sql);
    DBResult prepare(const std::string& sql, 
                     const std::vector<std::string>& params);
    
    // 事务
    bool begin();
    bool commit();
    bool rollback();
    
    // 辅助方法
    std::string escapeString(const std::string& s);
    int64_t getLastInsertRowId();
    
    // ========== 项目操作 ==========
    DBResult getProjects();
    DBResult getProjectById(const std::string& id);
    DBResult createProject(const std::string& id, const std::string& name, 
                          const std::string& description);
    DBResult deleteProject(const std::string& id);
    
    // ========== 户型图操作 ==========
    DBResult getFloorplans(const std::string& projectId);
    DBResult getFloorplanById(const std::string& id);
    DBResult createFloorplan(const std::map<std::string, std::string>& data);
    DBResult updateFloorplan(const std::string& id, 
                            const std::map<std::string, std::string>& data);
    DBResult deleteFloorplan(const std::string& id);
    
    // ========== 墙体操作 ==========
    DBResult getWalls(const std::string& projectId);
    DBResult getWallById(const std::string& id);
    DBResult createWall(const std::map<std::string, std::string>& data);
    DBResult createWallsBatch(const std::vector<std::map<std::string, std::string>>& walls);
    DBResult updateWall(const std::string& id,
                       const std::map<std::string, std::string>& data);
    DBResult deleteWall(const std::string& id);
    DBResult deleteWallsByProject(const std::string& projectId);
    
    // ========== 设备操作 ==========
    DBResult getDevices(const std::string& projectId);
    DBResult getDeviceById(const std::string& id);
    DBResult createDevice(const std::map<std::string, std::string>& data);
    DBResult updateDevice(const std::string& id,
                         const std::map<std::string, std::string>& data);
    DBResult deleteDevice(const std::string& id);
    DBResult deleteDevicesByProject(const std::string& projectId);
    
    // ========== 连接操作 ==========
    DBResult getLinks(const std::string& projectId);
    DBResult getLinkById(const std::string& id);
    DBResult createLink(const std::map<std::string, std::string>& data);
    DBResult updateLink(const std::string& id,
                       const std::map<std::string, std::string>& data);
    DBResult deleteLink(const std::string& id);
    DBResult deleteLinksByProject(const std::string& projectId);
    
    // ========== 比例尺操作 ==========
    DBResult getScale(const std::string& projectId);
    DBResult createOrUpdateScale(const std::map<std::string, std::string>& data);
    
    // ========== 配置操作 ==========
    DBResult getConfig(const std::string& key);
    DBResult setConfig(const std::string& key, const std::string& value);
    DBResult getAllConfig();
    
    // ========== 全量数据 ==========
    DBResult loadProjectData(const std::string& projectId);
    DBResult saveProjectData(const std::string& projectId,
                            const std::map<std::string, std::string>& data);
};

#endif // DATABASE_H