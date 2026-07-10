#!/usr/bin/env bash
# 每次 `expo prebuild` 生成 android/ 后运行本脚本，把 Gradle 分发和常用仓库
# 全部改成国内镜像，避免 dl.google.com / services.gradle.org / repo1.maven.org
# 在墙内不可达时构建失败。
#
# 使用：
#   pnpm --filter @yuanai/mobile prebuild:clean       # 内置了本脚本
#   或 pnpm --filter @yuanai/mobile android:mirror    # 已 prebuild 后单跑
#
# 幂等：多次执行结果相同（用 aliyun.com 标记跳过重复注入）。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="$ROOT/android"

if [ ! -d "$ANDROID_DIR" ]; then
  echo "❌ android/ 目录不存在，请先执行 expo prebuild"
  exit 1
fi

# 1. gradle-wrapper.properties：分发包走腾讯镜像
WRAPPER_PROPS="$ANDROID_DIR/gradle/wrapper/gradle-wrapper.properties"
if [ -f "$WRAPPER_PROPS" ]; then
  version=$(grep -oE 'gradle-[0-9]+\.[0-9]+(\.[0-9]+)?-(all|bin)\.zip' "$WRAPPER_PROPS" | head -1 || true)
  if [ -n "$version" ]; then
    tencent_url="https\\://mirrors.cloud.tencent.com/gradle/${version}"
    sed -i.bak -E \
      "s|^distributionUrl=.*|distributionUrl=${tencent_url}|" \
      "$WRAPPER_PROPS"
    rm -f "$WRAPPER_PROPS.bak"
    echo "✅ gradle-wrapper: ${version} → 腾讯云"
  fi
fi

# 2. android/build.gradle：把 buildscript.repositories 和 allprojects.repositories
#    前置阿里云镜像；不删除原始 google() / mavenCentral()，让 Gradle 按顺序回退
BUILD_GRADLE="$ANDROID_DIR/build.gradle"
if [ -f "$BUILD_GRADLE" ] && ! grep -q "aliyun.com" "$BUILD_GRADLE"; then
  python3 - <<PY
import re
p = "$BUILD_GRADLE"
s = open(p, encoding='utf-8').read()
mirrors = """        maven { url 'https://maven.aliyun.com/repository/google'; name 'aliyun-google' }
        maven { url 'https://maven.aliyun.com/repository/central'; name 'aliyun-central' }
        maven { url 'https://maven.aliyun.com/repository/public'; name 'aliyun-public' }
        maven { url 'https://maven.aliyun.com/repository/gradle-plugin'; name 'aliyun-plugin' }
"""
# buildscript { ... repositories { \n
s = re.sub(
    r'(buildscript\s*\{[^}]*?repositories\s*\{\s*\n)',
    r'\1' + mirrors,
    s, count=1, flags=re.S,
)
# allprojects { ... repositories { \n
s = re.sub(
    r'(allprojects\s*\{[^}]*?repositories\s*\{\s*\n)',
    r'\1' + mirrors,
    s, count=1, flags=re.S,
)
open(p, 'w', encoding='utf-8').write(s)
PY
  echo "✅ build.gradle: 已注入阿里云镜像（google / central / public / plugin）"
fi

# 3. settings.gradle：在顶部已有的 pluginManagement 块里追加 repositories 镜像
#    Gradle 要求 pluginManagement 必须在文件开头，不能在末尾另开一个
SETTINGS="$ANDROID_DIR/settings.gradle"
if [ -f "$SETTINGS" ] && ! grep -q "aliyun.com" "$SETTINGS"; then
  python3 - <<PY
import re
p = "$SETTINGS"
s = open(p, encoding='utf-8').read()

repos_block = """    repositories {
        maven { url 'https://maven.aliyun.com/repository/gradle-plugin'; name 'aliyun-plugin' }
        maven { url 'https://maven.aliyun.com/repository/public'; name 'aliyun-public' }
        maven { url 'https://maven.aliyun.com/repository/google'; name 'aliyun-google' }
        gradlePluginPortal()
    }
"""
# 在首个 pluginManagement { 后紧跟插入 repositories
s2, n = re.subn(
    r'(pluginManagement\s*\{\s*\n)',
    r'\1' + repos_block,
    s, count=1,
)
if n == 0:
    # 没有 pluginManagement 块，就在文件顶部插入一个
    s2 = "pluginManagement {\n" + repos_block + "}\n\n" + s
open(p, 'w', encoding='utf-8').write(s2)
PY
  echo "✅ settings.gradle: 已在 pluginManagement 中注入 repositories 镜像"
fi

echo ""
echo "🎉 完成。可以 pnpm --filter @yuanai/mobile android"
