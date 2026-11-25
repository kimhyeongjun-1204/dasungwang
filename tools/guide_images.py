# 갤럭시 알림 안내 사진: 개인정보(이름·이어폰 이름·사이트 주소·상태표시줄) 잘라내고, 누를 곳에 노란 테두리
# 사용: python3 tools/guide_images.py <원본 스크린샷 폴더> guide   (원본은 개인정보가 있어 저장소에 넣지 않음)
import sys
from PIL import Image, ImageDraw, ImageFilter

A = sys.argv[1]
OUT = sys.argv[2]
HL = (255, 204, 0)
W = 540  # 결과 폭 (원본 1080의 절반)

def load(n):
    return Image.open(f'{A}/{n}-image.jpg').convert('RGB')

def blur(im, box):
    r = im.crop(box).filter(ImageFilter.GaussianBlur(18))
    im.paste(r, box[:2])

def cover(im, box, color):
    ImageDraw.Draw(im).rounded_rectangle(box, radius=10, fill=color)

def ring(im, box, kind='rect'):
    d = ImageDraw.Draw(im)
    if kind == 'circle':
        d.ellipse(box, outline=HL, width=10)
    else:
        d.rounded_rectangle(box, radius=40, outline=HL, width=10)

def save(im, crop, name):
    im = im.crop(crop)
    h = round(im.height * W / im.width)
    im.resize((W, h), Image.LANCZOS).save(f'{OUT}/{name}.jpg', quality=78, optimize=True, progressive=True)
    print(name, W, h)

# 파트 1 — 휴대폰 설정 (한 번만)
im = load('e7fe9454')                       # 설정 첫 화면: 위쪽 이름·이어폰 카드는 잘라냄
ring(im, (34, 1616, 1046, 1762))
save(im, (0, 1120, 1080, 1790), 'p1-1-settings')

im = load('e109e9da')                       # 설정 › 알림
ring(im, (34, 1742, 1046, 1886))
save(im, (0, 130, 1080, 1905), 'p1-2-noti')

im = load('e99a49f2')                       # 알림 › 고급 설정
ring(im, (30, 1752, 1050, 1990))
save(im, (0, 130, 1080, 2010), 'p1-3-advanced')

# 파트 2 — 다승왕 알림 설정
im = load('f75e135d')                       # 시험 알림: 사이트 주소(kimhyeo…) 가림
cover(im, (478, 340, 640, 400), (78, 78, 80))
ring(im, (26, 316, 1054, 530))
save(im, (0, 290, 1080, 560), 'p2-1-longpress')

im = load('1eda10be')                       # 길게 누른 뒤 ⚙
ring(im, (893, 360, 1017, 484), 'circle')
save(im, (0, 290, 1080, 560), 'p2-2-gear')

im = load('6141fdae')                       # 다승왕 알림 설정 › 알림 카테고리
ring(im, (34, 1924, 1046, 2072))
top, bot = im.crop((0, 130, 1080, 470)), im.crop((0, 1640, 1080, 2095))   # 가운데 그림 부분은 빼고 위(제목)·아래(알림 카테고리)만
both = Image.new('RGB', (1080, top.height + 30 + bot.height), (0, 0, 0))
both.paste(top, (0, 0)); both.paste(bot, (0, top.height + 30))
d = ImageDraw.Draw(both)
for x in (500, 540, 580): d.ellipse((x - 7, top.height + 8, x + 7, top.height + 22), fill=(110, 110, 120))
save(both, (0, 0, 1080, both.height), 'p2-3-category')

im = load('5ca6df42')                       # 알림 카테고리 › '일반' 글자(스위치 말고)
ring(im, (38, 566, 850, 712))
save(im, (0, 130, 1080, 740), 'p2-4-general')

im = load('503aa223')                       # 일반 › 팝업으로 표시
ring(im, (40, 1262, 1040, 1404))
save(im, (0, 300, 1080, 1430), 'p2-5-popup')
