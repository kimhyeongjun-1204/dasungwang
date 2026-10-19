# 홈 화면 아이콘 만들기 (한 번만): python tools/make_icons.py → icons/*.png
# images.css의 --img-pig(돼장 이미지, WebP base64)를 정사각형으로 잘라 분홍 배경 위에 올림. Pillow 필요.
import base64, io, os, re
from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
css = open(os.path.join(root, 'images.css'), encoding='utf-8').read()
b64 = re.search(r'--img-pig:\s*url\(data:image/webp;base64,([A-Za-z0-9+/=]+)\)', css).group(1)
src = Image.open(io.BytesIO(base64.b64decode(b64))).convert('RGBA')
s = min(src.size)
left, top = (src.width - s) // 2, (src.height - s) // 2
sq = src.crop((left, top, left + s, top + s))

os.makedirs(os.path.join(root, 'icons'), exist_ok=True)
for size in (180, 192, 512):
    bg = Image.new('RGBA', (size, size), (0xFF, 0xD1, 0xDC, 255))  # .pig 배경색 #FFD1DC
    bg.alpha_composite(sq.resize((size, size), Image.LANCZOS))
    name = 'apple-touch-icon.png' if size == 180 else 'icon-%d.png' % size
    bg.convert('RGB').save(os.path.join(root, 'icons', name), optimize=True)
    print(name, size)
