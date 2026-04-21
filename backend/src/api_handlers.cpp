/**
 * 网规工具 - HTTP API 处理器实现
 */

#include "api_handlers.h"
#include <iostream>
#include <sstream>
#include <iomanip>
#include <random>
#include <chrono>

std::string generateUUID() {
    static std::mt19937 rng(std::chrono::steady_clock::now().time_since_epoch().count());
    std::uniform_int_distribution<int> dist(0, 15);
    const char* chars = "0123456789abcdef";
    std::string uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
    for (auto& c : uuid) {
        if (c == 'x') c = chars[dist(rng)];
        else if (c == 'y') c = chars[(dist(rng) & 0x3) | 0x8];
    }
    return uuid;
}

std::map<std::string, std::string> parseJsonBody(const std::string& body) {
    std::map<std::string, std::string> result;
    // 简单的JSON解析（生产环境建议用RapidJSON）
    size_t pos = 0;
    while (pos < body.size()) {
        // 找 key
        size_t keyStart = body.find('"', pos);
        if (keyStart == std::string::npos) break;
        size_t keyEnd = body.find('"', keyStart + 1);
        if (keyEnd == std::string::npos) break;
        std::string key = body.substr(keyStart + 1, keyEnd - keyStart - 1);
        
        // 找 :
        size_t colonPos = body.find(':', keyEnd);
        if (colonPos == std::string::npos) break;
        
        // 找值
        size_t valueStart = colonPos + 1;
        while (valueStart < body.size() && (body[valueStart] == ' ' || body[valueStart] == ',')) valueStart++;
        
        char valueChar = body[valueStart];
        std::string value;
        
        if (valueChar == '"') {
            // 字符串值
            size_t valueEnd = body.find('"', valueStart + 1);
            value = body.substr(valueStart + 1, valueEnd - valueStart - 1);
        } else if (valueChar == '{' || valueChar == '[') {
            // 对象或数组，跳过匹配
            int depth = 1;
            size_t valueEnd = valueStart + 1;
            while (depth > 0 && valueEnd < body.size()) {
                if (body[valueEnd] == '{' || body[valueEnd] == '[') depth++;
                else if (body[valueEnd] == '}' || body[valueEnd] == ']') depth--;
                valueEnd++;
            }
            value = body.substr(valueStart, valueEnd - valueStart);
        } else {
            // 数字或布尔
            size_t valueEnd = valueStart;
            while (valueEnd < body.size() && body[valueEnd] != ',' && body[valueEnd] != '}') valueEnd++;
            value = body.substr(valueStart, valueEnd - valueStart);
        }
        
        result[key] = value;
        pos = valueStart + value.size();
    }
    
    return result;
}

std::string extractPathParam(const std::string& path, const std::string& pattern) {
    // 简化实现，假设pattern是 "/api/projects/*" 格式
    size_t lastSlash = path.rfind('/');
    if (lastSlash != std::string::npos) {
        return path.substr(lastSlash + 1);
    }
    return "";
}

std::string rowsToJson(const std::vector<std::map<std::string, std::string>>& rows) {
    if (rows.empty()) return "[]";

    std::ostringstream ss;
    ss << "[";
    for (size_t i = 0; i < rows.size(); i++) {
        if (i > 0) ss << ",";
        ss << "{";
        bool first = true;
        for (const auto& pair : rows[i]) {
            if (!first) ss << ",";
            ss << "\"" << pair.first << "\":\"" << pair.second << "\"";
            first = false;
        }
        ss << "}";
    }
    ss << "]";
    return ss.str();
}

std::string mapToJson(const std::map<std::string, std::string>& data) {
    if (data.empty()) return "{}";

    std::ostringstream ss;
    ss << "{";
    bool first = true;
    for (const auto& pair : data) {
        if (!first) ss << ",";
        ss << "\"" << pair.first << "\":\"" << pair.second << "\"";
        first = false;
    }
    ss << "}";
    return ss.str();
}

