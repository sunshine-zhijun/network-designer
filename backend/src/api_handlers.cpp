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

// 解析JSON字符串值，正确处理转义字符
static size_t skipJsonString(const std::string& s, size_t start) {
    // start 指向 opening quote
    size_t pos = start + 1;
    while (pos < s.size()) {
        if (s[pos] == '\\') {
            pos += 2; // skip escape + escaped char
        } else if (s[pos] == '"') {
            return pos + 1; // return position after closing quote
        } else {
            pos++;
        }
    }
    return pos;
}

// 解析JSON对象或数组，正确处理嵌套和字符串
static size_t skipJsonContainer(const std::string& s, size_t start) {
    char open = s[start];
    char close = (open == '{') ? '}' : ']';
    int depth = 1;
    size_t pos = start + 1;
    while (depth > 0 && pos < s.size()) {
        if (s[pos] == '"') {
            pos = skipJsonString(s, pos);
        } else if (s[pos] == open) {
            depth++;
            pos++;
        } else if (s[pos] == close) {
            depth--;
            pos++;
            if (depth == 0) return pos;
        } else {
            pos++;
        }
    }
    return pos;
}

std::map<std::string, std::string> parseJsonBody(const std::string& body) {
    std::map<std::string, std::string> result;
    size_t pos = 0;
    
    // 跳过开头的空白和 {
    while (pos < body.size() && (body[pos] == ' ' || body[pos] == '\t' || body[pos] == '\n' || body[pos] == '{')) {
        if (body[pos] == '{') { pos++; break; }
        pos++;
    }
    
    while (pos < body.size()) {
        // 跳过空白
        while (pos < body.size() && (body[pos] == ' ' || body[pos] == '\t' || body[pos] == '\n' || body[pos] == '\r')) pos++;
        
        if (pos >= body.size()) break;
        
        // 检查结束
        if (body[pos] == '}') break;
        if (body[pos] == ',') { pos++; continue; }
        
        // 必须是 key (字符串)
        if (body[pos] != '"') break;
        
        // 解析 key
        size_t keyEnd = skipJsonString(body, pos);
        std::string key = body.substr(pos + 1, keyEnd - pos - 2);
        pos = keyEnd;
        
        // 跳过空白，找冒号
        while (pos < body.size() && body[pos] != ':') pos++;
        if (pos >= body.size()) break;
        pos++; // skip colon
        
        // 跳过空白
        while (pos < body.size() && (body[pos] == ' ' || body[pos] == '\t')) pos++;
        if (pos >= body.size()) break;
        
        // 解析 value
        std::string value;
        char c = body[pos];
        
        if (c == '"') {
            // 字符串
            size_t valueEnd = skipJsonString(body, pos);
            value = body.substr(pos + 1, valueEnd - pos - 2);
            pos = valueEnd;
        } else if (c == '{' || c == '[') {
            size_t valueEnd = skipJsonContainer(body, pos);
            value = body.substr(pos, valueEnd - pos);
            pos = valueEnd;
        } else if (c == 'n' && body.compare(pos, 4, "null") == 0) {
            value = "";
            pos += 4;
        } else if (c == 't' && body.compare(pos, 4, "true") == 0) {
            value = "true";
            pos += 4;
        } else if (c == 'f' && body.compare(pos, 5, "false") == 0) {
            value = "false";
            pos += 5;
        } else {
            // 数字或其他
            size_t valueEnd = pos;
            while (valueEnd < body.size() && body[valueEnd] != ',' && body[valueEnd] != '}' && body[valueEnd] != ' ' && body[valueEnd] != '\t') valueEnd++;
            value = body.substr(pos, valueEnd - pos);
            pos = valueEnd;
        }
        
        result[key] = value;
        
        // 循环继续，跳过可能的逗号
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
    // 调试输出原始请求体
    std::cerr << "[DEBUG] handleCreateWall body: " << req.body << std::endl;
    
    auto data = parseJsonBody(req.body);
    
    // 调试输出解析结果
    std::cerr << "[DEBUG] parseJsonBody result: ";
    for (const auto& p : data) {
        std::cerr << p.first << "=" << p.second << ", ";
    }
    std::cerr << std::endl;
    
    if (!data.count("x1") || !data.count("y1") || !data.count("x2") || !data.count("y2")) {
        return jsonError(400, "Missing required fields: x1, y1, x2, y2");
    }
    
    data["id"] = generateUUID();
    
    auto result = db_.createWall(data);
    if (!result.success) {
        std::cerr << "[ERROR] createWall failed: " << result.error << std::endl;
        return jsonError(500, result.error);
    }
    
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