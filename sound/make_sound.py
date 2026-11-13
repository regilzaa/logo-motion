"""Builds the whole soundtrack in code from timing.json (same cue times as the picture).
Writes out/sound_raw.wav, then masters to -14 LUFS integrated / -1 dBTP (gain + 4x-oversampled
true-peak limiter, measured with ffmpeg ebur128) -> out/logo_motion_sound.wav (48 kHz, 24-bit stereo).
If ./sfx/<cue>.wav exists (ambience, charge, zap, impact, crackle, tick, shimmer, sting, sweep)
it replaces the synthesised cue, placed at the same time."""
import json, os, subprocess, sys
import numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = json.load(open(os.path.join(ROOT, 'timing.json')))
E = T['events']
SR = 48000
DUR = T['duration']
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(20261113)
mix = np.zeros((N, 2))


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'bandpass', fs=SR, output='sos'), x)


def lp(x, f, order=2):
    return sosfilt(butter(order, f, 'lowpass', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, 'highpass', fs=SR, output='sos'), x)


def env(t0, a, d, shape=1.0):
    """attack a, exponential decay d (seconds), starting at t0"""
    x = t - t0
    e = np.where(x < 0, 0, np.where(x < a, (x / max(a, 1e-6)) ** shape, np.exp(-(x - a) / d)))
    return e


def place(sig, t0, gain=1.0, pan=0.0):
    """add a mono or stereo signal starting at t0 seconds, equal-power pan (-1..1)"""
    i0 = int(round(t0 * SR))
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l, sig * r], 1)
    n = min(len(sig), N - i0)
    if n > 0:
        mix[i0:i0 + n] += sig[:n] * gain


def user_sfx(name):
    p = os.path.join(ROOT, 'sfx', name + '.wav')
    if not os.path.exists(p):
        return None
    sr, x = wavfile.read(p)
    x = x.astype(np.float64)
    if x.dtype.kind == 'i' or np.abs(x).max() > 1.5:
        x /= np.abs(x).max() + 1e-9
    if sr != SR:
        idx = np.arange(int(len(x) * SR / sr)) * sr / SR
        x = np.stack([np.interp(idx, np.arange(len(x)), x[:, c] if x.ndim > 1 else x) for c in range(x.shape[1] if x.ndim > 1 else 1)], 1)
    return x


def cue(name, t0, synth, gain=1.0, pan=0.0):
    s = user_sfx(name)
    place(s if s is not None else synth(), t0, gain, pan)


# ---- ambience bed: low drone + dark noise, decorrelated L/R --------------------------------
def ambience():
    drone = 0.5 * np.sin(2 * np.pi * 41 * t) + 0.35 * np.sin(2 * np.pi * 41.6 * t + 1) + 0.2 * np.sin(2 * np.pi * 82.3 * t)
    nl, nr = lp(rng.standard_normal(N), 260, 4), lp(rng.standard_normal(N), 260, 4)
    fade = np.clip(t / 0.4, 0, 1) * np.where(t < E['hold_start'], 1, np.exp(-(t - E['hold_start']) / 0.35))
    return np.stack([(drone * 0.5 + nl * 2.5) * fade, (drone * 0.5 + nr * 2.5) * fade], 1)


cue('ambience', 0, ambience, 0.10)

# ---- city pulse: soft low blips on each pulse peak -------------------------------------------
for k in range(3):
    tp = E['city_pulse_start'] + k * 0.45 + 0.0
    if tp < E['charge_start']:
        x = np.arange(int(0.25 * SR)) / SR
        place(np.sin(2 * np.pi * 220 * x) * np.exp(-x / 0.06) * np.minimum(1, x / 0.01), tp, 0.05, -0.4)

