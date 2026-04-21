# =====================================================
# 网规工具 - CMake 构建配置
# =====================================================
# 支持平台:
#   - Windows (MSVC, MinGW-w64)
#   - Linux AMD64 (GCC, Clang)
#   - macOS (GCC, Clang)
#
# 使用方法:
#   Windows:
#     mkdir build && cd build
#     cmake .. -G "MinGW Makefiles"  # 或 "Visual Studio 17 2022"
#     cmake --build . --config Release
#
#   Linux/macOS:
#     mkdir build && cd build
#     cmake .. -DCMAKE_BUILD_TYPE=Release
#     cmake --build .
#
#   交叉编译 (Linux from Windows):
#     cmake .. -DCMAKE_TOOLCHAIN_FILE=../cmake/linux_amd64_toolchain.cmake
#
# =====================================================

cmake_minimum_required(VERSION 3.15)
project(NetworkPlanner VERSION 1.0.0 LANGUAGES CXX)

# =====================================================
# C++ 标准配置
# =====================================================
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# =====================================================
# 构建类型
# =====================================================
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE "Release" CACHE STRING "Build type" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY STRINGS "Debug" "Release" "RelWithDebInfo" "MinSizeRel")
endif()

# =====================================================
# 输出目录配置
# =====================================================
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)

# =====================================================
# 编译器选项
# =====================================================
if(MSVC)
    # MSVC 特定选项
    add_compile_options(/W4 /WX-)
    add_compile_options(/EHsc)
    add_definitions(-D_CRT_SECURE_NO_WARNINGS)
    add_definitions(-DWIN32_LEAN_AND_MEAN)
    add_definitions(-D_CONSOLE)
elseif(MINGW)
    # MinGW 特定选项
    add_compile_options(-Wall -Wextra -pedantic)
    add_definitions(-DWIN32_LEAN_AND_MEAN)
    add_definitions(-D_CONSOLE)
elseif(UNIX AND NOT APPLE)
    # Linux GCC/Clang
    add_compile_options(-Wall -Wextra -pedantic)
    add_compile_options(-fPIC)
    # 启用 POSIX extensions
    add_definitions(-D_GNU_SOURCE)
elseif(APPLE)
    # macOS
    add_compile_options(-Wall -Wextra -pedantic)
    add_compile_options(-mmacosx-version-min=10.14)
endif()

