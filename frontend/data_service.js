/**
 * 网规工具 - 数据持久化模块
 * 功能：与C++后端通信，实现数据存储和加载
 * 依赖: app.js (提供 State, apiGet/apiPost/apiPut/apiDelete, setTheme, updateStatus 等)
 */

// API函数 (apiGet, apiPost, apiPut, apiDelete) 已在 app.js 中定义
// BACKEND_AVAILABLE 变量已在 app.js 中定义

const STORAGE_KEY = 'network_planner_data';

// ============================================================
// 本地存储 (Offline支持)
// ============================================================

function saveToLocalStorage() {
  const data = {
    version: '1.0',
    projectId: State.projectId || 'default',
    floorplan: State.floorplanImage ? {
      imageData: State.floorplanImage.src,
      width: State.floorplanW,
      height: State.floorplanH,
    } : null,
    walls: State.walls,
    devices: State.aps,
    links: State.links,
    scale: {
      mPerPx: State.scale_m_per_px,
      x1: State.scalePoint1?.x || 0,
      y1: State.scalePoint1?.y || 0,
      x2: State.scalePoint2?.x || 0,
      y2: State.scalePoint2?.y || 0,
      realDistanceCm: State.scalePoint1 && State.scalePoint2 ? 
        Math.hypot(State.scalePoint2.x - State.scalePoint1.x, State.scalePoint2.y - State.scalePoint1.y) * State.scale_m_per_px * 100 : 0,
    },
    config: {
      theme: localStorage.getItem('theme') || 'dark',
      canvasW: State.canvasW,
      canvasH: State.canvasH,
    },
    savedAt: new Date().toISOString(),
  };
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    console.log('[Storage] Data saved locally');
  } catch (e) {
    console.error('[Storage] Save failed:', e);
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    
    const data = JSON.parse(raw);
    console.log('[Storage] Loading from localStorage, saved at:', data.savedAt);
    
    if (data.projectId) State.projectId = data.projectId;
    
    if (data.floorplan && data.floorplan.imageData) {
      const img = new Image();
      img.onload = () => {
        State.floorplanImage = img;
        State.floorplanW = data.floorplan.width;
        State.floorplanH = data.floorplan.height;
        render();
      };
      img.src = data.floorplan.imageData;
    }
    
    if (data.walls) State.walls = data.walls;
    if (data.devices) State.aps = data.devices;
    if (data.links) State.links = data.links;
    
    if (data.scale) {
      State.scale_m_per_px = data.scale.mPerPx || 0.05;
      if (data.scale.x1 && data.scale.y1 && data.scale.x2 && data.scale.y2) {
        State.scalePoint1 = { x: data.scale.x1, y: data.scale.y1 };
        State.scalePoint2 = { x: data.scale.x2, y: data.scale.y2 };
      }
    }
    
    if (data.config) {
      if (data.config.theme) setTheme(data.config.theme);
      if (data.config.canvasW) State.canvasW = data.config.canvasW;
      if (data.config.canvasH) State.canvasH = data.config.canvasH;
    }
    
    return true;
  } catch (e) {
    console.error('[Storage] Load failed:', e);
    return false;
  }
}

// ============================================================
// 后端数据同步
// ============================================================

async function loadFromBackend() {
  const projectId = State.projectId || 'default';
  
  const result = await apiGet(`/projects/${projectId}/load`);
  
  if (result && result.code === 0 && result.data) {
    console.log('[API] Loaded from backend');
    const d = result.data;
    
    if (d.floorplan && d.floorplan.length > 0) {
      const fp = d.floorplan[0];
      if (fp.image_data) {
        const img = new Image();
        img.onload = () => {
          State.floorplanImage = img;
          State.floorplanW = fp.image_width;
          State.floorplanH = fp.image_height;
          render();
        };
        img.src = fp.image_data;
      }
    }
    
    if (d.walls && d.walls.length > 0) {
      State.walls = d.walls.map(w => ({
        id: w.id,
        x1: parseFloat(w.x1),
        y1: parseFloat(w.y1),
        x2: parseFloat(w.x2),
        y2: parseFloat(w.y2),
        thickness: parseFloat(w.thickness) || 10,
        material: w.material || 'brick',
        color: w.color || null,
      }));
    }
    
    if (d.devices && d.devices.length > 0) {
      State.aps = d.devices.map(dev => ({
        id: dev.id,
        type: dev.device_type,
        model: dev.model || '',
        name: dev.name || '',
        x: parseFloat(dev.x),
        y: parseFloat(dev.y),
        freqBands: (dev.freq_bands || '2.4,5').split(','),
        power: parseInt(dev.power_dbm) || 20,
        angle: parseFloat(dev.angle) || 0,
      }));
    }
    
    if (d.links && d.links.length > 0) {
      State.links = d.links.map(l => ({
        id: l.id,
        fromId: l.from_device_id,
        toId: l.to_device_id,
        route: l.route_points ? JSON.parse(l.route_points) : [],
        cableType: l.cable_type || 'CAT6',
      }));
    }
    
    if (d.scale && d.scale.length > 0) {
      const s = d.scale[0];
      State.scale_m_per_px = parseFloat(s.m_per_px) || 0.05;
      State.scalePoint1 = { x: parseFloat(s.x1), y: parseFloat(s.y1) };
      State.scalePoint2 = { x: parseFloat(s.x2), y: parseFloat(s.y2) };
    }
    
    updateCountBadges();
    updateAPList();
    updateLinkList();
    updateScaleDisplay();
    render();
    
    return true;
  }
  
  console.log('[API] Backend load failed, trying localStorage');
  return loadFromLocalStorage();
}

