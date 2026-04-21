"""
无线网络规划报告 PDF 生成器
使用 reportlab 生成专业的多页 PDF 报告
"""

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, black, white
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph, Table, TableStyle, PageBreak
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import base64
import io
import json
from datetime import datetime

# 注册中文字体（Windows 系统）
try:
    pdfmetrics.registerFont(TTFont('Microsoft YaHei', 'C:/Windows/Fonts/msyh.ttc'))
    pdfmetrics.registerFont(TTFont('SimHei', 'C:/Windows/Fonts/simhei.ttf'))
    CHINESE_FONT = 'Microsoft YaHei'
    CHINESE_FONT_BOLD = 'Microsoft YaHei'
except:
    CHINESE_FONT = 'Helvetica'
    CHINESE_FONT_BOLD = 'Helvetica'

# 颜色定义
PRIMARY_COLOR = HexColor('#1a1d23')
ACCENT_COLOR = HexColor('#4a9eff')
TEXT_COLOR = HexColor('#333333')
LIGHT_GRAY = HexColor('#f5f5f5')
BORDER_COLOR = HexColor('#e0e0e0')


def create_report(data):
    """
    创建完整的 PDF 报告
    
    data 格式:
    {
        "floorplan_image": "base64...",  # 可选
        "device_canvas": "base64...",     # 设备布点图
        "wiring_canvas": "base64...",     # 布线图  
        "heatmap_canvas": "base64...",    # 信号仿真图
        "devices": [...],                 # 设备列表
        "links": [...],                   # 网线连接
        "walls": [...],                   # 墙体
        "scale": 0.05,                    # 比例尺
        "project_name": "项目名称"
    }
    """
    buffer = io.BytesIO()
    page_width, page_height = landscape(A4)
    
    c = canvas.Canvas(buffer, pagesize=landscape(A4))
    
    # ========== 第1页：封面 ==========
    draw_cover_page(c, page_width, page_height, data)
    
    # ========== 第2页：户型图 ==========
    c.showPage()
    if data.get('floorplan_image'):
        draw_image_page(c, page_width, page_height, 
                       data['floorplan_image'], '户型图', 'Floor Plan')
    
    # ========== 第3页：设备布点图 ==========
    c.showPage()
    if data.get('device_canvas'):
        draw_image_page(c, page_width, page_height,
                       data['device_canvas'], '设备布点图', 'Device Layout')
    
    # ========== 第4页：网线布线图 ==========
    c.showPage()
    if data.get('wiring_canvas'):
        draw_image_page(c, page_width, page_height,
                       data['wiring_canvas'], '网线布线图', 'Wiring Diagram')
    elif data.get('device_canvas'):
        draw_image_page(c, page_width, page_height,
                       data['device_canvas'], '网线布线图', 'Wiring Diagram')
    
    # ========== 第5页：信号仿真图 ==========
    c.showPage()
    if data.get('heatmap_canvas'):
        draw_image_page(c, page_width, page_height,
                       data['heatmap_canvas'], '信号覆盖仿真图', 'Signal Coverage')
    
    # ========== 第6页：设备清单 ==========
    c.showPage()
    draw_device_list_page(c, page_width, page_height, data)
    
    # ========== 第7页：统计信息 ==========
    c.showPage()
    draw_statistics_page(c, page_width, page_height, data)
    
    c.save()
    buffer.seek(0)
    return buffer


