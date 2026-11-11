(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const icon = (name, className = "") =>
    `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
  const pad = (number) => String(number).padStart(2, "0");
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);

  const PAGE_META = {
    map: "海洋生态地图",
    risk: "污染风险预警",
    report: "海洋问题上报",
    events: "事件处理闭环",
    analytics: "统计分析看板"
  };

  const TYPE_META = {
    oil: { label: "油污污染", icon: "risk", className: "oil" },
    trash: { label: "海洋垃圾", icon: "image", className: "trash" },
    water: { label: "水质异常", icon: "droplet", className: "water" },
    redtide: { label: "赤潮/藻类异常", icon: "wave", className: "redtide" },
    wildlife: { label: "野生动物异常", icon: "shield", className: "wildlife" },
    other: { label: "其他生态问题", icon: "file", className: "other" }
  };

  const STATUS_META = {
    pending_review: { label: "待审核", className: "pending_review", order: 0 },
    pending_dispatch: { label: "待分派", className: "pending_dispatch", order: 1 },
    processing: { label: "处理中", className: "processing", order: 2 },
    pending_verification: { label: "待复核", className: "pending_verification", order: 3 },
    archived: { label: "已归档", className: "archived", order: 4 }
  };

  const SEVERITY_META = {
    high: { label: "危急", className: "high" },
    medium: { label: "紧急", className: "medium" },
    low: { label: "一般", className: "low" }
  };

  const ACTION_META = {
    pending_review: { label: "审核立案", action: "review", icon: "check" },
    pending_dispatch: { label: "分派处置", action: "dispatch", icon: "send" },
    processing: { label: "提交处理结果", action: "submit_result", icon: "upload" },
    pending_verification: { label: "复核并归档", action: "archive", icon: "check-circle" },
    archived: null
  };

  const NEXT_STATUS = {
    review: "pending_dispatch",
    dispatch: "processing",
    submit_result: "pending_verification",
    archive: "archived"
  };

  const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
  const STORAGE_KEY = "liaodong-bay-eco-guard-v1";
  const requestTimeout = window.APP_CONFIG?.requestTimeout || 6000;
  const MAP_DATA_URL = window.APP_CONFIG?.mapDataUrl || "./data.json";
  const TIANDITU_KEY = String(window.APP_CONFIG?.tdtKey || "").trim();
  const MAP_CENTER = [40.15, 121.62];
  const assetUrl = (value) => {
    const url = String(value || "");
    if (!url || /^(?:https?:|data:|blob:)/i.test(url)) return url;
    return API_BASE && url.startsWith("/") ? `${API_BASE}${url}` : url;
  };

  const state = {
    page: "map",
    events: [],
    alerts: [],
    selectedEventId: null,
    eventStatus: "all",
    eventSearch: "",
    alertFilter: "all",
    reportSeverity: "medium",
    reportImages: [],
    mode: "demo",
    apiOnline: false,
    activeModal: null,
    mapData: null,
    mapProvider: null,
    mapMode: "overview",
    mapLayerVisibility: { stations: true, events: true, risk: true, port: true, zones: true },
    leafletMap: null,
    mapBaseLayer: null,
    mapBaseLabels: null,
    mapLayerGroups: {},
    mapFallback: false
  };

  const now = new Date();
  const isoMinutesAgo = (minutes) => new Date(now.getTime() - minutes * 60000).toISOString();
  const isoHoursAgo = (hours) => isoMinutesAgo(hours * 60);
  const isoDaysAgo = (days) => isoMinutesAgo(days * 24 * 60);

  function createSeedEvents() {
    const definitions = [
      ["EV-20261111-024", "营口港3号锚地油膜异常", "oil", "high", "pending_review", "营口港3号锚地东侧约800米", "巡航发现海面存在带状彩色油膜，范围约200平方米，伴有轻微油气味。", "王海巡", "巡护上报", 18, "营口港巡护中队", "王海巡", ["疑似船舶舱底水排放，现场未发现明显排放源。"]],
      ["EV-20261111-023", "月亮湖东侧岸线垃圾聚集", "trash", "medium", "pending_dispatch", "鲅鱼圈区月亮湖公园东侧300米海岸", "潮线附近发现塑料瓶、泡沫和废弃渔网聚集，长度约30米。", "李女士", "公众上报", 52, "鲅鱼圈岸线保洁队", "待分派", ["现场垃圾以生活塑料和渔业废弃物为主，未发现危化品。"]],
      ["EV-20261111-022", "双台子河口溶解氧持续偏低", "water", "high", "processing", "双台子河口南侧监测断面", "S11监测站溶解氧连续3小时低于4.5mg/L，水体颜色偏暗。", "环境监测中心", "系统预警", 83, "盘锦水质应急组", "张工", ["监测数据触发高风险阈值，已同步采集水样。"]],
      ["EV-20261111-021", "保护区表层水体变色", "redtide", "medium", "pending_verification", "辽东湾斑海豹保护区西侧", "近岸2公里范围内发现浅褐色带状水色异常，暂未发现鱼类死亡。", "陈研究员", "联合巡查", 130, "海洋生态监测站", "刘洋", ["已采集浮游植物样本，现场处置完成。", "处置后复查水色恢复正常。"]],
      ["EV-20261111-020", "仙人岛码头废弃渔网缠绕", "trash", "low", "archived", "仙人岛码头东南侧礁石区", "废弃渔网缠绕在礁石及护岸桩上，长约12米。", "赵先生", "公众上报", 178, "仙人岛岸线管护队", "孙强", ["已清理全部渔网并完成现场复核。"]],
      ["EV-20261111-019", "金州湾岸线塑料垃圾", "trash", "low", "processing", "金州湾滨海步道北段", "岸线出现大量泡沫浮球和塑料包装，分布范围约40米。", "周女士", "公众上报", 201, "金州湾保洁队", "周敏", ["保洁队已到场，正在分类清理。"]],
      ["EV-20261111-018", "辽东湾北部海水异味", "water", "medium", "pending_review", "营口市辽河口西岸", "岸边水体有明显异味，初步未发现漂浮物，已上传现场照片。", "附近渔民", "渔民上报", 245, "待确定", "待审核", ["平台正在核验位置与描述信息。"]],
      ["EV-20261111-017", "锦州港西侧浮油带", "oil", "high", "pending_dispatch", "锦州港西侧航道边缘", "巡航无人机发现长约500米、宽约8米的银灰色浮油带。", "无人机巡检", "设备发现", 293, "锦州港应急中队", "待分派", ["已通知港口拖轮临时避让，待围油栏到场。"]],
      ["EV-20261110-016", "红海滩景区岸线饮料瓶", "trash", "low", "archived", "红海滩国家风景廊道南段", "游客步道下方滩涂发现饮料瓶与包装袋，约10公斤。", "赵先生", "公众上报", 520, "红海滩景区管护队", "李健", ["已清理并完成垃圾称重。"]],
      ["EV-20261110-015", "S15站叶绿素a突升", "redtide", "medium", "processing", "辽东湾保护区S15监测站", "叶绿素a升至9.6μg/L，较前一日升高72%，水温22.1℃。", "环境监测中心", "系统预警", 610, "海洋生态监测站", "刘洋", ["已完成首次采样，等待实验室显微分析。"]],
      ["EV-20261110-014", "小凌河口漂浮物聚集", "other", "low", "archived", "小凌河入海口南侧", "上游来水带来树枝与农业废弃物，聚集在河口回水区。", "环卫巡护", "巡护上报", 720, "凌海河道管护队", "高伟", ["漂浮物已打捞，通知上游加强清理。"]],
      ["EV-20261110-013", "S21站溶解氧降至4.1mg/L", "water", "high", "processing", "营口港近岸S21监测站", "溶解氧连续6小时低于5mg/L，最低值4.1mg/L，盐度同步下降。", "环境监测中心", "系统预警", 860, "营口水质应急组", "郭峰", ["已启动加密监测，现场采样两批次。"]],
      ["EV-20261109-012", "鲅鱼圈港池零星油花", "oil", "medium", "processing", "鲅鱼圈港区6号泊位", "靠泊船只周边出现零星油花，范围较小，已布设吸油毡。", "港区巡检员", "巡护上报", 1100, "鲅鱼圈港区应急组", "宋涛", ["吸油毡已布设，正在排查排放源。"]],
      ["EV-20261109-011", "白沙湾岸线钓鱼线清理", "trash", "low", "pending_verification", "白沙湾海滨浴场北侧礁石区", "礁石缝隙发现多组废弃钓鱼线和塑料鱼饵包装。", "志愿者", "公众上报", 1370, "白沙湾岸线管护队", "郑凯", ["钓鱼线已清理，待复核照片。"]],
      ["EV-20261109-010", "辽河口S30浊度异常", "water", "medium", "processing", "辽河口S30监测站", "浊度短时升至48NTU，与上游来水过程吻合，正在持续跟踪。", "环境监测中心", "系统预警", 1560, "盘锦水质监测组", "张工", ["已与水文部门核对流量数据。"]],
      ["EV-20261108-009", "斑海豹保护区异常漂浮物", "wildlife", "low", "archived", "斑海豹保护区核心区边缘", "发现疑似困在漂浮物中的鸟类，巡护艇到场后已安全放飞。", "保护区巡护队", "巡护上报", 1900, "保护区巡护队", "刘洋", ["鸟类安全放飞，漂浮物已回收。"]],
      ["EV-20261108-008", "兴城海滨塑料浮球清理", "trash", "low", "archived", "兴城海滨第二浴场东侧", "潮间带发现十余个水产养殖塑料浮球。", "游客", "公众上报", 2260, "兴城岸线管护队", "杨帆", ["浮球已全部清理并回收利用。"]],
      ["EV-20261107-007", "金帛滩海面泡沫异常", "water", "low", "archived", "金帛滩旅游区近岸", "近岸出现条带状白色泡沫，经核查为藻类代谢物。", "巡护员", "巡护上报", 3180, "海洋生态监测站", "刘洋", ["检测结果无毒性，已持续观察。"]],
      ["EV-20261107-006", "团山子海域渔网清理", "trash", "medium", "archived", "团山子国家海洋公园东侧", "废弃网具缠绕礁石并覆盖约15平方米。", "志愿者", "公众上报", 3450, "团山子海洋公园管护队", "孙强", ["志愿者与管护队联合完成清理。"]],
      ["EV-20261106-005", "S03水温短时波动", "other", "low", "archived", "营口近岸S03监测站", "水温1小时内上升1.8℃，与沿岸排水温度变化相关。", "环境监测中心", "系统预警", 4380, "营口水质监测组", "郭峰", ["核查为短时波动，指标已恢复。"]],
      ["EV-20261106-004", "长兴岛码头油渍", "oil", "medium", "archived", "长兴岛公共码头2号泊位", "码头边缘发现约2平方米轻质油渍，已使用吸油材料处理。", "码头管理员", "巡护上报", 4720, "长兴岛港区应急组", "宋涛", ["现场油渍清除，未见扩散。"]],
      ["EV-20261105-003", "大清河口芦苇垃圾带", "trash", "medium", "archived", "大清河入海口西侧芦苇湿地", "潮水带来泡沫箱、塑料瓶等垃圾约60公斤。", "湿地巡护员", "巡护上报", 5600, "大洼湿地管护队", "高伟", ["已清理并分类处置。"]],
      ["EV-20261105-002", "辽东湾S34盐度偏低", "water", "low", "archived", "辽东湾中部S34监测站", "盐度短时下降2.1‰，与降雨径流增加有关。", "环境监测中心", "系统预警", 5980, "海洋生态监测站", "刘洋", ["持续观测后指标恢复至正常范围。"]],
      ["EV-20261104-001", "保护区内违规垂钓劝导", "other", "low", "archived", "斑海豹保护区实验区岸段", "发现岸边违规垂钓人员3名，未发现捕捞行为。", "保护区巡护队", "巡护上报", 7190, "保护区巡护队", "王海巡", ["已完成政策宣讲并劝离。"]]
    ];

    return definitions.map((item, index) => {
      const [id, title, type, severity, status, location, description, reporter, source, minutes, team, assignee, notes] = item;
      return {
        id,
        title,
        type,
        severity,
        status,
        location,
        description,
        reporter,
        source,
        created_at: isoMinutesAgo(minutes),
        updated_at: isoMinutesAgo(Math.max(4, minutes - 45 - (index % 4) * 18)),
        deadline: isoMinutesAgo(minutes - 480),
        team,
        assignee,
        notes,
        history: buildSeedHistory(status, minutes, notes)
      };
    });
  }

  function buildSeedHistory(status, minutes, notes) {
    const times = [
      isoMinutesAgo(minutes),
      isoMinutesAgo(Math.max(2, minutes - 20)),
      isoMinutesAgo(Math.max(1, minutes - 50)),
      isoMinutesAgo(Math.max(1, minutes - 100)),
      isoMinutesAgo(Math.max(1, minutes - 150))
    ];
    const history = [
      { title: "事件上报", detail: "上报信息已进入平台，等待审核", time: times[0], status: "done" }
    ];
    const order = STATUS_META[status]?.order ?? 0;
    if (order >= 1) history.push({ title: "审核通过", detail: "事件信息核验通过，已正式立案", time: times[1], status: "done" });
    if (order >= 2) history.push({ title: "任务分派", detail: `已分派至${notes?.[0] || "属地处置队伍"}`, time: times[2], status: "done" });
    if (order >= 3) history.push({ title: "现场处置完成", detail: notes?.[notes.length - 1] || "处置结果已提交，等待复核", time: times[3], status: "done" });
    if (order >= 4) history.push({ title: "复核归档", detail: "处置结果通过复核，事件完成闭环", time: times[4], status: "done" });
    return history;
  }

  function createSeedAlerts() {
    return [
      { id: "AL-20261111-0086", type: "oil", title: "营口港邻近海域油污风险", area: "营口港近岸 · S21", metric: "溶解氧", metric_value: "4.1 mg/L", score: 86, level: "high", trend: "+12%", created_at: isoMinutesAgo(22), status: "active", dispatched: false },
      { id: "AL-20261111-0079", type: "water", title: "双台子河口水质异常", area: "双台子河口 · S11", metric: "叶绿素 a", metric_value: "9.6 μg/L", score: 79, level: "high", trend: "+18%", created_at: isoMinutesAgo(48), status: "active", dispatched: false },
      { id: "AL-20261111-0064", type: "redtide", title: "保护区赤潮风险升高", area: "辽东湾保护区 · S15", metric: "叶绿素 a", metric_value: "8.2 μg/L", score: 64, level: "medium", trend: "+7%", created_at: isoMinutesAgo(93), status: "active", dispatched: false },
      { id: "AL-20261111-0057", type: "water", title: "养殖区溶解氧偏低", area: "鲅鱼圈养殖区 · S07", metric: "溶解氧", metric_value: "5.2 mg/L", score: 57, level: "medium", trend: "-3%", created_at: isoMinutesAgo(141), status: "active", dispatched: false },
      { id: "AL-20261111-0041", type: "redtide", title: "锦州南部藻类密度上升", area: "锦州南部海域 · S24", metric: "藻细胞", metric_value: "3.8×10⁵/L", score: 41, level: "medium", trend: "+4%", created_at: isoMinutesAgo(205), status: "active", dispatched: false },
      { id: "AL-20261111-0035", type: "water", title: "辽河口盐度短时下降", area: "辽河口 · S30", metric: "盐度", metric_value: "25.4‰", score: 35, level: "medium", trend: "-6%", created_at: isoMinutesAgo(260), status: "active", dispatched: false },
      { id: "AL-20261111-0028", type: "oil", title: "鲅鱼圈港池油花", area: "鲅鱼圈港区 · S18", metric: "石油类", metric_value: "0.08 mg/L", score: 28, level: "low", trend: "+2%", created_at: isoMinutesAgo(320), status: "active", dispatched: false },
      { id: "AL-20261111-0019", type: "water", title: "金州湾浊度波动", area: "金州湾北部 · S38", metric: "浊度", metric_value: "36 NTU", score: 19, level: "low", trend: "-8%", created_at: isoMinutesAgo(420), status: "active", dispatched: false }
    ];
  }

  function loadLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.events) || !Array.isArray(parsed.alerts)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveLocalState() {
    if (state.apiOnline) return;
    try {
      const events = state.events.map((event) => ({
        ...event,
        images: []
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ events, alerts: state.alerts, saved_at: new Date().toISOString() }));
    } catch {
      // Local storage may be unavailable or full; the demo remains usable in memory.
    }
  }

  async function api(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
      if (!response.ok) {
        let message = `请求失败 (${response.status})`;
        try {
          const data = await response.json();
          message = data.detail || data.message || message;
        } catch {
          // Keep the HTTP status message.
        }
        throw new Error(message);
      }
      return response.status === 204 ? null : response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  const riskLabel = (level) => ({ high: "高风险", medium: "中风险", low: "低风险" }[level] || "低风险");
  const riskColor = (level) => ({ high: "#ff6b57", medium: "#f4b954", low: "#35c8f4" }[level] || "#35c8f4");

  async function loadMapData(showErrors = false) {
    try {
      const separator = MAP_DATA_URL.includes("?") ? "&" : "?";
      const response = await fetch(`${MAP_DATA_URL}${separator}v=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`数据文件请求失败 (${response.status})`);
      const payload = await response.json();
      if (!Array.isArray(payload.stations)) throw new Error("数据文件缺少监测站列表");
      state.mapData = payload;
      updateMapDataBadges();
      return payload;
    } catch (error) {
      if (showErrors) showToast("地图数据刷新失败", error.message || "请检查 data.json 是否存在", "error");
      updateMapDataBadges(error);
      return null;
    }
  }

  function updateMapDataBadges(error = null) {
    const badge = $("#map-simulation-badge");
    const data = state.mapData;
    if (!badge) return;
    if (data) {
      badge.hidden = false;
      badge.textContent = data.data_mode === "simulation" ? `模拟点位 · ${data.local_date}` : `数据 ${data.local_date}`;
      badge.classList.toggle("real", data.data_mode !== "simulation");
      badge.title = data.simulation_notice || "点位属性以数据文件标注为准";
    } else if (error) {
      badge.hidden = false;
      badge.textContent = "数据读取失败";
      badge.classList.remove("real");
    }
    const counts = {
      station: data?.stations?.length || 0,
      issue: data?.issues?.length || 0,
      risk: data?.risks?.length || 0,
      port: data?.ports?.length || 0,
      zone: (data?.protected_areas?.length || 0) + (data?.aquaculture_zones?.length || 0)
    };
    Object.entries(counts).forEach(([key, count]) => {
      const element = $(`#${key}-layer-count`);
      if (element) element.textContent = count;
    });
  }

  function tiandituTileUrl(layer) {
    return `https://t{s}.tianditu.gov.cn/${layer}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer.replace(/_w$/, "")}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(TIANDITU_KEY)}`;
  }

  function setMapStatus(text, provider = "") {
    const status = $("#map-source-status");
    if (status) status.innerHTML = `<i></i>${escapeHtml(text)}`;
    state.mapProvider = provider || state.mapProvider;
  }

  function initializeLeafletMap() {
    const element = $("#leaflet-map");
    if (!element) return;
    if (!window.L) {
      activateStaticMapFallback("地图组件未加载");
      return;
    }
    if (!state.leafletMap) {
      state.leafletMap = L.map(element, {
        center: MAP_CENTER,
        zoom: 8,
        minZoom: 6,
        maxZoom: 17,
        zoomControl: false,
        attributionControl: true
      });
      L.control.zoom({ position: "bottomright" }).addTo(state.leafletMap);
      const panes = {
        zones: 405,
        risk: 415,
        stations: 440
      };
      Object.entries(panes).forEach(([name, zIndex]) => {
        const pane = state.leafletMap.createPane(`${name}Pane`);
        pane.style.zIndex = String(zIndex);
      });
      state.mapLayerGroups = {
        stations: L.layerGroup(),
        events: L.layerGroup(),
        risk: L.layerGroup(),
        port: L.layerGroup(),
        zones: L.layerGroup()
      };
      Object.values(state.mapLayerGroups).forEach((group) => group.addTo(state.leafletMap));
      state.leafletMap.on("click", () => state.leafletMap.closePopup());
    }
    switchMapSource(TIANDITU_KEY ? "tianditu" : "osm");
    setTimeout(() => state.leafletMap?.invalidateSize(), 80);
  }

  function switchMapSource(provider = "tianditu") {
    if (!state.leafletMap || !window.L) {
      activateStaticMapFallback("在线地图不可用");
      return;
    }
    if (state.mapBaseLayer) state.leafletMap.removeLayer(state.mapBaseLayer);
    if (state.mapBaseLabels) state.leafletMap.removeLayer(state.mapBaseLabels);
    state.mapBaseLayer = null;
    state.mapBaseLabels = null;

    if (provider === "tianditu" && TIANDITU_KEY) {
      state.mapBaseLayer = L.tileLayer(tiandituTileUrl("vec_w"), {
        subdomains: "01234567",
        maxZoom: 18,
        attribution: "&copy; 天地图"
      });
      state.mapBaseLabels = L.tileLayer(tiandituTileUrl("cva_w"), {
        subdomains: "01234567",
        maxZoom: 18,
        pane: "shadowPane"
      });
      setMapStatus("天地图 · 在线", "tianditu");
    } else {
      state.mapBaseLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        subdomains: "abc",
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      });
      setMapStatus(TIANDITU_KEY ? "OpenStreetMap · 备用" : "OpenStreetMap · 未配置天地图密钥", "osm");
    }

    const candidate = state.mapBaseLayer;
    let errors = 0;
    candidate.on("tileerror", () => {
      errors += 1;
      if (errors < 4 || state.mapBaseLayer !== candidate) return;
      if (provider === "tianditu") {
        showToast("天地图暂不可用", "正在自动切换 OpenStreetMap 备用底图", "info");
        switchMapSource("osm");
      } else {
        activateStaticMapFallback("在线底图连接失败");
      }
    });
    candidate.addTo(state.leafletMap);
    if (state.mapBaseLabels) {
      const labels = state.mapBaseLabels;
      labels.on("tileerror", () => {
        if (state.mapBaseLabels === labels && state.leafletMap.hasLayer(labels)) state.leafletMap.removeLayer(labels);
      });
      labels.addTo(state.leafletMap);
    }
  }

  function activateStaticMapFallback(reason) {
    state.mapFallback = true;
    $("#ocean-map")?.classList.add("static-fallback");
    const note = $("#map-fallback");
    if (note) {
      note.hidden = false;
      note.textContent = `${reason}，已切换为本地示意地图。`;
    }
    setMapStatus("本地示意底图", "fallback");
  }

  function addMapClick(layer, category, id) {
    layer.on("click", (event) => {
      if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
      openMapObject(category, id);
    });
    layer.bindTooltip("点击查看详情", { direction: "top", offset: [0, -6], opacity: 0.92 });
    return layer;
  }

  function renderMapObjects() {
    if (!state.leafletMap || state.mapFallback || !window.L || !state.mapData) return;
    Object.values(state.mapLayerGroups).forEach((group) => group.clearLayers());

    (state.mapData.stations || []).forEach((station) => {
      const marker = L.circleMarker([station.lat, station.lng], {
        pane: "stationsPane",
        radius: station.risk_level === "high" ? 8 : 6,
        color: "#d9fbff",
        weight: 1.5,
        fillColor: riskColor(station.risk_level),
        fillOpacity: 0.92
      });
      marker.bindTooltip(`${escapeHtml(station.id)} · ${escapeHtml(station.name)}<br>${escapeHtml(formatStationStatus(station))}`, { direction: "top", offset: [0, -7] });
      addMapClick(marker, "station", station.id);
      state.mapLayerGroups.stations.addLayer(marker);
    });

    (state.mapData.risks || []).forEach((risk) => {
      const area = L.circle([risk.lat, risk.lng], {
        pane: "riskPane",
        radius: Number(risk.radius_m) || 9000,
        color: riskColor(risk.level),
        weight: 1.4,
        fillColor: riskColor(risk.level),
        fillOpacity: risk.level === "high" ? 0.16 : 0.1,
        dashArray: "5 7"
      });
      area.bindTooltip(`${escapeHtml(risk.name)} · ${riskLabel(risk.level)}`, { sticky: true });
      addMapClick(area, "risk", risk.id);
      state.mapLayerGroups.risk.addLayer(area);
    });

    const markerIcon = (className, text, anchor = [12, 12]) => L.divIcon({
      className: `eco-map-marker ${className}`,
      html: `<span>${escapeHtml(text)}</span>`,
      iconSize: [24, 24],
      iconAnchor: anchor
    });

    (state.mapData.ports || []).forEach((port) => {
      const marker = L.marker([port.lat, port.lng], { icon: markerIcon("port", "港", [12, 23]) });
      marker.bindTooltip(`${escapeHtml(port.name)} · 点击查看`, { direction: "top", offset: [0, -13] });
      addMapClick(marker, "port", port.id);
      state.mapLayerGroups.port.addLayer(marker);
    });

    (state.mapData.issues || []).forEach((issue) => {
      const marker = L.marker([issue.lat, issue.lng], {
        icon: markerIcon(
          `issue ${issue.severity}`,
          issue.issue_type === "oil" ? "油" : issue.issue_type === "trash" ? "垃" : "!",
          [12, 1]
        )
      });
      marker.bindTooltip(`${escapeHtml(issue.name)} · ${escapeHtml(issue.status_label)}`, { direction: "top", offset: [0, -13] });
      addMapClick(marker, "issue", issue.id);
      state.mapLayerGroups.events.addLayer(marker);
    });

    [...(state.mapData.protected_areas || []), ...(state.mapData.aquaculture_zones || [])].forEach((zone) => {
      const isProtected = zone.category === "protected_area";
      const radiusMeters = (Number(zone.radius_deg) || 0.08) * 111000;
      const area = L.circle([zone.lat, zone.lng], {
        pane: "zonesPane",
        radius: radiusMeters,
        color: isProtected ? "#47d39a" : "#35c8f4",
        weight: 1.2,
        fillColor: isProtected ? "#47d39a" : "#35c8f4",
        fillOpacity: 0.075,
        dashArray: isProtected ? "8 6" : "3 6"
      });
      area.bindTooltip(`${escapeHtml(zone.name)} · 点击查看`, { sticky: true });
      addMapClick(area, zone.category, zone.id);
      state.mapLayerGroups.zones.addLayer(area);
    });

    applyMapLayerVisibility();
  }

  function applyMapLayerVisibility() {
    Object.entries(state.mapLayerGroups).forEach(([key, group]) => {
      if (!state.leafletMap) return;
      const visible = state.mapLayerVisibility[key] !== false;
      if (visible && !state.leafletMap.hasLayer(group)) group.addTo(state.leafletMap);
      if (!visible && state.leafletMap.hasLayer(group)) state.leafletMap.removeLayer(group);
    });
  }

  function formatStationStatus(station) {
    const oxygen = Number(station.dissolved_oxygen_mg_l);
    return station.risk_level === "high" || station.status === "高风险"
      ? `高风险 · 溶解氧 ${Number.isFinite(oxygen) ? oxygen.toFixed(1) : "--"} mg/L`
      : `${station.status || riskLabel(station.risk_level)} · 风险指数 ${station.risk_score ?? "--"}`;
  }

  function detailRows(items) {
    return items.map(([label, value]) => `<div><small>${escapeHtml(label)}</small><b>${escapeHtml(value ?? "--")}</b></div>`).join("");
  }

  function mapSimulationNotice(item) {
    return item?.is_simulated
      ? `<div class="map-card-simulation">${icon("shield")}该点位为平台验证用模拟点位，不代表官方监测站或事件位置。</div>`
      : "";
  }

  function openMapObject(category, id) {
    const data = state.mapData;
    if (!data) return;
    if (category === "station") {
      const station = data.stations?.find((item) => item.id === id);
      if (!station) return;
      const events = (station.associated_events || []).join("、") || "暂无关联事件";
      openModal(`
        <div class="modal-head"><div><span class="map-card-kicker">环境监测站 · ${escapeHtml(station.id)}</span><h2>${escapeHtml(station.name)}</h2><p>${escapeHtml(station.location)} · ${escapeHtml(formatDateTime(station.updated_at))}</p></div><button class="modal-close" data-close-modal>${icon("close")}</button></div>
        <div class="modal-body">
          <div class="map-detail-banner ${station.risk_level}"><span>当前状态</span><strong>${escapeHtml(station.status)}</strong><em>综合风险分 ${station.risk_score ?? "--"}</em></div>
          <div class="map-detail-grid">
            <div class="detail-summary"><small>水温</small><b>${station.water_temp_c ?? "--"}℃</b><span>${escapeHtml(station.trend?.label || "日数据")}</span></div>
            <div class="detail-summary"><small>盐度</small><b>${station.salinity_psu ?? "--"}‰</b><span>日变化 ${escapeHtml(station.trend?.change || "--")}</span></div>
            <div class="detail-summary"><small>溶解氧</small><b>${station.dissolved_oxygen_mg_l ?? "--"} mg/L</b><span>${Number(station.dissolved_oxygen_mg_l) < 5 ? "低于关注阈值" : "处于可监测范围"}</span></div>
          </div>
          <div class="map-detail-list">${detailRows([
            ["叶绿素 a", `${station.chlorophyll_a ?? "--"} μg/L`],
            ["pH", station.ph ?? "--"],
            ["浊度", `${station.turbidity_ntu ?? "--"} NTU`],
            ["近期趋势", station.trend?.label || "--"],
            ["关联事件", events]
          ])}</div>
          ${mapSimulationNotice(station)}
        </div>
        <div class="modal-foot"><button class="control-button" data-close-modal>关闭</button><button class="primary-button" data-go="risk">查看风险预警</button></div>`);
      return;
    }

    if (category === "risk") {
      const risk = data.risks?.find((item) => item.id === id);
      if (!risk) return;
      const type = TYPE_META[risk.risk_type] || TYPE_META.other;
      openModal(`
        <div class="modal-head"><div><span class="map-card-kicker">污染风险区 · ${escapeHtml(risk.id)}</span><h2>${escapeHtml(risk.name)}</h2><p>${escapeHtml(type.label)} · 数据更新时间 ${escapeHtml(formatDateTime(risk.updated_at))}</p></div><button class="modal-close" data-close-modal>${icon("close")}</button></div>
        <div class="modal-body">
          <div class="map-detail-banner ${risk.level}"><span>风险等级</span><strong>${riskLabel(risk.level)}</strong><em>风险评分 ${risk.score}</em></div>
          <div class="map-detail-section"><h3>异常指标</h3><p>${escapeHtml(risk.abnormal_indicator)}</p></div>
          <div class="map-detail-section"><h3>主要成因</h3><p>${escapeHtml(risk.cause)}</p></div>
          <div class="map-detail-section recommendation"><h3>建议处置措施</h3><p>${escapeHtml(risk.recommendation)}</p></div>
          ${mapSimulationNotice(risk)}
        </div>
        <div class="modal-foot"><button class="control-button" data-close-modal>关闭</button><button class="primary-button" data-go="risk">进入风险预警</button></div>`);
      return;
    }

    if (category === "issue") {
      const issue = data.issues?.find((item) => item.id === id);
      if (!issue) return;
      const type = TYPE_META[issue.issue_type] || TYPE_META.other;
      const status = STATUS_META[issue.status] || { label: issue.status_label || issue.progress, className: "processing" };
      openModal(`
        <div class="modal-head"><div><span class="map-card-kicker">生态问题 · ${escapeHtml(issue.id)}</span><h2>${escapeHtml(issue.name)}</h2><p>${escapeHtml(issue.location)}</p></div><button class="modal-close" data-close-modal>${icon("close")}</button></div>
        <div class="modal-body">
          <div class="map-detail-banner ${issue.severity}"><span>${escapeHtml(type.label)}</span><strong>${escapeHtml(status.label)}</strong><em>${escapeHtml(SEVERITY_META[issue.severity]?.label || "一般")}</em></div>
          <div class="issue-evidence-placeholder">${icon("image")}<span>现场图片待接入<br><small>演示数据暂未附带真实图片</small></span></div>
          <div class="map-detail-list">${detailRows([
            ["上报时间", formatDateTime(issue.created_at)],
            ["上报来源", issue.source],
            ["上报人", issue.reporter],
            ["责任单位", issue.team],
            ["处理进度", issue.progress || status.label]
          ])}</div>
          <div class="map-detail-section"><h3>问题描述</h3><p>${escapeHtml(issue.description)}</p></div>
          ${mapSimulationNotice(issue)}
        </div>
        <div class="modal-foot"><button class="control-button" data-close-modal>关闭</button><button class="primary-button" data-go="events">查看事件闭环</button></div>`);
      return;
    }

    const categories = {
      port: { list: data.ports, label: "港口区域", fallbackLabel: "港口属性" },
      protected_area: { list: data.protected_areas, label: "保护区", fallbackLabel: "保护区属性" },
      aquaculture_zone: { list: data.aquaculture_zones, label: "养殖区", fallbackLabel: "养殖区属性" }
    };
    const meta = categories[category];
    const area = meta?.list?.find((item) => item.id === id);
    if (!area) return;
    const attributes = Object.entries(area.attributes || {}).map(([key, value]) => [key, value]);
    const relatedStations = (area.related_station_ids || []).map((stationId) => {
      const station = data.stations?.find((item) => item.id === stationId);
      return station ? `${station.id} ${station.name}（${station.status}）` : stationId;
    }).join("；") || "暂无关联监测站";
    openModal(`
      <div class="modal-head"><div><span class="map-card-kicker">${escapeHtml(meta.label)} · ${escapeHtml(area.id)}</span><h2>${escapeHtml(area.name)}</h2><p>${escapeHtml(area.area_type || area.operator || "海洋功能区")}</p></div><button class="modal-close" data-close-modal>${icon("close")}</button></div>
      <div class="modal-body">
        <div class="map-detail-banner ${area.recent_risk >= 75 ? "high" : area.recent_risk >= 55 ? "medium" : "low"}"><span>近期风险</span><strong>${area.recent_risk >= 75 ? "高风险" : area.recent_risk >= 55 ? "中风险" : "低风险"}</strong><em>风险指数 ${area.recent_risk ?? "--"}</em></div>
        <div class="map-detail-list">${detailRows([...attributes, ["关联监测数据", relatedStations], ["近期问题数", `${area.issue_count ?? 0} 件`]])}</div>
        ${mapSimulationNotice(area)}
      </div>
      <div class="modal-foot"><button class="control-button" data-close-modal>关闭</button><button class="primary-button" data-go="map">返回生态地图</button></div>`);
  }

  async function initializeData() {
    await loadMapData();
    initializeLeafletMap();
    renderMapObjects();
    const local = loadLocalState();
    state.events = local?.events?.length ? local.events : createSeedEvents();
    state.alerts = local?.alerts?.length ? local.alerts : createSeedAlerts();
    state.selectedEventId = state.events[0]?.id || null;

    try {
      const health = await api("/api/health");
      if (health?.status === "ok") {
        const [events, alerts] = await Promise.all([api("/api/events"), api("/api/alerts")]);
        if (Array.isArray(events) && Array.isArray(alerts)) {
          state.apiOnline = true;
          state.mode = "server";
          state.events = events;
          state.alerts = alerts;
          state.selectedEventId = events.find((event) => event.status !== "archived")?.id || events[0]?.id || null;
        }
      }
    } catch {
      state.apiOnline = false;
      state.mode = "demo";
    }

    updateModeChip();
    renderAll();
  }

  function updateModeChip() {
    const chip = $("#mode-chip");
    if (!chip) return;
    chip.innerHTML = `<span></span>${state.apiOnline ? "服务端数据" : "演示数据"}`;
    chip.title = state.apiOnline
      ? "已连接服务器 API，数据将持久化保存"
      : "GitHub Pages 静态演示模式，数据保存在当前浏览器";
  }

  function renderAll() {
    renderWorkflowCounts();
    renderMapAlerts();
    renderAlertTable();
    renderRiskTrendChart();
    renderEvents();
    renderRecentReports();
    renderAnalytics();
  }

  function navigate(page, updateHash = true) {
    if (!PAGE_META[page]) return;
    state.page = page;
    $$(".page").forEach((section) => section.classList.toggle("active", section.dataset.page === page));
    $$(".nav-item, .mobile-bottom-nav button").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
    const current = $("#breadcrumb-current");
    if (current) current.textContent = PAGE_META[page];
    document.title = `${PAGE_META[page]} · 辽东湾智慧生态巡护平台`;
    if (updateHash && window.location.hash !== `#${page}`) {
      try {
        history.replaceState(null, "", `#${page}`);
      } catch {
        window.location.hash = page;
      }
    }
    closeSidebar();
    $(".page-container")?.scrollTo({ top: 0, behavior: "smooth" });
    if (window.innerWidth <= 760) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderWorkflowCounts() {
    const counts = { all: state.events.length, pending_review: 0, pending_dispatch: 0, processing: 0, pending_verification: 0, archived: 0 };
    state.events.forEach((event) => {
      if (counts[event.status] !== undefined) counts[event.status] += 1;
    });
    Object.entries(counts).forEach(([status, value]) => {
      const map = {
        all: "wf-all",
        pending_review: "wf-review",
        pending_dispatch: "wf-dispatch",
        processing: "wf-processing",
        pending_verification: "wf-verify",
        archived: "wf-archived"
      };
      const element = document.getElementById(map[status]);
      if (element) element.textContent = value;
    });
    const pending = counts.all - counts.archived;
    if ($("#pending-event-count")) $("#pending-event-count").textContent = pending;
    if ($("#event-nav-count")) $("#event-nav-count").textContent = counts.pending_review + counts.pending_dispatch;
    const activeAlerts = state.alerts.filter((alert) => alert.status === "active").length;
    if ($("#active-alert-count")) $("#active-alert-count").textContent = activeAlerts;
    if ($("#risk-nav-count")) $("#risk-nav-count").textContent = activeAlerts;
  }

  function formatRelative(dateString) {
    if (!dateString) return "刚刚";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;
    const diff = Date.now() - date.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 172800000) return "昨天";
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function formatDateTime(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString || "";
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function renderMapAlerts() {
    const container = $("#map-alert-list");
    if (!container) return;
    const alerts = state.alerts.filter((alert) => alert.level === "high" || alert.level === "medium").slice(0, 3);
    container.innerHTML = alerts.map((alert) => {
      const type = TYPE_META[alert.type] || TYPE_META.other;
      return `
        <div class="alert-mini ${alert.level}" data-alert-open="${escapeHtml(alert.id)}" tabindex="0" role="button">
          <div class="alert-mini-icon">${icon(type.icon)}</div>
          <div class="alert-mini-info">
            <b>${escapeHtml(alert.title)}</b>
            <span>${escapeHtml(alert.area)} · ${formatRelative(alert.created_at)}</span>
          </div>
          <div class="alert-mini-score"><strong>${alert.score}</strong><span>风险指数</span></div>
        </div>`;
    }).join("");
  }

  function renderAlertTable() {
    const body = $("#alert-table-body");
    if (!body) return;
    const alertFilter = state.alertFilter;
    const alerts = state.alerts.filter((alert) => alertFilter === "all" || alert.level === alertFilter);
    body.innerHTML = alerts.map((alert) => {
      const type = TYPE_META[alert.type] || TYPE_META.other;
      const dispatched = Boolean(alert.dispatched);
      return `
        <tr>
          <td>
            <div class="alert-type-cell">
              <span class="type-icon ${alert.level === "medium" ? "medium" : ""}">${icon(type.icon)}</span>
              <div><b>${escapeHtml(alert.title)}</b><small>${escapeHtml(alert.area)}</small></div>
            </div>
          </td>
          <td><div class="indicator-cell"><b>${escapeHtml(alert.metric_value)}</b><span>${escapeHtml(alert.metric)}</span></div></td>
          <td>
            <div class="risk-score-cell ${alert.level === "medium" ? "medium" : ""}">
              <strong>${alert.score}</strong><span class="score-bar"><i style="width:${Math.min(100, alert.score)}%"></i></span>
            </div>
          </td>
          <td><span class="${String(alert.trend).startsWith("+") ? "trend-up" : ""}">${alert.trend.startsWith("+") ? "↑" : "↓"} ${alert.trend.replace(/[+-]/, "")}</span></td>
          <td>${formatRelative(alert.created_at)}</td>
          <td><span class="status-pill ${alert.status === "dispatched" ? "processing" : alert.level}">${alert.status === "dispatched" ? "已转处置" : "待研判"}</span></td>
          <td><button class="row-action ${dispatched ? "dispatched" : ""}" data-alert-dispatch="${escapeHtml(alert.id)}" ${dispatched ? "disabled" : ""}>${dispatched ? "已生成事件" : "生成处置任务"}</button></td>
        </tr>`;
    }).join("");
  }

  function renderRiskTrendChart() {
    const container = $("#risk-trend-chart");
    if (!container) return;
    const values = [46, 49, 52, 51, 55, 53, 58, 56, 61, 64, 60, 63, 66, 68];
    const alertBars = [2, 3, 1, 3, 2, 4, 2, 3, 5, 3, 4, 3, 5, 4];
    const width = 720;
    const height = 165;
    const left = 34;
    const right = 14;
    const top = 12;
    const bottom = 24;
    const innerW = width - left - right;
    const innerH = height - top - bottom;
    const point = (value, index) => {
      const x = left + (index / (values.length - 1)) * innerW;
      const y = top + (1 - value / 100) * innerH;
      return [x, y];
    };
    const points = values.map((value, index) => point(value, index));
    const linePath = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
    const areaPath = `${linePath} L${points.at(-1)[0].toFixed(1)} ${top + innerH} L${left} ${top + innerH} Z`;
    const alertMax = Math.max(...alertBars);
    const labels = ["10/29", "10/30", "10/31", "11/01", "11/02", "11/03", "11/04", "11/05", "11/06", "11/07", "11/08", "11/09", "11/10", "今日"];
    const yLabels = [100, 75, 50, 25, 0];
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="近14日风险趋势图">
        <defs>
          <linearGradient id="trendArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#29d2c4" stop-opacity=".2"/>
            <stop offset="1" stop-color="#29d2c4" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${yLabels.map((value) => {
          const y = top + (1 - value / 100) * innerH;
          return `<line class="chart-grid-line" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"/><text class="chart-axis-label" x="${left - 8}" y="${y + 3}" text-anchor="end">${value}</text>`;
        }).join("")}
        ${alertBars.map((value, index) => {
          const x = left + (index / (values.length - 1)) * innerW - 2.4;
          const barHeight = Math.max(2, (value / alertMax) * 36);
          return `<rect x="${x}" y="${top + innerH - barHeight}" width="4.8" height="${barHeight}" rx="1.5" fill="#f4b954" opacity="${index === values.length - 1 ? ".85" : ".27"}"/>`;
        }).join("")}
        <path class="trend-area" d="${areaPath}"/>
        <path class="chart-line-main" d="${linePath}"/>
        ${points.map(([x, y], index) => index % 2 === 0 || index === points.length - 1
          ? `<circle class="chart-dot-main" cx="${x}" cy="${y}" r="${index === points.length - 1 ? 3.5 : 2.2}"/>`
          : "").join("")}
        <line x1="${points.at(-1)[0]}" x2="${points.at(-1)[0]}" y1="${top}" y2="${top + innerH}" stroke="rgba(41,210,196,.16)" stroke-dasharray="3 4"/>
        <rect class="chart-tooltip-bg" x="${points.at(-1)[0] - 52}" y="${points.at(-1)[1] - 32}" width="47" height="21" rx="4"/>
        <text class="chart-tooltip-text" x="${points.at(-1)[0] - 46}" y="${points.at(-1)[1] - 18}">风险 68</text>
        ${labels.map((label, index) => index % 2 === 0 || index === labels.length - 1
          ? `<text class="chart-axis-label" x="${point(0, index)[0]}" y="${height - 5}" text-anchor="middle">${label}</text>`
          : "").join("")}
      </svg>`;
  }

  function eventById(id) {
    return state.events.find((event) => event.id === id);
  }

  function renderEvents() {
    const list = $("#event-list");
    const detail = $("#event-detail");
    if (!list || !detail) return;

    let events = [...state.events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (state.eventStatus !== "all") events = events.filter((event) => event.status === state.eventStatus);
    if (state.eventSearch.trim()) {
      const query = state.eventSearch.trim().toLowerCase();
      events = events.filter((event) =>
        [event.id, event.title, event.location, TYPE_META[event.type]?.label].some((value) =>
          String(value || "").toLowerCase().includes(query)
        )
      );
    }

    list.innerHTML = events.length
      ? events.map((event) => {
          const type = TYPE_META[event.type] || TYPE_META.other;
          const status = STATUS_META[event.status] || STATUS_META.pending_review;
          return `
            <div class="event-list-item ${event.id === state.selectedEventId ? "active" : ""}" data-event-id="${escapeHtml(event.id)}" tabindex="0" role="button">
              <div class="event-list-icon ${type.className}">${icon(type.icon)}</div>
              <div class="event-list-info">
                <b>${escapeHtml(event.title)}</b>
                <span>${escapeHtml(event.id)} · ${escapeHtml(event.location)}</span>
              </div>
              <div class="event-list-meta">
                <span class="status-pill ${status.className}">${status.label}</span>
                <small>${formatRelative(event.created_at)}</small>
              </div>
            </div>`;
        }).join("")
      : `<div class="event-empty-list">${icon("search")}<span>没有符合条件的处置事件</span></div>`;

    $$("[data-status-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.statusFilter === state.eventStatus);
    });

    if (state.selectedEventId && events.some((event) => event.id === state.selectedEventId)) {
      renderEventDetail(eventById(state.selectedEventId));
    } else if (events.length) {
      state.selectedEventId = events[0].id;
      renderEventDetail(events[0]);
      const selected = list.querySelector(".event-list-item.active");
      if (selected) selected.classList.add("active");
    } else {
      detail.innerHTML = `<div class="event-detail-empty">${icon("events")}<h3>当前筛选下暂无事件</h3></div>`;
    }
  }

  function renderEventDetail(event) {
    const detail = $("#event-detail");
    if (!detail || !event) return;
    const type = TYPE_META[event.type] || TYPE_META.other;
    const status = STATUS_META[event.status] || STATUS_META.pending_review;
    const severity = SEVERITY_META[event.severity] || SEVERITY_META.medium;
    const action = ACTION_META[event.status];
    const history = event.history?.length ? event.history : buildSeedHistory(event.status, 30, event.notes);
    const notes = event.notes?.length ? event.notes[event.notes.length - 1] : event.description;
    const responseHours = Math.max(0.4, (new Date(event.updated_at || Date.now()) - new Date(event.created_at)) / 3600000).toFixed(1);
    const image = event.images?.[0];
    const imageUrl = assetUrl(typeof image === "string" ? image : image?.url || image?.dataUrl);
    const imageAlt = typeof image === "string" ? "现场影像" : image?.name || "现场影像";
    detail.innerHTML = `
      <div class="detail-top">
        <div>
          <div class="detail-title-line">
            <h2>${escapeHtml(event.title)}</h2>
            <span class="status-pill ${status.className}">${status.label}</span>
          </div>
          <div class="detail-subtitle">
            <span class="detail-id">${escapeHtml(event.id)}</span>
            <span>·</span>
            ${icon("pin")}
            <span>${escapeHtml(event.location)}</span>
          </div>
        </div>
        <div class="detail-title-line">
          <span class="severity-badge ${severity.className}">${severity.label}</span>
          <button class="detail-more" data-event-more="${escapeHtml(event.id)}" aria-label="更多操作">${icon("more")}</button>
        </div>
      </div>
      <div class="detail-summary-grid">
        <div class="detail-summary">
          <small>问题描述</small>
          <p>${escapeHtml(event.description)}</p>
        </div>
        <div class="detail-summary">
          <small>事件来源</small>
          <b>${escapeHtml(event.source)}</b>
          <span>${escapeHtml(event.reporter)} · ${formatRelative(event.created_at)}</span>
        </div>
        <div class="detail-summary">
          <small>当前处置时效</small>
          <strong>${responseHours}h</strong>
          <span>目标时限 8 小时</span>
        </div>
      </div>
      <div class="detail-mid-grid">
        <div class="detail-card">
          <div class="detail-card-title"><b>现场影像</b><span>${event.image_count ?? event.images?.length ?? 3} 张</span></div>
          <div class="detail-photo ${imageUrl ? "has-image" : ""}">
            ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageAlt)}">` : ""}
          </div>
        </div>
        <div class="detail-card">
          <div class="detail-card-title"><b>责任分派</b><span>${event.status === "pending_review" ? "尚未立案" : "已确认"}</span></div>
          <div class="assignee-row">
            <span class="assignee-avatar">${escapeHtml((event.assignee || "待").slice(0, 1))}</span>
            <div>
              <b>${escapeHtml(event.assignee || "待分派")}</b>
              <span>${escapeHtml(event.team || "待确定处置单位")}</span>
            </div>
            <button data-event-assign="${escapeHtml(event.id)}">调整</button>
          </div>
          <div class="deadline">${icon("clock")}要求完成时间：${formatDateTime(event.deadline)}</div>
        </div>
      </div>
      <div class="detail-card timeline-card">
        <div class="detail-card-title"><b>处置时间线</b><span>全流程留痕 · ${history.length} 条</span></div>
        <div class="timeline">
          ${history.map((item, index) => `
            <div class="timeline-item ${item.status || (index === history.length - 1 ? "current" : "done")}">
              <i></i>
              <div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.detail)}</p></div>
              <time>${formatDateTime(item.time)}</time>
            </div>`).join("")}
        </div>
      </div>
      <div class="detail-actions">
        <p>${event.status === "archived" ? "事件已完成闭环并归档，所有处置记录已锁定。" : `下一步：${action?.label || "跟进处置"}，完成后状态将自动更新。`}</p>
        ${action ? `<button class="primary-button" data-event-action="${escapeHtml(event.id)}" data-action="${action.action}">${icon(action.icon)}${action.label}</button>` : `<button class="control-button" data-event-view="${escapeHtml(event.id)}">${icon("eye")}查看归档记录</button>`}
      </div>`;
  }

  function renderRecentReports() {
    const container = $("#recent-report-list");
    if (!container) return;
    const reports = [...state.events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 3);
    container.innerHTML = reports.map((event) => {
      const type = TYPE_META[event.type] || TYPE_META.other;
      const status = STATUS_META[event.status] || STATUS_META.pending_review;
      return `
        <div class="recent-report">
          <i>${icon(type.icon)}</i>
          <div><b>${escapeHtml(event.title)}</b><span>${escapeHtml(event.location)}</span></div>
          <em>${status.label}</em>
        </div>`;
    }).join("");
  }

  function renderAnalytics() {
    renderIssueDonut();
    renderAreaBars();
    renderEfficiencyChart();
    renderRiskWeekChart();
    populateStaticDates();
  }

  function populateStaticDates() {
    const end = new Date();
    const start = new Date(end.getTime() - 29 * 86400000);
    const label = `${start.getFullYear()}.${pad(start.getMonth() + 1)}.${pad(start.getDate())} - ${pad(end.getMonth() + 1)}.${pad(end.getDate())}`;
    $$(".page-heading .control-button").forEach((button) => {
      if (button.textContent.includes("2026.10.13")) {
        button.innerHTML = `${icon("calendar")}${label}${icon("chevron-down", "chevron")}`;
      }
      if (button.textContent.includes("2026年11月11日")) {
        button.innerHTML = `${icon("calendar")}${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日${icon("chevron-down", "chevron")}`;
      }
    });
  }

  function renderIssueDonut() {
    const legend = $("#issue-donut-legend");
    const chart = $("#issue-donut");
    if (!legend || !chart) return;
    const keys = ["trash", "water", "oil", "redtide", "other"];
    const counts = Object.fromEntries(keys.map((key) => [key, state.events.filter((event) => event.type === key).length]));
    const total = state.events.length || 1;
    const colors = ["#28cfc1", "#4b9ff7", "#f4b954", "#a78fe3", "#ef7358"];
    const labels = ["海洋垃圾", "水质异常", "油污污染", "赤潮藻类", "其他问题"];
    let start = 0;
    const gradients = keys.map((key, index) => {
      const end = start + (counts[key] / total) * 100;
      const segment = `${colors[index]} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
      start = end;
      return segment;
    });
    chart.style.background = `conic-gradient(${gradients.join(",")})`;
    const center = chart.querySelector("strong");
    if (center) center.textContent = total;
    legend.innerHTML = keys.map((key, index) => `
      <div><i style="background:${colors[index]}"></i><span>${labels[index]}</span><b>${counts[key]}</b></div>`).join("");
  }

  function renderAreaBars() {
    const container = $("#area-bars");
    if (!container) return;
    const areas = [
      { label: "营口近岸", closed: 26, pending: 7 },
      { label: "盘锦河口", closed: 19, pending: 6 },
      { label: "锦州南部", closed: 22, pending: 4 },
      { label: "鲅鱼圈", closed: 17, pending: 5 },
      { label: "葫芦岛近岸", closed: 14, pending: 3 }
    ];
    const max = Math.max(...areas.map((area) => area.closed + area.pending));
    container.innerHTML = areas.map((area) => `
      <div class="horizontal-bar">
        <span>${area.label}</span>
        <div><i style="width:${(area.closed / max) * 100}%"></i><i style="width:${(area.pending / max) * 100}%"></i></div>
        <b>${area.closed + area.pending}</b>
      </div>`).join("");
  }

  function renderEfficiencyChart() {
    const container = $("#efficiency-chart");
    if (!container) return;
    const width = 420;
    const height = 165;
    const left = 28;
    const top = 12;
    const bottom = 23;
    const innerH = height - top - bottom;
    const innerW = width - left - 12;
    const response = [4.8, 4.3, 4.6, 3.9, 4.2, 3.8, 3.5, 3.2, 3.0, 2.8];
    const finish = [10.2, 9.8, 8.9, 9.1, 8.5, 8.2, 7.9, 7.3, 7.1, 6.8];
    const max = 12;
    const path = (values) => values.map((value, index) => {
      const x = left + (index / (values.length - 1)) * innerW;
      const y = top + (1 - value / max) * innerH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
    const labels = ["10/14", "10/17", "10/20", "10/23", "10/26", "10/29", "11/01", "11/05", "11/08", "今日"];
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="处置时效趋势图">
        ${[12, 8, 4, 0].map((value) => {
          const y = top + (1 - value / max) * innerH;
          return `<line class="chart-grid-line" x1="${left}" x2="${width - 12}" y1="${y}" y2="${y}"/><text class="chart-axis-label" x="${left - 7}" y="${y + 3}" text-anchor="end">${value}h</text>`;
        }).join("")}
        <path class="chart-line-secondary" d="${path(finish)}"/>
        <path class="chart-line-main" d="${path(response)}"/>
        ${response.map((value, index) => {
          const x = left + (index / (response.length - 1)) * innerW;
          const y = top + (1 - value / max) * innerH;
          return `<circle class="chart-dot-main" cx="${x}" cy="${y}" r="2"/>`;
        }).join("")}
        ${labels.map((label, index) => index % 2 === 0
          ? `<text class="chart-axis-label" x="${left + (index / (labels.length - 1)) * innerW}" y="${height - 5}" text-anchor="middle">${label}</text>`
          : "").join("")}
      </svg>`;
  }

  function renderRiskWeekChart() {
    const container = $("#risk-week-chart");
    if (!container) return;
    const width = 640;
    const height = 165;
    const left = 28;
    const top = 10;
    const bottom = 23;
    const innerW = width - left - 12;
    const innerH = height - top - bottom;
    const weeks = ["第1周", "第2周", "第3周", "第4周", "第5周", "本周"];
    const values = [77, 72, 74, 68, 65, 61];
    const path = values.map((value, index) => {
      const x = left + (index / (values.length - 1)) * innerW;
      const y = top + (1 - value / 100) * innerH;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="近六周风险趋势">
        <defs><linearGradient id="weekArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#29d2c4" stop-opacity=".18"/><stop offset="1" stop-color="#29d2c4" stop-opacity="0"/></linearGradient></defs>
        ${[100, 75, 50, 25, 0].map((value) => {
          const y = top + (1 - value / 100) * innerH;
          return `<line class="chart-grid-line" x1="${left}" x2="${width - 12}" y1="${y}" y2="${y}"/><text class="chart-axis-label" x="${left - 7}" y="${y + 3}" text-anchor="end">${value}</text>`;
        }).join("")}
        <path d="${path} L${left + innerW} ${top + innerH} L${left} ${top + innerH} Z" fill="url(#weekArea)"/>
        <path class="chart-line-main" d="${path}"/>
        ${values.map((value, index) => {
          const x = left + (index / (values.length - 1)) * innerW;
          const y = top + (1 - value / 100) * innerH;
          return `<circle class="chart-dot-main" cx="${x}" cy="${y}" r="3"/><text class="chart-axis-label" x="${x}" y="${y - 8}" text-anchor="middle" fill="${index === values.length - 1 ? "#8de4dc" : "#526f77"}">${value}</text>`;
        }).join("")}
        ${weeks.map((week, index) => `<text class="chart-axis-label" x="${left + (index / (weeks.length - 1)) * innerW}" y="${height - 5}" text-anchor="middle">${week}</text>`).join("")}
      </svg>`;
  }

  function showToast(title, message, type = "success", duration = 3600) {
    const stack = $("#toast-stack");
    if (!stack) return;
    const toast = document.createElement("div");
    const toastIcon = type === "error" ? "risk" : type === "info" ? "eye" : "check-circle";
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i>${icon(toastIcon)}</i>
      <div><b>${escapeHtml(title)}</b><span>${escapeHtml(message)}</span></div>
      <button aria-label="关闭通知">${icon("close")}</button>`;
    stack.appendChild(toast);
    const remove = () => {
      toast.classList.add("removing");
      setTimeout(() => toast.remove(), 220);
    };
    toast.querySelector("button").addEventListener("click", remove);
    setTimeout(remove, duration);
  }

  function openModal(content, className = "") {
    const root = $("#modal-root");
    if (!root) return;
    root.innerHTML = `<div class="modal ${className}" role="dialog" aria-modal="true">${content}</div>`;
    root.classList.add("open");
    state.activeModal = root.querySelector(".modal");
    const firstInput = root.querySelector("input, select, textarea");
    setTimeout(() => firstInput?.focus(), 80);
  }

  function closeModal() {
    const root = $("#modal-root");
    if (!root) return;
    root.classList.remove("open");
    root.innerHTML = "";
    state.activeModal = null;
  }

  function showAlertDetails(alertId) {
    const alert = state.alerts.find((item) => item.id === alertId);
    if (!alert) return;
    const type = TYPE_META[alert.type] || TYPE_META.other;
    openModal(`
      <div class="modal-head">
        <div><h2>${escapeHtml(alert.title)}</h2><p>${escapeHtml(alert.id)} · ${formatRelative(alert.created_at)}</p></div>
        <button class="modal-close" data-close-modal aria-label="关闭">${icon("close")}</button>
      </div>
      <div class="modal-body">
        <div class="detail-summary-grid">
          <div class="detail-summary"><small>风险区域</small><p>${escapeHtml(alert.area)}</p></div>
          <div class="detail-summary"><small>${escapeHtml(alert.metric)}</small><b>${escapeHtml(alert.metric_value)}</b><span>较昨日 ${escapeHtml(alert.trend)}</span></div>
          <div class="detail-summary"><small>风险评分</small><strong>${alert.score}</strong><span>${alert.level === "high" ? "高风险" : alert.level === "medium" ? "中风险" : "低风险"}</span></div>
        </div>
        <div class="score-orbit" style="height:170px">
          <div class="score-center"><span>多因子加权</span><strong>${alert.score}</strong><small>${alert.level === "high" ? "需优先处置" : "持续关注"}</small></div>
          <div class="orbit-ring r1"></div><div class="orbit-ring r2"></div>
          <span class="orbit-node n1">环境异常<b>${Math.min(100, alert.score + 4)}</b></span>
          <span class="orbit-node n2">趋势突变<b>${Math.max(20, alert.score - 8)}</b></span>
          <span class="orbit-node n3">事件密度<b>${Math.min(100, alert.score + 2)}</b></span>
        </div>
        <div class="model-note">${icon("shield")}风险评分用于辅助确定处置优先级，需结合现场核实结果研判。</div>
      </div>
      <div class="modal-foot">
        <button class="control-button" data-close-modal>暂不处理</button>
        <button class="primary-button" data-alert-dispatch="${escapeHtml(alert.id)}" ${alert.dispatched ? "disabled" : ""}>${alert.dispatched ? "已生成处置任务" : "生成处置任务"}</button>
      </div>`);
  }

  async function dispatchAlert(alertId) {
    const alert = state.alerts.find((item) => item.id === alertId);
    if (!alert || alert.dispatched) return;
    const type = TYPE_META[alert.type] || TYPE_META.other;
    const nowIso = new Date().toISOString();
    const event = {
      id: `EV-${nowIso.slice(0, 10).replaceAll("-", "")}-${String(state.events.length + 1).padStart(3, "0")}`,
      title: alert.title,
      type: alert.type,
      severity: alert.level === "high" ? "high" : "medium",
      status: "pending_dispatch",
      location: alert.area,
      description: `系统风险预警：${alert.metric}监测值为${alert.metric_value}，风险评分${alert.score}，已由预警中心生成处置任务。`,
      reporter: "风险预警模型",
      source: "系统预警",
      created_at: nowIso,
      updated_at: nowIso,
      deadline: new Date(Date.now() + 8 * 3600000).toISOString(),
      team: "待分派",
      assignee: "待分派",
      notes: ["预警已确认，等待责任单位分派。"],
      history: [
        { title: "风险预警触发", detail: `风险评分 ${alert.score}，进入处置流程`, time: nowIso, status: "done" },
        { title: "生成处置事件", detail: "预警已转为正式处置任务", time: nowIso, status: "current" }
      ]
    };

    let selectedId = event.id;
    try {
      if (state.apiOnline) {
        const result = await api(`/api/alerts/${encodeURIComponent(alertId)}/dispatch`, {
          method: "POST",
          body: JSON.stringify({})
        });
        if (result?.event) {
          state.events.unshift(result.event);
          selectedId = result.event.id;
          const index = state.alerts.findIndex((item) => item.id === alertId);
          if (index >= 0) state.alerts[index] = result.alert || { ...alert, dispatched: true, status: "dispatched" };
        }
      } else {
        state.events.unshift(event);
        alert.dispatched = true;
        alert.status = "dispatched";
        saveLocalState();
      }
      state.selectedEventId = selectedId;
      closeModal();
      renderAll();
      showToast("处置任务已生成", `${alert.title} 已进入待分派队列`, "success");
      navigate("events");
    } catch (error) {
      showToast("任务生成失败", error.message || "请稍后再试", "error");
    }
  }

  function openEventAction(eventId, action) {
    const event = eventById(eventId);
    if (!event) return;
    if (action === "review") {
      openModal(`
        <div class="modal-head"><div><h2>审核并立案</h2><p>请确认事件信息真实、位置明确且属于平台受理范围</p></div><button class="modal-close" data-close-modal>${icon("close")}</button></div>
        <div class="modal-body">
          <div class="detail-summary"><small>待审核事件</small><p>${escapeHtml(event.title)}</p><span>${escapeHtml(event.location)}</span></div>
          <label class="modal-field" style="margin-top:12px"><span>审核意见</span><textarea id="action-note">事件信息完整，同意立案并进入处置分派流程。</textarea></label>
        </div>
        <div class="modal-foot"><button class="control-button" data-close-modal>取消</button><button class="primary-button" data-confirm-action="${escapeHtml(event.id)}" data-action="review">${icon("check")}审核通过</button></div>`);
      return;
    }
    if (action === "dispatch") {
      openModal(`
        <div class="modal-head"><div><h2>分派处置任务</h2><p>为事件指定责任单位、现场负责人和完成时限</p></div><button class="modal-close" data-close-modal>${icon("close")}</button></div>
        <div class="modal-body">
          <label class="modal-field"><span>责任单位</span><select id="dispatch-team"><option>营口港巡护中队</option><option>鲅鱼圈岸线保洁队</option><option>营口水质应急组</option><option>海洋生态监测站</option><option>属地生态环境分局</option></select></label>
          <label class="modal-field"><span>现场负责人</span><input id="dispatch-assignee" value="${escapeHtml(event.team || "应急值守人员")}"></label>
          <label class="modal-field"><span>要求完成时限</span><select id="dispatch-deadline"><option value="4">4 小时内</option><option value="8" selected>8 小时内</option><option value="24">24 小时内</option></select></label>
          <label class="modal-field"><span>分派说明</span><textarea id="action-note">请携带现场取证设备与应急处置物资，抵达后先完成安全确认并回传现场照片。</textarea></label>
        </div>
        <div class="modal-foot"><button class="control-button" data-close-modal>取消</button><button class="primary-button" data-confirm-action="${escapeHtml(event.id)}" data-action="dispatch">${icon("send")}确认分派</button></div>`);
      return;
    }
    if (action === "submit_result") {
      openModal(`
        <div class="modal-head"><div><h2>提交处理结果</h2><p>处置结果将进入复核环节，请如实填写现场情况</p></div><button class="modal-close" data-close-modal>${icon("close")}</button></div>
        <div class="modal-body">
          <label class="modal-field"><span>处置结果</span><textarea id="action-note" placeholder="说明已采取的措施、现场处理范围及结果">已完成现场处置，污染源得到控制，现场经复查无明显异常。</textarea></label>
          <label class="modal-field"><span>现场复核照片</span><input id="result-images" type="file" accept="image/*" multiple></label>
          <div class="model-note">${icon("shield")}提交后将由平台管理员或指挥中心进行复核，复核通过后自动归档。</div>
        </div>
        <div class="modal-foot"><button class="control-button" data-close-modal>取消</button><button class="primary-button" data-confirm-action="${escapeHtml(event.id)}" data-action="submit_result">${icon("upload")}提交复核</button></div>`);
      return;
    }
    if (action === "archive") {
      openModal(`
        <div class="modal-head"><div><h2>复核并归档</h2><p>确认处置结果达到闭环要求</p></div><button class="modal-close" data-close-modal>${icon("close")}</button></div>
        <div class="modal-body">
          <div class="detail-summary"><small>处置结果</small><p>${escapeHtml(event.notes?.at(-1) || "处置队伍已完成现场处理并提交结果。")}</p></div>
          <label class="modal-field" style="margin-top:12px"><span>复核意见</span><textarea id="action-note">处置结果通过复核，现场风险已消除，同意归档。</textarea></label>
        </div>
        <div class="modal-foot"><button class="control-button" data-close-modal>返回复核</button><button class="primary-button" data-confirm-action="${escapeHtml(event.id)}" data-action="archive">${icon("check-circle")}复核通过并归档</button></div>`);
    }
  }

  async function confirmEventAction(eventId, action) {
    const event = eventById(eventId);
    if (!event || !NEXT_STATUS[action]) return;
    const note = $("#action-note")?.value?.trim() || "处置状态已更新。";
    const nextStatus = NEXT_STATUS[action];
    const team = $("#dispatch-team")?.value || event.team;
    const assignee = $("#dispatch-assignee")?.value?.trim() || event.assignee;
    const deadlineHours = Number($("#dispatch-deadline")?.value || 8);
    const nowIso = new Date().toISOString();
    const titles = {
      review: "审核立案",
      dispatch: "任务分派",
      submit_result: "现场处置完成",
      archive: "复核归档"
    };
    const payload = { action, note, team, assignee, deadline_hours: deadlineHours };
    if (action === "submit_result") {
      const files = Array.from($("#result-images")?.files || []);
      if (files.length > 6) {
        showToast("照片数量过多", "单次最多上传 6 张现场复核照片", "error");
        return;
      }
      try {
        payload.images = [];
        for (const file of files) {
          payload.images.push(await compressImage(file));
        }
      } catch (error) {
        showToast("照片处理失败", error.message || "请重新选择图片", "error");
        return;
      }
    }
    const original = { ...event, history: [...(event.history || [])], notes: [...(event.notes || [])] };

    event.status = nextStatus;
    event.updated_at = nowIso;
    event.notes = [...(event.notes || []), note];
    event.history = [...(event.history || []), { title: titles[action], detail: note, time: nowIso, status: "done" }];
    if (action === "dispatch") {
      event.team = team;
      event.assignee = assignee;
      event.deadline = new Date(Date.now() + deadlineHours * 3600000).toISOString();
    }
    if (payload.images?.length) {
      event.images = [...(event.images || []), ...payload.images];
      event.image_count = event.images.length;
    }

    try {
      if (state.apiOnline) {
        const updated = await api(`/api/events/${encodeURIComponent(eventId)}/transition`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        const index = state.events.findIndex((item) => item.id === eventId);
        if (index >= 0 && updated) state.events[index] = updated;
      } else {
        saveLocalState();
      }
      closeModal();
      renderAll();
      showToast(titles[action], `事件 ${eventId} 已更新为“${STATUS_META[nextStatus].label}”`, "success");
    } catch (error) {
      Object.assign(event, original);
      renderEvents();
      closeModal();
      showToast("状态更新失败", error.message || "请稍后再试", "error");
    }
  }

  function openAssignModal(eventId) {
    const event = eventById(eventId);
    if (!event) return;
    openModal(`
      <div class="modal-head"><div><h2>调整责任分派</h2><p>${escapeHtml(event.title)}</p></div><button class="modal-close" data-close-modal>${icon("close")}</button></div>
      <div class="modal-body">
        <label class="modal-field"><span>责任单位</span><input id="quick-team" value="${escapeHtml(event.team || "")}" placeholder="请输入责任单位"></label>
        <label class="modal-field"><span>现场负责人</span><input id="quick-assignee" value="${escapeHtml(event.assignee || "")}" placeholder="请输入负责人"></label>
      </div>
      <div class="modal-foot"><button class="control-button" data-close-modal>取消</button><button class="primary-button" data-quick-assign="${escapeHtml(event.id)}">${icon("users")}保存分派</button></div>`);
  }

  async function saveQuickAssign(eventId) {
    const event = eventById(eventId);
    if (!event) return;
    const team = $("#quick-team")?.value?.trim();
    const assignee = $("#quick-assignee")?.value?.trim();
    if (!team || !assignee) {
      showToast("信息不完整", "请填写责任单位和现场负责人", "error");
      return;
    }
    const original = { team: event.team, assignee: event.assignee };
    event.team = team;
    event.assignee = assignee;
    event.updated_at = new Date().toISOString();
    try {
      if (state.apiOnline) {
        const updated = await api(`/api/events/${encodeURIComponent(event.id)}/assign`, {
          method: "PATCH",
          body: JSON.stringify({ team, assignee })
        });
        const index = state.events.findIndex((item) => item.id === event.id);
        if (index >= 0 && updated) state.events[index] = updated;
      } else {
        saveLocalState();
      }
      closeModal();
      renderAll();
      showToast("分派已更新", `${team} · ${assignee}`, "success");
    } catch (error) {
      Object.assign(event, original);
      closeModal();
      showToast("更新失败", error.message || "请稍后重试", "error");
    }
  }

  function showReportSuccess(event) {
    const type = TYPE_META[event.type] || TYPE_META.other;
    openModal(`
      <div class="modal success-modal">
        <div class="modal-body">
          <div class="success-icon">${icon("check-circle")}</div>
          <h2>上报成功，感谢您的守护</h2>
          <p>平台将在 2 小时内完成初审，处理进度会通过您预留的方式反馈。</p>
          <div class="success-ticket">
            <div><span>事件编号</span><b>${escapeHtml(event.id)}</b></div>
            <div><span>问题类型</span><b>${type.label}</b></div>
            <div><span>发现位置</span><b>${escapeHtml(event.location)}</b></div>
            <div><span>当前状态</span><b>待审核</b></div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="control-button" data-close-modal>继续上报</button>
          <button class="primary-button" data-success-events="${escapeHtml(event.id)}">${icon("events")}查看处理进度</button>
        </div>
      </div>`, "success-modal");
  }

  function validateReportForm() {
    const type = $("#report-type");
    const location = $("#report-location");
    const description = $("#report-description");
    let valid = true;
    [type, location, description].forEach((field) => field.classList.remove("invalid"));
    if (!type.value) { type.classList.add("invalid"); valid = false; }
    if (!location.value.trim()) { location.classList.add("invalid"); valid = false; }
    if (description.value.trim().length < 5) { description.classList.add("invalid"); valid = false; }
    if (!valid) {
      showToast("请完善上报信息", "问题类型、发现位置和问题描述为必填项", "error");
    }
    return valid;
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("仅支持图片文件"));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        reject(new Error("单张图片不能超过 10MB"));
        return;
      }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("图片格式无法识别"));
        img.onload = () => {
          const maxSide = 1400;
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({ name: file.name, dataUrl: canvas.toDataURL("image/jpeg", 0.76) });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleReportImages(files) {
    const remaining = 6 - state.reportImages.length;
    if (remaining <= 0) {
      showToast("最多上传 6 张", "请删除部分图片后再继续", "info");
      return;
    }
    const accepted = Array.from(files).slice(0, remaining);
    for (const file of accepted) {
      try {
        const image = await compressImage(file);
        state.reportImages.push(image);
      } catch (error) {
        showToast("图片上传失败", `${file.name}：${error.message}`, "error");
      }
    }
    renderImagePreviews();
  }

  function renderImagePreviews() {
    const container = $("#image-preview-list");
    if (!container) return;
    container.innerHTML = state.reportImages.map((image, index) => `
      <div class="image-preview">
        <img src="${image.dataUrl}" alt="${escapeHtml(image.name)}">
        <button type="button" data-remove-image="${index}" aria-label="删除图片">${icon("close")}</button>
      </div>`).join("");
  }

  async function submitReport(button) {
    if (!validateReportForm()) return;
    const type = $("#report-type").value;
    const severity = state.reportSeverity;
    const location = $("#report-location").value.trim();
    const description = $("#report-description").value.trim();
    const anonymous = $("#report-anonymous").checked;
    const reporterRole = $("#reporter-role").value;
    const reporterName = anonymous ? "匿名用户" : ($("#reporter-name").value.trim() || (reporterRole === "patrol" ? "巡护人员" : "社会公众"));
    const reporterPhone = anonymous ? "" : $("#reporter-phone").value.trim();
    const nowIso = new Date().toISOString();
    const typeMeta = TYPE_META[type] || TYPE_META.other;
    const payload = {
      type,
      title: `${typeMeta.label} · ${location.slice(0, 18)}`,
      description,
      location,
      severity,
      reporter: reporterName,
      reporter_role: reporterRole,
      reporter_phone: reporterPhone,
      anonymous,
      source: reporterRole === "patrol" ? "巡护上报" : "公众上报",
      images: state.reportImages
    };
    const localEvent = {
      ...payload,
      id: `EV-${nowIso.slice(0, 10).replaceAll("-", "")}-${String(state.events.length + 1).padStart(3, "0")}`,
      status: "pending_review",
      created_at: nowIso,
      updated_at: nowIso,
      team: "待分派",
      assignee: "待审核",
      deadline: new Date(Date.now() + 2 * 3600000).toISOString(),
      image_count: state.reportImages.length,
      notes: ["上报信息已接收，平台正在进行自动查重与人工初审。"],
      history: [{ title: "事件上报", detail: "现场信息已提交，等待平台审核", time: nowIso, status: "done" }]
    };

    button.disabled = true;
    button.innerHTML = `${icon("refresh")}正在提交...`;
    try {
      let created = localEvent;
      if (state.apiOnline) {
        created = await api("/api/events", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 420));
      }
      state.events.unshift(created);
      state.selectedEventId = created.id;
      saveLocalState();
      renderAll();
      $("#report-form").reset();
      state.reportImages = [];
      state.reportSeverity = "medium";
      $$("#severity-options button").forEach((item) => item.classList.toggle("active", item.dataset.value === "medium"));
      $("#description-count").textContent = "0";
      renderImagePreviews();
      showReportSuccess(created);
    } catch (error) {
      showToast("上报提交失败", error.message || "网络异常，请稍后重试", "error");
    } finally {
      button.disabled = false;
      button.innerHTML = `${icon("send")}提交上报`;
    }
  }

  function openStationModal(stationId) {
    openMapObject("station", stationId);
  }

  function showCommandPalette() {
    openModal(`
      <div class="command-search">
        ${icon("search")}
        <input id="command-input" placeholder="搜索模块、监测站或事件..." autocomplete="off">
      </div>
      <div class="command-results" id="command-results"></div>`, "command-modal");
    renderCommandResults("");
    $("#command-input")?.addEventListener("input", (event) => renderCommandResults(event.target.value));
  }

  function renderCommandResults(query) {
    const container = $("#command-results");
    if (!container) return;
    const normalized = query.trim().toLowerCase();
    const modules = Object.entries(PAGE_META)
      .filter(([, label]) => !normalized || label.toLowerCase().includes(normalized))
      .map(([key, label]) => ({ kind: "模块", label, detail: "进入业务模块", icon: key === "map" ? "map" : key === "risk" ? "risk" : key, page: key }));
    const stations = [
      ["S21", "营口港近岸 · 高风险"], ["S11", "双台子河口 · 水质异常"], ["S15", "辽东湾保护区 · 赤潮关注"], ["S03", "营口近岸 · 正常"]
    ].filter(([id, detail]) => !normalized || `${id} ${detail}`.toLowerCase().includes(normalized))
      .map(([id, detail]) => ({ kind: "监测站", label: `${id} 监测站`, detail, icon: "locate", station: id }));
    const events = state.events
      .filter((event) => !normalized || `${event.title} ${event.id} ${event.location}`.toLowerCase().includes(normalized))
      .slice(0, 5)
      .map((event) => ({ kind: "事件", label: event.title, detail: `${event.id} · ${STATUS_META[event.status]?.label}`, icon: "events", event: event.id }));
    const groups = [
      ["功能模块", modules],
      ["监测站", stations],
      ["处置事件", events]
    ].filter(([, items]) => items.length);
    container.innerHTML = groups.length ? groups.map(([name, items]) => `
      <div class="command-group-label">${name}</div>
      ${items.map((item) => `
        <button class="command-item" data-command-page="${item.page || ""}" data-command-station="${item.station || ""}" data-command-event="${item.event || ""}">
          <i>${icon(item.icon)}</i>
          <div><b>${escapeHtml(item.label)}</b><span>${escapeHtml(item.detail)}</span></div>
          ${icon("chevron-right")}
        </button>`).join("")}`).join("") : `<div class="event-empty-list">${icon("search")}<span>未找到相关内容</span></div>`;
  }

  function toggleNotifications(anchor) {
    const existing = $(".notice-panel");
    if (existing) {
      existing.remove();
      return;
    }
    const panel = document.createElement("div");
    panel.className = "notice-panel";
    panel.innerHTML = `
      <div class="notice-head"><b>通知中心</b><button id="notice-read-all">全部标为已读</button></div>
      <div class="notice-item"><i>${icon("risk")}</i><div><b>S21 风险指数升至 86</b><span>营口港近岸进入高风险状态，建议优先处置</span><time>22 分钟前</time></div></div>
      <div class="notice-item"><i>${icon("events")}</i><div><b>2 个事件即将超时</b><span>责任单位尚未提交现场处理结果</span><time>41 分钟前</time></div></div>
      <div class="notice-item"><i>${icon("check-circle")}</i><div><b>事件 EV-20261111-021 待复核</b><span>处置单位已提交现场结果</span><time>1 小时前</time></div></div>
      <button class="notice-all" data-go="events">查看全部处理事项</button>`;
    const top = anchor.getBoundingClientRect().bottom + 7;
    const right = Math.max(10, window.innerWidth - anchor.getBoundingClientRect().right - 10);
    panel.style.top = `${top}px`;
    panel.style.right = `${right}px`;
    document.body.appendChild(panel);
    panel.querySelector("#notice-read-all")?.addEventListener("click", () => {
      anchor.querySelector(".notification-dot")?.remove();
      panel.remove();
      showToast("通知已全部标为已读", "新的处置动态会继续提醒您", "success");
    });
  }

  function exportCsv(rows, filename) {
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportEventsCsv() {
    const rows = [
      ["事件编号", "事件名称", "问题类型", "风险等级", "处理状态", "位置", "上报人", "来源", "上报时间", "责任单位", "负责人"],
      ...state.events.map((event) => [
        event.id,
        event.title,
        TYPE_META[event.type]?.label || event.type,
        SEVERITY_META[event.severity]?.label || event.severity,
        STATUS_META[event.status]?.label || event.status,
        event.location,
        event.reporter,
        event.source,
        formatDateTime(event.created_at),
        event.team,
        event.assignee
      ])
    ];
    exportCsv(rows, `辽东湾生态事件台账_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast("台账已导出", `包含 ${state.events.length} 条事件记录`, "success");
  }

  function exportAnalyticsCsv() {
    const typeRows = Object.entries(TYPE_META).map(([key, meta]) => [
      meta.label,
      state.events.filter((event) => event.type === key).length
    ]);
    const rows = [
      ["辽东湾生态巡护统计分析"],
      ["统计口径", "近30日"],
      ["事件总数", state.events.length],
      ["已闭环", state.events.filter((event) => event.status === "archived").length],
      ["闭环率", `${((state.events.filter((event) => event.status === "archived").length / Math.max(1, state.events.length)) * 100).toFixed(1)}%`],
      [],
      ["问题类型", "事件数量"],
      ...typeRows,
      [],
      ["说明", "当前为平台原型演示数据，正式上线后由服务器实时统计。"]
    ];
    exportCsv(rows, `辽东湾生态统计分析_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast("分析数据已导出", "已生成当前统计口径 CSV 文件", "success");
  }

  function toggleLayer(layer, visible) {
    state.mapLayerVisibility[layer] = Boolean(visible);
    if (layer === "zones") {
      $$(".map-zone").forEach((element) => { element.style.display = visible ? "" : "none"; });
    } else {
      const elements = $$(`[data-layer="${layer}"]`);
      elements.forEach((element) => { element.style.display = visible ? "" : "none"; });
    }
    applyMapLayerVisibility();
  }

  function switchMapMode(mode) {
    state.mapMode = mode;
    $$("[data-map-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mapMode === mode));
    if (mode === "overview") {
      ["stations", "events", "risk", "port", "zones"].forEach((layer) => toggleLayer(layer, true));
    } else if (mode === "quality") {
      ["stations", "risk", "events", "port", "zones"].forEach((layer) => toggleLayer(layer, layer === "stations" || layer === "risk"));
    } else if (mode === "events") {
      ["stations", "events", "risk", "port", "zones"].forEach((layer) => toggleLayer(layer, layer === "events" || layer === "risk"));
    }
    $$("[data-layer-toggle]").forEach((input) => {
      input.checked = state.mapLayerVisibility[input.dataset.layerToggle] !== false;
    });
  }

  function closeSidebar() {
    $("#sidebar")?.classList.remove("open");
    $("#sidebar-scrim")?.classList.remove("open");
  }

  function bindEvents() {
    document.addEventListener("click", async (event) => {
      const target = event.target;
      const pageButton = target.closest(".nav-item[data-page], .mobile-bottom-nav button[data-page]");
      if (pageButton) {
        navigate(pageButton.dataset.page);
        return;
      }
      const goButton = target.closest("[data-go]");
      if (goButton) {
        closeModal();
        navigate(goButton.dataset.go);
        return;
      }
      if (target.closest("[data-close-modal]")) {
        closeModal();
        return;
      }
      if (target.id === "modal-root") {
        closeModal();
        return;
      }
      if (target.closest("[data-alert-open]")) {
        showAlertDetails(target.closest("[data-alert-open]").dataset.alertOpen);
        return;
      }
      if (target.closest("[data-alert-dispatch]")) {
        await dispatchAlert(target.closest("[data-alert-dispatch]").dataset.alertDispatch);
        return;
      }
      if (target.closest("[data-alert-filter]")) {
        state.alertFilter = target.closest("[data-alert-filter]").dataset.alertFilter;
        $$("[data-alert-filter]").forEach((button) => button.classList.toggle("active", button === target.closest("[data-alert-filter]")));
        renderAlertTable();
        return;
      }
      if (target.closest("[data-event-id]")) {
        state.selectedEventId = target.closest("[data-event-id]").dataset.eventId;
        renderEvents();
        return;
      }
      if (target.closest("[data-status-filter]")) {
        state.eventStatus = target.closest("[data-status-filter]").dataset.statusFilter;
        renderEvents();
        return;
      }
      if (target.closest("[data-event-action]")) {
        const element = target.closest("[data-event-action]");
        openEventAction(element.dataset.eventAction, element.dataset.action);
        return;
      }
      if (target.closest("[data-confirm-action]")) {
        const element = target.closest("[data-confirm-action]");
        await confirmEventAction(element.dataset.confirmAction, element.dataset.action);
        return;
      }
      if (target.closest("[data-event-assign]")) {
        openAssignModal(target.closest("[data-event-assign]").dataset.eventAssign);
        return;
      }
      if (target.closest("[data-quick-assign]")) {
        await saveQuickAssign(target.closest("[data-quick-assign]").dataset.quickAssign);
        return;
      }
      if (target.closest("[data-event-view]")) {
        showToast("记录已锁定", "该事件已归档，完整时间线可在详情中查看", "info");
        return;
      }
      if (target.closest("[data-event-more]")) {
        showToast("更多操作", "可导出记录、复制事件编号或发起协同会商", "info");
        return;
      }
      if (target.closest("[data-command-page]")) {
        const page = target.closest("[data-command-page]").dataset.commandPage;
        closeModal();
        if (page) navigate(page);
        return;
      }
      if (target.closest("[data-command-station]")) {
        const station = target.closest("[data-command-station]").dataset.commandStation;
        closeModal();
        openStationModal(station);
        return;
      }
      if (target.closest("[data-command-event]")) {
        const eventId = target.closest("[data-command-event]").dataset.commandEvent;
        closeModal();
        state.selectedEventId = eventId;
        state.eventStatus = "all";
        navigate("events");
        renderEvents();
        return;
      }
      if (target.closest("[data-success-events]")) {
        const eventId = target.closest("[data-success-events]").dataset.successEvents;
        closeModal();
        state.selectedEventId = eventId;
        state.eventStatus = "all";
        navigate("events");
        renderEvents();
        return;
      }
      if (target.closest("[data-remove-image]")) {
        state.reportImages.splice(Number(target.closest("[data-remove-image]").dataset.removeImage), 1);
        renderImagePreviews();
        return;
      }
      if (target.closest("[data-station]")) {
        openStationModal(target.closest("[data-station]").dataset.station);
        return;
      }
      if (target.closest("[data-station-open]")) {
        openStationModal(target.closest("[data-station-open]").dataset.stationOpen);
        return;
      }
      if (target.closest("[data-map-mode]")) {
        switchMapMode(target.closest("[data-map-mode]").dataset.mapMode);
        return;
      }
      if (target.closest("#global-search")) {
        showCommandPalette();
        return;
      }
      if (target.closest("#notifications-button")) {
        toggleNotifications(target.closest("#notifications-button"));
        return;
      }
      if (target.closest("#layer-toggle")) {
        $("#layer-panel")?.classList.toggle("collapsed");
        return;
      }
      if (target.closest("#refresh-map")) {
        const button = target.closest("#refresh-map");
        button.querySelector("svg")?.animate([{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }], { duration: 600 });
        await loadMapData(true);
        renderMapObjects();
        const stationCount = state.mapData?.stations?.length || 0;
        if (state.mapData) showToast("地图数据已刷新", `${stationCount} 个监测站及 ${state.mapData.issues?.length || 0} 个生态问题已载入`, "success");
        return;
      }
      if (target.closest("#map-fullscreen")) {
        const map = $("#ocean-map");
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
        } else {
          map?.requestFullscreen?.().catch(() => showToast("无法进入全屏", "请检查浏览器权限设置", "info"));
        }
        setTimeout(() => state.leafletMap?.invalidateSize(), 250);
        return;
      }
      if (target.closest("#risk-refresh")) {
        const button = target.closest("#risk-refresh");
        button.disabled = true;
        setTimeout(() => {
          button.disabled = false;
          renderAlertTable();
          renderRiskTrendChart();
          showToast("风险研判已更新", "模型已完成 42 个监测站多因子计算", "success");
        }, 650);
        return;
      }
      if (target.closest("#export-events")) {
        exportEventsCsv();
        return;
      }
      if (target.closest("#export-analytics")) {
        exportAnalyticsCsv();
        return;
      }
      if (target.closest("#choose-images")) {
        $("#report-images")?.click();
        return;
      }
      if (target.closest("#locate-button")) {
        const button = target.closest("#locate-button");
        button.disabled = true;
        button.innerHTML = `${icon("refresh")}正在定位`;
        if (!navigator.geolocation) {
          showToast("浏览器不支持定位", "请手动填写发现位置", "error");
          button.disabled = false;
          button.innerHTML = `${icon("locate")}获取定位`;
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            $("#report-location").value = `辽东湾近岸（${latitude.toFixed(5)}, ${longitude.toFixed(5)}）`;
            $("#report-location").classList.remove("invalid");
            button.disabled = false;
            button.innerHTML = `${icon("locate")}已定位`;
            showToast("定位成功", "已自动填写当前位置坐标", "success");
          },
          () => {
            button.disabled = false;
            button.innerHTML = `${icon("locate")}获取定位`;
            showToast("定位未授权", "请允许浏览器定位或手动填写位置", "info");
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        );
        return;
      }
      if (!target.closest(".notice-panel") && !target.closest("#notifications-button")) {
        $(".notice-panel")?.remove();
      }
    });

    $("#mobile-menu")?.addEventListener("click", () => {
      $("#sidebar")?.classList.add("open");
      $("#sidebar-scrim")?.classList.add("open");
    });
    $("#sidebar-scrim")?.addEventListener("click", closeSidebar);

    $$("[data-layer-toggle]").forEach((input) => {
      input.addEventListener("change", () => toggleLayer(input.dataset.layerToggle, input.checked));
    });

    $("#severity-options")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-value]");
      if (!button) return;
      state.reportSeverity = button.dataset.value;
      $$("#severity-options button").forEach((item) => item.classList.toggle("active", item === button));
    });

    $("#description-count") && $("#report-description")?.addEventListener("input", (event) => {
      $("#description-count").textContent = String(event.target.value.length);
      event.target.classList.remove("invalid");
    });

    const uploadZone = $("#upload-zone");
    const fileInput = $("#report-images");
    uploadZone?.addEventListener("click", (event) => {
      if (!event.target.closest("button")) fileInput?.click();
    });
    uploadZone?.addEventListener("dragover", (event) => {
      event.preventDefault();
      uploadZone.classList.add("dragover");
    });
    uploadZone?.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
    uploadZone?.addEventListener("drop", (event) => {
      event.preventDefault();
      uploadZone.classList.remove("dragover");
      handleReportImages(event.dataTransfer.files);
    });
    fileInput?.addEventListener("change", (event) => {
      handleReportImages(event.target.files);
      event.target.value = "";
    });
    $("#report-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitReport($("#submit-report"));
    });
    $("#report-type")?.addEventListener("change", (event) => event.target.classList.remove("invalid"));
    $("#report-location")?.addEventListener("input", (event) => event.target.classList.remove("invalid"));

    $("#event-search")?.addEventListener("input", (event) => {
      state.eventSearch = event.target.value;
      renderEvents();
    });

    document.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        showCommandPalette();
      }
      if (event.key === "Escape") {
        closeModal();
        $(".notice-panel")?.remove();
        closeSidebar();
      }
    });

    document.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && event.target.matches("[data-alert-open], [data-event-id]")) {
        event.preventDefault();
        event.target.click();
      }
    });
  }

  function updateClock() {
    const nowTime = new Date();
    const element = $("#header-time");
    if (element) element.textContent = `${pad(nowTime.getHours())}:${pad(nowTime.getMinutes())}:${pad(nowTime.getSeconds())}`;
    const sync = $("#last-sync");
    if (sync) sync.textContent = "刚刚同步";
  }

  function boot() {
    bindEvents();
    updateClock();
    setInterval(updateClock, 1000);
    const hashPage = window.location.hash.replace("#", "");
    if (PAGE_META[hashPage]) navigate(hashPage, false);
    initializeData();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
