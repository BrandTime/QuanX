/*
# 快手 Cookie -> 青龙（QX 版，Env风格）
# 变量：ksdkCk
# 多号：@ 拼接（兼容大多数脚本）
#

[rewrite_local]
^https?:\/\/api\.kuaishouzt\.com\/rest\/zt\/appsupport\/yoda\/biz\/info url script-request-header https://api.timbrd.com/qx/ks_ck_to_ql.js
[mitm]
hostname = api.kuaishouzt.com
*/

const $ = new Env("KSCK->QL");

const CONFIG = {
  // 与 JDCK2QL 完全复用
  QL_URL: $.getdata("JDCK2QL_QL_URL") || "",
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

function parseKSCookie(cookieStr = "") {
  const userId =
    (cookieStr.match(/userId=([^;]+);?/i) || [])[1];

  const token =
    (cookieStr.match(/token=([^;]+);?/i) || [])[1];

  if (!userId || !token) return null;

  return {
    userId: decodeURIComponent(userId),
    ck: cookieStr.trim(),
  };
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitMultiCookies(val = "") {
  if (!val) return [];

  return val
    .split(/\n|@/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function joinMultiCookies(arr = []) {
  return arr.filter(Boolean).join("@");
}

function hasUserId(cookie, userId) {
  const re = new RegExp(
    `userId=${escapeRegExp(userId)};?`,
    "i"
  );

  return re.test(cookie || "");
}

async function qlLogin(baseUrl, clientId, clientSecret) {
  const url = `${baseUrl}/open/auth/token?client_id=${encodeURIComponent(clientId)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}`;

  const resp = await $.http.get({
    url,
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = $.toObj(resp.body, resp.body);

  const token = data?.data?.token;

  if (!token) {
    throw new Error(`QL登录失败：${resp.body || ""}`);
  }

  return token;
}

async function qlGetEnvs(baseUrl, token, searchValue) {
  const url = `${baseUrl}/open/envs?searchValue=${encodeURIComponent(searchValue)}`;

  const resp = await $.http.get({
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  const data = $.toObj(resp.body, resp.body);

  if (!Array.isArray(data?.data)) {
    throw new Error(`QL读取env失败：${resp.body || ""}`);
  }

  return data.data;
}

async function qlAddEnv(baseUrl, token, name, value, remarks) {
  const url = `${baseUrl}/open/envs`;

  const body = JSON.stringify([
    {
      name,
      value,
      remarks,
    },
  ]);

  const resp = await $.http.post({
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });

  const data = $.toObj(resp.body, resp.body);

  if (data?.code !== 200) {
    throw new Error(`QL新增env失败：${resp.body || ""}`);
  }

  return data?.data;
}

async function qlUpdateEnv(baseUrl, token, id, name, value, remarks) {
  const url = `${baseUrl}/open/envs`;

  const body = JSON.stringify({
    id,
    name,
    value,
    remarks,
  });

  const resp = await $.http.put({
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });

  const data = $.toObj(resp.body, resp.body);

  if (data?.code !== 200) {
    throw new Error(`QL更新env失败：${resp.body || ""}`);
  }

  return data?.data;
}

async function qlEnableEnv(baseUrl, token, ids) {
  const url = `${baseUrl}/open/envs/enable`;

  const body = JSON.stringify(ids);

  const resp = await $.http.put({
    url,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body,
  });

  const data = $.toObj(resp.body, resp.body);

  return data?.code === 200;
}

(async () => {
  if (
    typeof $request === "undefined" ||
    !$request?.headers
  ) {
    return $done({});
  }

  const baseUrl = normalizeBaseUrl(CONFIG.QL_URL);

  const clientId = CONFIG.QL_CLIENT_ID;
  const clientSecret = CONFIG.QL_CLIENT_SECRET;

  if (!baseUrl || !clientId || !clientSecret) {
    $.msg(
      $.name,
      "配置缺失",
      "请先配置 JDCK2QL_QL_URL 等参数"
    );

    return $done({});
  }

  const cookieHeader =
    $request.headers.Cookie ||
    $request.headers.cookie ||
    "";

  if (!cookieHeader) {
    return $done({});
  }

  const parsed = parseKSCookie(cookieHeader);

  if (!parsed) {
    return $done({});
  }

  const { userId, ck } = parsed;

  const token = await qlLogin(
    baseUrl,
    clientId,
    clientSecret
  );

  const envs = await qlGetEnvs(
    baseUrl,
    token,
    "ksdkCk"
  );

  const existed = envs.find(
    (e) => e?.name === "ksdkCk"
  );

  const remarks = `${CONFIG.REMARKS_PREFIX}:${userId}`;

  // 当前已有CK列表
  let ckList = [];

  if (existed?.value) {
    ckList = splitMultiCookies(existed.value);
  }

  // 替换同 userId
  let replaced = false;

  ckList = ckList.map((item) => {
    if (hasUserId(item, userId)) {
      replaced = true;
      return ck;
    }

    return item;
  });

  // 新增
  if (!replaced) {
    ckList.push(ck);
  }

  const finalValue = joinMultiCookies(ckList);

  if (existed?.id) {
    await qlUpdateEnv(
      baseUrl,
      token,
      existed.id,
      "ksdkCk",
      finalValue,
      existed.remarks || remarks
    );

    if (existed.status === 1) {
      await qlEnableEnv(baseUrl, token, [existed.id]);
    }

    $.msg(
      $.name,
      replaced ? "更新成功" : "新增成功",
      userId
    );
  } else {
    await qlAddEnv(
      baseUrl,
      token,
      "ksdkCk",
      finalValue,
      remarks
    );

    $.msg($.name, "新增成功", userId);
  }

  $done({});
})().catch((e) => {
  $.msg(
    $.name,
    "执行失败",
    String(e?.message || e)
  );

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
