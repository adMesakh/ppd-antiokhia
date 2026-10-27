# Ubah gambar QR (PNG) menjadi video Y4M untuk kamera palsu Chromium saat pengujian.
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
W, H = 640, 480
bg = Image.new("RGB", (W, H), (60, 55, 50))
qr = Image.open(src).convert("RGB")
side = 300
qr = qr.resize((side, side), Image.NEAREST)
bg.paste(qr, ((W - side) // 2, (H - side) // 2))
ycbcr = bg.convert("YCbCr")
y, cb, cr = ycbcr.split()
cb = cb.resize((W // 2, H // 2))
cr = cr.resize((W // 2, H // 2))
frame = y.tobytes() + cb.tobytes() + cr.tobytes()
with open(out, "wb") as f:
    f.write(f"YUV4MPEG2 W{W} H{H} F10:1 Ip A1:1 C420jpeg\n".encode())
    for _ in range(20):
        f.write(b"FRAME\n")
        f.write(frame)
print("ok")
