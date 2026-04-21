/**
 * 网规工具后端服务 - C++ REST API
 * 
 * 构建依赖:
 *   - cpp-httplib (header-only): https://github.com/yhirose/cpp-httplib
 *   - Windows: ws2_32.lib
 * 
 * 编译命令 (MSVC):
 *   cl /EHsc /std:c++17 /O2 /I include src/main.cpp /Fe:network_planner.exe ws2_32.lib
 * 
 * 编译命令 (GCC/MinGW):
 *   g++ -std=c++17 -O2 -I include src/main.cpp -o network_planner.exe -lws2_32
 */

#define CPPHTTPLIB_OPENSSL_SUPPORT 0
#include <iostream>
#include <string>
#include <vector>
#include <map>
#include <mutex>
#include <sstream>
#include <fstream>
#include <algorithm>
#include <cmath>
#include <chrono>
#include <iomanip>
#include <random>

#include "signal_model.h"
#include "json_helper.h"

// ============================================================
// 全局状态存储（生产环境应使用数据库）
// ============================================================
std::mutex g_mutex;

std::vector<Wall> g_walls;
std::vector<APDevice> g_aps;
double g_scale_m_per_px = 0.05; // 默认比例: 5cm/px (100px = 5m)
int g_canvas_w = 1200;
int g_canvas_h = 800;

// 材质查找表
std::map<std::string, WallMaterial> g_material_table = {
    {"concrete", Materials::CONCRETE},
    {"brick",    Materials::BRICK},
    {"wood",     Materials::WOOD},
    {"glass",    Materials::GLASS},
    {"gypsum",   Materials::GYPSUM},
    {"metal",    Materials::METAL},
    {"floor",    Materials::FLOOR_CEIL}
};

// ============================================================
// UUID生成
// ============================================================
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

// ============================================================
// 简单HTTP服务器（不依赖cpp-httplib，使用WinSock）
// ============================================================
#ifdef _WIN32
  #include <winsock2.h>
  #include <ws2tcpip.h>
  #pragma comment(lib, "ws2_32.lib")
  typedef SOCKET SocketT;
  #define CLOSE_SOCKET closesocket
#else
  #include <sys/socket.h>
  #include <netinet/in.h>
  #include <unistd.h>
  typedef int SocketT;
  #define CLOSE_SOCKET close
  #define INVALID_SOCKET -1
  #define SOCKET_ERROR -1
#endif

// ============================================================
// 路由处理器
// ============================================================

struct HttpRequest {
    std::string method;
    std::string path;
    std::string body;
    std::map<std::string, std::string> headers;
};

struct HttpResponse {
    int status = 200;
    std::string body;
    std::string content_type = "application/json";
};

using RouteHandler = std::function<HttpResponse(const HttpRequest&)>;
std::map<std::string, RouteHandler> g_routes;

// CORS headers
std::string corsHeaders() {
    return "Access-Control-Allow-Origin: *\r\n"
           "Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS\r\n"
           "Access-Control-Allow-Headers: Content-Type\r\n";
}

// ============================================================
// API 处理函数
// ============================================================

// GET /api/health
HttpResponse handleHealth(const HttpRequest&) {
    return {200, R"({"status":"ok","version":"1.0.0"})"};
}

// GET /api/walls
HttpResponse handleGetWalls(const HttpRequest&) {
    std::lock_guard<std::mutex> lock(g_mutex);
    json::Array arr;
    for (const auto& w : g_walls) {
        json::Object obj;
        obj.add("id", json::str(w.id))
           .add("x1", w.x1).add("y1", w.y1)
           .add("x2", w.x2).add("y2", w.y2)
           .add("material_id", json::str(
               // reverse lookup material name
               [&]() -> std::string {
                   for (auto& m : g_material_table)
                       if (m.second.name == w.material.name) return m.first;
                   return "brick";
               }()
           ))
           .add("material_name", json::str(w.material.name))
           .add("atten_2g", w.material.attenuation_2_4ghz)
           .add("atten_5g", w.material.attenuation_5ghz);
        arr.push(obj.build());
    }
    return {200, R"({"walls":)" + arr.build() + "}"};
}

