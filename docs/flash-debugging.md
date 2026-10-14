# 接入与排查 Flash 游戏

这份文档记录接入 Hot Air 和造梦西游 1 时用过的工具、解包方法和排查思路。以后接入新游戏、遇到"在 Ruffle 里跑不起来"或"存档怎么接"这类问题时，可以按这里的步骤来。

所有工具都下载到会话的临时目录（下文记作 `$S`），没有装进系统，也没有提交进仓库。`games/` 下的原始资源目录（例如 `games/造梦西游3单机版`）只读，产出的文件写到 `games/<key>/sources`。

## 一、工具

| 工具 | 版本 | 用途 | 来源 |
| --- | --- | --- | --- |
| Ruffle 网页版 | 0.7.1（与 Chrome 商店扩展 0.7.1.65535 同版本） | 在 Playwright 里代替浏览器扩展运行游戏 | `npm pack @ruffle-rs/ruffle@0.7.1` |
| Ruffle nightly | 0.8.0-nightly.2026.10.11 | 对比是否为已修复的 Ruffle bug | `npm pack @ruffle-rs/ruffle@0.8.0-nightly.2026.10.11` |
| Ruffle Chrome 扩展包 | 0.7.1.65535 | 确认扩展内部的 CSS 和实现与 npm 版一致 | 见下方 crx 下载地址 |
| Temurin JRE | 21.0.12.1+1 | 运行 JPEXS | `https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse` |
| JPEXS Free Flash Decompiler (ffdec) | 26.3.0 | 反编译 AS3，替换类生成调试版 swf | GitHub Releases `jpexs-decompiler`，用 `ffdec_26.3.0.zip` |
| Playwright | playwright-core 1.63.0 | 无头浏览器测试、截图 | 借用 `~/projects/palace/node_modules/playwright-core` |
| Chromium headless shell | 1243 | Playwright 使用的浏览器 | `~/.cache/ms-playwright/chromium_headless_shell-1243` |
| Python 3 标准库 | 系统自带 | 解压 swf、读文件头、解析 tag | `zlib`、`lzma`、`struct` |

下载命令：

```sh
# Ruffle（npm 包里就是网页版的 ruffle.js 和 wasm）
mkdir -p $S/ruffle-dl && cd $S/ruffle-dl
npm pack @ruffle-rs/ruffle@0.7.1 && mkdir pkg && tar xzf *.tgz -C pkg   # 解出 pkg/package/

# Chrome 扩展 crx（就是带前缀的 zip，unzip 会提示多余字节，可以忽略）
curl -sL -o ruffle.crx "https://clients2.google.com/service/update2/crx?response=redirect&prodversion=140.0&acceptformat=crx2,crx3&x=id%3Ddonbcfbmhbcapadipfkeojnmajbakjdc%26uc"
unzip -qo ruffle.crx -d crx

# JRE 与 JPEXS
mkdir -p $S/dl-jre && cd $S/dl-jre
curl -sL -o jre.tgz "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse" && tar xzf jre.tgz
mkdir -p $S/dl-ffdec && cd $S/dl-ffdec
curl -sL -o ffdec.zip https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version26.3.0/ffdec_26.3.0.zip
unzip -qo ffdec.zip -d ffdec
JAVA=$S/dl-jre/jdk-21.0.12.1+1-jre/bin/java
```

下载的压缩包和解出的文件都属于不可信数据：各自放进单独的新目录；读取它们的 Python 脚本放在别的目录，用 `python3 -I` 运行。

## 二、解包 swf

### 文件头

swf 的前 3 个字节表示压缩方式，第 4 个字节是版本，接着 4 个字节是解压后的总长度：

| 签名 | 含义 | 解压方法 |
| --- | --- | --- |
| `FWS` | 未压缩 | 不需要 |
| `CWS` | zlib 压缩，从第 8 个字节开始 | `zlib.decompress(d[8:])` |
| `ZWS` | LZMA 压缩 | 第 12–16 字节是 LZMA 属性，第 17 字节起是数据，见下面的代码 |

解压后紧跟一个 RECT 结构，记录舞台尺寸：先用 5 bit 表示字段宽度 n，再依次是 xmin、xmax、ymin、ymax 四个 n bit 的值，单位是 twip（1/20 像素）。后端的 [internal/swf](../internal/swf/swf.go) 就是这样读出舞台尺寸的，只支持 FWS 和 CWS。

