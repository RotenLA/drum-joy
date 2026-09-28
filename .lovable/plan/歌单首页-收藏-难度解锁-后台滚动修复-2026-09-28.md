# 歌单首页 + 收藏 + 难度解锁 + 后台滚动修复

## 1. 后台不能上下滑动（先修）
全站为了游戏画面锁定了整页滚动，后台页面没有自己的滚动区域。给后台外层加独立的上下滚动容器（触屏也能滑），游戏页面不受影响。

## 2. 首页改为歌单
- 选歌页横向卡片改为显示「歌单」：每个标签一张，按后台排序；有未分类歌曲时最后加一张「未分类」。
- 最左侧固定「我的收藏」歌单（没有收藏时显示空状态提示）。
- 点开歌单进入详情：
  - 左侧：歌单内歌曲竖向列表，上下滑动浏览，当前选中高亮。
  - 右侧：选中歌曲的信息与设置（封面、歌名、长度/BPM/拍号、成绩评级、难度、手机音色、鼓组、排行榜、下载/开始按钮——沿用现有卡片内容）。
  - 左上返回歌单列表；搜索保留，在歌单内过滤。
- 歌曲右上角红心：点击收藏/取消，「我的收藏」立刻更新。

## 3. 收藏随账号走
- 云端新增收藏记录（玩家 id + 歌曲 id）。有宿主账号时同步云端；未登录存本机，首次登录合并到账号（与成绩同样规则）。

## 4. 难度上锁
- 轻松、入门始终可玩。
- 标准：该歌「入门」曾全连击（无 Miss 完成）才解锁。
- 困难：该歌「标准」曾全连击才解锁。
- 锁住的难度按钮显示锁图标和提示「入门全连击后解锁」等；解锁按每首歌单独计算。
- 需要在成绩里记录「是否全连击」，旧成绩没有这个字段视为未全连击。

## 技术细节
- admin.tsx 根节点包 `h-dvh overflow-y-auto taiko-scroll`。
- 新迁移：`song_favorites(user_id text, song_id uuid, created_at)` 主键 (user_id, song_id)，GRANT + RLS（只由服务端函数读写）；`play_bests`/`plays` 加 `full_combo boolean default false`，最佳记录中 full_combo 取 OR。
- `listLibrarySongs` 返回每首歌的 tag_ids 与标签列表；新增 `getFavorites/toggleFavorite/importLocalFavorites`。
- 前端：新 `PlaylistGrid`、`PlaylistDetail`，复用 CardControls；history.ts 记录 fullCombo，新增 `isUnlocked(songId, diff)`；FallScreen 结算时写入 fullCombo；新增文案中英 + 其余语言回退英文。
