// 天气抓取：Open-Meteo 免费无 key 接口，更新 daily.weather（平潭）
import { bjDate } from "./lib.js";

// 平潭综合实验区
const LAT = 25.5;
const LON = 119.79;
const CITY = "平潭";
const URL =
  "https://api.open-meteo.com/v1/forecast?latitude=" +
  LAT +
  "&longitude=" +
  LON +
  "&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,apparent_temperature" +
  "&daily=uv_index_max,temperature_2m_max,temperature_2m_min&timezone=Asia%2FShanghai&forecast_days=1";

const WMO = {
  0: "晴", 1: "晴间多云", 2: "多云", 3: "阴",
  45: "雾", 48: "雾凇",
  51: "毛毛雨", 53: "小雨", 55: "中雨", 61: "小雨", 63: "中雨", 65: "大雨",
  71: "小雪", 73: "中雪", 75: "大雪", 80: "阵雨", 81: "阵雨", 82: "强阵雨",
  95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "强雷暴",
};

function windDir(deg) {
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return dirs[Math.floor(((deg + 22.5) % 360) / 45)];
}

export async function updateWeather(data) {
  let d;
  try {
    const res = await fetch(URL, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    d = await res.json();
  } catch (e) {
    console.error("weather fetch fail, 保留原值:", e.message);
    return false;
  }
  const cur = d.current || {};
  const daily = d.daily || {};
  const temp = cur.temperature_2m;
  const app = cur.apparent_temperature;
  const rh = cur.relative_humidity_2m;
  const wspd = cur.wind_speed_10m;
  const wdeg = cur.wind_direction_10m;
  const code = cur.weather_code ?? 3;
  const wdesc = WMO[code] || "多云";
  const uv = (daily.uv_index_max || [0])[0];
  const tmax = (daily.temperature_2m_max || [0])[0];
  const tmin = (daily.temperature_2m_min || [0])[0];

  let desc = `${wdesc}，气温${Math.round(tmin)}~${Math.round(tmax)}°C，体感约${Math.round(app)}°C；湿度${Math.round(rh)}%，${windDir(wdeg || 0)}风约${Math.round(wspd)}km/h`;
  if (uv >= 8) desc += `，紫外线极强（UV${Math.round(uv)}）`;
  else if (uv >= 6) desc += `，紫外线强（UV${Math.round(uv)}）`;

  let advice = tmax >= 28 ? "短袖+透气衣物即可；" : "备薄外套；";
  if (uv >= 8) advice += "10-15点外出务必涂防晒、戴墨镜；";
  if (wspd) {
    // wspd 这里是风速，>=30 提示阵风较大
  }
  if (wspd >= 30) advice += "海边阵风较大，戴帽子选带绳款防吹跑；";
  advice += "多喝水，办公室备件薄外套防空调着凉。";

  const today = bjDate();
  data.daily.weather = {
    city: CITY,
    temp: `${Math.round(tmin)}~${Math.round(tmax)}°C（体感约${Math.round(app)}°C）`,
    desc,
    aqi: "优（Open-Meteo未提供，平潭常优良）",
    advice,
    date: today,
  };
  return true;
}
