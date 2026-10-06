# Генератор тёмной темы: берёт styles.css, находит все объявления с цветами
# и пишет их тёмные копии под html[data-theme="dark"].
# python3 mkdark.py <styles.css> <out.css> <hue> <sat>
import re, sys, colorsys

src, out = sys.argv[1], sys.argv[2]
HUE, SAT = float(sys.argv[3]) / 360, float(sys.argv[4])
css = open(src).read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)

def parse(s):
    """-> list of (prelude, body_or_children, is_block_rule)"""
    i, n, items = 0, len(s), []
    while i < n:
        j = s.find('{', i)
        if j < 0: break
        pre = s[i:j].strip()
        depth, k = 1, j + 1
        while k < n and depth:
            if s[k] == '{': depth += 1
            elif s[k] == '}': depth -= 1
            k += 1
        body = s[j + 1:k - 1]
        if pre.startswith('@media') or pre.startswith('@supports'):
            items.append((pre, parse(body), True))
        elif pre.startswith('@'):
            pass  # keyframes, font-face — не трогаем
        else:
            items.append((pre, body, False))
        i = k
    return items

def hex2rgb(h):
    h = h.lstrip('#')
    if len(h) in (3, 4): h = ''.join(c * 2 for c in h[:3])
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

def fmt(r, g, b, a=None):
    R, G, B = (round(max(0, min(1, x)) * 255) for x in (r, g, b))
    return f'#{R:02x}{G:02x}{B:02x}' if a is None else f'rgba({R},{G},{B},{a:g})'

def lum(r, g, b): return 0.2126 * r + 0.7152 * g + 0.0722 * b

def neutral(r, g, b):
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return s < 0.32 or max(r, g, b) - min(r, g, b) < 0.13

def dark_surface(L):
    # светлые фоны -> тёмные: фон .88 -> .085, карточка .92 -> .125, поле 1.0 -> .2
    if L >= 0.88: return 0.085 + (L - 0.88) * 0.95
    return min(0.24, 0.125 + (0.92 - L) * 0.8)   # серые «кнопки на карточке» -> чуть светлее карточки

def light_text(L):
    return min(0.94, 0.95 - (L - 0.05) * 0.55)

def tint(L, extra_sat=0):
    return colorsys.hls_to_rgb(HUE, L, min(1, SAT + extra_sat))

def map_color(rgb, a, role):
    r, g, b = rgb
    if not neutral(r, g, b): return None
    L = lum(r, g, b)
    if a is not None and a < 1:
        if role == 'text': return None if L > 0.8 else fmt(*tint(0.9), a)
        if L > 0.8:   # полупрозрачный белый: «светлее фона»
            if role == 'shadow': return fmt(1, 1, 1, round(a * 0.06, 3))
            return fmt(*tint(0.5), round(min(1, a * 0.16), 3))
        if role == 'shadow': return fmt(0, 0, 0, round(min(.7, a * 1.6), 3))
        if L < 0.35:  # полупрозрачный тёмный: линии, рамки -> светлые линии
            return fmt(*tint(0.9), round(min(1, a * 1.15), 3))
        return None
    if role == 'text':
        if L > 0.8: return None           # белый текст на цветных кнопках остаётся белым
        return fmt(*tint(light_text(L)))
    if role == 'shadow': return None
    if L > 0.62: return fmt(*tint(dark_surface(L)))
    if L < 0.2: return fmt(*tint(0.9 - L))  # тёмные фоны (подсказки) -> светлые
    return fmt(*tint(light_text(L) * 0.75))

COL = re.compile(r'#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)')

def conv(val, role):
    changed = False
    def rep(m):
        nonlocal changed
        t = m.group(0)
        if t.startswith('#'):
            h = t[1:]
            if len(h) not in (3, 6): return t
            rgb, a = hex2rgb(t), None
        else:
            nums = [float(x) for x in re.findall(r'[\d.]+', t)]
            rgb, a = tuple(x / 255 for x in nums[:3]), (nums[3] if len(nums) > 3 else None)
        nv = map_color(rgb, a, role)
        if nv is None: return t
        changed = True
        return nv
    v = COL.sub(rep, val)
    return v if changed else None

def role_of(prop, name):
    if prop in ('color', 'caret-color', '-webkit-text-fill-color'): return 'text'
    if 'shadow' in prop: return 'shadow'
    if prop.startswith('--'):
        if 'shadow' in prop: return 'shadow'
        if any(k in prop for k in ('text', 'title', 'ink', 'body', 'muted', 'icon')): return 'text'
        if prop in ('--title', '--ink', '--body', '--muted', '--icon', '--text'): return 'text'
        return 'bg'
    return 'bg'

COLORISH = re.compile(r'^(background(-color|-image)?|color|border(-top|-bottom|-left|-right)?-color|fill|stroke|box-shadow|outline-color|filter|text-shadow)$')

def scope(sel):
    parts = []
    for s in sel.split(','):
        s = s.strip()
        if not s: continue
        if s.startswith(':root') or s.startswith('html'):
            s2 = re.sub(r'^(:root|html)', r'\1[data-theme="dark"]', s, 1)
            if s2.startswith(':root[data-theme="dark"]:where'): s2 = ':root[data-theme="dark"]'
            parts.append(s2)
        elif s.startswith('body'):
            parts.append('html[data-theme="dark"] ' + s)
        else:
            parts.append('html[data-theme="dark"] ' + s)
    return ', '.join(dict.fromkeys(parts))

def emit(items):
    outp = []
    for pre, body, block in items:
        if block:
            inner = emit(body)
            if inner.strip(): outp.append(f'{pre} {{\n{inner}}}\n')
            continue
        decls = []
        for d in body.split(';'):
            if ':' not in d: continue
            p, v = d.split(':', 1)
            p = p.strip(); v = v.strip()
            if not p: continue
            if re.match(r'^(border(-top|-bottom|-left|-right)?|outline)$', p):
                # шорткат: переносим только цвет, чтобы не сбить толщину из более поздних правил
                imp = ' !important' if '!important' in v else ''
                m = COL.search(v)
                if m:
                    c = conv(m.group(0), 'bg') or m.group(0)
                    decls.append(f'{p}-color: {c}{imp}')
                continue
            nv = conv(v, role_of(p, pre))
            if nv: decls.append(f'{p}: {nv}')
            elif COLORISH.match(p) and not p.startswith('--'): decls.append(f'{p}: {v}')
        if decls: outp.append(f'{scope(pre)} {{ ' + '; '.join(decls) + '; }\n')
    return ''.join(outp)

res = emit(parse(css))
extra = sys.argv[5] if len(sys.argv) > 5 else ''
if extra: res += open(extra).read()
bg = fmt(*tint(0.075))
res += f'''
html[data-theme="dark"] {{ color-scheme: dark; background: {bg}; }}
html[data-theme="dark"] body {{ background: {bg}; }}
'''
open(out, 'w').write(res)
print(len(res.splitlines()), 'lines')
