# 游戏美术提示词

给任意游戏生成四种图的 GPT Image 提示词前缀。前缀以 `The game:` 结尾，后面接上游戏描述即可，最好同时附上游戏原画或截图作为参考图。

| 文件 | 用途 | 页面显示尺寸 | 生成尺寸 |
| --- | --- | --- | --- |
| [icon.prompt.txt](icon.prompt.txt) | 游戏图标 | 约 128×128（1:1） | 1024×1024 |
| [card.prompt.txt](card.prompt.txt) | 分区卡片封面 | 约 655×410（16:10） | 1600×1000 |
| [poster.prompt.txt](poster.prompt.txt) | 最近游玩区域大海报 | 约 1380×480，大屏更宽 | 2560×1097（21:9） |
| [background.prompt.txt](background.prompt.txt) | 游玩页面全屏背景 | 整个浏览器窗口 | 2560×1440（16:9） |

四种图都要求四个直角、满版出血，圆角由网站 CSS 负责。背景图不带任何阴影、暗角或中间的面板，阴影统一由前端加。

## 游戏描述写法

```
Name: 造梦西游 3
Original style: 2D cartoon, hand-drawn Flash animation, bold outlines
Main character: a cartoon Monkey King in golden armor holding a red-and-gold staff
Setting: Chinese mythology, clouds, mountains, temples, demons
Palette: red, gold, sky blue
Mood: heroic, energetic
```

## 用法示例

```bash
{ cat design/card.prompt.txt; echo; cat game.txt; } | wl-copy
```
