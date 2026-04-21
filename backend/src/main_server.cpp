/**
 * 网规工具 - C++ 后端 HTTP 服务器主程序
 * 
 * 功能：
 *   - HTTP REST API 服务
 *   - SQLite 数据存储
 *   - 静态文件服务（可选）
 * 
 * 编译命令 (MinGW):
 *   g++ -std=c++17 -O2 -I include -o server.exe ^
 *     src/database.cpp src/api_handlers.cpp src/main_server.cpp ^
 *     -lws2_32 -lsqlite3
 * 
 * 编译命令 (MSVC):
 *   cl /EHsc /std:c++17 /O2 /I include ^
 *     src/database.cpp src/api_handlers.cpp src/main_server.cpp ^
 *     /Fe:server.exe ws2_32.lib sqlite3.lib
 */

#include <iostream>
#include <string>
#include <map>
#include <mutex>
#include <thread>
#include <chrono>
#include <regex>

#include "database.h"
#include "api_handlers.h"
#include "server_config.h"

// Windows Socket 初始化
#ifdef _WIN32
    #define WIN32_LEAN_AND_MEAN
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")

    static WSADATA g_wsaData;
    static bool g_wsaInitialized = false;

    static bool initWSA() {
        if (!g_wsaInitialized) {
            int result = WSAStartup(MAKEWORD(2, 2), &g_wsaData);
            if (result != 0) {
                std::cerr << "[ERROR] WSAStartup failed: " << result << std::endl;
                return false;
            }
            g_wsaInitialized = true;
        }
        return true;
    }
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <unistd.h>
    #include <arpa/inet.h>
    typedef int SOCKET;
    #define INVALID_SOCKET (-1)
    #define SOCKET_ERROR (-1)
    #define closesocket close

    static bool initWSA() {
        return true;  // Linux 不需要 WSA 初始化
    }
#endif

// 全局变量
static Database& g_db = Database::getInstance();
static SOCKET g_serverSocket = INVALID_SOCKET;
static bool g_running = true;

// 清理Socket
inline void cleanupSocket(SOCKET sock) {
    if (sock != INVALID_SOCKET) {
        #ifdef _WIN32
            closesocket(sock);
        #else
            close(sock);
        #endif
    }
}

// 读取HTTP请求
bool readRequest(SOCKET clientSocket, std::string& method, std::string& path, 
                 std::map<std::string, std::string>& headers, std::string& body) {
    char buffer[8192];
    int bytesReceived = recv(clientSocket, buffer, sizeof(buffer) - 1, 0);
    
    if (bytesReceived <= 0) return false;
    buffer[bytesReceived] = '\0';
    
    std::string request(buffer);
    
    // 解析请求行
    std::istringstream ss(request);
    ss >> method >> path;
    
    // 解析请求头
    std::string line;
    while (std::getline(ss, line) && line != "\r") {
        size_t colonPos = line.find(':');
        if (colonPos != std::string::npos) {
            std::string key = line.substr(0, colonPos);
            std::string value = line.substr(colonPos + 1);
            // 去除空格
            while (value[0] == ' ') value = value.substr(1);
            headers[key] = value;
        }
    }
    
    // 检查是否有body
    size_t bodyPos = request.find("\r\n\r\n");
    if (bodyPos != std::string::npos) {
        body = request.substr(bodyPos + 4);
    }
    
    return true;
}

// 发送HTTP响应
bool sendResponse(SOCKET clientSocket, int statusCode, const std::string& body,
                  const std::string& contentType = "application/json") {
    std::ostringstream ss;
    ss << "HTTP/1.1 " << statusCode << " "
       << (statusCode == 200 ? "OK" : statusCode == 404 ? "Not Found" : "Bad Request")
       << "\r\n";
    ss << "Content-Type: " << contentType << "; charset=utf-8\r\n";
    ss << "Content-Length: " << body.size() << "\r\n";
    ss << "Access-Control-Allow-Origin: *\r\n";
    ss << "Connection: close\r\n";
    ss << "\r\n";
    ss << body;
    
    std::string response = ss.str();
    int sent = send(clientSocket, response.c_str(), response.size(), 0);
    return sent > 0;
}

