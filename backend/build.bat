@echo off
REM 网规工具 - C++ 后端编译脚本
REM 
REM 依赖:
REM   - MinGW-w64 或 MSVC
REM   - SQLite3 (下载 sqlite3.dll 放到同一目录)
REM   - httplib.h (如果使用)
REM
REM 使用 MinGW 编译:
REM   mingw32-make
REM   或手动执行: g++ -std=c++17 -O2 -I include -o server.exe src\*.cpp -lws2_32 -lsqlite3

REM 清理
if exist server.exe del server.exe
if exist *.o del *.o 2>nul

echo ========================================
echo   网规工具 C++ 后端编译
echo ========================================

REM 检查MinGW
where g++ >nul 2>nul
if errorlevel 1 (
    echo [ERROR] 未找到 g++，请安装 MinGW-w64
    pause
    exit /b 1
)

echo [1/3] 编译 database.cpp...
g++ -std=c++17 -O2 -c src\database.cpp -I include -o database.o -lws2_32 -lsqlite3
if errorlevel 1 goto :error

echo [2/3] 编译 api_handlers.cpp...
g++ -std=c++17 -O2 -c src\api_handlers.cpp -I include -o api_handlers.o -lws2_32 -lsqlite3
if errorlevel 1 goto :error

echo [3/3] 链接 server.exe...
g++ -std=c++17 -O2 -o server.exe database.o api_handlers.o src\main_server.cpp -lws2_32 -lsqlite3
if errorlevel 1 goto :error

REM 清理临时文件
del database.o api_handlers.o 2>nul

echo.
echo ========================================
echo   编译成功! server.exe 已生成
echo ========================================
echo.
echo 运行: server.exe [端口]  (默认端口 8766)
echo 示例: server.exe 8080
echo.
pause
goto :end

:error
echo.
echo ========================================
echo   编译失败!
echo ========================================
pause

:end