"""Download a small, traceable Wikimedia Commons scenic photo gallery.

Only public Commons metadata and images are requested; no local data is uploaded.
Run from any directory with Python, requests and Pillow installed.
"""
from pathlib import Path
import hashlib
import html
import io
import json
import re
import time
from datetime import datetime, timezone

import requests
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "gallery"
DEST = ROOT / "Todo工作台" / "风景图库"
PHOTOS = [
    ("01-moraine-lake.jpg", "冰川蓝湖 · 加拿大", "Moraine Lake 17092005.jpg"),
    ("02-altai-lake.jpg", "山间静湖 · 阿尔泰", "Middle Multinskoe - Panoramic.jpg"),
    ("03-mount-shasta.jpg", "雪峰湖畔 · 沙斯塔山", "Mount Shasta, Lake Siskiyou, SW view.jpg"),
    ("04-coast-blue-hour.jpg", "蓝调海岸 · 葡萄牙", "Seascape after sunset denoised.jpg"),
    ("05-coast-sunset.jpg", "海上落日 · 葡萄牙", "Sunset 2007-1.jpg"),
    ("06-snow-mont-blanc.jpg", "雪山全景 · 勃朗峰", "Snow on mountain panorama.jpg"),
    ("07-foggy-forest.jpg", "雾中森林 · 宾夕法尼亚", "Foggy woods.jpeg"),
    ("08-autumn-lake.jpg", "秋色湖畔 · 芬兰", "Autumn landscape at lake Äkäslompolo, Kolari, Lapland, Finland, 2023 September.jpg"),
    ("09-kirkjufell.jpg", "瀑布彩虹 · 冰岛", "Kirkjufell, Iceland, 20240714 1631 0713.jpg"),
]


def plain(value):
    return html.unescape(re.sub(r"<[^>]+>", "", value)).strip()


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers["User-Agent"] = "TodoDashboardGallery/1.0 (personal Obsidian scenic banner collection)"
    response = session.get("https://commons.wikimedia.org/w/api.php", params={
        "action": "query", "format": "json", "titles": "|".join("File:" + p[2] for p in PHOTOS),
        "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 1920,
    }, timeout=60)
    response.raise_for_status()
    raw = response.json()
    (DEST / "commons-imageinfo.json").write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
    pages = {v["title"]: v for v in raw["query"]["pages"].values()}
    records = []
    for filename, label, title in PHOTOS:
        info = pages["File:" + title]["imageinfo"][0]
        meta = info["extmetadata"]
        val = lambda key: plain(str(meta.get(key, {}).get("value", "")))
        license_name = val("LicenseShortName")
        if not (license_name.startswith("CC BY") or license_name in ("CC0", "Public domain")):
            raise RuntimeError(f"Unreviewed license: {title}: {license_name}")
        target = DEST / filename
        download_url = info.get("thumburl", info["url"])
        if not target.exists():
            image_response = session.get(download_url, timeout=90)
            image_response.raise_for_status()
            picture = ImageOps.exif_transpose(Image.open(io.BytesIO(image_response.content))).convert("RGB")
            if picture.width <= picture.height:
                raise RuntimeError("Portrait image rejected: " + title)
            if picture.width > 1920:
                picture.resize((1920, round(picture.height * 1920 / picture.width)), Image.Resampling.LANCZOS).save(target, quality=90, optimize=True)
            else:
                picture.save(target, quality=90, optimize=True)
            time.sleep(1)
        with Image.open(target) as picture:
            width, height = picture.size
        records.append({
            "file": filename, "label": label, "title": title,
            "author": val("Artist"), "attribution": val("Attribution") or val("Artist"), "source_url": info["descriptionurl"],
            "original_url": info["url"], "download_url": download_url,
            "license": license_name,
            "license_url": val("LicenseUrl") or "https://commons.wikimedia.org/wiki/Template:PD-self",
            "attribution_required": val("AttributionRequired") == "true",
            "changes": "Resized by Wikimedia Commons to ~1920 px wide; JPEG re-encoded (quality 90); no crop, no AI generation or editing. Banner may be displayed with a temporary CSS crop.",
            "width": width, "height": height, "bytes": target.stat().st_size,
            "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            "retrieved_at": datetime.now(timezone.utc).isoformat(),
        })
        print(filename, license_name, width, height, target.stat().st_size, flush=True)
    (DEST / "SOURCE_LICENSES.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    lines = ["# 真实风景图库：来源与授权", "", "本图库为真实摄影作品，来自 Wikimedia Commons；不是 AI 生成。图片仅作缩放和 JPEG 编码，未裁剪。工作台横幅显示时可能通过 CSS 临时裁剪。", "", "请在复制、分享或发布图库时保留本文件和 SOURCE_LICENSES.json。CC BY 作品须署名并附许可证链接；CC BY-SA 作品的改编须以相同或兼容许可证发布。公共领域作品仍保留来源以便追溯。插件代码的许可证不覆盖这些独立图片。", ""]
    for item in records:
        lines += [f"## {item['label']}", "", f"- 文件：`{item['file']}` ({item['width']} × {item['height']})", f"- 作品：{item['title']}", f"- 作者：{item['author']}", f"- 署名：{item['attribution']}", f"- 来源：{item['source_url']}", f"- 授权：[{item['license']}]({item['license_url']})", "- 修改：仅缩放及 JPEG 编码；无 AI 处理。", ""]
    (DEST / "SOURCE_LICENSES.md").write_text("\n".join(lines), encoding="utf-8")
    sheet = Image.new("RGB", (1200, 675), "#142228")
    draw = ImageDraw.Draw(sheet)
    for index, item in enumerate(records):
        x, y = (index % 3) * 400, (index // 3) * 225
        with Image.open(DEST / item["file"]) as picture:
            # Preview the actual wide banner treatment, not an edited deliverable.
            thumb = ImageOps.fit(picture, (388, 184), centering=(0.5, 0.5))
        sheet.paste(thumb, (x + 6, y + 6))
        draw.text((x + 10, y + 196), item["file"], fill="white")
    sheet.save(ROOT / "contact-sheet.jpg", quality=92)
    print("TOTAL", sum(r["bytes"] for r in records), flush=True)


if __name__ == "__main__":
    main()
