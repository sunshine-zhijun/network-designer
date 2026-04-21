"""
网规工具 PDF 报告生成服务
Flask 后端 + reportlab
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import base64
import io
from datetime import datetime

# 导入报告生成器
from generate_report import create_report

app = Flask(__name__)
CORS(app)


@app.route('/api/report/generate', methods=['POST'])
def generate_report():
    """
    生成 PDF 报告
    
    请求体:
    {
        "project_name": "项目名称",
        "floorplan_image": "base64...",
        "device_canvas": "base64...",
        "wiring_canvas": "base64...",
        "heatmap_canvas": "base64...",
        "devices": [...],
        "links": [...],
        "walls": [...],
        "scale": 0.05
    }
    """
    try:
        data = request.json
        
        # 生成 PDF
        pdf_buffer = create_report(data)
        
        # 返回 PDF 文件
        filename = f"无线网络规划报告_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
        return send_file(
            pdf_buffer,
            mimetype='application/pdf',
            as_attachment=True,
            download_name=filename
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health():
    """健康检查"""
    return jsonify({'status': 'ok', 'service': 'pdf-report-generator'})


if __name__ == '__main__':
    print('Starting PDF report service on http://localhost:8767')
    app.run(host='0.0.0.0', port=8767, debug=False)