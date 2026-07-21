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
subprocess.run(["npx", "cap", "sync", "android"], cwd=PROJ, check=True)

# 3) fix MainActivity package declaration + physical location
found = None
for root, _, files in os.walk(os.path.join(APP, "src", "main", "java")):
    if "MainActivity.java" in files:
        found = os.path.join(root, "MainActivity.java")
        break
content = open(found).read()
content = re.sub(r'^package .*;', f'package {PKG};', content, flags=re.M)
dst_dir = os.path.join(APP, "src", "main", "java", *PKG.split("."))
os.makedirs(dst_dir, exist_ok=True)
dst = os.path.join(dst_dir, "MainActivity.java")
open(dst, "w").write(content)
if os.path.abspath(dst) != os.path.abspath(found):
    os.remove(found)
    p = os.path.dirname(found)
    while p != os.path.join(APP, "src", "main", "java"):
        if not os.listdir(p):
            os.rmdir(p)
        p = os.path.dirname(p)

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
AND = os.path.join(PROJ, "android")
subprocess.run(["./gradlew", ":app:assembleRelease", "--no-daemon"], cwd=AND, check=True)

# 6) rename apk to package name
apk_dir = os.path.join(APP, "build", "outputs", "apk", "release")
if os.path.exists(apk_dir):
    for f in os.listdir(apk_dir):
        if f.endswith(".apk") and "unaligned" not in f and "unsigned" not in f:
            src = os.path.join(apk_dir, f)
            dst = os.path.join(apk_dir, f"{PKG}-release.apk")
            if src != dst:
                os.rename(src, dst)
                print(f"Renamed {f} -> {PKG}-release.apk")
            print("BUILT", PKG)
            break
