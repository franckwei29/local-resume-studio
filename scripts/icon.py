"""Regenerate the macOS icon using Pillow."""
from PIL import Image, ImageDraw

def make():
    im = Image.new("RGBA", (1024, 1024))
    pen = ImageDraw.Draw(im)
    pen.rounded_rectangle((60, 64, 964, 968), radius=205, fill="#244e42")
    pen.rounded_rectangle((55, 48, 969, 953), radius=205, fill="#326a56")
    pen.rounded_rectangle((255, 184, 765, 825), radius=38, fill="#fbf6e7")
    pen.rounded_rectangle((304, 242, 425, 773), radius=20, fill="#b4c8b3")
    pen.ellipse((327, 282, 402, 357), fill="#5c8172")
    for y, w in [(275, 214), (336, 145), (444, 214), (491, 175), (606, 204), (653, 158), (700, 178)]:
        pen.rounded_rectangle((466, y, 466+w, y+17), radius=8, fill="#416b5c" if y in [275,444,606] else "#a7b4a5")
    return im

make().save("assets/Studio.icns", format="ICNS")
