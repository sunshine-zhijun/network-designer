@echo off
chcp 65001 >nul
echo ============================================
echo   网规工具 - 一键启动脚本
echo ============================================

:: 检查后端可执行文件
if not exist "backend\network_planner.exe" (
    echo [INFO] 后端尚未编译，正在编译...
    cd backend
    call build.bat
    cd ..
    if not exist "backend\network_planner.exe" (
        echo [错误] 编译失败，将以纯前端模式运行（离线模式）
        echo 热力图计算将在浏览器端完成
        goto start_frontend
    )
)

:: 检查后端端口是否已占用
netstat -an 2>nul | find "8766" | find "LISTENING" >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] 后端服务已在运行 (端口8766)
    goto start_frontend
)

:: 启动后端
echo [INFO] 启动后端服务 (端口8766)...
start "网规工具后端" /MIN backend\network_planner.exe

:: 等待启动
timeout /t 2 /nobreak >nul

:start_frontend
echo [INFO] 启动前端...
echo.
echo =============================================
echo  访问地址: 在浏览器中打开以下文件
echo  frontend\index.html
echo =============================================
echo.

:: 启动 PDF 报告服务（如果 Python 可用）
where python >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] 启动 PDF 报告服务 (端口8767)...
    start "PDF报告服务" /MIN python backend\app.py
    timeout /t 1 /nobreak >nul
)

:: 优先使用python内置HTTP服务器（避免file://跨域问题）
where python >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] 使用Python HTTP服务器 (端口8080)
    echo [INFO] 前端地址: http://localhost:8080
    cd frontend
    start "" "http://localhost:8080"
    python -m http.server 8080
    cd ..
    goto end
)

where python3 >nul 2>&1
if %errorlevel% equ 0 (
    cd frontend
    start "" "http://localhost:8080"
    python3 -m http.server 8080
    cd ..
    goto end
)

:: 没有python，直接打开文件
echo [INFO] 直接打开HTML文件（注意：某些功能需要HTTP服务器）
start "" "frontend\index.html"

:end
pause