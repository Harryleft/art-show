# Art Show

> _「让美术馆住进你的桌面」_

<p align="center">
  <img src="logo/logo.png" alt="Art Show Logo" width="128" height="128">
</p>

![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)
![Electron](https://img.shields.io/badge/Electron-41-blue.svg)
![Platform](https://img.shields.io/badge/Platform-Windows-informational.svg)

一键操作，每 N 分钟自动展示一幅来自大都会艺术博物馆（The Met）的公开藏品。

效果演示 · 安装 · 使用 · 背后的故事

---

## 效果演示

__每 N 分钟，桌面角落悄然换上一幅新画。__

无边框透明窗口悬浮在桌面，不抢焦点、不打扰工作。

- 自动从 The Met 公开 API 获取艺术品
- 支持自定义关键词搜索（如 "landscape"、"portrait"）
- 左下角悬浮显示作品信息（标题、作者、年代、朝代）
- 系统托盘常驻，右键菜单可暂停/继续/更换间隔
- 支持一键置顶/取消置顶

---

## 安装

### 从源码运行

1. 克隆仓库

   ```
   git clone https://github.com/Harryleft/art-show.git
   cd art-show
   ```

2. 安装依赖

   ```
   npm install
   ```

3. 启动应用

   ```
   npm start
   ```

   桌面角落出现浮动艺术品窗口即启动成功。

### 打包为 EXE

```
npm run build:portable    # 便携版
npm run build:installer   # 安装版（NSIS）
```

---

## 使用

| 操作 | 效果 |
| --- | --- |
| 启动后自动运行 | 按设定间隔自动切换艺术品 |
| 左下角悬浮触发 | 显示当前作品标题、作者、年代等信息 |
| 右键窗口/托盘图标 | 打开菜单：暂停/继续、更换间隔、关键词搜索、置顶 |
| 托盘图标双击 | 显示/隐藏窗口 |

数据来源：[The Met Open Access API](https://metmuseum.github.io/)，无需 API Key。

---

## 背后的故事

有一次在网上无意间看到 The Met 把 50 万件藏品开放了 API，想着能不能让这些画「活」起来——不只是躺在数据库里，而是随机出现在桌面上，像一个小小的流动画廊。

于是用 Electron 做了这个无边框透明窗口：自动抓取、自动展示、定时换画。后来又加了关键词搜索，这样你可以只看风景、只看肖像，或者只看某个流派。

它不做什么花哨的事，就是在你写代码、看文档、发呆的时候，角落里安静地换一幅画。

---

## 致谢

- [The Metropolitan Museum of Art](https://www.metmuseum.org/) — 开放藏品 API
- 数据遵循 [CC0](https://creativecommons.org/publicdomain/zero/1.0/) 协议

## License

ISC License
