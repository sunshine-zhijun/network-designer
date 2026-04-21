# =====================================================
# 网规工具 - CMake 构建配置
# =====================================================
# 支持 Windows (MSVC/MinGW) 和 Linux/macOS (GCC/Clang)
#
# 使用方法:
#   mkdir build && cd build
#   cmake ..
#   cmake --build . --config Release
#
# 或者使用 CMake GUI / CLion / VSCode

cmake_minimum_required(VERSION 3.15)
project(NetworkPlanner VERSION 1.0.0 LANGUAGES CXX)

# =====================================================
# C++ 标准
# =====================================================
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# =====================================================
# 输出配置
# =====================================================
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/bin)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_BINARY_DIR}/lib)

# =====================================================
# 编译器选项
# =====================================================
if(MSVC)
    # MSVC 特定选项
    add_compile_options(/W4 /WX-)  # 警告级别4，警告不作为错误
    add_compile_options(/EHsc)    # 异常处理
    add_definitions(-D_CRT_SECURE_NO_WARNINGS)
    add_definitions(-DWIN32_LEAN_AND_MEAN)
else()
    # GCC/Clang 选项
    add_compile_options(-Wall -Wextra -Wpedantic)
    add_compile_options(-O2)
endif()

# =====================================================
# 源码目录
# =====================================================
set(INC_DIR ${CMAKE_SOURCE_DIR}/include)
set(SRC_DIR ${CMAKE_SOURCE_DIR}/src)
set(THIRD_DIR ${CMAKE_SOURCE_DIR}/third_party)

# 添加头文件搜索路径
include_directories(${INC_DIR})

# =====================================================
# 第三方库依赖
# =====================================================

# SQLite3
find_package(SQLite3 QUIET)
if(SQLite3_FOUND)
    message(STATUS "Found SQLite3: ${SQLite3_INCLUDE_DIRS}")
    set(USE_SQLITE3 TRUE)
else()
    # 下载或使用 vendored 版本
    message(STATUS "SQLite3 not found, using bundled source")
    set(USE_SQLITE3 FALSE)
    # SQLite 源码将直接编译
endif()

# =====================================================
# 源文件列表
# =====================================================
set(SERVER_SOURCES
    ${SRC_DIR}/main_server.cpp
    ${SRC_DIR}/database.cpp
    ${SRC_DIR}/api_handlers.cpp
)

set(SERVER_HEADERS
    ${INC_DIR}/server_config.h
    ${INC_DIR}/database.h
    ${INC_DIR}/api_handlers.h
)

# =====================================================
# 可执行文件: network_planner_server
# =====================================================
add_executable(network_planner_server
    ${SERVER_SOURCES}
    ${SERVER_HEADERS}
)

# =====================================================
# SQLite3 链接
# =====================================================
if(SQLite3_FOUND)
    target_link_libraries(network_planner_server SQLite::SQLite3)
else()
    # Windows: 使用系统 SQLite 或需要单独下载
    if(WIN32)
        # 尝试链接 SQLite3 库
        find_library(SQLITE3_LIBRARY NAMES sqlite3 PATHS ${THIRD_DIR})
        if(SQLITE3_LIBRARY)
            target_link_libraries(network_planner_server ${SQLITE3_LIBRARY})
            message(STATUS "Linking with: ${SQLITE3_LIBRARY}")
        else()
            message(WARNING "SQLite3 library not found. Please ensure sqlite3.dll is in PATH or download from https://sqlite.org/download.html")
            # 不链接，在运行时从系统获取
        endif()
    else()
        # Linux/macOS
        find_library(SQLITE3_LIBRARY NAMES sqlite3)
        if(SQLITE3_LIBRARY)
            target_link_libraries(network_planner_server ${SQLITE3_LIBRARY})
        endif()
    endif()
endif()

# =====================================================
# 平台特定配置
# =====================================================
if(WIN32)
    # Windows Socket 库
    if(MSVC)
        target_link_libraries(network_planner_server ws2_32)
    else()
        # MinGW
        target_link_libraries(network_planner_server ws2_32)
    endif()
    
    # 生成 .exe
    set_target_properties(network_planner_server PROPERTIES
        OUTPUT_NAME "network_planner_server"
        SUFFIX ".exe"
    )
else()
    # Unix-like 系统
    find_library(THREAD_LIBRARY pthread REQUIRED)
    target_link_libraries(network_planner_server ${THREAD_LIBRARY})
endif()

# =====================================================
# 可选: 单元测试 (使用 Catch2)
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
endif()

# =====================================================
# 安装目标
# =====================================================
install(TARGETS network_planner_server
    RUNTIME DESTINATION bin
)

install(FILES ${INC_DIR}/*.h
    DESTINATION include/network_planner
)

# =====================================================
# 打印配置信息
# =====================================================
message(STATUS "")
message(STATUS "============================================")
message(STATUS "  网规工具 - 构建配置")
message(STATUS "============================================")
message(STATUS "  C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "  Build Type: ${CMAKE_BUILD_TYPE}")
message(STATUS "  Output: ${CMAKE_RUNTIME_OUTPUT_DIRECTORY}")
message(STATUS "  SQLite3: ${SQLite3_FOUND}")
message(STATUS "============================================")