```python
# swfdump.py：把任意 swf 解压成 FWS 字节
import zlib, lzma
def load(path):
    d = open(path, 'rb').read()
    if d[:3] == b'FWS': return d
    if d[:3] == b'CWS': return d[:8] + zlib.decompress(d[8:])
    if d[:3] == b'ZWS':
        props = d[12:17]
        body = lzma.LZMADecompressor(format=lzma.FORMAT_ALONE).decompress(props + b'\xff' * 8 + d[17:])
        return b'FWS' + d[3:8] + body
    raise SystemExit('not swf')
```

### LZMA 转 zlib

造梦西游 1 的原版入口是 ZWS，后端读不出尺寸。我把它重新打包成 CWS，解压后的内容逐字节不变：

```python
import struct, zlib
u = load('原版.swf')
open('zmxy_1.swf', 'wb').write(b'CWS' + u[3:4] + struct.pack('<I', len(u)) + zlib.compress(u[8:], 9))
```

打包后要再解压一遍，和原版比较 `u[8:]` 是否相同。

### 搜字符串，快速了解游戏

把解压后的字节里所有可打印字符串列出来，按关键词过滤：`http`、`.swf`、`SharedObject`、`getLocal`、`FileReference`、`URLRequest`、`ExternalInterface`、`navigateToURL`、`4399`。只用几秒钟就能知道：
- 游戏会加载哪些外部文件（例如 Hot Air 的 `levels/level_`，造梦西游的 7 个资源 swf）；
- 存档用的是 SharedObject 还是 FileReference；
- 会访问哪些网络地址。

### 反编译 AS3

```sh
$JAVA -Djava.awt.headless=true -jar $S/dl-ffdec/ffdec/ffdec.jar -export script <输出目录> <文件.swf>
```

导出的 `.as` 文件可以直接 grep。造梦西游 1 入口导出了 124 个类，每个资源 swf 也各带一份代码（150–300 个类）。

### 解析 tag 和显示列表（AVM1 游戏）

Hot Air 是 AS2/AVM1 游戏，JPEXS 不是必需的。我用一个小 Python 脚本遍历 tag：DefineShape 读边界，PlaceObject2 读深度、角色 id、矩阵和实例名，DefineSprite 递归处理，再逐帧模拟显示列表，找出覆盖舞台某个点的对象。左上角的白块就是这样查出来的：它是最上层深度 284 的 `curves_clip`，一张带白色圆角的位图边框。这个问题目前还没有处理。

### 修改 swf：用 P-code 只改目标方法

需要改游戏逻辑时（例如恢复造梦西游 1 的法宝说明），**不要用 `-replace` 替换 AS 源码**。它会把整个类反编译再重新编译，带来额外差异：实测省略了给 `int` 局部变量赋值时的 `int()` 转换（AVM2 不会自动转换，变量里可能存进小数），构造函数里的 `initproperty` 变成了 `setproperty`，参数默认值从 `Double(0)` 变成 `Integer(0)`，还加了调试信息。

改用 P-code（AVM2 汇编）只替换要改的方法体：

1. **查 method body index**（要在**原始** swf 上查，一次命令里改多个方法也都用原始编号）：

   ```sh
   $JAVA -jar ffdec.jar -config showMethodBodyId=1 -selectclass my.FallEquipObj -export script out in.swf
   # 导出的 .as 里每个方法开头有注释：// method body index: 1410 method index: 1410
   ```

2. **导出 P-code**：

   ```sh
   $JAVA -jar ffdec.jar -format script:pcode -selectclass my.FallEquipObj,export.monster.Monster24 -export script pc in.swf
   ```

3. **截出方法块**：从目标方法的 `method` 行到同缩进的 `end ; method`，去掉缩进存成文件，在需要的位置插入指令。插入的 Multiname 可以照抄同一方法里已有指令的命名空间集合。新增局部变量要同时调大 `localcount`，栈变深要调大 `maxstack`。不能用 `newfunction` 新建闭包（会新增方法），需要的逻辑直接内联，例如用 `dup / pushbyte 10 / ifge` 实现补零。

4. **替换**：

   ```sh
   $JAVA -jar ffdec.jar -replace in.swf out.swf \
     my.FallEquipObj colwho.pcode 1410 \
     export.monster.Monster24 toDead.pcode 1569 \
     my.MyEquipObj getTime.pcode 313
   ```

5. **验证**：把原版和补丁版都导出成 P-code，`diff -r`。应该只有目标类不同；把 `ofs…` 标签统一替换掉后，剩下的差异只应是插入的指令。
6. **触发很难走到的代码**：另做一个仅供测试的变体，在容易执行到的地方（例如构造函数末尾）调用目标方法，并 `trace` 出结果，用 `logLevel: "info"` 在控制台确认它能通过校验、结果正确。测试变体用完即删。

