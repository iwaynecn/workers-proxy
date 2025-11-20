/**
 * Cloudflare Worker 网站反向代理 (隐私增强版)
 * * 核心功能：
 * 1. 动态后端 & Host 修正。
 * 2. 重定向 (Location) 修正。
 * 3. [新增] 响应头清洗：移除暴露源站信息的敏感 Header。
 */

export default {
  async fetch(request, env, ctx) {
    const targetOrigin = env.BACKEND_URL;

    if (!targetOrigin) {
      return new Response("Error: BACKEND_URL variable is not set.", {
        status: 500,
        headers: { "content-type": "text/plain;charset=UTF-8" }
      });
    }

    const url = new URL(request.url);
    const targetUrl = new URL(targetOrigin);
    const workerOrigin = url.origin;

    // --- 1. 构建请求 ---
    url.protocol = targetUrl.protocol;
    url.hostname = targetUrl.hostname;
    url.port = targetUrl.port;
    
    if (targetUrl.pathname !== '/' && targetUrl.pathname !== '') {
       url.pathname = targetUrl.pathname + url.pathname;
    }

    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetUrl.hostname);
    newHeaders.set("X-Forwarded-Host", new URL(request.url).hostname);
    newHeaders.set("X-Forwarded-Proto", new URL(request.url).protocol.replace(':', ''));

    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: "manual" 
    });

    try {
      // --- 2. 发送请求 ---
      const response = await fetch(newRequest);

      // --- 3. 处理响应头 ---
      const newResponseHeaders = new Headers(response.headers);

      // [关键修改] 移除敏感 Header，防止泄露源站信息
      // 这些头都是源站返回的，Worker 可以直接拦截删除
      newResponseHeaders.delete("x-served-by");    // 你的主要痛点
      newResponseHeaders.delete("x-powered-by");  // 隐藏后端语言 (如 PHP/Express)
      newResponseHeaders.delete("server");        // 隐藏服务器类型 (如 Nginx/Apache)
      newResponseHeaders.delete("via");           // 隐藏中间代理信息

      // [重定向修正]
      const location = newResponseHeaders.get("Location");
      if (location) {
        if (location.startsWith(targetOrigin)) {
           newResponseHeaders.set("Location", location.replace(targetOrigin, workerOrigin));
        } else if (location.startsWith("http") && location.includes(targetUrl.hostname)) {
           const locUrl = new URL(location);
           if (locUrl.hostname === targetUrl.hostname) {
             locUrl.protocol = new URL(workerOrigin).protocol;
             locUrl.hostname = new URL(workerOrigin).hostname;
             locUrl.port = new URL(workerOrigin).port;
             newResponseHeaders.set("Location", locUrl.toString());
           }
        }
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newResponseHeaders
      });

    } catch (e) {
      return new Response(`Proxy Error: ${e.message}`, { status: 502 });
    }
  },
};
