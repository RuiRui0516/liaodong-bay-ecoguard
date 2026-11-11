#!/usr/bin/env python3
"""Generate or refresh the Liaodong Bay map dataset.

The public demo works without a data provider. When MAP_DATA_SOURCE_URL (or
--source-url) is configured, station readings returned by that endpoint are
merged into the local object catalogue. All positions remain explicitly marked
as simulated until authoritative station coordinates are supplied.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT_DIR / "docs" / "data.json"
CHINA_TZ = timezone(timedelta(hours=8))


STATIONS = [
    ("S03", "营口近岸监测站", "营口市 · 辽河口外缘", 40.61, 122.08, "normal"),
    ("S07", "鲅鱼圈养殖区监测站", "鲅鱼圈区 · 养殖示范区", 40.23, 121.94, "attention"),
    ("S11", "双台子河口监测站", "盘锦市 · 双台子河口", 40.88, 121.72, "abnormal"),
    ("S15", "辽东湾保护区监测站", "斑海豹保护区 · 西部海域", 40.59, 121.36, "attention"),
    ("S21", "营口港近岸监测站", "营口港 · 港区西侧", 40.31, 122.07, "high"),
    ("S24", "锦州南部海域监测站", "锦州市 · 南部近岸", 40.38, 121.19, "normal"),
    ("S30", "辽河口监测站", "盘锦市 · 辽河口南支", 40.79, 121.99, "attention"),
    ("S34", "辽东湾中部监测站", "辽东湾 · 中部公共海域", 40.39, 121.67, "normal"),
    ("S38", "金州湾北部监测站", "大连市 · 金州湾北部", 39.33, 121.69, "normal"),
    ("S42", "红海滩监测站", "盘锦市 · 红海滩南段", 40.69, 121.58, "normal"),
    ("S45", "绥中近岸监测站", "葫芦岛市 · 绥中近岸", 40.08, 120.19, "normal"),
    ("S48", "兴城海滨监测站", "葫芦岛市 · 兴城海滨", 40.60, 120.76, "normal"),
    ("S51", "长兴岛监测站", "大连市 · 长兴岛西岸", 39.61, 121.25, "attention"),
    ("S54", "仙人岛监测站", "营口市 · 仙人岛南侧", 40.03, 122.15, "normal"),
]

RISKS = [
    ("R-01", "营口港近岸油污风险区", "oil", "high", 86, 40.33, 122.05, 16000, "溶解氧 4.1 mg/L、石油类异常", "港区船舶活动密集，低溶解氧与油膜事件叠加", "优先巡查锚地与靠泊船舶，布设围油栏并开展定点采样。"),
    ("R-02", "双台子河口水质异常风险区", "water", "high", 79, 40.87, 121.73, 13500, "叶绿素 a 9.6 μg/L、溶解氧偏低", "上游径流、营养盐输入和河口低流速共同作用", "启动加密监测，核查入河排口并同步采集藻类样本。"),
    ("R-03", "斑海豹保护区赤潮关注区", "redtide", "medium", 64, 40.60, 121.39, 12500, "叶绿素 a 8.2 μg/L、藻密度上升", "水温升高及近岸水体交换减弱", "保护区巡护艇每日巡查，持续跟踪叶绿素和藻细胞密度。"),
    ("R-04", "鲅鱼圈养殖区低氧关注区", "water", "medium", 57, 40.23, 121.94, 10500, "溶解氧 5.2 mg/L、盐度波动", "养殖密度较高且潮汐交换条件一般", "通知养殖主体加强增氧与投饵管理，安排夜间复测。"),
    ("R-05", "锦州南部藻类关注区", "redtide", "medium", 44, 40.37, 121.18, 9000, "藻细胞 3.8×10⁵/L", "近岸水温阶段性偏高，营养盐比例变化", "开展浮游植物网采，结合卫星水色遥感扩大研判范围。"),
    ("R-06", "金州湾浊度波动区", "water", "low", 31, 39.34, 121.70, 8500, "浊度 36 NTU", "近岸施工及短时风浪扰动", "保持常规监测，关注连续降雨及施工排水时段。"),
]

PORTS = [
    ("P-01", "营口港鲅鱼圈港区", "营口港", 40.29, 122.10, {"泊位数": "36", "监管级别": "重点", "通航状态": "正常"}, ["S07", "S21"], 86, 8),
    ("P-02", "营口港仙人岛港区", "营口港", 40.02, 122.12, {"泊位数": "12", "监管级别": "重点", "通航状态": "正常"}, ["S54"], 42, 3),
    ("P-03", "锦州港主港区", "锦州港", 40.48, 121.06, {"泊位数": "24", "监管级别": "重点", "通航状态": "正常"}, ["S24"], 58, 5),
    ("P-04", "盘锦港荣兴港区", "盘锦港", 40.73, 121.93, {"泊位数": "16", "监管级别": "一般", "通航状态": "正常"}, ["S11", "S30"], 47, 4),
    ("P-05", "绥中港区", "绥中港", 40.09, 120.16, {"泊位数": "9", "监管级别": "一般", "通航状态": "正常"}, ["S45"], 24, 1),
    ("P-06", "葫芦岛港柳条沟港区", "葫芦岛港", 40.71, 120.92, {"泊位数": "14", "监管级别": "一般", "通航状态": "正常"}, ["S48"], 19, 2),
]

PROTECTED_AREAS = [
    ("Z-01", "辽东湾斑海豹国家级自然保护区", "国家级自然保护区", 40.60, 121.40, 0.25, {"主要保护对象": "斑海豹及其栖息地", "核心区": "约512 km²", "巡护频次": "每日"}, ["S15"], 64, 4),
    ("Z-02", "红海滩国家级自然保护区", "滨海湿地保护区", 40.75, 121.61, 0.16, {"主要保护对象": "滨海湿地生态系统", "核心区": "约120 km²", "巡护频次": "每日"}, ["S11", "S42"], 52, 3),
    ("Z-03", "团山子国家海洋公园", "国家级海洋公园", 40.01, 120.76, 0.12, {"主要保护对象": "海蚀地貌与近岸生态", "核心区": "约23 km²", "巡护频次": "每周"}, ["S45"], 28, 2),
]

AQUACULTURE_ZONES = [
    ("A-01", "鲅鱼圈水产养殖示范区", "海水养殖", 40.22, 121.90, 0.11, {"主要品种": "海参、贝类", "养殖面积": "约38 km²", "监管状态": "重点监测"}, ["S07"], 57, 2),
    ("A-02", "仙人岛海水养殖区", "海水养殖", 40.04, 122.08, 0.09, {"主要品种": "鱼类、贝类", "养殖面积": "约22 km²", "监管状态": "常规监测"}, ["S54"], 35, 1),
    ("A-03", "金州湾北部养殖区", "海水养殖", 39.35, 121.72, 0.08, {"主要品种": "海参、扇贝", "养殖面积": "约18 km²", "监管状态": "常规监测"}, ["S38"], 31, 2),
    ("A-04", "兴城近岸养殖区", "海水养殖", 40.56, 120.79, 0.07, {"主要品种": "贝类、鱼类", "养殖面积": "约13 km²", "监管状态": "常规监测"}, ["S48"], 22, 1),
]

ISSUES = [
    ("I-01", "营口港3号锚地油膜异常", "oil", "high", "pending_review", 40.33, 122.02, "营口港3号锚地东侧约800米", "巡护上报", "王海巡", "营口港巡护中队", 18, "待审核"),
    ("I-02", "月亮湖东侧岸线垃圾聚集", "trash", "medium", "pending_dispatch", 40.23, 122.06, "鲅鱼圈区月亮湖公园东侧300米海岸", "公众上报", "李女士", "鲅鱼圈岸线保洁队", 52, "待分派"),
    ("I-03", "双台子河口溶解氧持续偏低", "water", "high", "processing", 40.88, 121.73, "双台子河口南侧监测断面", "系统预警", "环境监测中心", "盘锦水质应急组", 83, "处理中"),
    ("I-04", "保护区表层水体变色", "redtide", "medium", "pending_verification", 40.61, 121.37, "辽东湾斑海豹保护区西侧", "联合巡查", "陈研究员", "海洋生态监测站", 130, "待复核"),
    ("I-05", "仙人岛码头废弃渔网缠绕", "trash", "low", "archived", 40.02, 122.13, "仙人岛码头东南侧礁石区", "公众上报", "赵先生", "仙人岛岸线管护队", 178, "已归档"),
    ("I-06", "金州湾岸线塑料垃圾", "trash", "low", "processing", 39.34, 121.70, "金州湾滨海步道北段", "公众上报", "周女士", "金州湾保洁队", 201, "处理中"),
    ("I-07", "辽东湾北部海水异味", "water", "medium", "pending_review", 40.72, 122.00, "营口市辽河口西岸", "渔民上报", "附近渔民", "待确定", 245, "待审核"),
    ("I-08", "锦州港西侧浮油带", "oil", "high", "pending_dispatch", 40.45, 121.03, "锦州港西侧航道边缘", "设备发现", "无人机巡检", "锦州港应急中队", 293, "待分派"),
    ("I-09", "红海滩景区岸线饮料瓶", "trash", "low", "archived", 40.69, 121.58, "红海滩国家风景廊道南段", "公众上报", "赵先生", "红海滩景区管护队", 520, "已归档"),
    ("I-10", "小凌河口漂浮物聚集", "other", "low", "archived", 40.82, 121.00, "小凌河入海口南侧", "巡护上报", "环卫巡护", "凌海河道管护队", 720, "已归档"),
    ("I-11", "鲅鱼圈港池零星油花", "oil", "medium", "processing", 40.29, 122.10, "鲅鱼圈港区6号泊位", "巡护上报", "港区巡检员", "鲅鱼圈港区应急组", 1100, "处理中"),
    ("I-12", "辽河口S30浊度异常", "water", "medium", "processing", 40.79, 121.99, "辽河口S30监测站", "系统预警", "环境监测中心", "盘锦水质监测组", 1560, "处理中"),
]

ISSUE_STATION_LINKS = {
    "I-01": {"S21"},
    "I-02": {"S07"},
    "I-03": {"S11"},
    "I-04": {"S15"},
    "I-05": {"S54"},
    "I-06": {"S38"},
    "I-07": {"S03", "S30"},
    "I-08": {"S24"},
    "I-09": {"S42"},
    "I-11": {"S21"},
    "I-12": {"S30"},
}

STATUS_LABELS = {
    "pending_review": "待审核",
    "pending_dispatch": "待分派",
    "processing": "处理中",
    "pending_verification": "待复核",
    "archived": "已归档",
}


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def station_status(oxygen: float, chlorophyll: float) -> str:
    if oxygen < 4.5 or chlorophyll > 9:
        return "高风险"
    if oxygen < 5.3 or chlorophyll > 7:
        return "关注"
    return "正常"


def build_stations(rng: random.Random, day_index: int, generated_at: datetime) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for index, (station_id, name, location, lat, lng, planned_state) in enumerate(STATIONS):
        wave = math.sin(day_index * 0.43 + index * 1.17)
        oxygen = clamp(6.7 + wave * 0.35 - (1.7 if station_id == "S21" else 0.9 if station_id == "S11" else 0.4 if station_id == "S07" else 0), 3.8, 8.1)
        temperature = clamp(18.2 + math.sin(day_index * 0.17 + index * 0.28) * 2.1 + (0.8 if lat < 40 else 0), 13.5, 23.8)
        salinity = clamp(29.3 + math.cos(day_index * 0.21 + index * 0.41) * 1.2 - (1.9 if station_id in {"S11", "S30"} else 0), 24.2, 31.6)
        chlorophyll = clamp(5.1 + math.sin(day_index * 0.31 + index) * 1.25 + (3.4 if station_id in {"S11", "S15"} else 0), 2.1, 11.2)
        turbidity = clamp(12 + rng.uniform(-4, 13) + (20 if station_id in {"S11", "S30"} else 0), 5, 52)
        risk_score = int(clamp(32 + (8.1 - oxygen) * 11 + max(0, chlorophyll - 5) * 5 + rng.uniform(-5, 5), 12, 91))
        status = station_status(oxygen, chlorophyll)
        trend = "上升" if wave >= 0 else "回落"
        result.append({
            "id": station_id,
            "name": name,
            "category": "station",
            "location": location,
            "lat": round(lat + rng.uniform(-0.008, 0.008), 6),
            "lng": round(lng + rng.uniform(-0.008, 0.008), 6),
            "is_simulated": True,
            "status": status,
            "planned_state": planned_state,
            "risk_score": risk_score,
            "risk_level": "high" if risk_score >= 75 else "medium" if risk_score >= 55 else "low",
            "water_temp_c": round(temperature, 1),
            "salinity_psu": round(salinity, 1),
            "dissolved_oxygen_mg_l": round(oxygen, 1),
            "ph": round(8.08 + rng.uniform(-0.12, 0.12), 2),
            "turbidity_ntu": round(turbidity, 1),
            "chlorophyll_a": round(chlorophyll, 1),
            "trend": {
                "label": f"近 24 小时{trend}",
                "direction": "up" if wave >= 0 else "down",
                "change": f"{wave * 0.6:+.1f}",
            },
            "associated_events": [
                issue[0] for issue in ISSUES
                if station_id in ISSUE_STATION_LINKS.get(issue[0], set())
            ],
            "updated_at": generated_at.isoformat(timespec="seconds"),
        })
    return result


def build_issues(generated_at: datetime) -> list[dict[str, Any]]:
    result = []
    for issue_id, title, issue_type, severity, status, lat, lng, location, source, reporter, team, minutes, _ in ISSUES:
        created_at = generated_at - timedelta(minutes=minutes)
        result.append({
            "id": issue_id,
            "name": title,
            "category": "issue",
            "issue_type": issue_type,
            "severity": severity,
            "status": status,
            "status_label": STATUS_LABELS[status],
            "lat": lat,
            "lng": lng,
            "location": location,
            "location_name": location,
            "source": source,
            "reporter": reporter,
            "team": team,
            "created_at": created_at.isoformat(timespec="seconds"),
            "progress": STATUS_LABELS[status],
            "is_simulated": True,
            "images": [],
            "description": f"{location}发现{title}，已进入平台处置流程，等待责任单位跟进并反馈现场结果。",
        })
    return result


def build_polygons(generated_at: datetime) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    protected = []
    for area_id, name, area_type, lat, lng, radius, attributes, stations, risk, issues in PROTECTED_AREAS:
        protected.append({
            "id": area_id,
            "name": name,
            "category": "protected_area",
            "area_type": area_type,
            "lat": lat,
            "lng": lng,
            "radius_deg": radius,
            "attributes": attributes,
            "related_station_ids": stations,
            "recent_risk": risk,
            "issue_count": issues,
            "is_simulated": True,
        })
    aquaculture = []
    for area_id, name, area_type, lat, lng, radius, attributes, stations, risk, issues in AQUACULTURE_ZONES:
        aquaculture.append({
            "id": area_id,
            "name": name,
            "category": "aquaculture_zone",
            "area_type": area_type,
            "lat": lat,
            "lng": lng,
            "radius_deg": radius,
            "attributes": attributes,
            "related_station_ids": stations,
            "recent_risk": risk,
            "issue_count": issues,
            "is_simulated": True,
        })
    return protected, aquaculture


def merge_remote_stations(stations: list[dict[str, Any]], source_url: str) -> tuple[list[dict[str, Any]], str | None]:
    if not source_url:
        return stations, None
    request = urllib.request.Request(source_url, headers={"User-Agent": "LiaodongBay-EcoGuard-DataUpdater/1.1"})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, ValueError, json.JSONDecodeError) as exc:
        print(f"数据源请求失败，保留模拟数据: {exc}", file=sys.stderr)
        return stations, f"远程数据源不可用：{exc}"

    remote_rows = payload.get("stations", payload) if isinstance(payload, dict) else payload
    if not isinstance(remote_rows, list):
        return stations, "远程数据格式不是监测站列表，已保留模拟数据"
    by_id = {item.get("id"): item for item in remote_rows if isinstance(item, dict) and item.get("id")}
    telemetry_keys = {
        "water_temp_c", "salinity_psu", "dissolved_oxygen_mg_l", "ph",
        "turbidity_ntu", "chlorophyll_a", "lat", "lng", "updated_at",
    }
    merged = 0
    for station in stations:
        remote = by_id.get(station["id"])
        if not remote:
            continue
        for key in telemetry_keys:
            if key in remote:
                station[key] = remote[key]
        station["is_simulated"] = False
        station["source"] = "configured_public_api"
        merged += 1
    note = f"已合并 {merged} 个远程监测站读数" if merged else "远程数据未匹配现有站点，已保留模拟数据"
    return stations, note


def generate_payload(generated_at: datetime, source_url: str = "") -> dict[str, Any]:
    local_day = generated_at.astimezone(CHINA_TZ).date()
    day_index = local_day.toordinal()
    rng = random.Random(f"liaodong-bay-{local_day.isoformat()}")
    stations = build_stations(rng, day_index, generated_at)
    stations, source_note = merge_remote_stations(stations, source_url)
    protected, aquaculture = build_polygons(generated_at)
    ports = [
        {
            "id": port_id,
            "name": name,
            "category": "port",
            "operator": operator,
            "lat": lat,
            "lng": lng,
            "attributes": attributes,
            "related_station_ids": stations_ids,
            "recent_risk": risk,
            "issue_count": issues,
            "is_simulated": True,
        }
        for port_id, name, operator, lat, lng, attributes, stations_ids, risk, issues in PORTS
    ]
    risks = [
        {
            "id": risk_id,
            "name": name,
            "category": "risk",
            "risk_type": risk_type,
            "level": level,
            "score": score,
            "lat": lat,
            "lng": lng,
            "radius_m": radius,
            "abnormal_indicator": indicator,
            "cause": cause,
            "recommendation": recommendation,
            "is_simulated": True,
            "updated_at": generated_at.isoformat(timespec="seconds"),
        }
        for risk_id, name, risk_type, level, score, lat, lng, radius, indicator, cause, recommendation in RISKS
    ]
    issues = build_issues(generated_at)
    real_station_count = sum(1 for station in stations if not station["is_simulated"])
    mode = "hybrid" if real_station_count else "simulation"
    note = source_note or "未配置远程数据源，使用每日确定性模拟数据。"
    return {
        "schema_version": "1.1",
        "generated_at": generated_at.isoformat(timespec="seconds"),
        "local_date": local_day.isoformat(),
        "data_mode": mode,
        "source_note": note,
        "simulation_notice": "点位坐标为用于平台验证的模拟位置，不代表官方监测站坐标。",
        "stations": stations,
        "risks": risks,
        "ports": ports,
        "protected_areas": protected,
        "aquaculture_zones": aquaculture,
        "issues": issues,
        "metadata": {
            "network_station_total": 42,
            "displayed_station_count": len(stations),
            "remote_station_count": real_station_count,
            "simulated_station_count": len(stations) - real_station_count,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="刷新辽东湾平台地图数据")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="输出 JSON 路径")
    parser.add_argument("--source-url", default=os.getenv("MAP_DATA_SOURCE_URL", ""), help="可选公开 API 地址")
    parser.add_argument("--date", help="生成日期，格式 YYYY-MM-DD；默认当前北京时间")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.date:
        local_now = datetime.strptime(args.date, "%Y-%m-%d").replace(hour=8, tzinfo=CHINA_TZ)
        generated_at = local_now.astimezone(timezone.utc)
    else:
        generated_at = datetime.now(timezone.utc).replace(microsecond=0)
    payload = generate_payload(generated_at, args.source_url)
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已生成 {output}（{payload['data_mode']}，{len(payload['stations'])} 个监测站）")


if __name__ == "__main__":
    main()
