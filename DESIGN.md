---
name: 拼单购物原生小程序
description: 真实商品摄影、清晰份额价格与克制蓝色操作的原生微信界面
colors:
  primary: "#0071e3"
  primary-text: "#0066cc"
  primary-soft: "#edf5ff"
  primary-wash: "#e6f1ff"
  surface: "#ffffff"
  background: "#f5f5f7"
  ink: "#1d1d1f"
  body-secondary: "#515154"
  secondary: "#6e6e73"
  muted: "#86868b"
  stroke: "#d2d2d7"
  divider: "#e9e9ed"
  error: "#b42318"
  warning-text: "#a06724"
  warning-soft: "#fdf1e3"
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif'
    fontSize: "56rpx"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-1.5rpx"
  headline:
    fontSize: "46rpx"
    fontWeight: 700
    letterSpacing: "-1rpx"
  title:
    fontSize: "32rpx"
    fontWeight: 600
  price:
    fontSize: "38rpx"
    fontWeight: 600
    letterSpacing: "-0.7rpx"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif'
    fontSize: "28rpx"
    lineHeight: 1.5
  label:
    fontSize: "24rpx"
    lineHeight: 1.6
  subtitle:
    fontSize: "26rpx"
    lineHeight: 1.7
rounded:
  input-small: "8rpx"
  badge: "12rpx"
  share-option: "20rpx"
  control: "24rpx"
  card: "28rpx"
  gallery: "32rpx"
  sheet: "36rpx 36rpx 0 0"
  pill: "40rpx"
spacing:
  tight: "8rpx"
  compact: "12rpx"
  related: "16rpx"
  row-gap: "20rpx"
  section: "24rpx"
  card-inset: "28rpx"
  page-inset: "32rpx"
  closing: "48rpx"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "22rpx 24rpx"
  button-disabled:
    backgroundColor: "{colors.divider}"
    textColor: "{colors.secondary}"
    rounded: "{rounded.control}"
  button-location:
    backgroundColor: "{colors.primary-wash}"
    textColor: "{colors.primary-text}"
    rounded: "{rounded.control}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    padding: "0 16rpx"
  search-field:
    backgroundColor: "{colors.divider}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 26rpx"
    height: "96rpx"
  composer-input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 24rpx"
    height: "96rpx"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "32rpx"
  category-pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.body-secondary}"
    rounded: "{rounded.pill}"
    padding: "0 26rpx"
  category-pill-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
  share-option:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.share-option}"
    padding: "22rpx 20rpx"
  share-option-selected:
    backgroundColor: "{colors.primary-soft}"
    rounded: "{rounded.share-option}"
    padding: "22rpx 20rpx"
  tab-navigation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.secondary}"
  tab-navigation-selected:
    textColor: "{colors.primary}"
---

# Design System: 拼单购物原生小程序

## Overview

**Creative North Star: "清晰的好物橱窗"**

真实商品摄影、清晰份额价格和可发现的操作构成界面。浅灰白承载黑灰文字，蓝色引导下一步；以留白和字号建立层级，保留微信原生导航、Tab、输入、轮播与选择器。此名称是对已确认 iPhone 宣传页参考和实际构建的描述，不是新的方向选择。

本文件是 2026-10-06 的 scan-mode 记录。规范值来自原生 WXML/WXSS 的最终级联，机器层使用实际 rpx 单位。适用范围是商品浏览与详情、地址、我的、客服入口和 AI 对话的共用语言；旧页面存在差异，不以本文件宣称全应用已经统一。它不改变交易规则、页面授权或后端契约。

**Key Characteristics:**

- 商品照片与份额起价先被看见。
- 白色承载面与浅灰背景形成平静层次。
- 黑灰文字分层，蓝色集中于交互及其选中反馈。
- 原生控件、短按压反馈、底部安全区共同支撑操作。

抽取依据：`apps/mini-program/miniprogram/app.wxss`、`app.json`，以及 `features/catalog/pages/index/index.wxss`、`features/catalog/pages/detail/index.wxss`、对应 WXML，`features/address/pages/list/index.wxss`、`features/address/pages/form/index.wxss`、`features/profile/pages/index/index.wxss`、`features/ai-support/pages/chat/index.wxss`、`features/cs/pages/index/index.wxss`。方向依据为 `PRODUCT.md` 与 `.impeccable/surfaces/mini-storefront.md`。

原生开发者工具 iPhone 12/13 Pro 截图及 `.impeccable/review/finish-review.md` 提供观察依据；本文件未独立重跑渲染或检测器。安卓/GPS/帧率/深色模式/字体放大、真机以及原生 swiper 的减少动态效果行为仍待验。截图含个人信息，不作为本设计系统的可分发资产。

## Colors

配色以冷浅灰白和中性黑灰为底，蓝色承担操作意义，红与浅棕仅说明异常或状态。

### Primary

