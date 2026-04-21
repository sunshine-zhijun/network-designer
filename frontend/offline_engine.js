/**
 * 离线模式信号计算引擎（当后端不可用时使用）
 * 完全在浏览器端计算热力图
 * 
 * 功能：
 * 1. 支持不同AP安装方式（吸顶/壁挂/桌面）的信号辐射模式
 * 2. 支持双频段AP（2.4G + 5G）分别计算
 * 3. 支持实时信号强度查询
 */

/**
 * 离线模式信号计算引擎（当后端不可用时使用）
 * 完全在浏览器端计算热力图
 * 
 * 功能：
 * 1. 支持不同AP安装方式（吸顶/壁挂/桌面）的信号辐射模式
 * 2. 支持双频段AP（2.4G + 5G）分别计算
 * 3. 支持实时信号强度查询
 * 4. 支持户型图区域检测（只计算有效区域）
 */

// 创建画布用于检测户型图边界
const _boundaryCanvas = document.createElement('canvas');
const _boundaryCtx = _boundaryCanvas.getContext('2d');

/**
 * 提取户型图的边界掩码（非透明区域）
 * 返回一个 Uint8Array，每个位置标识是否在户型图内
 */
function extractFloorplanMask(image, margin = 5) {
  // 设置画布大小与图像相同
  _boundaryCanvas.width = image.width;
  _boundaryCanvas.height = image.height;
  _boundaryCtx.clearRect(0, 0, image.width, image.height);
  
  // 绘制图像
  _boundaryCtx.drawImage(image, 0, 0);
  
  // 获取图像数据
  const imageData = _boundaryCtx.getImageData(0, 0, image.width, image.height);
  const data = imageData.data;
  const width = image.width;
  const height = image.height;
  
  // 创建掩码数组
  const mask = new Uint8Array(width * height);
  
  // 检测每个像素是否为非透明（Alpha > 10）
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    mask[i / 4] = alpha > 10 ? 1 : 0;
  }
  
  // 膨胀掩码（包含边缘几像素，确保覆盖完整）
  if (margin > 0) {
    const dilated = new Uint8Array(width * height);
    for (let y = margin; y < height - margin; y++) {
      for (let x = margin; x < width - margin; x++) {
        let hasValid = false;
        for (let dy = -margin; dy <= margin && !hasValid; dy++) {
          for (let dx = -margin; dx <= margin && !hasValid; dx++) {
            if (mask[(y + dy) * width + (x + dx)]) {
              hasValid = true;
            }
          }
        }
        dilated[y * width + x] = hasValid ? 1 : 0;
      }
    }
    return dilated;
  }
  
  return mask;
}

/**
 * 检查世界坐标点是否在户型图有效区域内
 * @param {number} wx, wy - 世界坐标（像素位置）
 * @param {Object} mask - 户型图掩码
 * @param {number} width - 掩码宽度
 * @param {number} height - 掩码高度
 * @param {number} offsetX - 户型图在画布中的偏移X
 * @param {number} offsetY - 户型图在画布中的偏移Y
 * @param {number} zoom - 当前缩放
 * @param {number} panX - 当前平移X
 * @param {number} panY - 当前平移Y
 * @returns {boolean}
 */
function isPointInFloorplan(wx, wy, mask, width, height, offsetX, offsetY, zoom, panX, panY) {
  // 将世界坐标转换为图像像素坐标
  const imgX = Math.round((wx - offsetX) / zoom);
  const imgY = Math.round((wy - offsetY) / zoom);
  
  // 检查是否在掩码范围内
  if (imgX < 0 || imgX >= width || imgY < 0 || imgY >= height) {
    return false;
  }
  
  return mask[imgY * width + imgX] === 1;
}

