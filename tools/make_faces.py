# docs/ref/faces/face_*.png(256px, 투명 배경, 다른 AI가 원본 캐릭터에서 얼굴만 다시 그림)를
# 72px WebP base64로 줄여 images.css의 --face-* 변수로 넣음. 화면에선 24px(3배 화면까지 선명). Pillow 필요.
# 실행: python tools/make_faces.py
import base64, io, os, re
from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'docs', 'ref', 'faces')
path = os.path.join(root, 'images.css')
css = open(path, encoding='utf-8').read()
css = re.sub(r'\n  --face-\w+: url\([^)]*\);', '', css)  # 다시 돌려도 중복 없게
lines = []
for k in ['cv', 'lb', 'bf', 'lm', 'pk', 'ck']:
    im = Image.open(os.path.join(src, 'face_%s.png' % k)).convert('RGBA').resize((72, 72), Image.LANCZOS)
    buf = io.BytesIO(); im.save(buf, 'WEBP', quality=90, method=6)
    lines.append('  --face-%s: url(data:image/webp;base64,%s);' % (k, base64.b64encode(buf.getvalue()).decode()))
    print(k, len(buf.getvalue()), 'bytes')
i = css.rindex('}')
css = css[:i].rstrip('\n') + '\n' + '\n'.join(lines) + '\n' + css[i:]
open(path, 'w', encoding='utf-8').write(css)
