@echo off
REM =====================================================
REM 网规工具 - Windows 构建脚本
REM =====================================================
REM
REM 依赖:
REM   - MinGW-w64 (g++, mingw32-make)
REM   - CMake 3.15+
REM   - SQLite3 (sqlite3.dll 或 libsqlite3.a)
REM
REM 使用方法:
REM   build.bat              # CMake 构建 (推荐)
REM   build.bat legacy       # 旧版直接编译
REM   build.bat clean        # 清理
REM
REM =====================================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set "BUILD_TYPE=%1"

if "%BUILD_TYPE%"=="clean" goto clean
if "%BUILD_TYPE%"=="legacy" goto legacy
if "%BUILD_TYPE%"=="" goto cmake_build

:cmake_build
echo ========================================
echo   网规工具 - CMake 构建 (Windows)
echo ========================================
echo.

REM 检查 CMake
where cmake >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 CMake，请安装 CMake 3.15+
    echo 下载地址: https://cmake.org/download/
    pause
    exit /b 1
)

REM 检查 MinGW
where g++ >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 g++，请安装 MinGW-w64
    echo 推荐使用 MSYS2: https://www.msys2.org/
    echo 安装命令: pacman -S mingw-w64-x86_64-gcc
    pause
    exit /b 1
)

REM 清理旧构建
if exist "build" (
    echo [清理] 删除旧 build 目录...
    rmdir /s /q build 2>nul
)

REM 创建构建目录
echo [1/3] 创建构建目录...
mkdir build 2>nul

REM CMake 配置
echo.
echo [2/3] CMake 配置...
cd build
cmake .. -G "MinGW Makefiles" -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 (
    echo [错误] CMake 配置失败
    cd ..
    pause
    exit /b 1
)

REM 编译
echo.
echo [3/3] 编译...
cmake --build . --config Release
if errorlevel 1 (
    echo [错误] 编译失败
    cd ..
    pause
    exit /b 1
)

cd ..

echo.
echo ========================================
echo   编译成功!
echo ========================================
echo.
echo 可执行文件: backend\build\bin\network_planner_server.exe
echo.
echo 运行: backend\build\bin\network_planner_server.exe [端口]
echo 示例: backend\build\bin\network_planner_server.exe 8766
echo.
pause
goto :end

:legacy
echo ========================================
echo   网规工具 - 旧版直接编译
echo ========================================

REM 清理
if exist server.exe del server.exe
if exist *.o del *.o 2>nul

REM 检查 g++
where g++ >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 g++
    pause
    exit /b 1
)

REM 编译
echo [编译] database.cpp...
g++ -std=c++17 -O2 -c src\database.cpp -I include -o database.o
if errorlevel 1 goto :error

echo [编译] api_handlers.cpp...
g++ -std=c++17 -O2 -c src\api_handlers.cpp -I include -o api_handlers.o
if errorlevel 1 goto :error

echo [链接] server.exe...
g++ -std=c++17 -O2 -o server.exe database.o api_handlers.o src\main_server.cpp -lws2_32 -lsqlite3
if errorlevel 1 goto :error

REM 清理
del database.o api_handlers.o 2>nul

echo.
echo ========================================
echo   编译成功! server.exe 已生成
echo ========================================
echo.
echo 运行: server.exe [端口]  (默认端口 8766)
echo.
pause
goto :end

:error
echo.
echo ========================================
echo   编译失败!
echo ========================================
pause
goto :end

:clean
echo [清理] 删除构建文件...
if exist "build" rmdir /s /q build
if exist "server.exe" del server.exe
if exist "*.o" del *.o 2>nul
echo [完成]

:end
endlocal