const OfflineEngine = (() => {
  // 复制后端信号模型到前端
  function pathLoss(distanceM, freqGhz) {
    if (distanceM < 0.1) distanceM = 0.1;
    const lambda = 3e8 / (freqGhz * 1e9);
    const pl0 = 20 * Math.log10(4 * Math.PI / lambda);
    const n = 3.0;
    return pl0 + 10 * n * Math.log10(distanceM);
  }

  function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1x = bx - ax, d1y = by - ay;
    const d2x = dx - cx, d2y = dy - cy;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return false;
    const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross;
    const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross;
    return (t >= 0 && t <= 1 && u >= 0 && u <= 1);
  }

  function wallAttenuation(ax, ay, px, py, walls, freqGhz) {
    let total = 0;
    for (const wall of walls) {
      if (segmentsIntersect(ax, ay, px, py, wall.x1, wall.y1, wall.x2, wall.y2)) {
        const matId = wall.material_id || 'brick';
        let atten;
        if (freqGhz >= 5.5) {
          // 6G 频段
          atten = MATERIALS[matId]?.atten6g || (MATERIALS[matId]?.atten5g || 17) + 3;
        } else if (freqGhz >= 4) {
          // 5G 频段
          atten = MATERIALS[matId]?.atten5g || 17;
        } else {
          // 2.4G 频段
          atten = MATERIALS[matId]?.atten2g || 12;
        }
        total += atten;
      }
    }
    return total;
  }

  /**
   * 根据安装方式计算方向性衰减
   * - ceiling (吸顶): 全向天线，水平方向均匀，向下辐射最强
   * - wall (壁挂): 定向天线，垂直于墙面方向辐射最强
   * - desktop (桌面): 全向，但朝向性较弱
   */
  function mountTypeAttenuation(ap, dx, dy) {
    const angle = Math.atan2(dy, dx); // 与X轴夹角（弧度）
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.1) return 0; // 太近无衰减
    
    let atten = 0;
    
    switch (ap.mount_type) {
      case 'ceiling': // 吸顶AP - 全向，但向下（Y正方向）辐射稍强
        // 模拟全向天线，向下偏移5度最强
        const ceilAngle = Math.abs(angle - Math.PI / 2);
        atten = Math.max(0, Math.round(ceilAngle * 10));
        break;
        
      case 'wall': // 壁挂AP - 定向辐射，垂直于墙面
        // AP的朝向角度（如果有）
        const wallAngle = (ap.mount_angle || 0) * Math.PI / 180;
        const angleDiff = Math.abs(angle - wallAngle);
        const normDiff = Math.min(angleDiff, 2 * Math.PI - angleDiff);
        // 偏离主方向越远衰减越大
        atten = Math.max(0, Math.round(Math.sin(normDiff) * 8));
        break;
        
      case 'desktop': // 桌面AP - 接近全向
        // 轻微的全向衰减
        atten = 0;
        break;
        
      default:
        atten = 0;
    }
    
    return atten;
  }

  /**
   * 计算单个AP在指定点的信号强度
   * @param {Object} ap - AP对象
   * @param {number} px, py - 世界坐标
   * @param {number} scaleMPerPx - 像素到米的缩放
   * @param {Array} walls - 墙体数组
   * @param {number|string} targetFreq - 指定频段 ('all' | 2.4 | 5 | 6)
   */
  function computeRSSI(ap, px, py, scaleMPerPx, walls, targetFreq = 'all') {
    // 计算距离（世界坐标）
    const dx = px - ap.x;
    const dy = py - ap.y;
    const distPx = Math.sqrt(dx * dx + dy * dy);
    const distM = distPx * scaleMPerPx;

    if (distM < 0.1) return -30; // 太近视为最大信号

    // 获取AP支持的频段
    let bands = ap.bands || [2.4, 5];
    if (typeof bands === 'string') bands = bands.split(',').map(Number);
    
    // 处理对象数组格式 [{freq: 2.4, power: 20}, ...]
    const freqNumbers = bands.map(b => typeof b === 'object' ? b.freq : b);
    
    // 根据目标频段过滤
    let targetFreqs = freqNumbers;
    if (targetFreq === 2.4) targetFreqs = freqNumbers.filter(f => f < 4);
    else if (targetFreq === 5) targetFreqs = freqNumbers.filter(f => f >= 4 && f < 6);
    else if (targetFreq === 6) targetFreqs = freqNumbers.filter(f => f >= 6);
    if (targetFreqs.length === 0) targetFreqs = freqNumbers;

    // 计算每个频段的信号强度
    let bestRSSI = -120;
    for (const freq of targetFreqs) {
      const freqGhz = freq;
      
      // 路径损耗
      const pl = pathLoss(distM, freqGhz);
      
      // 墙体衰减
      const wallAtt = wallAttenuation(ap.x, ap.y, px, py, walls, freqGhz);
      
      // 安装方式衰减
      const mountAtt = mountTypeAttenuation(ap, dx, dy);
      
      // 获取发射功率（dBm）
      const txPower = ap.tx_power || 20;
      
      // RSSI = 发射功率 - 路径损耗 - 墙体衰减 - 安装衰减
      const rssi = txPower - pl - wallAtt - mountAtt;
      
      if (rssi > bestRSSI) bestRSSI = rssi;
    }

    return bestRSSI;
  }

  /**
   * 获取指定点的信号强度
   * @param {Array} aps - AP数组
   * @param {number} x, y - 世界坐标
   * @param {number} scaleMPerPx - 比例尺
   * @param {Array} walls - 墙体数组
   * @param {number|string} targetFreq - 指定频段
   * @returns {number} 最佳RSSI
   */
  function getRSSIAtPoint(aps, x, y, scaleMPerPx, walls, targetFreq = 'all') {
    let bestRSSI = -120;
    for (const ap of aps) {
      if (!ap.enabled) continue;
      const rssi = computeRSSI(ap, x, y, scaleMPerPx, walls, targetFreq);
      if (rssi > bestRSSI) bestRSSI = rssi;
    }
    return bestRSSI;
  }

  function rssiToColor(rssi) {
    // 热力图颜色：单一色系渐变（红→橙→黄→绿）
    // -90dBm(差) → 深红 → -75dBm → 橙红 → -65dBm → 橙黄 → -55dBm → 黄绿 → -30dBm(好) → 翠绿
    // 分5档：差(<-75)、较差(-75~-65)、一般(-65~-55)、良好(-55~-45)、优(>-45)
    const norm = Math.max(0, Math.min(1, (rssi + 90) / 60));
    let r, g, b;
    
    if (norm < 0.25) {
      // -90 to -75: 深红 (差)
      const t = norm / 0.25;
      r = Math.round(180 + t * 55);    // 180→235
      g = Math.round(30 + t * 40);     // 30→70
      b = Math.round(30 + t * 20);     // 30→50
    } else if (norm < 0.417) {
      // -75 to -65: 红→橙红 (较差)
      const t = (norm - 0.25) / 0.167;
      r = 255;
      g = Math.round(70 + t * 100);    // 70→170
      b = Math.round(50 - t * 50);     // 50→0
    } else if (norm < 0.583) {
      // -65 to -55: 橙红→橙黄 (一般)
      const t = (norm - 0.417) / 0.166;
      r = 255;
      g = Math.round(170 + t * 55);    // 170→225
      b = Math.round(t * 30);          // 0→30
    } else if (norm < 0.75) {
      // -55 to -45: 橙黄→黄绿 (良好)
      const t = (norm - 0.583) / 0.167;
      r = Math.round(255 - t * 100);   // 255→155
      g = Math.round(225 + t * 30);    // 225→255
      b = Math.round(30 + t * 20);     // 30→50
    } else {
      // -45 to -30: 黄绿→翠绿 (优)
      const t = (norm - 0.75) / 0.25;
      r = Math.round(155 - t * 105);   // 155→50
      g = 255;
      b = Math.round(50 + t * 40);     // 50→90
    }
    
    return [r, g, b];
  }

  /**
   * 计算热力图
   * @param {Object} params
   * @param {number|string} params.targetFreq - 指定频段 ('all' | 2.4 | 5 | 6)
   * @param {Object} params.floorplanMask - 户型图掩码（可选，有掩码时只计算有效区域）
   * @param {Object} params.floorplanOffset - 户型图偏移 {x, y}
   * @returns {Array} points [{x,y,rssi,r,g,b}]
   */
  function computeHeatmap({ aps, walls, scaleMPerPx, width, height, step, targetFreq = 'all', floorplanMask = null, floorplanOffset = null }) {
    const points = [];
    const enabledAPs = aps.filter(a => a.enabled);
    if (enabledAPs.length === 0) return points;

    for (let py = 0; py < height; py += step) {
      for (let px2 = 0; px2 < width; px2 += step) {
        // 如果有户型图掩码，只计算有效区域内的点
        if (floorplanMask && floorplanOffset) {
          const imgX = Math.round((px2 - floorplanOffset.x));
          const imgY = Math.round((py - floorplanOffset.y));
          if (imgX < 0 || imgX >= floorplanMask.width || imgY < 0 || imgY >= floorplanMask.height) {
            continue;
          }
          if (!floorplanMask.data[imgY * floorplanMask.width + imgX]) {
            continue;
          }
        }

        let bestRSSI = -120;
        for (const ap of enabledAPs) {
          const rssi = computeRSSI(ap, px2, py, scaleMPerPx, walls, targetFreq);
          if (rssi > bestRSSI) bestRSSI = rssi;
        }
        // 只显示有意义强度的点（降低阈值让热力图更明显）
        if (bestRSSI > -100) {
          const [r, g, b] = rssiToColor(bestRSSI);
          points.push({ x: px2, y: py, rssi: bestRSSI, r, g, b });
        }
      }
    }
    return points;
  }

  return { 
    computeHeatmap, 
    computeRSSI, 
    rssiToColor,
    getRSSIAtPoint,
    mountTypeAttenuation,
    extractFloorplanMask,
    isPointInFloorplan
  };
})();
