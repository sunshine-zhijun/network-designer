@echo off
chcp 65001 >nul
echo ============================================
echo   网规工具 - 后端编译脚本 (MSVC)
echo ============================================

:: 检查cl.exe是否可用
where cl >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到MSVC编译器(cl.exe)
    echo 请先运行 Visual Studio 开发者命令提示符
    echo 或者执行: "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvarsall.bat" x64
    echo.
    echo [备选] 尝试使用 MinGW/GCC 编译...
    goto try_gcc
)

echo [INFO] 使用MSVC编译...
cl /EHsc /std:c++17 /O2 /W3 ^
   /I "include" ^
   "src/main.cpp" ^
   /Fe:"network_planner.exe" ^
   /link ws2_32.lib

if %errorlevel% equ 0 (
    echo.
    echo [成功] 编译完成: network_planner.exe
) else (
    echo.
    echo [失败] MSVC编译失败，尝试GCC...
    goto try_gcc
)
goto end

:try_gcc
where g++ >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到g++编译器
    echo 请安装 MinGW-w64 或 MSYS2
    echo 下载地址: https://www.msys2.org/
    goto end
)

echo [INFO] 使用GCC编译...
g++ -std=c++17 -O2 -Wall ^
    -I "include" ^
    "src/main.cpp" ^
    -o "network_planner.exe" ^
    -lws2_32

if %errorlevel% equ 0 (
    echo.
    echo [成功] 编译完成: network_planner.exe
) else (
    echo.
    echo [失败] 编译失败，请检查编译器安装
)

:end
pause