// POST /api/walls
HttpResponse handleAddWall(const HttpRequest& req) {
    std::lock_guard<std::mutex> lock(g_mutex);
    Wall w;
    w.id = generateUUID();
    w.x1 = json::parseNumber(req.body, "x1");
    w.y1 = json::parseNumber(req.body, "y1");
    w.x2 = json::parseNumber(req.body, "x2");
    w.y2 = json::parseNumber(req.body, "y2");
    std::string mat_id = json::parseString(req.body, "material_id");
    if (mat_id.empty()) mat_id = "brick";
    auto it = g_material_table.find(mat_id);
    w.material = (it != g_material_table.end()) ? it->second : Materials::BRICK;
    g_walls.push_back(w);
    
    json::Object resp;
    resp.add("success", true).add("id", json::str(w.id));
    return {200, resp.build()};
}

// PUT /api/walls/:id
HttpResponse handleUpdateWall(const HttpRequest& req) {
    std::lock_guard<std::mutex> lock(g_mutex);
    // Extract id from path like /api/walls/uuid
    std::string path = req.path;
    std::string id = path.substr(path.rfind('/') + 1);
    std::string mat_id = json::parseString(req.body, "material_id");
    
    for (auto& w : g_walls) {
        if (w.id == id) {
            if (!mat_id.empty()) {
                auto it = g_material_table.find(mat_id);
                if (it != g_material_table.end()) w.material = it->second;
            }
            // Optionally update coordinates
            double x1 = json::parseNumber(req.body, "x1");
            if (x1 != 0) { w.x1 = x1; w.y1 = json::parseNumber(req.body, "y1");
                           w.x2 = json::parseNumber(req.body, "x2");
                           w.y2 = json::parseNumber(req.body, "y2"); }
            return {200, R"({"success":true})"};
        }
    }
    return {404, R"({"error":"wall not found"})"};
}

// DELETE /api/walls/:id
HttpResponse handleDeleteWall(const HttpRequest& req) {
    std::lock_guard<std::mutex> lock(g_mutex);
    std::string path = req.path;
    std::string id = path.substr(path.rfind('/') + 1);
    auto it = std::remove_if(g_walls.begin(), g_walls.end(),
        [&](const Wall& w){ return w.id == id; });
    if (it != g_walls.end()) {
        g_walls.erase(it, g_walls.end());
        return {200, R"({"success":true})"};
    }
    return {404, R"({"error":"wall not found"})"};
}

// GET /api/aps
HttpResponse handleGetAPs(const HttpRequest&) {
    std::lock_guard<std::mutex> lock(g_mutex);
    json::Array arr;
    for (const auto& ap : g_aps) {
        json::Object obj;
        obj.add("id", json::str(ap.id))
           .add("x", ap.x).add("y", ap.y)
           .add("freq_ghz", ap.freq_ghz)
           .add("tx_power_dbm", ap.tx_power_dbm)
           .add("mount_type", json::str(ap.mount_type))
           .add("model", json::str(ap.model))
           .add("enabled", ap.enabled);
        arr.push(obj.build());
    }
    return {200, R"({"aps":)" + arr.build() + "}"};
}

// POST /api/aps
HttpResponse handleAddAP(const HttpRequest& req) {
    std::lock_guard<std::mutex> lock(g_mutex);
    APDevice ap;
    ap.id = generateUUID();
    ap.x = json::parseNumber(req.body, "x");
    ap.y = json::parseNumber(req.body, "y");
    ap.freq_ghz = json::parseNumber(req.body, "freq_ghz");
    if (ap.freq_ghz == 0) ap.freq_ghz = 2.4;
    ap.tx_power_dbm = json::parseNumber(req.body, "tx_power_dbm");
    if (ap.tx_power_dbm == 0) ap.tx_power_dbm = 20.0;
    ap.mount_type = json::parseString(req.body, "mount_type");
    if (ap.mount_type.empty()) ap.mount_type = "ceiling";
    ap.model = json::parseString(req.body, "model");
    if (ap.model.empty()) ap.model = "Generic AP";
    ap.enabled = true;
    g_aps.push_back(ap);
    
    json::Object resp;
    resp.add("success", true).add("id", json::str(ap.id));
    return {200, resp.build()};
}