def draw_cover_page(c, page_width, page_height, data):
    """绘制封面页"""
    # 背景
    c.setFillColor(PRIMARY_COLOR)
    c.rect(0, 0, page_width, page_height, fill=True)
    
    # 顶部装饰线
    c.setStrokeColor(ACCENT_COLOR)
    c.setLineWidth(3)
    c.line(50, page_height - 80, page_width - 50, page_height - 80)
    
    # 标题
    c.setFillColor(white)
    c.setFont(CHINESE_FONT_BOLD, 36)
    c.drawCentredString(page_width / 2, page_height - 150, '无线网络规划报告')
    
    # 英文副标题
    c.setFont(CHINESE_FONT, 16)
    c.drawCentredString(page_width / 2, page_height - 180, 'Wireless Network Planning Report')
    
    # 分隔线
    c.setStrokeColor(ACCENT_COLOR)
    c.line(page_width / 2 - 100, page_height - 200, page_width / 2 + 100, page_height - 200)
    
    # 项目信息
    c.setFont(CHINESE_FONT, 14)
    project_name = data.get('project_name', '无线网络规划项目')
    c.drawCentredString(page_width / 2, page_height - 260, f'项目名称: {project_name}')
    
    # 日期
    c.setFont(CHINESE_FONT, 12)
    date_str = datetime.now().strftime('%Y年%m月%d日')
    c.drawCentredString(page_width / 2, page_height - 290, f'生成日期: {date_str}')
    
    # 统计摘要
    devices = data.get('devices', [])
    ap_count = len([d for d in devices if d.get('type') == 'ap'])
    switch_count = len([d for d in devices if d.get('type') == 'switch'])
    router_count = len([d for d in devices if d.get('type') == 'router'])
    link_count = len(data.get('links', []))
    wall_count = len(data.get('walls', []))
    
    y = page_height - 360
    c.setFont(CHINESE_FONT_BOLD, 16)
    c.drawCentredString(page_width / 2, y, '项目概览')
    
    c.setFont(CHINESE_FONT, 14)
    y -= 40
    c.drawCentredString(page_width / 2, y, f'AP设备: {ap_count} 台  |  交换机: {switch_count} 台  |  路由器: {router_count} 台')
    y -= 30
    c.drawCentredString(page_width / 2, y, f'网线连接: {link_count} 条  |  墙体数量: {wall_count} 段')
    
    # 底部信息
    c.setFont(CHINESE_FONT, 10)
    c.setFillColor(HexColor('#888888'))
    c.drawCentredString(page_width / 2, 50, '由 网规工具 自动生成')


def draw_image_page(c, page_width, page_height, image_base64, title_cn, title_en):
    """绘制图片页面"""
    # 页眉
    c.setFillColor(PRIMARY_COLOR)
    c.rect(0, page_height - 60, page_width, 60, fill=True)
    c.setFillColor(white)
    c.setFont(CHINESE_FONT_BOLD, 20)
    c.drawString(30, page_height - 40, title_cn)
    c.setFont(CHINESE_FONT, 12)
    c.drawString(page_width - 100, page_height - 40, title_en)
    
    # 绘制图片
    try:
        img_data = base64.b64decode(image_base64.split(',')[1] if ',' in image_base64 else image_base64)
        img_buffer = io.BytesIO(img_data)
        from PIL import Image
        img = Image.open(img_buffer)
        img_width, img_height = img.size
        
        # 计算缩放比例使图片适应页面
        margin = 30
        max_w = page_width - 2 * margin
        max_h = page_height - 120
        
        scale = min(max_w / img_width, max_h / img_height)
        draw_w = img_width * scale
        draw_h = img_height * scale
        x = (page_width - draw_w) / 2
        y = margin
        
        c.drawImage(img_buffer, x, y, width=draw_w, height=draw_h)
    except Exception as e:
        c.setFillColor(TEXT_COLOR)
        c.setFont(CHINESE_FONT, 14)
        c.drawCentredString(page_width / 2, page_height / 2, f'图片加载失败: {str(e)}')
    
    # 页脚
    c.setFillColor(HexColor('#888888'))
    c.setFont(CHINESE_FONT, 9)
    c.drawString(30, 20, f'比例尺: {data.get("scale", 0.05) * 100:.1f} cm/px')
    c.drawRightString(page_width - 30, 20, f'- {title_cn} -')


