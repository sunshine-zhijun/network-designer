#pragma once
#include <string>
#include <vector>
#include <sstream>
#include <iomanip>

// Minimal JSON builder (no external deps)
namespace json {

inline std::string escape(const std::string& s) {
    std::ostringstream oss;
    for (char c : s) {
        switch (c) {
            case '"':  oss << "\\\""; break;
            case '\\': oss << "\\\\"; break;
            case '\n': oss << "\\n";  break;
            case '\r': oss << "\\r";  break;
            case '\t': oss << "\\t";  break;
            default:   oss << c;      break;
        }
    }
    return oss.str();
}

inline std::string str(const std::string& s) {
    return "\"" + escape(s) + "\"";
}

inline std::string num(double v) {
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(4) << v;
    return oss.str();
}

inline std::string num(int v) {
    return std::to_string(v);
}

inline std::string boolean(bool v) {
    return v ? "true" : "false";
}

struct Object {
    std::ostringstream oss;
    bool first = true;
    
    Object() { oss << "{"; }
    
    Object& add(const std::string& key, const std::string& val) {
        if (!first) oss << ",";
        oss << "\"" << escape(key) << "\":" << val;
        first = false;
        return *this;
    }
    
    Object& add(const std::string& key, double val) {
        return add(key, num(val));
    }
    
    Object& add(const std::string& key, int val) {
        return add(key, std::to_string(val));
    }
    
    Object& add(const std::string& key, bool val) {
        return add(key, boolean(val));
    }
    
    std::string build() {
        return oss.str() + "}";
    }
};

struct Array {
    std::ostringstream oss;
    bool first = true;
    
    Array() { oss << "["; }
    
    Array& push(const std::string& val) {
        if (!first) oss << ",";
        oss << val;
        first = false;
        return *this;
    }
    
    std::string build() {
        return oss.str() + "]";
    }
};

// Parse a simple JSON string value
inline std::string parseString(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return "";
    pos = json.find(":", pos + search.size());
    if (pos == std::string::npos) return "";
    pos = json.find("\"", pos + 1);
    if (pos == std::string::npos) return "";
    size_t end = json.find("\"", pos + 1);
    if (end == std::string::npos) return "";
    return json.substr(pos + 1, end - pos - 1);
}

// Parse a simple JSON number value
inline double parseNumber(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return 0.0;
    pos = json.find(":", pos + search.size());
    if (pos == std::string::npos) return 0.0;
    // skip whitespace
    while (pos < json.size() && (json[pos] == ':' || json[pos] == ' ')) pos++;
    try { return std::stod(json.substr(pos)); }
    catch (...) { return 0.0; }
}

inline bool parseBoolean(const std::string& json, const std::string& key) {
    std::string search = "\"" + key + "\"";
    size_t pos = json.find(search);
    if (pos == std::string::npos) return false;
    pos = json.find(":", pos + search.size());
    if (pos == std::string::npos) return false;
    size_t tp = json.find("true", pos);
    size_t fp = json.find("false", pos);
    if (tp != std::string::npos && (fp == std::string::npos || tp < fp))
        return true;
    return false;
}

} // namespace json
