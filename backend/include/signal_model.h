#pragma once
#include <vector>
#include <cmath>
#include <string>

// 墙体材质及其信号衰减参数
struct WallMaterial {
    std::string name;
    double attenuation_2_4ghz; // dB per wall at 2.4GHz
    double attenuation_5ghz;   // dB per wall at 5GHz
    double thickness;          // meters
};

// 预定义材质
namespace Materials {
    const WallMaterial CONCRETE    = {"混凝土承重墙", 15.0, 20.0, 0.20};
    const WallMaterial BRICK       = {"砖墙",        12.0, 17.0, 0.15};
    const WallMaterial WOOD        = {"木质隔断",     4.0,  6.0,  0.05};
    const WallMaterial GLASS       = {"玻璃幕墙",     3.0,  5.0,  0.01};
    const WallMaterial GYPSUM      = {"石膏板",       3.5,  5.5,  0.025};
    const WallMaterial METAL       = {"金属",        20.0, 25.0, 0.005};
    const WallMaterial FLOOR_CEIL  = {"楼板/天花板",  18.0, 22.0, 0.20};
}

// 墙体线段
struct Wall {
    double x1, y1, x2, y2;  // 像素坐标
    WallMaterial material;
    std::string id;
};

// AP设备
struct APDevice {
    std::string id;
    double x, y;          // 像素坐标
    double freq_ghz;       // 2.4 or 5.0
    double tx_power_dbm;   // 发射功率 dBm
    std::string mount_type; // ceiling/wall/desktop
    std::string model;
    bool enabled;
};

// 热力图像素点信号强度
struct HeatMapPoint {
    int px, py;
    double rssi_dbm;
};

// 信号传播模型
class SignalModel {
public:
    // Log-distance path loss model
    // PL(d) = PL(d0) + 10*n*log10(d/d0)
    static double pathLoss(double distance_m, double freq_ghz) {
        if (distance_m <= 0.1) distance_m = 0.1;
        // Free space path loss at reference distance 1m
        double pl0 = 20.0 * std::log10(freq_ghz * 1e9) 
                   - 147.55; // FSPL formula simplified
        // n=3.0 for indoor propagation exponent
        double n = 3.0;
        double pl = pl0 + 10.0 * n * std::log10(distance_m);
        return pl;
    }

    // 计算穿过墙壁的总衰减
    static double wallAttenuation(
        double ax, double ay,    // AP位置
        double px, double py,    // 目标点
        const std::vector<Wall>& walls,
        double freq_ghz
    ) {
        double total_atten = 0.0;
        for (const auto& wall : walls) {
            if (segmentsIntersect(ax, ay, px, py,
                                  wall.x1, wall.y1, wall.x2, wall.y2)) {
                double a = (freq_ghz < 3.0) 
                    ? wall.material.attenuation_2_4ghz
                    : wall.material.attenuation_5ghz;
                total_atten += a;
            }
        }
        return total_atten;
    }

    // 计算RSSI
    static double computeRSSI(
        const APDevice& ap,
        double px, double py,     // 目标点像素坐标
        double scale_m_per_px,    // 比例尺: 米/像素
        const std::vector<Wall>& walls
    ) {
        double dx = (px - ap.x) * scale_m_per_px;
        double dy = (py - ap.y) * scale_m_per_px;
        double dist = std::sqrt(dx*dx + dy*dy);
        
        double pl = pathLoss(dist, ap.freq_ghz);
        double wall_loss = wallAttenuation(ap.x, ap.y, px, py, walls, ap.freq_ghz);
        
        double rssi = ap.tx_power_dbm - pl - wall_loss;
        return rssi;
    }

    // 线段相交检测
    static bool segmentsIntersect(
        double ax, double ay, double bx, double by,
        double cx, double cy, double dx, double dy
    ) {
        double d1x = bx - ax, d1y = by - ay;
        double d2x = dx - cx, d2y = dy - cy;
        double cross = d1x * d2y - d1y * d2x;
        if (std::abs(cross) < 1e-10) return false;
        
        double t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
        double u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
        
        return (t >= 0 && t <= 1 && u >= 0 && u <= 1);
    }

    // RSSI转颜色 (for heatmap)
    // returns {r, g, b} 0-255
    static std::tuple<int,int,int> rssiToColor(double rssi) {
        // -30 excellent (green) to -90 poor (red)
        double norm = std::max(0.0, std::min(1.0, (rssi + 90.0) / 60.0));
        int r, g, b;
        if (norm < 0.25) {
            // red to orange
            r = 255; g = (int)(norm * 4 * 165); b = 0;
        } else if (norm < 0.5) {
            // orange to yellow
            double t = (norm - 0.25) * 4;
            r = 255; g = (int)(165 + t * 90); b = 0;
        } else if (norm < 0.75) {
            // yellow to light green
            double t = (norm - 0.5) * 4;
            r = (int)(255 * (1 - t)); g = 255; b = 0;
        } else {
            // green to blue-green
            double t = (norm - 0.75) * 4;
            r = 0; g = (int)(255 * (1 - t * 0.3)); b = (int)(t * 100);
        }
        return {r, g, b};
    }
};