// 处理客户端请求
void handleClient(SOCKET clientSocket) {
    try {
        std::string method, path, body;
        std::map<std::string, std::string> headers;
        
        if (!readRequest(clientSocket, method, path, headers, body)) {
            cleanupSocket(clientSocket);
            return;
        }
        
        std::cout << "[REQUEST] " << method << " " << path << std::endl;
        
        // 解析查询参数
        std::map<std::string, std::string> queryParams;
        size_t queryPos = path.find('?');
        if (queryPos != std::string::npos) {
            std::string queryString = path.substr(queryPos + 1);
            path = path.substr(0, queryPos);
            
            std::istringstream ss(queryString);
            std::string param;
            while (std::getline(ss, param, '&')) {
                size_t eqPos = param.find('=');
                if (eqPos != std::string::npos) {
                    queryParams[param.substr(0, eqPos)] = param.substr(eqPos + 1);
                }
            }
        }
        
        // 构建请求
        Request req;
        req.method = method;
        req.path = path;
        req.body = body;
        req.queryParams = queryParams;
        req.headers = headers;
        
        // 路由处理
        ApiRouter router(g_db);
        Response res = router.handle(req);
        
        // 发送响应
        sendResponse(clientSocket, res.statusCode, res.body);
        
    } catch (const std::exception& e) {
        std::cerr << "[ERROR] Exception: " << e.what() << std::endl;
        sendResponse(clientSocket, 500, "{\"code\":500,\"message\":\"Internal error\"}");
    }
    
    cleanupSocket(clientSocket);
}

// 启动服务器
bool startServer(int port) {
    // 初始化WSA
    if (!initWSA()) return false;
    
    // 创建Socket
    g_serverSocket = socket(AF_INET, SOCK_STREAM, 0);
    if (g_serverSocket == INVALID_SOCKET) {
        std::cerr << "[ERROR] Failed to create socket" << std::endl;
        return false;
    }
    
    // 绑定地址
    sockaddr_in serverAddr;
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_addr.s_addr = INADDR_ANY;
    serverAddr.sin_port = htons(port);
    
    if (bind(g_serverSocket, (sockaddr*)&serverAddr, sizeof(serverAddr)) == SOCKET_ERROR) {
        std::cerr << "[ERROR] Failed to bind to port " << port << std::endl;
        cleanupSocket(g_serverSocket);
        return false;
    }
    
    // 监听
    if (listen(g_serverSocket, MAX_CONNECTIONS) == SOCKET_ERROR) {
        std::cerr << "[ERROR] Failed to listen" << std::endl;
        cleanupSocket(g_serverSocket);
        return false;
    }
    
    std::cout << "[SERVER] Listening on port " << port << std::endl;
    return true;
}

// 停止服务器
void stopServer() {
    g_running = false;
    if (g_serverSocket != INVALID_SOCKET) {
        cleanupSocket(g_serverSocket);
        g_serverSocket = INVALID_SOCKET;
    }
    #ifdef _WIN32
        WSACleanup();
    #endif
    std::cout << "[SERVER] Stopped" << std::endl;
}

// 主循环
void runServerLoop() {
    while (g_running) {
        sockaddr_in clientAddr;
        socklen_t clientAddrLen = sizeof(clientAddr);

        SOCKET clientSocket = accept(g_serverSocket, (sockaddr*)&clientAddr, &clientAddrLen);
        if (clientSocket == INVALID_SOCKET) {
            if (g_running) {
                std::cerr << "[ERROR] Failed to accept connection" << std::endl;
            }
            continue;
        }
        
        // 为每个客户端创建新线程
        std::thread(handleClient, clientSocket).detach();
    }
}

// 信号处理
#ifdef _WIN32
    #include <csignal>
    
    BOOL WINAPI consoleHandler(DWORD dwType) {
        if (dwType == CTRL_C_EVENT || dwType == CTRL_BREAK_EVENT) {
            std::cout << "\n[SERVER] Shutting down..." << std::endl;
            stopServer();
            exit(0);
        }
        return TRUE;
    }
#else
    #include <signal.h>
    
    void signalHandler(int sig) {
        std::cout << "\n[SERVER] Shutting down..." << std::endl;
        stopServer();
        exit(0);
    }
#endif

// 主函数
int main(int argc, char* argv[]) {
    std::cout << "============================================" << std::endl;
    std::cout << "  网规工具 - C++ 后端服务 v1.0" << std::endl;
    std::cout << "============================================" << std::endl;
    
    // 解析端口参数
    int port = SERVER_PORT;
    if (argc > 1) {
        port = atoi(argv[1]);
    }
    
    // 初始化数据库
    std::cout << "[DB] Initializing database..." << std::endl;
    if (!g_db.initialize(DB_PATH)) {
        std::cerr << "[ERROR] Failed to initialize database" << std::endl;
        return 1;
    }
    
    // 设置信号处理
    #ifdef _WIN32
        SetConsoleCtrlHandler(consoleHandler, TRUE);
    #else
        signal(SIGINT, signalHandler);
        signal(SIGTERM, signalHandler);
    #endif
    
    // 启动服务器
    std::cout << "[SERVER] Starting server on port " << port << "..." << std::endl;
    if (!startServer(port)) {
        std::cerr << "[ERROR] Failed to start server" << std::endl;
        return 1;
    }
    
    std::cout << "[SERVER] Server ready!" << std::endl;
    std::cout << "[SERVER] API Base URL: http://localhost:" << port << "/api" << std::endl;
    std::cout << "[SERVER] Press Ctrl+C to stop" << std::endl;
    
    // 运行主循环
    runServerLoop();
    
    return 0;
}