# Release 模式优化
if(CMAKE_BUILD_TYPE STREQUAL "Release" OR CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
    if(MSVC)
        add_compile_options(/O2 /Ob2 /Oi /Ot)
    else()
        add_compile_options(-O2 -march=native)
    endif()
endif()

# =====================================================
# 源码目录
# =====================================================
set(INC_DIR ${CMAKE_SOURCE_DIR}/include)
set(SRC_DIR ${CMAKE_SOURCE_DIR}/src)
set(THIRD_DIR ${CMAKE_SOURCE_DIR}/third_party)

include_directories(${INC_DIR})

# =====================================================
# 平台检测
# =====================================================
set(PLATFORM_WINDOWS FALSE)
set(PLATFORM_LINUX FALSE)
set(PLATFORM_MACOS FALSE)
set(PLATFORM_POSIX FALSE)

if(WIN32)
    set(PLATFORM_WINDOWS TRUE)
    message(STATUS "Detected platform: Windows")
elseif(UNIX AND NOT APPLE)
    set(PLATFORM_LINUX TRUE)
    set(PLATFORM_POSIX TRUE)
    message(STATUS "Detected platform: Linux")
elseif(APPLE)
    set(PLATFORM_MACOS TRUE)
    set(PLATFORM_POSIX TRUE)
    message(STATUS "Detected platform: macOS")
endif()

# =====================================================
# 第三方库依赖
# =====================================================

# --- SQLite3 ---
set(USE_SQLITE3 TRUE)
set(SQLITE3_SOURCES "")

find_package(SQLite3 QUIET)
if(SQLite3_FOUND)
    message(STATUS "Found system SQLite3: ${SQLite3_INCLUDE_DIRS}")
else()
    # 检查是否有 vendored 源码
    if(EXISTS ${THIRD_DIR}/sqlite3.c AND EXISTS ${THIRD_DIR}/sqlite3.h)
        message(STATUS "Using bundled SQLite3 source")
        set(USE_SQLITE3 TRUE)
        set(SQLITE3_SOURCES ${THIRD_DIR}/sqlite3.c)
        include_directories(${THIRD_DIR})
    else()
        message(STATUS "SQLite3 not found, will try pkg-config or fallback")
        # Linux/macOS 尝试 pkg-config
        if(PLATFORM_POSIX)
            find_package(PkgConfig QUIET)
            if(PkgConfig_FOUND)
                pkg_check_modules(SQLITE3 REQUIRED sqlite3)
                if(SQLITE3_FOUND)
                    set(SQLite3_FOUND TRUE)
                    set(SQLite3_INCLUDE_DIRS ${SQLITE3_INCLUDE_DIRS})
                    set(SQLite3_LIBRARIES ${SQLITE3_LIBRARIES})
                endif()
            endif()
        endif()
    endif()
endif()

# =====================================================
# 源文件列表
# =====================================================
set(SERVER_SOURCES
    ${SRC_DIR}/main_server.cpp
    ${SRC_DIR}/database.cpp
    ${SRC_DIR}/api_handlers.cpp
)

# SQLite3 源码
if(SQLITE3_SOURCES)
    list(APPEND SERVER_SOURCES ${SQLITE3_SOURCES})
endif()

set(SERVER_HEADERS
    ${INC_DIR}/server_config.h
    ${INC_DIR}/database.h
    ${INC_DIR}/api_handlers.h
)

# =====================================================
# 可执行文件
# =====================================================
add_executable(network_planner_server
    ${SERVER_SOURCES}
    ${SERVER_HEADERS}
)

# =====================================================
# SQLite3 链接
# =====================================================
if(SQLite3_FOUND)
    if(MSVC)
        target_link_libraries(network_planner_server SQLite::SQLite3)
    elseif(CMAKE_VERSION VERSION_GREATER_EQUAL "3.26")
        target_link_libraries(network_planner_server SQLite::SQLite3)
    else()
        target_include_directories(network_planner_server PRIVATE ${SQLite3_INCLUDE_DIRS})
        target_link_libraries(network_planner_server ${SQLite3_LIBRARIES})
    endif()
elseif(SQLITE3_SOURCES)
    # 使用 bundled 源码，无需额外链接
    message(STATUS "Using bundled SQLite3, no external linking needed")
else()
    # 尝试 find_library
    if(PLATFORM_POSIX)
        find_library(SQLITE3_LIB NAMES sqlite3 REQUIRED)
        target_link_libraries(network_planner_server ${SQLITE3_LIB})
    else()
        message(WARNING "SQLite3 library not found. On Windows, ensure sqlite3.dll is in PATH")
    endif()
endif()

# =====================================================
# 平台特定配置
# =====================================================
if(PLATFORM_WINDOWS)
    # Windows Socket 库 (Winsock2)
    if(MINGW)
        target_link_libraries(network_planner_server ws2_32)
    else()
        target_link_libraries(network_planner_server ws2_32)
    endif()

    # 设置输出文件名
    set_target_properties(network_planner_server PROPERTIES
        OUTPUT_NAME "network_planner_server"
        SUFFIX ".exe"
    )

    # Windows 安装
    install(TARGETS network_planner_server
        RUNTIME DESTINATION bin
    )
    install(FILES ${THIRD_DIR}/sqlite3.dll
        DESTINATION bin
        OPTIONAL
    )

elseif(PLATFORM_LINUX)
    # Linux 特定配置
    target_link_libraries(network_planner_server pthread dl)

    # Linux 安装
    install(TARGETS network_planner_server
        RUNTIME DESTINATION bin
    )
    install(FILES ${INC_DIR}/*.h
        DESTINATION include/network_planner
    )

    # 创建 man page 目录
    install(DIRECTORY docs/man
        DESTINATION share/man
        OPTIONAL
    )

elseif(PLATFORM_MACOS)
    # macOS 特定配置
    target_link_libraries(network_planner_server pthread)

    # macOS 应用包
    set_target_properties(network_planner_server PROPERTIES
        MACOSX_BUNDLE TRUE
        MACOSX_BUNDLE_SHORT_VERSION_STRING ${PROJECT_VERSION}
        MACOSX_BUNDLE_LONG_VERSION_STRING ${PROJECT_VERSION}
    )

    install(TARGETS network_planner_server
        BUNDLE DESTINATION bin
    )
endif()

# =====================================================
# 可选: 单元测试 (Catch2)
# =====================================================
option(BUILD_TESTS "Build unit tests" OFF)
if(BUILD_TESTS)
    include(FetchContent)
    FetchContent_Declare(
        Catch2
        GIT_REPOSITORY https://github.com/catchorg/Catch2.git
        GIT_TAG v3.0.1
    )
    FetchContent_MakeAvailable(Catch2)

    add_executable(tests
        ${SRC_DIR}/tests.cpp
    )
    target_link_libraries(tests Catch2::Catch2WithMain)
    target_include_directories(tests PRIVATE ${INC_DIR})
endif()

# =====================================================
# 可选: 静态分析
# =====================================================
option(ENABLE_CLANG_TIDY "Enable clang-tidy static analysis" OFF)
if(ENABLE_CLANG_TIDY AND NOT MSVC)
    find_program(CLANG_TIDY clang-tidy)
    if(CLANG_TIDY)
        set_target_properties(network_planner_server PROPERTIES
            CXX_CLANG_TIDY ${CLANG_TIDY}
        )
        message(STATUS "clang-tidy enabled")
    endif()
endif()

# =====================================================
# 可选: 链接时优化 (LTO)
# =====================================================
option(ENABLE_LTO "Enable Link-Time Optimization" OFF)
if(ENABLE_LTO)
    include(CheckIPOSupported)
    check_ipo_supported(RESULT LTO_SUPPORTED OUTPUT LTO_ERROR)
    if(LTO_SUPPORTED)
        set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)
        message(STATUS "LTO enabled")
    else()
        message(WARNING "LTO not supported: ${LTO_ERROR}")
    endif()
endif()

# =====================================================
# 打印配置信息
# =====================================================
message(STATUS "")
message(STATUS "============================================")
message(STATUS "  网规工具 - CMake 配置")
message(STATUS "============================================")
message(STATUS "  Version: ${PROJECT_VERSION}")
message(STATUS "  C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "  Build Type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  Compiler: ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION}")
message(STATUS "  Platform: ${CMAKE_SYSTEM_NAME}")
message(STATUS "  Output: ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}")
message(STATUS "  SQLite3: ${SQLite3_FOUND}")
message(STATUS "  Build Tests: ${BUILD_TESTS}")
message(STATUS "============================================")
