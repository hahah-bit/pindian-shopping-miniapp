/**
 * 数据来源配置。
 * - mode: 'api'（默认，读取真实后端） | 'mock'（界面预览，页面会标注 Mock）
 * - baseUrl: 开发者工具本机联调地址；真机需要可访问的 HTTPS 域名并配置微信合法域名。
 */
export const apiConfig: { mode: 'mock' | 'api'; baseUrl: string } = {
  mode: 'api',
  baseUrl: 'http://127.0.0.1:3000'
};