# ---- charge hum: rising, harmonically rich, cut dead at FIRE ---------------------------------
def charge():
    a, b = E['charge_start'], E['fire']
    L = int((b - a + 0.02) * SR)
    x = np.arange(L) / SR
    p = np.clip(x / (b - a), 0, 1)
    f = 70 * (1 + 4.0 * p ** 2)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = sum(np.sin(ph * h) / h for h in range(1, 7))
    trem = 1 + 0.25 * np.sin(2 * np.pi * (8 + 30 * p) * x)
    riser = bp(rng.standard_normal(L), 800, 6000) * p ** 3 * 0.6
    amp = p ** 1.6 * np.clip((L / SR - x) / 0.01, 0, 1)
    return (s * trem * 0.5 + riser) * amp


cue('charge', E['charge_start'], charge, 0.33, -0.35)

# ---- laser zap on FIRE: falling chirp + crack, sweeps left -> right with the beam ---------------
def zap():
    L = int(0.6 * SR)
    x = np.arange(L) / SR
    f = 300 + 2700 * np.exp(-x / 0.06)
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = (np.sin(ph) + 0.4 * np.sign(np.sin(ph * 2.01)) * 0.5) * np.exp(-x / 0.18)
    crack = hp(rng.standard_normal(L), 2500) * np.exp(-x / 0.02)
    s = tone * 0.7 + crack * 0.5
    pan = np.clip(x / 0.5, 0, 1) * 1.4 - 0.6
    return np.stack([s * np.cos((pan + 1) * np.pi / 4), s * np.sin((pan + 1) * np.pi / 4)], 1)


cue('zap', E['fire'], zap, 0.45)

# ---- impact boom with sub ---------------------------------------------------------------
def impact():
    L = int(1.6 * SR)
    x = np.arange(L) / SR
    f = 30 + 45 * np.exp(-x / 0.12)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x / 0.55) * np.minimum(1, x / 0.004)
    body = lp(rng.standard_normal(L), 900, 4) * np.exp(-x / 0.25) * 3.0
    click = hp(rng.standard_normal(L), 3000) * np.exp(-x / 0.006)
    return sub * 1.0 + body * 0.35 + click * 0.35


cue('impact', E['impact'], impact, 0.75, 0.3)

# ---- trace crackles + a tick on every new path start ----------------------------------------
def crackle():
    a, b = E['trace_start'], E['trace_end']
    L = int((b - a + 0.1) * SR)
    imp = np.zeros(L)
    n = int((b - a) * 90)
    pos = rng.integers(0, L - 1, n)
    imp[pos] = rng.uniform(0.3, 1.0, n) * rng.choice([-1, 1], n)
    s = bp(imp, 1800, 7000) * 6 + bp(rng.standard_normal(L), 3000, 9000) * 0.08
    x = np.arange(L) / SR
    return s * np.clip(x / 0.05, 0, 1) * np.clip((L / SR - x) / 0.1, 0, 1)


cue('crackle', E['trace_start'], crackle, 0.22, 0.15)
for i, tp in enumerate(T['trace_paths']):
    def tick():
        x = np.arange(int(0.08 * SR)) / SR
        return np.sin(2 * np.pi * 2400 * x) * np.exp(-x / 0.012) + hp(rng.standard_normal(len(x)), 4000) * np.exp(-x / 0.004) * 0.4
    cue('tick', tp['start'], tick, 0.16, [-0.3, 0.3, 0.1, -0.1, 0.0][i % 5])

# ---- resolve: bright shimmer + soft sting, ringing out to silence by 5.00 ----------------------
end_fade = np.clip((DUR - 0.03 - t) / 0.5, 0, 1) ** 2   # guarantees silence at 5.00


def shimmer():
    L = N - int(E['trace_end'] * SR)
    x = np.arange(L) / SR
    s = np.zeros((L, 2))
    for k, f in enumerate([2093, 2637, 3136, 4186, 5274]):
        for c in range(2):
            det = 1 + (0.003 if c else -0.003) * (k + 1)
            s[:, c] += np.sin(2 * np.pi * f * det * x + k) / (k + 1.5)
    e = np.minimum(1, x / 0.08) * np.exp(-x / 0.55)
    return s * e[:, None]


