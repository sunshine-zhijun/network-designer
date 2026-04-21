#!/bin/bash
# =====================================================
# 网规工具 - Linux/macOS 构建脚本
# =====================================================
#
# 使用方法:
#   ./build.sh              # Release 构建
#   ./build.sh Debug       # Debug 构建
#   ./build.sh clean        # 清理
# =====================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BUILD_TYPE="${1:-Release}"

echo "============================================"
echo "  网规工具 - Linux/macOS 构建"
echo "============================================"

# 检查依赖
check_dependencies() {
    local missing=()

    # 检查 GCC/Clang
    if ! command -v g++ &> /dev/null && ! command -v clang++ &> /dev/null; then
        missing+=("g++ or clang++")
    fi

    # 检查 CMake
    if ! command -v cmake &> /dev/null; then
        missing+=("cmake")
    fi

    # 检查 SQLite3 开发库
    if ! ldconfig -p 2>/dev/null | grep -q libsqlite3; then
        if ! pkg-config --exists sqlite3 2>/dev/null; then
            # 最后检查头文件
            if [ ! -f /usr/include/sqlite3.h ] && [ ! -f /usr/include/sqlite3/sqlite3.h ]; then
                missing+=("sqlite3 development library")
            fi
        fi
    fi

    if [ ${#missing[@]} -ne 0 ]; then
        echo "错误: 缺少以下依赖:"
        for dep in "${missing[@]}"; do
            echo "  - $dep"
        done
        echo ""
        echo "安装示例 (Ubuntu/Debian):"
        echo "  sudo apt install build-essential cmake libsqlite3-dev"
        echo ""
        echo "安装示例 (CentOS/RHEL):"
        echo "  sudo yum install gcc-c++ cmake sqlite-devel"
        echo ""
        echo "安装示例 (macOS):"
        echo "  brew install cmake sqlite3"
        exit 1
    fi
}

# 清理
clean() {
    echo "[清理] 删除 build 目录..."
    rm -rf build
    echo "[完成]"
}

# 构建
build() {
    echo "[构建] Build type: $BUILD_TYPE"
    echo ""

    # 创建构建目录
    rm -rf build
    mkdir -p build
    cd build

    # CMake 配置
    echo "[1/2] CMake 配置..."
    cmake .. \
        -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
        -DCMAKE_INSTALL_PREFIX=/usr/local

    # 编译
    echo ""
    echo "[2/2] 编译..."
    cmake --build . -j$(nproc)

    # 确认可执行文件存在
    EXE_PATH=$(find . -name "network_planner_server" -type f 2>/dev/null | head -1)
    if [ -z "$EXE_PATH" ]; then
        echo "[警告] 未找到编译产物"
        exit 1
    fi

    echo ""
    echo "============================================"
    echo "  构建完成!"
    echo "============================================"
    echo ""
    echo "可执行文件: $EXE_PATH"
    echo ""
    echo "运行: ./$EXE_PATH [端口]"
    echo "示例: ./$EXE_PATH 8766"
}

# 主流程
case "$BUILD_TYPE" in
    clean)
        clean
        ;;
    *)
        check_dependencies
        build
        ;;
esac