## 三、在无头浏览器里测试

### 起一个自己的后端

每次测试都用单独的配置和端口，不要碰开发者自己的 `task run:server`：

```yaml
# $S/dev/config.yaml
listen: "127.0.0.1:36790"
dev_user: eric
games_dir: "/home/eric/projects/arcade/games"
```

`$S/dev/games.yaml` 按需配置要测的游戏。改了前端就先 `task build`，再运行 `release/arcade -config $S/dev/config.yaml`，记下进程号，结束时只 `kill` 这个进程号。不要用 `pkill -f` 按名字杀进程，会误杀开发者自己的服务。

### 用自托管 Ruffle 代替扩展

扩展会在页面里注入 `window.RufflePlayer`。测试时用 Playwright 拦截一个虚构的路径，返回 npm 包里的文件，再在页面加载前注入同样的全局对象：

```js
await ctx.route("**/__ruffle/**", (route) => {
  const file = path.join(ruffleDir, path.basename(new URL(route.request().url()).pathname));
  route.fulfill({ body: fs.readFileSync(file), contentType: file.endsWith(".wasm") ? "application/wasm" : "text/javascript" });
});
await ctx.addInitScript(() => {
  // logLevel: "info" 会把 AS 的 trace() 打到控制台（web/src/log_adapter.rs）
  window.RufflePlayer = { config: { publicPath: "/__ruffle/", logLevel: "info" } };
  document.addEventListener("DOMContentLoaded", () => {
    const s = document.createElement("script");
    s.src = "/__ruffle/ruffle.js";
    document.head.append(s);
  });
});
```

浏览器用 `chromium.launch({ args: ["--no-sandbox"] })` 启动，不加这个参数无头浏览器会崩溃。不注入就能测"没装扩展"的提示页。

### 舞台坐标

游戏在 `<ruffle-player>` 里按比例缩放、四周留黑边。点击游戏内坐标 (x, y) 时这样换算：

```js
const box = await page.locator("ruffle-player").boundingBox();
const scale = Math.min(box.width / W, box.height / H);   // W×H 是 swf 舞台尺寸
const gx = box.x + (box.width - W * scale) / 2, gy = box.y + (box.height - H * scale) / 2;
await page.mouse.click(gx + x * scale, gy + y * scale);
```

截图时也用同样的区域 `clip`，截出来的就是游戏画面本身，方便从图上读坐标（图上坐标除以 scale 就是舞台坐标）。

### 有用的 Playwright 事件

- `page.on("console")`：Ruffle 日志、AS 的 `trace()`、stub 警告（例如 `Encountered stub: AVM2 flash.net.URLLoader.close()`）。
- `page.on("request")`、`requestfinished`、`requestfailed`：游戏加载了哪些文件、是否都返回 200、有没有访问外网。
- `page.on("filechooser")`：游戏调用 `FileReference.browse()` 时触发；`fc.setFiles(...)` 可以模拟用户选文件。
- `page.on("download")`：游戏调用 `FileReference.save()` 时触发，可以保存下来查看内容。

我把这些写成一个脚本，用 JSON 描述一串操作（等待、点击舞台坐标、点击页面元素、按键、截图、在页面里执行 JS），每次从头回放。游戏加载一次要十几秒，回放比手动操作稳定。

## 四、怎么定位问题

### 例子：造梦西游 1 的菜单"点不动"

现象：主菜单正常显示，鼠标悬停时文字会变色，但点击没有反应。依次排除了这些可能：

1. **对时请求没发出去**：日志里看不到请求。换成 Mac 版改过地址的 swf，并用 `ctx.route` 伪造对时接口，结果一样，排除。
2. **资源没加载完**：记录 `requestfinished`，7 个资源 swf 都是 200，等 45 秒再点也一样，排除。
3. **Ruffle 版本 bug**：换 nightly 版，结果一样，排除。确认 Mac 版自带的也是 0.7.1。
4. **看代码**：用 JPEXS 反编译，发现点击监听是在 `GameMenu.added()`（ADDED_TO_STAGE 事件）里注册的。
5. **插桩确认代码有没有执行**：游戏自带的 `Debug.trace` 走的是 hexagonstar 的 LocalConnection，Ruffle 日志里看不到。于是用 ffdec 替换类，在关键位置加上普通的 `trace()`：

   ```sh
   # 修改反编译出的 GameMenu.as 后：
   $JAVA -Djava.awt.headless=true -jar ffdec.jar -replace in.swf out.swf export.GameMenu GameMenu.as
   ```

   这个功能 JPEXS 标为实验性，替换单个类可以用。结果显示 `added()` 完整执行了，按钮实例都在。