def sting():
    L = N - int(E['trace_end'] * SR)
    x = np.arange(L) / SR
    s = np.zeros(L)
    for f, g in [(110, 0.8), (164.8, 0.5), (220, 0.6), (277.2, 0.35), (329.6, 0.3), (493.9, 0.18)]:
        ph = 2 * np.pi * f * x
        s += g * (np.sin(ph) + 0.25 * np.sin(2 * ph) + 0.1 * np.sin(3 * ph))
    e = np.minimum(1, x / 0.015) * np.exp(-x / 0.6)
    return lp(s, 2500) * e


cue('shimmer', E['trace_end'], shimmer, 0.07)
cue('sting', E['trace_end'], sting, 0.16)

# ---- light sweep: a faint airy whoosh ---------------------------------------------------------
def sweep():
    a, b = E['light_sweep']
    L = int((b - a) * SR)
    x = np.arange(L) / SR
    p = x / (b - a)
    s = bp(rng.standard_normal(L), 3000, 10000) * np.sin(np.pi * p) ** 2
    pan = p * 1.6 - 0.8
    return np.stack([s * np.cos((pan + 1) * np.pi / 4), s * np.sin((pan + 1) * np.pi / 4)], 1)


cue('sweep', E['light_sweep'][0], sweep, 0.05)

mix *= end_fade[:, None]
mix = hp(mix.T, 22).T                       # remove DC / infrasonic rumble
mix /= np.abs(mix).max() + 1e-9
mix *= 0.5
os.makedirs(os.path.join(ROOT, 'out'), exist_ok=True)
raw = os.path.join(ROOT, 'out', 'sound_raw.wav')
wavfile.write(raw, SR, (mix * 2147483647).astype(np.int32))

# ---- master: gain to -14 LUFS integrated, 4x-oversampled true-peak limiter at -1.2 dBTP ----------
from scipy.signal import resample_poly
from scipy.ndimage import minimum_filter1d


def lufs(x):
    p = os.path.join(ROOT, 'out', '_meter.wav')
    wavfile.write(p, SR, x.astype(np.float32))
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', p, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    os.remove(p)
    tail = r[r.rindex('Summary:'):]
    I = float(tail.split('I:')[1].split('LUFS')[0]); TP = float(tail.split('Peak:')[1].split('dBFS')[0])
    return I, TP


def limit(x, ceiling_db=-1.2, look=0.005, release=0.06):
    thr = 10 ** (ceiling_db / 20)
    os_ = np.abs(resample_poly(x, 4, 1, axis=0)).max(1).reshape(-1, 4).max(1)[:len(x)]
    g = np.minimum(1.0, thr / np.maximum(os_, 1e-9))
    w = int(look * SR)
    g = minimum_filter1d(g, size=2 * w + 1)                 # look-ahead: reduce before the peak
    a = np.exp(-1 / (release * SR)); out = np.empty_like(g); cur = 1.0
    for i in range(len(g)):                                 # instant attack, smooth release
        cur = g[i] if g[i] < cur else a * cur + (1 - a) * g[i]
        out[i] = cur
    k = np.hanning(2 * w + 1); k /= k.sum()
    out = np.minimum(out, np.convolve(out, k, 'same'))
    return x * out[:, None]


y = mix.copy()
for _ in range(4):
    I, TP = lufs(y)
    y *= 10 ** ((-14.0 - I) / 20)
    y = limit(y)
I, TP = lufs(y)
y *= end_fade[:, None]
out = os.path.join(ROOT, 'out', 'logo_motion_sound.wav')
wavfile.write(os.path.join(ROOT, 'out', '_f.wav'), SR, y.astype(np.float32))
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', os.path.join(ROOT, 'out', '_f.wav'), '-c:a', 'pcm_s24le', out], check=True)
os.remove(os.path.join(ROOT, 'out', '_f.wav'))
chk = subprocess.run(['ffmpeg', '-hide_banner', '-i', out, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
print(chk[chk.rindex('Summary:'):])