Response ApiRouter::handle(const Request& req) {
    std::string path = req.path;
    
    // 路由匹配
    if (path == "/api/health" || path == ApiPath::HEALTH) {
        return handleHealth();
    }
    
    // 项目路由
    if (path == "/api/projects" && req.method == "GET") {
        return handleGetProjects();
    }
    if (path == "/api/projects" && req.method == "POST") {
        return handleCreateProject(req);
    }
    if (path.substr(0, 14) == "/api/projects/" && req.method == "GET") {
        std::string id = extractPathParam(path, "/api/projects/*");
        if (path.find("/save") != std::string::npos) {
            return handleSaveProject(id, req);
        }
        if (path.find("/load") != std::string::npos) {
            return handleLoadProject(id);
        }
        return handleGetProject(id);
    }
    if (path.substr(0, 14) == "/api/projects/" && req.method == "DELETE") {
        std::string id = extractPathParam(path, "/api/projects/*");
        return handleDeleteProject(id);
    }
    
    // 户型图路由
    if (path == "/api/floorplans" && req.method == "POST") {
        return handleCreateFloorplan(req);
    }
    if (path.substr(0, 16) == "/api/floorplans/" && req.method == "PUT") {
        std::string id = extractPathParam(path, "/api/floorplans/*");
        return handleUpdateFloorplan(id, req);
    }
    if (path.substr(0, 16) == "/api/floorplans/" && req.method == "DELETE") {
        std::string id = extractPathParam(path, "/api/floorplans/*");
        return handleDeleteFloorplan(id);
    }
    if (path == "/api/floorplans" && req.method == "GET" && req.queryParams.count("project_id")) {
        return handleGetFloorplans(req.queryParams.at("project_id"));
    }
    
    // 墙体路由
    if (path == "/api/walls" && req.method == "GET" && req.queryParams.count("project_id")) {
        return handleGetWalls(req.queryParams.at("project_id"));
    }
    if (path == "/api/walls" && req.method == "POST") {
        return handleCreateWall(req);
    }
    if (path == "/api/walls/batch" && req.method == "POST") {
        return handleCreateWallsBatch(req);
    }
    if (path.substr(0, 12) == "/api/walls/" && req.method == "PUT") {
        std::string id = extractPathParam(path, "/api/walls/*");
        return handleUpdateWall(id, req);
    }
    if (path.substr(0, 12) == "/api/walls/" && req.method == "DELETE") {
        std::string id = extractPathParam(path, "/api/walls/*");
        return handleDeleteWall(id);
    }
    
    // 设备路由
    if (path == "/api/devices" && req.method == "GET" && req.queryParams.count("project_id")) {
        return handleGetDevices(req.queryParams.at("project_id"));
    }
    if (path == "/api/devices" && req.method == "POST") {
        return handleCreateDevice(req);
    }
    if (path.substr(0, 14) == "/api/devices/" && req.method == "PUT") {
        std::string id = extractPathParam(path, "/api/devices/*");
        return handleUpdateDevice(id, req);
    }
    if (path.substr(0, 14) == "/api/devices/" && req.method == "DELETE") {
        std::string id = extractPathParam(path, "/api/devices/*");
        return handleDeleteDevice(id);
    }
    
    // 连接路由
    if (path == "/api/links" && req.method == "GET" && req.queryParams.count("project_id")) {
        return handleGetLinks(req.queryParams.at("project_id"));
    }
    if (path == "/api/links" && req.method == "POST") {
        return handleCreateLink(req);
    }
    if (path.substr(0, 12) == "/api/links/" && req.method == "PUT") {
        std::string id = extractPathParam(path, "/api/links/*");
        return handleUpdateLink(id, req);
    }
    if (path.substr(0, 12) == "/api/links/" && req.method == "DELETE") {
        std::string id = extractPathParam(path, "/api/links/*");
        return handleDeleteLink(id);
    }
    
    // 比例尺路由
    if (path == "/api/scales" && req.method == "GET" && req.queryParams.count("project_id")) {
        return handleGetScale(req.queryParams.at("project_id"));
    }
    if (path == "/api/scales" && req.method == "POST") {
        return handleCreateOrUpdateScale(req);
    }
    
    // 配置路由
    if (path == "/api/config" && req.method == "GET") {
        if (req.queryParams.count("key")) {
            return handleGetConfig(req.queryParams.at("key"));
        }
        // 返回所有配置
        auto result = db_.getAllConfig();
        return jsonSuccess(rowsToJson(result.rows));
    }
    if (path == "/api/config" && req.method == "POST") {
        return handleSetConfig(req);
    }
    
    return jsonError(404, "API not found: " + path);
}

