@echo off
chcp 65001 >nul
rem ===== AI刷题侠 - 本地一键调试 =====
rem 后端 : http://127.0.0.1:18099  (数据目录 .devdb，不影响真机)
rem 前端 : http://localhost:5173  (vite 热更新，/api 自动代理到后端)
rem 调试满意后：cd frontend && npm run build，再拷到 app\www 更新后 fnpack build 装机

set ROOT=%~dp0
start "shuatixia-backend" cmd /k "cd /d %ROOT% && node app\server\server.js --port 18099 --data-dir .devdb"
start "shuatixia-frontend" cmd /k "cd /d %ROOT%frontend && npm run dev"

echo.
echo 后端 18099 与前端 5173 已启动，浏览器打开 http://localhost:5173/
echo 关闭方式：分别关掉两个黑色窗口即可
