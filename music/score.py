#!/usr/bin/env python3
"""Minimal standard-MIDI-file reader (stdlib only) -> notes in BEATS (quarter notes), not seconds.

Timing in the film is decided later (music/build.py maps beats -> film seconds from anchors), so the
file's own tempo is ignored on purpose; only pitches, beat positions, durations, track and the
time-signature map (for bar numbers) are kept.

  python3 music/score.py music/scores/bwv988-aria.mid      # summary: tracks, meter, bars
"""
import struct, sys
from dataclasses import dataclass


@dataclass
class Note:
    beat: float      # onset, quarter notes from the start of the file
    dur: float       # quarter notes
    pitch: int
    vel: int         # as written in the file (usually flat; build.py re-shapes dynamics)
    track: int


@dataclass
class Score:
    notes: list
    meters: list     # [(beat, num, den)]
    pedal: list      # [(beat, value)] CC64 if the file has any
    length: float    # beats (last note-off)
    tracks: list     # track names

    def bar_beat(self, bar, beat_in_bar=0.0):
        """Beat position of a 1-based bar number (+ quarter-note offset inside the bar)."""
        b = 1; pos = 0.0
        ms = self.meters + [(float('inf'), 0, 0)]
        for (m0, num, den), (m1, _, _) in zip(ms, ms[1:]):
            bl = num * 4.0 / den
            nbars = (m1 - m0) / bl if m1 != float('inf') else float('inf')
            if bar < b + nbars:
                return m0 + (bar - b) * bl + beat_in_bar
            b += round(nbars); pos = m1
        raise ValueError(bar)

    def bar_len(self, beat):
        cur = self.meters[0]
        for m in self.meters:
            if m[0] <= beat + 1e-9:
                cur = m
        return cur[1] * 4.0 / cur[2]

    def beat_in_bar(self, beat):
        """Quarter-note offset of `beat` from the start of its bar (meter changes respected)."""
        ms = self.meters
        m0, num, den = ms[0]
        for m in ms:
            if m[0] <= beat + 1e-9:
                m0, num, den = m
        return (beat - m0) % (num * 4.0 / den)

    def bars(self):
        """Number of complete bars (approx. for pickup-less files)."""
        n = 0; pos = 0.0
        while pos < self.length - 1e-6:
            pos += self.bar_len(pos); n += 1
        return n


def _vlq(d, i):
    v = 0
    while True:
        c = d[i]; i += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, i


def read(path):
    d = open(path, 'rb').read()
    assert d[:4] == b'MThd'
    fmt, ntrk, div = struct.unpack('>HHH', d[8:14])
    assert not div & 0x8000, 'SMPTE time division not supported'
    i = 8 + struct.unpack('>I', d[4:8])[0]
    notes, meters, pedal, names = [], [], [], []
    for tn in range(ntrk):
        assert d[i:i + 4] == b'MTrk'
        ln = struct.unpack('>I', d[i + 4:i + 8])[0]
        j, end = i + 8, i + 8 + ln
        tick, run, on, name = 0, 0, {}, ''
        while j < end:
            dt, j = _vlq(d, j); tick += dt
            st = d[j]
            if st == 0xFF:
                typ = d[j + 1]; l, j = _vlq(d, j + 2); data = d[j:j + l]; j += l
                if typ == 0x58:
                    meters.append((tick / div, data[0], 2 ** data[1]))
                elif typ == 0x03:
                    name = data.decode('latin1')
                continue
            if st in (0xF0, 0xF7):
                l, j = _vlq(d, j + 1); j += l; continue
            if st & 0x80:
                run = st; j += 1
            else:
                st = run
            hi = st & 0xF0
            if hi in (0xC0, 0xD0):
                j += 1; continue
            a, b = d[j], d[j + 1]; j += 2
            if hi == 0x90 and b > 0:
                on.setdefault(a, []).append((tick, b))
            elif hi == 0x80 or (hi == 0x90 and b == 0):
                if on.get(a):
                    t0, v = on[a].pop(0)
                    notes.append(Note(t0 / div, (tick - t0) / div, a, v, tn))
            elif hi == 0xB0 and a == 64:
                pedal.append((tick / div, b))
        names.append(name)
        i = end
    notes.sort(key=lambda n: (n.beat, n.pitch))
    meters = sorted(set(meters)) or [(0.0, 4, 4)]
    if meters[0][0] > 0:
        meters.insert(0, (0.0,) + meters[0][1:])
    # collapse duplicate meter events at the same beat (multi-track files repeat them)
    dedup = {}
    for m in meters:
        dedup[m[0]] = m
    meters = [dedup[k] for k in sorted(dedup)]
    length = max((n.beat + n.dur for n in notes), default=0.0)
    return Score(notes, meters, sorted(pedal), length, names)


if __name__ == '__main__':
    for p in sys.argv[1:]:
        s = read(p)
        print(p)
        print('  tracks', [(k, nm, sum(1 for n in s.notes if n.track == k)) for k, nm in enumerate(s.tracks)])
        print('  meters', s.meters[:6], ' length', round(s.length, 3), 'beats  bars', s.bars())
        print('  pitch range', min(n.pitch for n in s.notes), max(n.pitch for n in s.notes), ' pedal events', len(s.pedal))
