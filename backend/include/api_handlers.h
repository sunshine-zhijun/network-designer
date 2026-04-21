/**
 * 网规工具 - HTTP API 处理器
 */

#ifndef API_HANDLERS_H
#define API_HANDLERS_H

#include <string>
#include <map>
#include <functional>
#include "database.h"
#include "server_config.h"

// HTTP请求/响应封装
struct Request {
    std::string method;
    std::string path;
    std::string body;
    std::map<std::string, std::string> queryParams;
    std::map<std::string, std::string> headers;
};

struct Response {
    int statusCode = 200;
    std::string body;
    std::map<std::string, std::string> headers;
    
    Response() {
        headers["Content-Type"] = "application/json; charset=utf-8";
        headers["Access-Control-Allow-Origin"] = "*";
    }
};

// 响应构建助手
inline Response jsonSuccess(const std::string& data = "{}") {
    Response res;
    res.body = "{\"code\":0,\"message\":\"success\",\"data\":" + data + "}";
    return res;
}

inline Response jsonError(int code, const std::string& msg) {
    Response res;
    res.statusCode = 400;
    res.body = "{\"code\":" + std::to_string(code) + ",\"message\":\"" + msg + "\",\"data\":null}";
    return res;
}

inline Response jsonData(const std::map<std::string, std::string>& data) {
    Response res;
    res.body = "{\"code\":0,\"message\":\"success\",\"data\":" + mapToJson(data) + "}";
    return res;
}

// UUID生成
std::string generateUUID();

// 解析JSONBody到map
std::map<std::string, std::string> parseJsonBody(const std::string& body);

// URL路径参数解析
std::string extractPathParam(const std::string& path, const std::string& pattern);

// ========== API 路由映射 ==========

class ApiRouter {
private:
    std::map<std::string, std::function<Response(const Request&)>> routes_;
    Database& db_;
    
public:
    ApiRouter(Database& database) : db_(database) {
        initRoutes();
    }
    
    Response handle(const Request& req);
    
private:
    void initRoutes();
    
    // 健康检查
    Response handleHealth();
    
    // 项目
    Response handleGetProjects();
    Response handleCreateProject(const Request& req);
    Response handleGetProject(const std::string& id);
    Response handleDeleteProject(const std::string& id);
    Response handleSaveProject(const std::string& id, const Request& req);
    Response handleLoadProject(const std::string& id);
    
    // 户型图
    Response handleGetFloorplans(const std::string& projectId);
    Response handleCreateFloorplan(const Request& req);
    Response handleUpdateFloorplan(const std::string& id, const Request& req);
    Response handleDeleteFloorplan(const std::string& id);
    
    // 墙体
    Response handleGetWalls(const std::string& projectId);
    Response handleCreateWall(const Request& req);
    Response handleCreateWallsBatch(const Request& req);
    Response handleUpdateWall(const std::string& id, const Request& req);
    Response handleDeleteWall(const std::string& id);
    
    // 设备
    Response handleGetDevices(const std::string& projectId);
    Response handleCreateDevice(const Request& req);
    Response handleUpdateDevice(const std::string& id, const Request& req);
    Response handleDeleteDevice(const std::string& id);
    
    // 连接
    Response handleGetLinks(const std::string& projectId);
    Response handleCreateLink(const Request& req);
    Response handleUpdateLink(const std::string& id, const Request& req);
    Response handleDeleteLink(const std::string& id);
    
    // 比例尺
    Response handleGetScale(const std::string& projectId);
    Response handleCreateOrUpdateScale(const Request& req);
    
    // 配置
    Response handleGetConfig(const std::string& key);
    Response handleSetConfig(const Request& req);
};

// JSON转换辅助
std::string rowsToJson(const std::vector<std::map<std::string, std::string>>& rows);

#endif // API_HANDLERS_H