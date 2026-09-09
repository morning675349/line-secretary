#!/usr/bin/env python3
"""
產生 LINE 圖文選單底圖（2500x1686，3 欄 2 列共 6 格）。

輸出：public/richmenu.png
用法：python3 scripts/generate-richmenu.py

要改按鈕文字改下面 CELLS 一處，但記得 app/api/admin/richmenu/route.ts 的
areas 座標與 action 也要對應調整，兩邊格數必須一致，否則會按到錯的功能。

字型注意：macOS 的 Apple Color Emoji 只支援固定點陣尺寸（可用 160），
其他尺寸會丟 invalid pixel size，所以固定用 160 算完再放大。
"""
from PIL import Image, ImageDraw, ImageFont

W, H = 2500, 1686
COLS, ROWS = 3, 2
CW, CH = W // COLS, H // ROWS

ZH_BOLD = '/System/Library/Fonts/STHeiti Medium.ttc'
ZH_LIGHT = '/System/Library/Fonts/STHeiti Light.ttc'
EMOJI = '/System/Library/Fonts/Apple Color Emoji.ttc'
EMOJI_NATIVE = 160

# (emoji, 主標, 副標)
CELLS = [
    ('📸', '掃名片',  '拍照自動建檔'),
    ('📋', '待跟進',  '今天該聯絡誰'),
    ('🔍', '找人',    '姓名或公司'),
    ('📅', '今日行程', '日曆與會前情報'),
    ('💰', '業務戰情', '簽案與收款'),
    ('🎪', '展場模式', '連續掃名片'),
]


def gradient_bg():
    """深藍到深灰的垂直漸層，低調專業，白字對比夠。"""
    bg = Image.new('RGB', (1, H))
    top, bottom = (11, 18, 32), (26, 37, 61)
    px = bg.load()
    for y in range(H):
        t = y / (H - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return bg.resize((W, H))


def emoji_img(ch, target):
    """Apple Color Emoji 只能用固定尺寸算，算完再縮放到想要的大小。"""
    f = ImageFont.truetype(EMOJI, EMOJI_NATIVE)
    layer = Image.new('RGBA', (EMOJI_NATIVE * 2, EMOJI_NATIVE * 2), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((EMOJI_NATIVE // 2, EMOJI_NATIVE // 2), ch,
                               font=f, embedded_color=True, anchor='mm')
    return layer.crop(layer.getbbox()).resize((target, target), Image.LANCZOS)


def main():
    img = gradient_bg()
    d = ImageDraw.Draw(img, 'RGBA')

    f_title = ImageFont.truetype(ZH_BOLD, 104)
    f_sub = ImageFont.truetype(ZH_LIGHT, 52)

    for i, (emo, title, sub) in enumerate(CELLS):
        col, row = i % COLS, i // COLS
        cx = col * CW + CW // 2
        top = row * CH

        icon = emoji_img(emo, 230)
        img.paste(icon, (cx - icon.width // 2, top + 150), icon)

        d.text((cx, top + 500), title, font=f_title, fill=(255, 255, 255), anchor='ma')
        d.text((cx, top + 640), sub, font=f_sub, fill=(148, 163, 184), anchor='ma')

    # 格線：細且淡，只用來分隔，不搶視覺
    line = (255, 255, 255, 26)
    for c in range(1, COLS):
        d.line([(c * CW, 40), (c * CW, H - 40)], fill=line, width=3)
    d.line([(60, CH), (W - 60, CH)], fill=line, width=3)

    img.save('public/richmenu.png', 'PNG', optimize=True)
    print(f'已輸出 public/richmenu.png（{W}x{H}）')


if __name__ == '__main__':
    main()