// PUT /api/aps/:id
HttpResponse handleUpdateAP(const HttpRequest& req) {
    std::lock_guard<std::mutex> lock(g_mutex);
    std::string path = req.path;
    std::string id = path.substr(path.rfind('/') + 1);
    
    for (auto& ap : g_aps) {
        if (ap.id == id) {
            double x = json::parseNumber(req.body, "x");
            double y = json::parseNumber(req.body, "y");
            // Only update if provided (non-zero or explicit)
            if (req.body.find("\"x\"") != std::string::npos) ap.x = x;
            if (req.body.find("\"y\"") != std::string::npos) ap.y = y;
            
            std::string mt = json::parseString(req.body, "mount_type");
            if (!mt.empty()) ap.mount_type = mt;
            
            double freq = json::parseNumber(req.body, "freq_ghz");
            if (freq > 0) ap.freq_ghz = freq;
            
            double pwr = json::parseNumber(req.body, "tx_power_dbm");
            if (pwr != 0) ap.tx_power_dbm = pwr;
            
            std::string model = json::parseString(req.body, "model");
            if (!model.empty()) ap.model = model;
            
            if (req.body.find("\"enabled\"") != std::string::npos)
                ap.enabled = json::parseBoolean(req.body, "enabled");
            
            return {200, R"({"success":true})"};
        }
    }
    return {404, R"({"error":"ap not found"})"};
}

// DELETE /api/aps/:id
HttpResponse handleDeleteAP(const HttpRequest& req) {
    std::lock_guard<std::mutex> lock(g_mutex);
    std::string path = req.path;
    std::string id = path.substr(path.rfind('/') + 1);
    auto it = std::remove_if(g_aps.begin(), g_aps.end(),
        [&](const APDevice& a){ return a.id == id; });
    if (it != g_aps.end()) {
        g_aps.erase(it, g_aps.end());
        return {200, R"({"success":true})"};
    }
    return {404, R"({"error":"ap not found"})"};
}

// POST /api/heatmap - 计算热力图数据
HttpResponse handleHeatmap(const HttpRequest& req) {
    std::lock_guard<std::mutex> lock(g_mutex);
    
    // 解析请求参数
    int step = (int)json::parseNumber(req.body, "step");
    if (step <= 0) step = 10; // 采样步长(px)
    int width = (int)json::parseNumber(req.body, "width");
    int height = (int)json::parseNumber(req.body, "height");
    if (width <= 0) width = g_canvas_w;
    if (height <= 0) height = g_canvas_h;
    
    json::Array points;
    
    for (int py = 0; py < height; py += step) {
        for (int px = 0; px < width; px += step) {
            // 取所有启用AP的最强信号
            double best_rssi = -120.0;
            for (const auto& ap : g_aps) {
                if (!ap.enabled) continue;
                double rssi = SignalModel::computeRSSI(
                    ap, (double)px, (double)py,
                    g_scale_m_per_px, g_walls
                );
                if (rssi > best_rssi) best_rssi = rssi;
            }
            
            if (best_rssi > -120.0) {
                auto [r, g, b] = SignalModel::rssiToColor(best_rssi);
                json::Object pt;
                pt.add("x", px).add("y", py)
                  .add("rssi", best_rssi)
                  .add("r", r).add("g", (int)g).add("b", b);
                points.push(pt.build());
            }
        }
    }
    
    return {200, R"({"points":)" + points.build() + ",\"step\":" + std::to_string(step) + "}"};
}

// GET /api/scale
HttpResponse handleGetScale(const HttpRequest&) {
    json::Object obj;
    obj.add("scale_m_per_px", g_scale_m_per_px)
       .add("px_per_meter", 1.0 / g_scale_m_per_px);
    return {200, obj.build()};
}

// POST /api/scale
HttpResponse handleSetScale(const HttpRequest& req) {
    double scale = json::parseNumber(req.body, "scale_m_per_px");
    if (scale > 0) {
        std::lock_guard<std::mutex> lock(g_mutex);
        g_scale_m_per_px = scale;
    }
    return {200, R"({"success":true})"};
}

