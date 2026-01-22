/*
# 京东 CK -> 青龙（QX 版，Env风格）
# 适配：青龙 ClientID/Secret
# 变量：JD_COOKIE
# 策略：同 pt_pin 覆盖更新
#

[rewrite_local]
^https?:\/\/api\.m\.jd\.com\/api\?appid=plus_business&functionId=queryCircleInfo url script-request-header https://raw.githubusercontent.com/BrandTime/QuanX/master/Rewrites/jd_ck_to_ql.js
[mitm]
hostname = api.m.jd.com
*/

const $ = new Env("JDCK->QL");

const CONFIG = {
  // 在 QX 里用 BoxJs/缓存键配置（或你也可以直接写死在这里，但不推荐）
  QL_URL: $.getdata("JDCK2QL_QL_URL") || "", // 例如 http://ip:5700 或 https://域名/ql
  QL_CLIENT_ID: $.getdata("JDCK2QL_QL_CLIENT_ID") || "",
  QL_CLIENT_SECRET: $.getdata("JDCK2QL_QL_CLIENT_SECRET") || "",
  REMARKS_PREFIX: $.getdata("JDCK2QL_REMARKS_PREFIX") || "QX",
};

function normalizeBaseUrl(url) {
  let u = (url || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  u = u.replace(/\/+$/, "");
  return u;
}

function parseJDCookieFromHeader(cookieStr = "") {
  const pt_key = (cookieStr.match(/pt_key=([^;]+);?/i) || [])[1];
  const pt_pin = (cookieStr.match(/pt_pin=([^;]+);?/i) || [])[1];
  if (!pt_key || !pt_pin) return null;
  return {
    pt_key,
    pt_pin: decodeURIComponent(pt_pin),
    ck: `pt_key=${pt_key}; pt_pin=${pt_pin};`,
  };
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findEnvByPtPin(envs, pt_pin) {
  const re = new RegExp(`pt_pin=${escapeRegExp(pt_pin)};?`, "i");
  return envs.find((e) => e?.name === "JD_COOKIE" && re.test(e?.value || ""));
}

async function qlLogin(baseUrl, clientId, clientSecret) {
  const url = `${baseUrl}/open/auth/token?client_id=${encodeURIComponent(
    clientId
  )}&client_secret=${encodeURIComponent(clientSecret)}`;

  const resp = await $.http.get({ url, headers: { "Content-Type": "application/json" }, body: "" });
  const data = $.toObj(resp.body, resp.body);
  const token = data?.data?.token;
  if (!token) throw new Error(`QL登录失败：${resp.statusCode || ""} ${resp.body || ""}`);
  return token;
}

async function qlGetEnvs(baseUrl, token, searchValue) {
  const url = `${baseUrl}/open/envs?searchValue=${encodeURIComponent(searchValue)}`;
  const resp = await $.http.get({
    url,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const data = $.toObj(resp.body, resp.body);
  if (!Array.isArray(data?.data)) throw new Error(`QL读取env失败：${resp.body || ""}`);
  return data.data;
}

async function qlAddEnv(baseUrl, token, name, value, remarks) {
  const url = `${baseUrl}/open/envs`;
  const body = JSON.stringify([{ name, value, remarks }]);
  const resp = await $.http.post({
    url,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
  });
  const data = $.toObj(resp.body, resp.body);
  if (data?.code !== 200) throw new Error(`QL新增env失败：${resp.body || ""}`);
  return data?.data;
}

async function qlUpdateEnv(baseUrl, token, id, name, value, remarks) {
  const url = `${baseUrl}/open/envs`;
  const body = JSON.stringify({ id, name, value, remarks });
  const resp = await $.http.put({
    url,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
  });
  const data = $.toObj(resp.body, resp.body);
  if (data?.code !== 200) throw new Error(`QL更新env失败：${resp.body || ""}`);
  return data?.data;
}

async function qlEnableEnv(baseUrl, token, ids) {
  const url = `${baseUrl}/open/envs/enable`;
  const body = JSON.stringify(ids);
  const resp = await $.http.put({
    url,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body,
  });
  const data = $.toObj(resp.body, resp.body);
  return data?.code === 200;
}

(async () => {
  // 必须是 rewrite 触发才有 $request
  if (typeof $request === "undefined" || !$request?.headers) return $done({});

  const baseUrl = normalizeBaseUrl(CONFIG.QL_URL);
  const clientId = CONFIG.QL_CLIENT_ID;
  const clientSecret = CONFIG.QL_CLIENT_SECRET;

  if (!baseUrl || !clientId || !clientSecret) {
    $.msg($.name, "配置缺失", "请设置 JDCK2QL_QL_URL / JDCK2QL_QL_CLIENT_ID / JDCK2QL_QL_CLIENT_SECRET");
    return $done({});
  }

  const cookieHeader = $request.headers.Cookie || $request.headers.cookie || "";
  const parsed = parseJDCookieFromHeader(cookieHeader);
  if (!parsed) return $done({});

  const { pt_pin, ck } = parsed;
  const remarks = `${CONFIG.REMARKS_PREFIX}:${pt_pin}`;

  const token = await qlLogin(baseUrl, clientId, clientSecret);
  const envs = await qlGetEnvs(baseUrl, token, "JD_COOKIE");
  const existed = findEnvByPtPin(envs, pt_pin);

  if (existed?.id) {
    await qlUpdateEnv(baseUrl, token, existed.id, "JD_COOKIE", ck, existed.remarks || remarks);
    if (existed.status === 1) await qlEnableEnv(baseUrl, token, [existed.id]); // 如果之前禁用则启用
    $.msg($.name, "更新成功", pt_pin);
  } else {
    await qlAddEnv(baseUrl, token, "JD_COOKIE", ck, remarks);
    $.msg($.name, "新增成功", pt_pin);
  }

  $done({});
})().catch((e) => {
  $.msg($.name, "执行失败", String(e?.message || e));
  $done({});
});

/**************** Env 框架（精简版，足够QX用） ****************/
function Env(name) {
  this.name = name;
  this.http = new Http(this);
  this.getdata = (key) => {
    if (typeof $prefs !== "undefined") return $prefs.valueForKey(key);
    return null;
  };
  this.setdata = (val, key) => {
    if (typeof $prefs !== "undefined") return $prefs.setValueForKey(val, key);
    return false;
  };
  this.msg = (title, subtitle, body) => {
    if (typeof $notify !== "undefined") $notify(title, subtitle, body);
  };
  this.toObj = (str, fallback = null) => {
    try {
      return JSON.parse(str);
    } catch (_) {
      return fallback;
    }
  };
  this.log = (...args) => console.log(...args);
}

function Http(env) {
  this.env = env;
  const send = (method, options) =>
    new Promise((resolve, reject) => {
      if (typeof $task === "undefined") return reject(new Error("Not in Quantumult X"));
      $task.fetch({ method, ...options }).then(
        (resp) => resolve({ statusCode: resp.statusCode, headers: resp.headers, body: resp.body }),
        reject
      );
    });
  this.get = (opt) => send("GET", opt);
  this.post = (opt) => send("POST", opt);
  this.put = (opt) => send("PUT", opt);
}