async function saveToBackend() {
  const projectId = State.projectId || 'default';
  
  const data = {
    project: { id: projectId, name: '默认项目' },
    floorplan: State.floorplanImage ? {
      project_id: projectId,
      name: '户型图',
      image_data: State.floorplanImage.src,
      image_width: State.floorplanW,
      image_height: State.floorplanH,
      offset_x: 0,
      offset_y: 0,
      scale_x: 1,
      scale_y: 1,
      rotation: 0,
    } : null,
    walls: State.walls.map(w => ({
      id: w.id,
      project_id: projectId,
      x1: w.x1,
      y1: w.y1,
      x2: w.x2,
      y2: w.y2,
      thickness: w.thickness || 10,
      material: w.material || 'brick',
      color: w.color || null,
    })),
    devices: State.aps.map(dev => ({
      id: dev.id,
      project_id: projectId,
      device_type: dev.type,
      model: dev.model || '',
      name: dev.name || '',
      x: dev.x,
      y: dev.y,
      freq_bands: dev.freqBands ? dev.freqBands.join(',') : '2.4,5',
      power_dbm: dev.power || 20,
      angle: dev.angle || 0,
    })),
    links: State.links.map(l => ({
      id: l.id,
      project_id: projectId,
      from_device_id: l.fromId,
      to_device_id: l.toId,
      route_points: JSON.stringify(l.route || []),
      cable_type: l.cableType || 'CAT6',
    })),
    scale: State.scalePoint1 && State.scalePoint2 ? {
      id: 'scale_' + projectId,
      project_id: projectId,
      x1: State.scalePoint1.x,
      y1: State.scalePoint1.y,
      x2: State.scalePoint2.x,
      y2: State.scalePoint2.y,
      real_distance_cm: Math.hypot(State.scalePoint2.x - State.scalePoint1.x, State.scalePoint2.y - State.scalePoint1.y) * State.scale_m_per_px * 100,
      m_per_px: State.scale_m_per_px,
    } : null,
  };
  
  const result = await apiPost(`/projects/${projectId}/save`, data);
  
  if (result && result.code === 0) {
    console.log('[API] Saved to backend');
    saveToLocalStorage();
    return true;
  }
  
  console.log('[API] Backend save failed, saving to localStorage');
  saveToLocalStorage();
  return false;
}

// ============================================================
// 增量保存 (单条操作)
// ============================================================

async function saveWall(wall) {
  if (BACKEND_AVAILABLE) {
    const result = await apiPost('/walls', {
      id: wall.id,
      project_id: State.projectId || 'default',
      x1: wall.x1,
      y1: wall.y1,
      x2: wall.x2,
      y2: wall.y2,
      thickness: wall.thickness || 10,
      material: wall.material || 'brick',
      color: wall.color || null,
    });
    if (result && result.code === 0) return;
  }
  saveToLocalStorage();
}

async function deleteWall(wallId) {
  if (BACKEND_AVAILABLE) {
    await apiDelete(`/walls/${wallId}`);
  }
  saveToLocalStorage();
}

async function saveDevice(device) {
  if (BACKEND_AVAILABLE) {
    const result = await apiPost('/devices', {
      id: device.id,
      project_id: State.projectId || 'default',
      device_type: device.type,
      model: device.model || '',
      name: device.name || '',
      x: device.x,
      y: device.y,
      freq_bands: device.freqBands ? device.freqBands.join(',') : '2.4,5',
      power_dbm: device.power || 20,
      angle: device.angle || 0,
    });
    if (result && result.code === 0) return;
  }
  saveToLocalStorage();
}

async function deleteDevice(deviceId) {
  if (BACKEND_AVAILABLE) {
    await apiDelete(`/devices/${deviceId}`);
  }
  saveToLocalStorage();
}

async function saveLink(link) {
  if (BACKEND_AVAILABLE) {
    const result = await apiPost('/links', {
      id: link.id,
      project_id: State.projectId || 'default',
      from_device_id: link.fromId,
      to_device_id: link.toId,
      route_points: JSON.stringify(link.route || []),
      cable_type: link.cableType || 'CAT6',
    });
    if (result && result.code === 0) return;
  }
  saveToLocalStorage();
}

async function deleteLink(linkId) {
  if (BACKEND_AVAILABLE) {
    await apiDelete(`/links/${linkId}`);
  }
  saveToLocalStorage();
}

async function saveScale() {
  if (!State.scalePoint1 || !State.scalePoint2) return;
  
  const px = State.scalePoint2.x - State.scalePoint1.x;
  const py = State.scalePoint2.y - State.scalePoint1.y;
  const pxDist = Math.hypot(px, py);
  const realDistanceCm = pxDist * State.scale_m_per_px * 100;
  
  if (BACKEND_AVAILABLE) {
    await apiPost('/scales', {
      id: 'scale_default',
      project_id: State.projectId || 'default',
      x1: State.scalePoint1.x,
      y1: State.scalePoint1.y,
      x2: State.scalePoint2.x,
      y2: State.scalePoint2.y,
      real_distance_cm: realDistanceCm,
      m_per_px: State.scale_m_per_px,
    });
  }
  saveToLocalStorage();
}