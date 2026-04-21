# =====================================================
# Linux AMD64 交叉编译工具链 (从 Windows)
# =====================================================
#
# 使用方法:
#   cmake .. -DCMAKE_TOOLCHAIN_FILE=cmake/linux_amd64_toolchain.cmake
#
# 依赖 (MSYS2/MinGW 环境):
#   pacman -S mingw-w64-x86_64-cross-binutils mingw-w64-x86_64-cross-gcc
# =====================================================

set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR amd64)

# 交叉编译器路径 (根据实际情况调整)
set(CROSS_ROOT /usr/x86_64-linux-gnu)

# C/C++ 交叉编译器
set(CMAKE_C_COMPILER ${CROSS_ROOT}-gcc)
set(CMAKE_CXX_COMPILER ${CROSS_ROOT}-g++)

# Sysroot (如果需要)
# set(CMAKE_SYSROOT /path/to/sysroot)

# 搜索模式
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# 编译选项
set(CMAKE_C_FLAGS "-march=x86-64-v2" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS "-march=x86-64-v2" CACHE STRING "" FORCE)