// GET /api/materials
HttpResponse handleGetMaterials(const HttpRequest&) {
    json::Array arr;
    for (const auto& [id, mat] : g_material_table) {
        json::Object obj;
        obj.add("id", json::str(id))
           .add("name", json::str(mat.name))
           .add("atten_2g", mat.attenuation_2_4ghz)
           .add("atten_5g", mat.attenuation_5ghz)
           .add("thickness", mat.thickness);
        arr.push(obj.build());
    }
    return {200, R"({"materials":)" + arr.build() + "}"};
}

// POST /api/walls/batch (批量导入识别结果)
HttpResponse handleBatchWalls(const HttpRequest& req) {
    std::lock_guard<std::mutex> lock(g_mutex);
    // 简单解析JSON数组: {"walls":[{x1,y1,x2,y2,material_id},...]}
    // 清空现有墙体
    size_t pos = req.body.find("\"walls\"");
    if (pos == std::string::npos)
        return {400, R"({"error":"invalid format"})"};
    
    // 清空旧墙
    g_walls.clear();
    
    // 逐段解析
    size_t start = req.body.find('[', pos);
    size_t end = req.body.rfind(']');
    if (start == std::string::npos || end == std::string::npos)
        return {400, R"({"error":"invalid array"})"};
    
    std::string arr_str = req.body.substr(start + 1, end - start - 1);
    // 简单按 "}" 分割
    size_t p = 0;
    int count = 0;
    while ((p = arr_str.find('{', p)) != std::string::npos) {
        size_t e = arr_str.find('}', p);
        if (e == std::string::npos) break;
        std::string item = arr_str.substr(p, e - p + 1);
        
        Wall w;
        w.id = generateUUID();
        w.x1 = json::parseNumber(item, "x1");
        w.y1 = json::parseNumber(item, "y1");
        w.x2 = json::parseNumber(item, "x2");
        w.y2 = json::parseNumber(item, "y2");
        std::string mat_id = json::parseString(item, "material_id");
        if (mat_id.empty()) mat_id = "concrete";
        auto it = g_material_table.find(mat_id);
        w.material = (it != g_material_table.end()) ? it->second : Materials::CONCRETE;
        g_walls.push_back(w);
        count++;
        p = e + 1;
    }
    
    json::Object resp;
    resp.add("success", true).add("count", count);
    return {200, resp.build()};
}

// POST /api/clear - 清空画布
HttpResponse handleClear(const HttpRequest&) {
    std::lock_guard<std::mutex> lock(g_mutex);
    g_walls.clear();
    g_aps.clear();
    return {200, R"({"success":true})"};
}

// ============================================================
// HTTP服务器核心
// ============================================================

std::string buildResponse(int status, const std::string& body,
                           const std::string& content_type = "application/json") {
    std::map<int, std::string> status_text = {
        {200, "OK"}, {201, "Created"}, {400, "Bad Request"},
        {404, "Not Found"}, {500, "Internal Server Error"}
    };
    std::string text = status_text.count(status) ? status_text.at(status) : "OK";
    
    std::ostringstream oss;
    oss << "HTTP/1.1 " << status << " " << text << "\r\n";
    oss << "Content-Type: " << content_type << "; charset=utf-8\r\n";
    oss << "Content-Length: " << body.size() << "\r\n";
    oss << corsHeaders();
    oss << "Connection: close\r\n\r\n";
    oss << body;
    return oss.str();
}

HttpRequest parseRequest(const std::string& raw) {
    HttpRequest req;
    std::istringstream ss(raw);
    std::string line;
    
    // First line: METHOD PATH HTTP/1.1
    std::getline(ss, line);
    if (!line.empty() && line.back() == '\r') line.pop_back();
    std::istringstream first(line);
    first >> req.method >> req.path;
    
    // Headers
    while (std::getline(ss, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.empty()) break;
        size_t col = line.find(':');
        if (col != std::string::npos) {
            std::string key = line.substr(0, col);
            std::string val = line.substr(col + 2); // skip ": "
            req.headers[key] = val;
        }
    }
    
    // Body
    std::string body, bl;
    while (std::getline(ss, bl)) {
        body += bl + "\n";
    }
    req.body = body;
    
    return req;
}

