# Art Show — 桌面艺术小组件

Windows 桌面浮动窗口，定期展示来自大都会美术馆等 GLAM 机构的公开艺术品。

## 技术栈

- Electron (无边框透明窗口)
- Met Museum Collection API (RESTful, 无需认证)

## 项目结构

```
src/
  main.js           — Electron 主进程：窗口、托盘、IPC、API 调用
  preload.js         — 安全 IPC 桥接
  renderer/
    index.html       — 组件 UI
    styles.css       — 透明无边框样式、动画
    renderer.js      — DOM 逻辑、hover 效果、倒计时
  api/
    met-api.js       — Met Museum API 客户端（对象池、预加载）
```

## 运行

```bash
npm start
```

## 交互

- 拖拽顶部 6px 区域移动窗口
- 鼠标悬浮显示艺术品信息（标题、艺术家、年代、博物馆）
- 右键菜单：下一幅作品 / 更换间隔 / 置顶切换 / 退出
- 底部进度条显示距下次更换的倒计时

## API 说明

- Met API: `https://collectionapi.metmuseum.org/public/collection/v1/`
- 搜索接口返回 object ID 列表，对象接口返回详情+图片 URL
- 启动时预加载 100 个随机 ID，用完前自动补充
- 先加载小图（primaryImageSmall），后台替换高清图