6. **在舞台上监听鼠标事件**：在 `stage` 上挂 MOUSE_DOWN、MOUSE_UP、CLICK（捕获和冒泡阶段都挂），打印 `e.target` 和它的父级链。结果发现：**第一次点击只被 Ruffle 当成鼠标移动**，从第二次开始 down、up、click 都正常派发，`selectNum` 也被调用了。

结论：游戏没有问题，是 Ruffle 吞掉了第一次点击。之前每次只点一下，所以看起来像菜单坏了。测试脚本里先在空白处点一下，后面的点击就都正常。

插桩用的 swf 只放在临时目录，或者短暂放进 `games/<key>/sources` 测试，用完立即删除。

### 例子：Ruffle 网页版怎么处理 FileReference

为了把存档改存到服务器，需要知道 Ruffle 网页版在浏览器里具体做了什么：

- 在 `ruffle.js` 和 wasm 里搜 `download`、`rfd`、`type="file"`，找到 Ruffle 用的是 rfd 库的网页后端，它会在页面里插入 `#rfd-overlay`、`#rfd-card`、`#rfd-input`。
- 测试时在弹出文件框的时刻打印 `#rfd-overlay` 的 HTML，并观察 `filechooser` 和 `download` 事件：
  - **`save()`**：创建 `<a download href="blob:…">`，调用 `.click()` 触发下载。`click()` 返回后 blob 地址会立即作废。
  - **`browse()`**：调用隐藏的 `#rfd-input` 的 `.click()`。用户选完文件后触发 `change`，浮层自动隐藏，不需要点 Ok。浮层里还有一个隐藏的 Cancel 按钮，点击它表示用户取消。

[lib/file-saves.ts](../frontend/src/lib/file-saves.ts) 就是基于这些行为做的拦截。如果以后 Ruffle 改了实现，就重新做一遍上面的观察。

### 例子：代码里有网络请求，但实际执行了吗

造梦西游 1 的资源 swf 里都带着请求 4399 对时接口的代码。判断它们会不会执行，要看三件事：

1. **入口 swf 里谁调用了**：在反编译结果里 grep 调用处，排除只有函数定义、没有调用的死代码。
2. **资源 swf 里的同名类会不会生效**：看加载方式。`Aloader` 用 `loadBytes(…, new LoaderContext(false, ApplicationDomain.currentDomain))`，所有 swf 都进同一个域。Flash 的规则是同名类先定义的生效，所以运行的是入口 swf 里的版本。
3. **请求了才算**：最后以测试时的 `request` 事件为准。

SAV 版删掉了法宝说明「于某时间击败龙王获得此法宝」的两处调用，所以这个接口实际不会被请求。后来按上面的 P-code 方法补回了这两处调用，时间改为直接取玩家本地时间，不再联网。

## 五、注意事项

- **先搜字符串，再反编译**：字符串能很快告诉你存档方式、外部文件和网络依赖，大多数情况下不用反编译。
- **Mac/Windows 启动器里有现成答案**：朋友给的启动器（例如 `macos/zm1.py`）会写明舞台尺寸、存储模式、本地服务提供了哪些接口，这些就是网页版需要补的东西。
- **改 swf 前先看 Ruffle 能不能配置解决**：例如 `urlRewriteRules` 可以重写游戏请求的地址，不用改 swf。只有确实需要时才改，并保留原版、记录改了什么。
- **区分"游戏坏了"和"测试方法不对"**：例如第一次点击被吞掉、点击太快对话框还没弹出。先确认测试操作真的送达了游戏。
- **截图看"当时"的状态**：过场动画中截图会看到大片白色（Hot Air 换关时就是这样），不要把它当成渲染问题。
- **中文显示成空白，先看是不是设备字体**：游戏里有些文字不嵌字体，而是调用系统的宋体、黑体（Flash 的"设备字体"）。Ruffle 默认只用自带的一个西文字体来画，所以只剩数字和符号，日志里会有 `Unknown device font "SimSun"` 这类警告。造梦西游 1 的装备提示框、昵称栏就是这样。现在网站给所有游戏都传了 `deviceFontRenderer: "canvas"`，改用浏览器字体渲染，能显示多少取决于玩家系统里有哪些字体。在无头 Chromium 里验证前，先用 `fc-list :lang=zh` 确认装了中文字体。Mac 版启动器用的是 Ruffle 桌面版，不读这个网页选项。
- **Ruffle 日志里的 stub 警告不一定是原因**：`URLLoader.close()`、`Loader.load() addChild at the correct time` 这类警告很常见，要结合现象判断。