HttpResponse dispatchRequest(const HttpRequest& req) {
    // CORS preflight
    if (req.method == "OPTIONS") {
        return {200, ""};
    }
    
    std::string path = req.path;
    // Remove query string
    size_t q = path.find('?');
    if (q != std::string::npos) path = path.substr(0, q);
    
    // Route matching
    if (req.method == "GET" && path == "/api/health")
        return handleHealth(req);
    else if (req.method == "GET" && path == "/api/walls")
        return handleGetWalls(req);
    else if (req.method == "POST" && path == "/api/walls")
        return handleAddWall(req);
    else if (req.method == "POST" && path == "/api/walls/batch")
        return handleBatchWalls(req);
    else if (req.method == "PUT" && path.substr(0, 11) == "/api/walls/")
        return handleUpdateWall(req);
    else if (req.method == "DELETE" && path.substr(0, 11) == "/api/walls/")
        return handleDeleteWall(req);
    else if (req.method == "GET" && path == "/api/aps")
        return handleGetAPs(req);
    else if (req.method == "POST" && path == "/api/aps")
        return handleAddAP(req);
    else if (req.method == "PUT" && path.substr(0, 9) == "/api/aps/")
        return handleUpdateAP(req);
    else if (req.method == "DELETE" && path.substr(0, 9) == "/api/aps/")
        return handleDeleteAP(req);
    else if (req.method == "POST" && path == "/api/heatmap")
        return handleHeatmap(req);
    else if (req.method == "GET" && path == "/api/scale")
        return handleGetScale(req);
    else if (req.method == "POST" && path == "/api/scale")
        return handleSetScale(req);
    else if (req.method == "GET" && path == "/api/materials")
        return handleGetMaterials(req);
    else if (req.method == "POST" && path == "/api/clear")
        return handleClear(req);
    
    return {404, R"({"error":"not found"})"};
}

void handleClient(SocketT client_sock) {
    char buf[65536] = {0};
    int received = recv(client_sock, buf, sizeof(buf) - 1, 0);
    if (received <= 0) {
        CLOSE_SOCKET(client_sock);
        return;
    }
    
    std::string raw(buf, received);
    HttpRequest req = parseRequest(raw);
    HttpResponse resp = dispatchRequest(req);
    
    std::string response = buildResponse(resp.status, resp.body, resp.content_type);
    send(client_sock, response.c_str(), (int)response.size(), 0);
    CLOSE_SOCKET(client_sock);
}

int main() {
    std::cout << "=================================\n";
    std::cout << "  网规工具后端服务 v1.0\n";
    std::cout << "=================================\n";

#ifdef _WIN32
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        std::cerr << "WSAStartup failed\n";
        return 1;
    }
#endif

    int port = 8766;
    SocketT server_sock = socket(AF_INET, SOCK_STREAM, 0);
    if (server_sock == INVALID_SOCKET) {
        std::cerr << "socket() failed\n";
        return 1;
    }

    // Allow reuse
    int opt = 1;
    setsockopt(server_sock, SOL_SOCKET, SO_REUSEADDR, (const char*)&opt, sizeof(opt));

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    addr.sin_addr.s_addr = INADDR_ANY;

    if (bind(server_sock, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        std::cerr << "bind() failed on port " << port << "\n";
        CLOSE_SOCKET(server_sock);
        return 1;
    }

    if (listen(server_sock, 10) == SOCKET_ERROR) {
        std::cerr << "listen() failed\n";
        CLOSE_SOCKET(server_sock);
        return 1;
    }

    std::cout << "服务已启动: http://localhost:" << port << "\n";
    std::cout << "前端地址:   http://localhost:" << port << "/\n";
    std::cout << "按 Ctrl+C 停止服务\n\n";

    while (true) {
        sockaddr_in client_addr{};
        socklen_t client_len = sizeof(client_addr);
        SocketT client = accept(server_sock, (sockaddr*)&client_addr, &client_len);
        if (client == INVALID_SOCKET) continue;
        
        // 简单同步处理（生产环境应用线程池）
        handleClient(client);
    }

#ifdef _WIN32
    WSACleanup();
#endif
    return 0;
}