- **操作蓝**（`primary`）：主按钮、原生 Tab 选中态、输入光标与份额选中描边。
- **深操作蓝**（`primary-text`）：份额标签、地址默认标记和定位辅助操作的文字。
- **选中浅蓝**（`primary-soft`）：选中份额、默认地址标签与已绑定状态。
- **辅助浅蓝**（`primary-wash`）：主动位置选择按钮和我的页头像占位承载面。

### Neutral

- **白色承载面**（`surface`）：卡片、面板、底栏、原生导航与 Tab。
- **冷浅灰底**（`background`）：页面背景、未选份额和 AI 输入区。
- **近黑主文字**（`ink`）：标题、商品名、价格和正文；分类选中态也使用这一底色。
- **中灰正文**（`body-secondary`）：商品说明、数量、表单标签与未选分类文字。
- **次级灰**（`secondary`）：辅助说明、占位、计数和未选导航。
- **弱化灰与分隔灰**（`muted`、`stroke`、`divider`）：弱化提示、细描边、行分隔、搜索底与禁用按钮。
- **异常红**（`error`）：请求错误、表单错误和危险操作文字。
- **状态棕及浅棕底**（`warning-text`、`warning-soft`）：售罄与未绑定等状态。它们不是第二品牌色。

**The 操作有色 Rule.** 蓝色表示操作或与操作相关的选择状态；商品摄影保留其真实色彩，价格保持近黑色。

未把零星骨架色、演示提示色和人工客服旧背景扩展成全局品牌色。金额展示与状态文字必须继续依据既有业务契约，不能仅靠颜色表达结果。

## Typography

**Display Font:** 系统无衬线，与正文同栈。

**Body Font:** `-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`；未加载或自托管额外字体。中文由平台实际回退字体承载，安卓实际字形尚待验。

**Character:** 大标题与近黑价格建立清晰层级，灰色说明减轻密度。同一字体通过字号、字重、行高与少量负字距区分角色。

### Hierarchy

- **Display**（`display`）：首页主标题，两行黑灰层级。
- **Headline**（`headline`）：全局标题及地址页标题。我的页实际为 52rpx，详情商品名为 42rpx；这些是页面变体，不能互换为统一字号。
- **Title**（`title`）：共用分区标题；商品集合标题使用 34rpx，AI 对话标题及下单面板标题使用 36rpx。
- **Price**（`price`）：首页份额起价。详情份额起价同为 38rpx、字重 600，但未沿用首页负字距；整件参考价为 34rpx、字重 700。
- **Body**（`body`）：正文、输入与全局按钮。商品名称为 28rpx、字重 500、行高 1.45，限制两行。
- **Label**（`label`）：共用状态与提示；页面辅助文字还实际使用 20–26rpx，按原有用途保留，不一律降为最小字号。
- **Subtitle**（`subtitle`）：页头说明及商品描述；AI 助手长回答使用继承的正文字号和 1.8 行高，保留换行。

**The 字体继承 Rule.** 页面变体只覆盖其所需的字号或字重；没有显式定义的属性继承原生页面基础字体，不能把推测值写成源代码事实。

## Layout

原生页面使用 rpx，基础页边距为 `page-inset`。首页左右保持此边距，上下实际为 24rpx/48rpx；商品网格是两个 `minmax(0,1fr)` 列，行列间距分别为 24rpx/20rpx。分类使用横向 `scroll-view`，保留一行，不建立桌面断点。当前实现没有响应式断点表。

通用卡片间距为 `section`，内边距依场景为 26/28/32rpx。首页商品照片高 340rpx，详情轮播高 650rpx并使用 `aspectFill`；图像失败回落到文字占位。商品卡片信息内边距为 22rpx 22rpx 26rpx。不要把首页两列或详情图高提升为所有页面的固定模板。

详情页面底部留 200rpx，固定操作栏与 AI 输入栏使用 `env(safe-area-inset-bottom)`。下单面板最多 80vh，可纵向滚动。AI 对话使用 flex 纵向容器，消息区滚动，实际键盘高度以 px 输入容器内边距；这是平台事件单位，与布局 rpx 分工不同。

按钮、搜索、分类、份额行、小型关闭与昵称操作的主要触摸尺寸在代码中至少为 96rpx；我的页入口行实际为 104rpx。实机键盘、字体放大和安卓安全区仍需验证。

**The 空间分工 Rule.** 小间距组织同一组内容，大间距区分区块；固定底栏和面板遵循安全区，正文保持可滚动。

## Elevation & Depth

常态卡片以白面与灰底区分，不使用悬浮卡片阴影。层次只在固定底栏、选中份额和下单遮罩处加强；阴影不承担商品信息层级。

### Shadow Vocabulary

- **底栏软分离**：`0 -10rpx 30rpx rgba(0,0,0,.035)`；商品详情最终级联值，覆盖该文件较早的底栏阴影。
- **份额选中内描边**：`inset 0 0 0 2rpx #0071e3`；用于选择状态，不表示浮起。
- **面板遮罩**：`rgba(0,0,0,0.45)`；盖住背景并承载关闭交互。
- **轮播计数底**：`rgba(29,29,31,.75)`；保障照片上的计数可见，属于局部覆盖层。

