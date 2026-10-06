# 客服商品意图与导购卡片

模式 Operate；延续 T014 灰白蓝、系统字、原生四 Tab 及小蓝精灵，不重新选择视觉方向。

THESIS：用户问咖啡或介绍想买的商品时，简洁回答后就能点开真实商品，减少返回列表搜索的步骤。
OWN-WORLD：用户气泡蓝底白字，助手白底深色字；商品独立白色行、实有商品图、名称和参考份额价，蓝色“查看商品”与 CSS 小箭头。
STORY：进入客服 → 输入产品需求 → 只读检索 → 看到不超过三款商品 → 打开现有详情；回来或重新进入保留消息与商品快照。
FIRST VIEWPORT：保留既有身份、人工售后、输入与导航位置；正常问答不插卡片，查询无匹配仍可回复；图片失败提供灰色文字占位，长名称两行；参考份额价与实际报价区分。
FORM：原生 TypeScript/WXML/WXSS。新增行采用低幅触摸透明度反馈，跟随既有关闭动效及 reduced-motion。商品图复用公开媒体数据，无新增位图装饰。真实 DeepSeek、原生模拟器与界面夹具分开记录，安卓真机未验。
FINISH：unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
