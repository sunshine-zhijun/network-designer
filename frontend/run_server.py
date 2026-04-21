# -*- coding: utf-8 -*-
"""
网规工具 - Python HTTP 服务器
绕过中文主机名编码问题
"""
import http.server
import socketserver
import os
import sys

# 设置默认编码
if sys.version_info[0] < 3:
    reload(sys)
    sys.setdefaultencoding('utf-8')

PORT = 8081
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class MyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # 添加 CORS 头
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        # 抑制日志输出
        pass

if __name__ == '__main__':
    os.chdir(DIRECTORY)
    with socketserver.TCPServer(("", PORT), MyHTTPRequestHandler) as httpd:
        print(f"网规工具前端服务已启动: http://localhost:{PORT}")
        print(f"按 Ctrl+C 停止服务")
        httpd.serve_forever()
