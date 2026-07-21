#!/usr/bin/env python3
import os, re, json, subprocess, sys

PKG = sys.argv[1]  # com.agorameet.app or com.agorameet.app2
PROJ = os.getcwd()
APP = os.path.join(PROJ, "android", "app")
BASE = "com.agorameet.app"

# 1) appId in capacitor config
cfg = os.path.join(PROJ, "capacitor.config.json")
j = json.load(open(cfg))
j["appId"] = PKG
json.dump(j, open(cfg, "w"), indent=2)

# 2) sync native project (updates namespace/applicationId/manifest)
result = subprocess.run(["npx", "cap", "sync", "android"], cwd=PROJ, capture_output=True, text=True)
print(result.stdout[-2000:] if len(result.stdout) > 2000 else result.stdout)
if result.returncode != 0:
    print("CAP SYNC ERROR:", result.stderr[-2000:] if len(result.stderr) > 2000 else result.stderr, file=sys.stderr)
    sys.exit(result.returncode)

# 3) fix MainActivity + custom plugin package declaration + physical location
JAVA_FILES = ["MainActivity.java", "AdMobManager.java", "AdMobPlugin.java", "OfflineEngine.java", "OfflinePlugin.java"]
for jf in JAVA_FILES:
    found = None
    for root, _, files in os.walk(os.path.join(APP, "src", "main", "java")):
        if jf in files:
            found = os.path.join(root, jf)
            break
    if not found: continue
    content = open(found).read()
    content = re.sub(r'^package .*;', f'package {PKG};', content, flags=re.M)
    dst_dir = os.path.join(APP, "src", "main", "java", *PKG.split("."))
    os.makedirs(dst_dir, exist_ok=True)
    dst = os.path.join(dst_dir, jf)
    open(dst, "w").write(content)
    if os.path.abspath(dst) != os.path.abspath(found):
        os.remove(found)
        p = os.path.dirname(found)
        while p != os.path.join(APP, "src", "main", "java"):
            if not os.listdir(p):
                os.rmdir(p)
            p = os.path.dirname(p)

# 3b) ensure capacitor.plugins.json has our custom AdMob plugin registered
pjson = os.path.join(APP, "src", "main", "assets", "capacitor.plugins.json")
plugins = json.load(open(pjson)) if os.path.exists(pjson) else []
CUSTOM_PLUGINS = [
    {"classSuffix": "AdMobPlugin", "pkg": f"{PKG}.AdMobPlugin", "cls": f"{PKG}.AdMobPlugin"},
    {"classSuffix": "OfflinePlugin", "pkg": f"{PKG}.OfflinePlugin", "cls": f"{PKG}.OfflinePlugin"},
]
for cp in CUSTOM_PLUGINS:
    if not any(p.get("class", "").endswith(cp["classSuffix"]) for p in plugins):
        plugins.append({"pkg": cp["pkg"], "class": cp["cls"]})
    else:
        for p in plugins:
            if p.get("class", "").endswith(cp["classSuffix"]):
                p["pkg"] = cp["pkg"]
                p["class"] = cp["cls"]
json.dump(plugins, open(pjson, "w"))

# 4) strings.xml package_name + custom_url_scheme
sx = os.path.join(APP, "src", "main", "res", "values", "strings.xml")
s = open(sx).read()
for old in (BASE, "com.agorameet.app2"):
    s = s.replace(f'<string name="package_name">{old}</string>', f'<string name="package_name">{PKG}</string>')
    s = s.replace(f'<string name="custom_url_scheme">{old}</string>', f'<string name="custom_url_scheme">{PKG}</string>')
open(sx, "w").write(s)

# 4b) build.gradle namespace + applicationId (cap sync does not always rewrite these)
bg = os.path.join(APP, "build.gradle")
b = open(bg).read()
b = re.sub(r'namespace "[^"]*"', f'namespace "{PKG}"', b)
b = re.sub(r'applicationId "[^"]*"', f'applicationId "{PKG}"', b)
open(bg, "w").write(b)

# 5) build (gradlew lives in android/, task is :app:assembleRelease)
import sys
AND = os.path.join(PROJ, "android")
result = subprocess.run(["./gradlew", ":app:assembleRelease", "--no-daemon"], cwd=AND, capture_output=True, text=True)
print(result.stdout[-5000:] if len(result.stdout) > 5000 else result.stdout)
if result.returncode != 0:
    print("STDERR:", result.stderr[-3000:] if len(result.stderr) > 3000 else result.stderr, file=sys.stderr)
    sys.exit(result.returncode)
print("BUILT", PKG)
