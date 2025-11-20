/**
 * Cloudflare Worker 网站反向代理 (增强版)
 * * 核心功能：
 * 1. 动态后端：读取环境变量 BACKEND_URL。
 * 2. 请求转发：保持 Path、Query、Method、Body。
 * 3. Host 修正：强制修改 Host 头为后端域名。
 * 4. (新增) 重定向修正：拦截后端返回的 301/302 重定向，将跳转地址改回 Worker 域名。
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
    
    // 记录原始 Worker 的域名（用于后续重写 Redirect）
    const workerOrigin = url.origin;

    // --- 1. 构建请求 ---
    
    // 替换目标 URL
    url.protocol = targetUrl.protocol;
    url.hostname = targetUrl.hostname;
    url.port = targetUrl.port;
    
    // 处理子路径挂载情况
    if (targetUrl.pathname !== '/' && targetUrl.pathname !== '') {
       url.pathname = targetUrl.pathname + url.pathname;
    }

    // 复制并修改请求头
    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", targetUrl.hostname);
    newHeaders.set("X-Forwarded-Host", new URL(request.url).hostname);
    newHeaders.set("X-Forwarded-Proto", new URL(request.url).protocol.replace(':', ''));
    // 防止后端返回 gzip 压缩数据，导致 Worker 无法修改响应体（如果未来需要修改 HTML）
    // newHeaders.delete("accept-encoding"); 

    const newRequest = new Request(url.toString(), {
      method: request.method,
      headers: newHeaders,
      body: request.body,
      redirect: "manual" // 重点：不自动跟随重定向，而是手动处理响应
    });

    try {
      // --- 2. 发送请求 ---
      const response = await fetch(newRequest);

      // --- 3. 处理响应 (关键步骤) ---
      
      // 复制响应头以便修改
      const newResponseHeaders = new Headers(response.headers);

      // [Fix] 处理 Location 头：如果后端返回重定向，将其中的后端地址替换回 Worker 地址
      const location = newResponseHeaders.get("Location");
      if (location) {
        // 简单判断：如果 Location 包含了后端的目标地址，则替换
        // 注意：这里只处理了绝对路径的替换，相对路径通常不需要处理
        if (location.startsWith(targetOrigin)) {
           newResponseHeaders.set("Location", location.replace(targetOrigin, workerOrigin));
        } else if (location.startsWith("http") && location.includes(targetUrl.hostname)) {
           // 处理可能的 http/https 协议不一致情况
           const locUrl = new URL(location);
           if (locUrl.hostname === targetUrl.hostname) {
             locUrl.protocol = new URL(workerOrigin).protocol;
             locUrl.hostname = new URL(workerOrigin).hostname;
             locUrl.port = new URL(workerOrigin).port;
             newResponseHeaders.set("Location", locUrl.toString());
           }
        }
      }

      // [Fix] 处理 Set-Cookie 域名限制（可选，视情况而定）
      // 有些后端会强制写入 Domain=1.2.3.4，导致 Cookie 在 Worker 域名下无效
      // 简单的做法是移除 Domain 属性，让 Cookie 默认为当前域名有效
      /*
      const setCookie = newResponseHeaders.get("Set-Cookie");
      if (setCookie) {
        newResponseHeaders.set("Set-Cookie", setCookie.replace(/Domain=[^;]+;?/gi, ""));
      }
      */

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
