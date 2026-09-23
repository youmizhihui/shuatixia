#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""前端构建产物部署到 app/www：
1) 读 dist/index.html 提取 assets 文件名（script/css）
2) 清空并复制 dist/assets -> app/www/assets
3) 用提取的文件名更新 app/www/index.html 的引用（保证不 404）
用法: python frontend/deploy-www.py   （在工程根目录运行）
"""
import os, re, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_HTML = os.path.join(ROOT, "frontend", "dist", "index.html")
DIST_ASSETS = os.path.join(ROOT, "frontend", "dist", "assets")
WWW_ASSETS = os.path.join(ROOT, "app", "www", "assets")
WWW_HTML = os.path.join(ROOT, "app", "www", "index.html")

def fail(msg):
    print("DEPLOY_FAIL:", msg)
    sys.exit(1)

if not os.path.exists(DIST_HTML):
    fail("frontend/dist/index.html 不存在，请先 npm run build")

html = open(DIST_HTML, encoding="utf-8").read()

# 提取 script src 与 link href（形如 /assets/xxx.js）
refs = {}
m = re.search(r'<script[^>]*src="([^"]*assets/([^"/]+\.js))"', html)
if not m:
    fail("dist/index.html 中未找到 js 引用")
refs["js"] = (os.path.basename(m.group(1)), m.group(2))
m = re.search(r'<link[^>]*href="([^"]*assets/([^"/]+\.css))"', html)
if m:
    refs["css"] = (os.path.basename(m.group(1)), m.group(2))

print("提取到:", refs)

# 复制 assets
if os.path.exists(WWW_ASSETS):
    for f in os.listdir(WWW_ASSETS):
        p = os.path.join(WWW_ASSETS, f)
        if os.path.isfile(p):
            os.remove(p)
else:
    os.makedirs(WWW_ASSETS)
for f in os.listdir(DIST_ASSETS):
    shutil.copy2(os.path.join(DIST_ASSETS, f), os.path.join(WWW_ASSETS, f))
print("assets 已复制:", sorted(os.listdir(WWW_ASSETS)))

# 校验并更新 index.html
w = open(WWW_HTML, encoding="utf-8").read()
js_name = refs["js"][1]
css_name = refs["css"][1] if "css" in refs else None
w2 = re.sub(r'<script type="module"[^>]*src="[^"]*assets/[^"/]+\.js"',
            f'<script type="module" crossorigin src="/app/shuatixia/assets/{js_name}"', w)
if css_name:
    w2 = re.sub(r'<link rel="stylesheet"[^>]*href="[^"]*assets/[^"/]+\.css"',
                f'<link rel="stylesheet" crossorigin href="/app/shuatixia/assets/{css_name}"', w2)
if w2 == w:
    print("index.html 引用未变化（可能已一致）")
open(WWW_HTML, "w", encoding="utf-8", newline="\n").write(w2)
print("index.html 已更新 ->", js_name, css_name)

# 最终校验：index.html 引用必须存在于 assets
final = open(WWW_HTML, encoding="utf-8").read()
for name in [js_name, css_name]:
    if name and f"/assets/{name}" not in final:
        fail(f"index.html 中缺少引用 {name}")
    if name and not os.path.exists(os.path.join(WWW_ASSETS, name)):
        fail(f"assets 目录缺少文件 {name}")
print("DEPLOY_OK")