// ========== API 实现 ==========

Response ApiRouter::handleHealth() {
    return jsonSuccess("{\"status\":\"ok\"}");
}

Response ApiRouter::handleGetProjects() {
    auto result = db_.getProjects();
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess(rowsToJson(result.rows));
}

Response ApiRouter::handleCreateProject(const Request& req) {
    auto data = parseJsonBody(req.body);
    std::string id = data.count("id") ? data.at("id") : generateUUID();
    std::string name = data.count("name") ? data.at("name") : "新项目";
    std::string description = data.count("description") ? data.at("description") : "";
    
    auto result = db_.createProject(id, name, description);
    if (!result.success) return jsonError(500, result.error);
    
    auto project = db_.getProjectById(id);
    return jsonSuccess(rowsToJson(project.rows));
}

Response ApiRouter::handleGetProject(const std::string& id) {
    auto result = db_.getProjectById(id);
    if (result.rows.empty()) return jsonError(404, "Project not found");
    return jsonSuccess(rowsToJson(result.rows));
}

Response ApiRouter::handleDeleteProject(const std::string& id) {
    auto result = db_.deleteProject(id);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

Response ApiRouter::handleSaveProject(const std::string& id, const Request& req) {
    auto data = parseJsonBody(req.body);
    auto result = db_.saveProjectData(id, data);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

Response ApiRouter::handleLoadProject(const std::string& id) {
    auto result = db_.loadProjectData(id);
    if (!result.success) return jsonError(500, result.error);
    
    std::ostringstream ss;
    ss << "{";
    ss << "\"project\":" << rowsToJson(result.data["project"]) << ",";
    ss << "\"floorplan\":" << rowsToJson(result.data["floorplan"]) << ",";
    ss << "\"walls\":" << rowsToJson(result.data["walls"]) << ",";
    ss << "\"devices\":" << rowsToJson(result.data["devices"]) << ",";
    ss << "\"links\":" << rowsToJson(result.data["links"]) << ",";
    ss << "\"scale\":" << rowsToJson(result.data["scale"]);
    ss << "}";
    
    Response res;
    res.body = "{\"code\":0,\"message\":\"success\",\"data\":" + ss.str() + "}";
    return res;
}

// 户型图
Response ApiRouter::handleGetFloorplans(const std::string& projectId) {
    auto result = db_.getFloorplans(projectId);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess(rowsToJson(result.rows));
}

Response ApiRouter::handleCreateFloorplan(const Request& req) {
    auto data = parseJsonBody(req.body);
    data["id"] = generateUUID();
    
    auto result = db_.createFloorplan(data);
    if (!result.success) return jsonError(500, result.error);
    
    auto fp = db_.getFloorplanById(data["id"]);
    return jsonSuccess(rowsToJson(fp.rows));
}

Response ApiRouter::handleUpdateFloorplan(const std::string& id, const Request& req) {
    auto data = parseJsonBody(req.body);
    auto result = db_.updateFloorplan(id, data);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

Response ApiRouter::handleDeleteFloorplan(const std::string& id) {
    auto result = db_.deleteFloorplan(id);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

// 墙体
Response ApiRouter::handleGetWalls(const std::string& projectId) {
    auto result = db_.getWalls(projectId);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess(rowsToJson(result.rows));
}

Response ApiRouter::handleCreateWall(const Request& req) {
    auto data = parseJsonBody(req.body);
    data["id"] = generateUUID();
    
    auto result = db_.createWall(data);
    if (!result.success) return jsonError(500, result.error);
    
    auto wall = db_.getWallById(data["id"]);
    return jsonSuccess(rowsToJson(wall.rows));
}

Response ApiRouter::handleCreateWallsBatch(const Request& req) {
    // 解析walls数组
    auto data = parseJsonBody(req.body);
    std::vector<std::map<std::string, std::string>> walls;
    
    // TODO: 解析walls数组
    auto result = db_.createWallsBatch(walls);
    if (!result.success) return jsonError(500, result.error);
    
    return jsonSuccess("{\"count\":" + std::to_string(walls.size()) + "}");
}

Response ApiRouter::handleUpdateWall(const std::string& id, const Request& req) {
    auto data = parseJsonBody(req.body);
    auto result = db_.updateWall(id, data);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

Response ApiRouter::handleDeleteWall(const std::string& id) {
    auto result = db_.deleteWall(id);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

// 设备
Response ApiRouter::handleGetDevices(const std::string& projectId) {
    auto result = db_.getDevices(projectId);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess(rowsToJson(result.rows));
}

Response ApiRouter::handleCreateDevice(const Request& req) {
    auto data = parseJsonBody(req.body);
    data["id"] = generateUUID();
    
    auto result = db_.createDevice(data);
    if (!result.success) return jsonError(500, result.error);
    
    auto device = db_.getDeviceById(data["id"]);
    return jsonSuccess(rowsToJson(device.rows));
}

Response ApiRouter::handleUpdateDevice(const std::string& id, const Request& req) {
    auto data = parseJsonBody(req.body);
    auto result = db_.updateDevice(id, data);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

Response ApiRouter::handleDeleteDevice(const std::string& id) {
    auto result = db_.deleteDevice(id);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

// 连接
Response ApiRouter::handleGetLinks(const std::string& projectId) {
    auto result = db_.getLinks(projectId);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess(rowsToJson(result.rows));
}

Response ApiRouter::handleCreateLink(const Request& req) {
    auto data = parseJsonBody(req.body);
    data["id"] = generateUUID();
    
    auto result = db_.createLink(data);
    if (!result.success) return jsonError(500, result.error);
    
    auto link = db_.getLinkById(data["id"]);
    return jsonSuccess(rowsToJson(link.rows));
}

Response ApiRouter::handleUpdateLink(const std::string& id, const Request& req) {
    auto data = parseJsonBody(req.body);
    auto result = db_.updateLink(id, data);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

Response ApiRouter::handleDeleteLink(const std::string& id) {
    auto result = db_.deleteLink(id);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}

// 比例尺
Response ApiRouter::handleGetScale(const std::string& projectId) {
    auto result = db_.getScale(projectId);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess(rowsToJson(result.rows));
}

Response ApiRouter::handleCreateOrUpdateScale(const Request& req) {
    auto data = parseJsonBody(req.body);
    data["id"] = generateUUID();
    
    auto result = db_.createOrUpdateScale(data);
    if (!result.success) return jsonError(500, result.error);
    
    return jsonSuccess("{\"id\":\"" + data["id"] + "\",\"m_per_px\":" + data["m_per_px"] + "}");
}

// 配置
Response ApiRouter::handleGetConfig(const std::string& key) {
    auto result = db_.getConfig(key);
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess(rowsToJson(result.rows));
}

Response ApiRouter::handleSetConfig(const Request& req) {
    auto data = parseJsonBody(req.body);
    if (!data.count("key") || !data.count("value")) {
        return jsonError(400, "Missing key or value");
    }
    
    auto result = db_.setConfig(data.at("key"), data.at("value"));
    if (!result.success) return jsonError(500, result.error);
    return jsonSuccess("{}");
}