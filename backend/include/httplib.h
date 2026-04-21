// cpp-httplib single-header HTTP library placeholder
// In production, download from: https://github.com/yhirose/cpp-httplib
// This is a minimal stub for build reference - replace with actual httplib.h

#pragma once
#include <string>
#include <functional>
#include <map>
#include <vector>
#include <sstream>

namespace httplib {

struct Request {
    std::string method;
    std::string path;
    std::string body;
    std::map<std::string, std::string> headers;
    std::map<std::string, std::string> params;
    std::string remote_addr;
};

struct Response {
    int status = 200;
    std::string body;
    std::map<std::string, std::string> headers;
    
    void set_content(const std::string& content, const std::string& content_type) {
        body = content;
        headers["Content-Type"] = content_type;
    }
};

using Handler = std::function<void(const Request&, Response&)>;

class Server {
public:
    Server& Get(const std::string& path, Handler handler) { return *this; }
    Server& Post(const std::string& path, Handler handler) { return *this; }
    Server& Put(const std::string& path, Handler handler) { return *this; }
    Server& Delete(const std::string& path, Handler handler) { return *this; }
    Server& Options(const std::string& path, Handler handler) { return *this; }
    bool listen(const std::string& host, int port) { return true; }
    void stop() {}
    bool is_running() const { return false; }
    void set_pre_routing_handler(std::function<bool(const Request&, Response&)> handler) {}
};

} // namespace httplib