def draw_device_list_page(c, page_width, page_height, data):
    """绘制设备清单页面"""
    # 页眉
    c.setFillColor(PRIMARY_COLOR)
    c.rect(0, page_height - 60, page_width, 60, fill=True)
    c.setFillColor(white)
    c.setFont(CHINESE_FONT_BOLD, 20)
    c.drawString(30, page_height - 40, '设备清单')
    c.setFont(CHINESE_FONT, 12)
    c.drawString(page_width - 100, page_height - 40, 'Device List')
    
    devices = data.get('devices', [])
    
    if not devices:
        c.setFillColor(TEXT_COLOR)
        c.setFont(CHINESE_FONT, 14)
        c.drawCentredString(page_width / 2, page_height / 2, '暂无设备数据')
        return
    
    # 统计设备
    stats = {}
    for device in devices:
        model = device.get('model') or device.get('name') or device.get('product_id') or '未知型号'
        if model not in stats:
            stats[model] = {
                'type': device.get('type', 'ap'),
                'count': 0,
                'power': device.get('tx_power_dbm') or device.get('tx_power') or 0,
                'freq': ''
            }
        stats[model]['count'] += 1
        if device.get('bands'):
            freqs = device['bands']
            if isinstance(freqs[0], dict):
                stats[model]['freq'] = '/'.join([str(f['freq']) + 'G' for f in freqs])
            else:
                stats[model]['freq'] = '/'.join([str(f) + 'G' for f in freqs])
        elif device.get('freq_ghz'):
            stats[model]['freq'] = str(device['freq_ghz']) + 'G'
    
    # 绘制表格
    y = page_height - 100
    margin = 30
    
    # 表头
    c.setFillColor(LIGHT_GRAY)
    c.rect(margin, y - 25, page_width - 2 * margin, 25, fill=True)
    
    c.setFillColor(TEXT_COLOR)
    c.setFont(CHINESE_FONT_BOLD, 11)
    
    col_widths = [200, 120, 80, 150, 100]
    headers = ['型号', '类型', '数量', '频段', '功率(dBm)']
    x = margin + 10
    for i, header in enumerate(headers):
        c.drawString(x, y - 17, header)
        x += col_widths[i]
    
    y -= 30
    
    # 数据行
    c.setFont(CHINESE_FONT, 10)
    type_labels = {'ap': 'AP', 'switch': '交换机', 'router': '路由器'}
    row = 0
    
    for model, info in stats.items():
        # 检查是否需要换页
        if y < 80:
            c.showPage()
            y = page_height - 60
        
        # 交替背景色
        if row % 2 == 1:
            c.setFillColor(HexColor('#f9f9f9'))
            c.rect(margin, y - 20, page_width - 2 * margin, 20, fill=True)
        
        c.setFillColor(TEXT_COLOR)
        x = margin + 10
        c.drawString(x, y - 14, model)
        x += col_widths[0]
        c.drawString(x, y - 14, type_labels.get(info['type'], 'AP'))
        x += col_widths[1]
        c.drawString(x, y - 14, str(info['count']))
        x += col_widths[2]
        c.drawString(x, y - 14, info['freq'] or '-')
        x += col_widths[3]
        c.drawString(x, y - 14, str(info['power']))
        
        y -= 22
        row += 1
    
    # 合计行
    y -= 10
    c.setFillColor(HexColor('#e8f4ff'))
    c.rect(margin, y - 25, page_width - 2 * margin, 25, fill=True)
    c.setFillColor(PRIMARY_COLOR)
    c.setFont(CHINESE_FONT_BOLD, 11)
    x = margin + 10
    c.drawString(x, y - 17, '合计')
    x += col_widths[0]
    c.drawString(x, y - 17, '-')
    x += col_widths[1]
    c.drawString(x, y - 17, f'{len(devices)} 台')
    x += col_widths[2]
    c.drawString(x, y - 17, '-')
    x += col_widths[3]
    c.drawString(x, y - 17, '-')


