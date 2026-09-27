"""Outpost Aurelia colour math: sRGB -> CIE L*, WCAG contrast, anchor sampling.
Usage: python3 art/tools/colour.py contrast <bg> <fg>...   |  lstar <hex>...  |  sample <img> [k]"""
import sys

def rgb(h):
    h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def lin(c):
    c /= 255; return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def lum(h):
    r, g, b = (lin(v) for v in rgb(h)); return 0.2126 * r + 0.7152 * g + 0.0722 * b

def lstar(h):
    y = lum(h); return 116 * (y ** (1 / 3)) - 16 if y > 216 / 24389 else y * 24389 / 27

def contrast(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la + 0.05) / (lb + 0.05)

if __name__ == '__main__':
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'contrast':
        for fg in args[1:]:
            c = contrast(args[0], fg); print(f'{fg} on {args[0]}: {c:.2f}:1 {"PASS" if c >= 4.5 else "FAIL"}')
    elif cmd == 'lstar':
        for h in args: print(f'{h} L*={lstar(h):.1f}')
    elif cmd == 'sample':
        from PIL import Image
        import colorsys
        im = Image.open(args[0]).convert('RGB').resize((256, 256))
        q = im.quantize(int(args[1]) if len(args) > 1 else 32, method=Image.Quantize.MEDIANCUT, kmeans=3)
        pal = q.getpalette()
        for n, i in sorted(q.getcolors(), reverse=True):
            r, g, b = pal[i*3:i*3+3]; hx = '#%02x%02x%02x' % (r, g, b)
            h, l, s = colorsys.rgb_to_hls(r/255, g/255, b/255)
            print(f'{n:6d} {hx} L*={lstar(hx):5.1f} hue={h*360:5.0f} sat={s:.2f}')