**The 常态平面 Rule.** 共用卡片保留平面；延续现有状态描边和局部覆盖层，不为每张商品卡新增阴影。

## Shapes

控件、卡片、轮播与面板使用不同的圆角角色，具体值以 frontmatter 为准。卡片和轮播裁切图片；份额是较紧凑的圆角行，分类是胶囊；面板只有上角圆。头像是圆形，AI 用户消息使用不对称圆角（26rpx 26rpx 6rpx 26rpx），未把它泛化为卡片形状。

分隔线通常为 1rpx，搜索图标与我的页箭头以简单几何线条构成。底部导航为原创线性图标：来源 `scripts/ui/generate-tab-icons.ps1`，输出至 `assets/tabs/`，72px 图像画布、4px 圆端笔触；实际显示尺寸由微信原生 Tab 控制。

## Components

### Buttons

蓝色实心表达主要动作，浅蓝位置按钮与透明人工入口承担辅助动作。全局按钮为 `button-primary`，最小高 96rpx，默认上间距 24rpx；局部发送、定位或入口样式会覆盖尺寸和间距。禁用态由原生 `disabled` 属性映射为灰底灰字，loading 与禁用共同防止重复提交。

按压使用 120ms `ease-out` 的缩放/透明度反馈，目标缩放 0.97、透明度 0.88；局部 `.hover` 覆盖为 0.85 透明度。没有网页鼠标 hover 设计或自定义 focus ring；输入焦点由原生控件承载。

### Chips

分类为白底灰字，选中后近黑底白字；最小高 96rpx，内边距 0 26rpx。分类色彩切换为 220ms `ease-out`，按压反馈为 120ms。地址默认/绑定标签是状态标签，不继承分类的交互尺寸或近黑选中底。

### Cards / Containers

白色圆角承载面，通用卡片按 frontmatter，详情/地址/我的/客服内边距遵循各页面变体。首页商品卡片图片占据上部，信息置于下部，不用装饰覆盖名称与价格；卡片按压缩放为 180ms `cubic-bezier(.16,1,.3,1)`。骨架沿用卡片和图片区几何，不声称存在 shimmer 动画。

### Inputs / Fields

搜索与 AI 输入使用圆角灰底；地址表单将标签与原生 input/textarea/picker 排在白色卡片中的分隔行，表单行垂直内边距为 30rpx。昵称编辑保留细描边、小圆角并可换行。输入光标为操作蓝，错误反馈使用独立红色文字；源码没有新增 focus 视觉规则。

### Navigation

微信原生顶部导航白底黑字，底部三个入口为商品、订单、我的；常态次级灰，选中操作蓝。原创位图图标随 Tab 状态切换。系统导航尺寸、字体和转场由微信运行时控制，不复制成网页导航。

### Share Selection & Order Sheet

份额行展示份额、参考数量与价格；选中用浅蓝底和内描边，不使用仅有颜色的状态表达，文字也显示“已选”。下单面板的抬升入场为 320ms `cubic-bezier(.16,1,.3,1)`，由下方 100% 位移回到原位；遮罩入场为 220ms `ease-out`。面板滚动、关闭范围和安全区内边距遵循现有实现。

### Photography & Native Gallery

10 个演示商品各 3 张照片，来源、许可、文件摘要与下载地址见 `scripts/demo-catalog/manifest.json`；不在本文件复制照片。图片须保留体验商品的事实边界，不能把图片推断成产地、认证、销量或优惠。轮播间隔 4500ms、切换 420ms、`easeOutCubic`；页面不可见或下单面板打开时停止自动轮播。

减少动态效果的 WXSS 分支关闭按钮/分类/份额行的 transition 和变换及面板/遮罩动画；原生 swiper 和 `scroll-with-animation` 不在该 CSS 分支保证之内，实机效果待验。

## Do's and Don'ts

### Do:

- **Do** 延续真实商品摄影、黑灰文字层级和蓝色操作意义。
- **Do** 使用原生 rpx 与安全区，保留加载、空态、失败占位、重试、loading 和 disabled 的真实状态。
- **Do** 保留体验商品、参考价格、支付未开放与 AI 身份/核实提示的事实表达。
- **Do** 将新页面的共用样式与上述 token 对照，页面变体明确记录适用范围。

### Don't:

- **Don't** 添加虚假优惠、销量或产地认证来填补空白。
- **Don't** 将设计预览 HTML、开发者工具截图或本地接口验证当作安卓/真机/全部状态验收。
- **Don't** 将人工客服旧浅绿背景、旧黑色按钮和不同输入圆角写成新的全局规则；这是存量漂移，本轮未修复。
- **Don't** 把只在单页存在的尺寸、动画或提示色扩展成所有页面的规范。

`.impeccable/design.json` 是本文件的扩展层：只保存颜色/字体用途元数据、阴影、动效和组件预览。预览 HTML/CSS 是便于面板展示的转译，按 375px 宽画布将 rpx 除以 2，使用浏览器默认焦点；它既不是应用产物，也不新增原生焦点规范。没有生成未实现的色阶、断点或新的组件状态。