def draw_statistics_page(c, page_width, page_height, data):
    """绘制统计信息页面"""
    # 页眉
    c.setFillColor(PRIMARY_COLOR)
    c.rect(0, page_height - 60, page_width, 60, fill=True)
    c.setFillColor(white)
    c.setFont(CHINESE_FONT_BOLD, 20)
    c.drawString(30, page_height - 40, '项目统计')
    c.setFont(CHINESE_FONT, 12)
    c.drawString(page_width - 100, page_height - 40, 'Statistics')
    
    devices = data.get('devices', [])
    links = data.get('links', [])
    walls = data.get('walls', [])
    
    # 统计计数
    ap_count = len([d for d in devices if d.get('type') == 'ap'])
    switch_count = len([d for d in devices if d.get('type') == 'switch'])
    router_count = len([d for d in devices if d.get('type') == 'router'])
    
    # 分组统计
    y = page_height - 120
    margin = 50
    
    # 标题
    c.setFillColor(TEXT_COLOR)
    c.setFont(CHINESE_FONT_BOLD, 16)
    c.drawString(margin, y, '设备统计')
    y -= 30
    
    # 统计框
    box_w = 150
    box_h = 80
    gap = 20
    
    # AP统计
    draw_stat_box(c, margin, y - box_h, box_w, box_h, 'AP设备', str(ap_count), '台', ACCENT_COLOR)
    # 交换机统计
    draw_stat_box(c, margin + box_w + gap, y - box_h, box_w, box_h, '交换机', str(switch_count), '台', HexColor('#ff9f4a'))
    # 路由器统计
    draw_stat_box(c, margin + 2 * (box_w + gap), y - box_h, box_w, box_h, '路由器', str(router_count), '台', HexColor('#4aff9f'))
    # 总设备
    draw_stat_box(c, margin + 3 * (box_w + gap), y - box_h, box_w, box_h, '设备总计', str(len(devices)), '台', PRIMARY_COLOR)
    
    y -= box_h + 40
    
    # 网络连接统计
    c.setFont(CHINESE_FONT_BOLD, 16)
    c.drawString(margin, y, '网络连接')
    y -= 30
    
    draw_stat_box(c, margin, y - box_h, box_w, box_h, '网线连接', str(len(links)), '条', HexColor('#888888'))
    draw_stat_box(c, margin + box_w + gap, y - box_h, box_w, box_h, '墙体数量', str(len(walls)), '段', HexColor('#666666'))
    
    # 计算总网线长度（如果提供）
    total_length = 0
    for link in links:
        if link.get('route'):
            for i in range(len(link['route']) - 1):
                dx = link['route'][i + 1]['x'] - link['route'][i]['x']
                dy = link['route'][i + 1]['y'] - link['route'][i]['y']
                length = (dx * dx + dy * dy) ** 0.5 * data.get('scale', 0.05)
                total_length += length
    
    if total_length > 0:
        draw_stat_box(c, margin + 2 * (box_w + gap), y - box_h, box_w, box_h, '预估线缆', f'{total_length:.1f}', '米', HexColor('#4a9eff'))
    
    y -= box_h + 50
    
    # 项目信息
    c.setFont(CHINESE_FONT_BOLD, 16)
    c.drawString(margin, y, '项目信息')
    y -= 30
    
    c.setFont(CHINESE_FONT, 12)
    c.setFillColor(TEXT_COLOR)
    
    info_items = [
        f'项目名称: {data.get("project_name", "无线网络规划项目")}',
        f'比例尺: {data.get("scale", 0.05) * 100:.2f} cm/px',
        f'生成时间: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}',
        f'设备总数: {len(devices)} 台',
        f'AP数量: {ap_count} 台',
        f'交换机数量: {switch_count} 台',
        f'路由器数量: {router_count} 台',
        f'网线连接数: {len(links)} 条',
        f'墙体数量: {len(walls)} 段'
    ]
    
    for item in info_items:
        c.drawString(margin, y, item)
        y -= 22
    
    # 页脚
    c.setFillColor(HexColor('#888888'))
    c.setFont(CHINESE_FONT, 9)
    c.drawString(margin, 20, '由 网规工具 自动生成')


def draw_stat_box(c, x, y, w, h, label, value, unit, color):
    """绘制统计框"""
    # 背景
    c.setFillColor(HexColor('#f5f5f5'))
    c.roundRect(x, y, w, h, 8, fill=True)
    
    # 顶部色条
    c.setFillColor(color)
    c.roundRect(x, y + h - 5, w, 5, 3, fill=True)
    
    # 标签
    c.setFillColor(HexColor('#888888'))
    c.setFont(CHINESE_FONT, 10)
    c.drawCentredString(x + w / 2, y + h - 25, label)
    
    # 数值
    c.setFillColor(TEXT_COLOR)
    c.setFont(CHINESE_FONT_BOLD, 20)
    c.drawCentredString(x + w / 2, y + h - 50, value)
    
    # 单位
    c.setFillColor(HexColor('#888888'))
    c.setFont(CHINESE_FONT, 10)
    c.drawCentredString(x + w / 2, y + h - 65, unit)


if __name__ == '__main__':
    # 测试
    test_data = {
        'project_name': '测试项目',
        'devices': [
            {'type': 'ap', 'name': 'TL-XAP3000', 'tx_power_dbm': 20},
            {'type': 'ap', 'name': 'TL-XAP6000', 'tx_power_dbm': 23},
            {'type': 'switch', 'name': 'TL-SG2008', 'tx_power_dbm': 0},
        ],
        'links': [],
        'walls': [],
        'scale': 0.05
    }
    
    pdf_buffer = create_report(test_data)
    with open('test_report.pdf', 'wb') as f:
        f.write(pdf_buffer.read())
    print('PDF created: test_report.pdf')