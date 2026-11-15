// khost: headless offline renderer for Spectrasonics Keyscape (AU v2, loaded in-process).
//
//   khost --state state.plist --events ev.json --out out.wav [--sr 48000] [--warm 8] [--tail 6]
//   khost --dump-state default.plist            (write the plugin's default fullState)
//
// SSH sessions cannot see the system AU registry, so the component's factory is dlopen'ed and
// registered for this process only. state.plist = AU fullState (music/keyscape.py builds it from a
// factory .prt_key patch). ev.json = {"events": [[t_sec, status, d1, d2], ...]} sorted by time.
// Output: 32-bit float stereo WAV, sample-accurate event timing (events are scheduled with in-block
// offsets), rendered with kAudioUnitProperty_OfflineRender = 1 so disk streaming never drops voices.
import AVFoundation
import AudioToolbox
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
func die(_ s: String) -> Never { FileHandle.standardError.write((s + "\n").data(using: .utf8)!); exit(1) }

var args: [String: String] = [:]
var it = CommandLine.arguments.dropFirst().makeIterator()
while let a = it.next() { if a.hasPrefix("--") { args[String(a.dropFirst(2))] = it.next() ?? "" } }

let SR = Double(args["sr"] ?? "48000")!
let bin = args["plugin"] ?? "/Library/Audio/Plug-Ins/Components/Keyscape.component/Contents/MacOS/Keyscape"
guard let h = dlopen(bin, RTLD_NOW) else { die("dlopen: \(String(cString: dlerror()))") }
guard let sym = dlsym(h, "CVST2AUPluginFactory") else { die("no CVST2AUPluginFactory") }
var desc = AudioComponentDescription(componentType: kAudioUnitType_MusicDevice,
                                     componentSubType: 0x4B73746E /* Kstn */,
                                     componentManufacturer: 0x474F5357 /* GOSW */,
                                     componentFlags: 0, componentFlagsMask: 0)
_ = AudioComponentRegister(&desc, "Keyscape (khost)" as CFString, 66816,
                           unsafeBitCast(sym, to: AudioComponentFactoryFunction.self))

let sem = DispatchSemaphore(value: 0)
var unitOpt: AVAudioUnit?
AVAudioUnit.instantiate(with: desc, options: [.loadInProcess]) { u, e in
    if let e { print("instantiate error:", e) }
    unitOpt = u; sem.signal()
}
sem.wait()
guard let unit = unitOpt else { die("instantiate failed") }
let au = unit.auAudioUnit

if let p = args["dump-state"] {
    let d = try PropertyListSerialization.data(fromPropertyList: au.fullState ?? [:], format: .xml, options: 0)
    try d.write(to: URL(fileURLWithPath: p)); print("wrote", p); exit(0)
}

guard let statePath = args["state"], let evPath = args["events"], let outPath = args["out"] else {
    die("usage: khost --state s.plist --events ev.json --out o.wav [--sr 48000] [--warm 8] [--tail 6]")
}

// ---- engine (offline manual rendering) ----
let engine = AVAudioEngine()
engine.attach(unit)
let fmt = AVAudioFormat(standardFormatWithSampleRate: SR, channels: 2)!
engine.connect(unit, to: engine.mainMixerNode, format: fmt)
let maxFrames: AVAudioFrameCount = 512
try engine.enableManualRenderingMode(.offline, format: fmt, maximumFrameCount: maxFrames)
var one: UInt32 = 1
AudioUnitSetProperty(unit.audioUnit, kAudioUnitProperty_OfflineRender, kAudioUnitScope_Global, 0, &one, 4)

// state after the engine knows the sample rate, so the plugin loads samples for it
let stData = try Data(contentsOf: URL(fileURLWithPath: statePath))
guard let st = try PropertyListSerialization.propertyList(from: stData, format: nil) as? [String: Any] else { die("bad state") }
au.fullState = st
try engine.start()

// Spectrasonics loads sample preloads asynchronously after a state change: give it wall-clock time,
// pulling silent blocks meanwhile (some engines only make progress while being rendered).
let buf = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: maxFrames)!
let warm = Double(args["warm"] ?? "8")!
let t0 = Date()
while Date().timeIntervalSince(t0) < warm {
    _ = try engine.renderOffline(maxFrames, to: buf)
    usleep(2000)
}

// ---- events ----
let evData = try Data(contentsOf: URL(fileURLWithPath: evPath))
guard let evRoot = try JSONSerialization.jsonObject(with: evData) as? [String: Any],
      let evs = evRoot["events"] as? [[Double]] else { die("bad events json") }
let events: [(Int64, UInt8, UInt8, UInt8)] = evs.map { (Int64(($0[0] * SR).rounded()), UInt8($0[1]), UInt8($0[2]), UInt8($0[3])) }
    .sorted { $0.0 < $1.0 }
let tail = Double(args["tail"] ?? "6")!
let total = Int64(((events.last.map { Double($0.0) / SR } ?? 0) + tail) * SR)
guard let midi = au.scheduleMIDIEventBlock else { die("no MIDI block") }

// ---- render ----
var outL = [Float](); var outR = [Float]()
outL.reserveCapacity(Int(total)); outR.reserveCapacity(Int(total))
var pos: Int64 = 0, ei = 0
let started = Date()
while pos < total {
    let n = AVAudioFrameCount(min(Int64(maxFrames), total - pos))
    while ei < events.count && events[ei].0 < pos + Int64(n) {
        let e = events[ei]
        let off = max(0, e.0 - pos)
        var bytes: [UInt8] = (e.1 & 0xF0) == 0xC0 || (e.1 & 0xF0) == 0xD0 ? [e.1, e.2] : [e.1, e.2, e.3]
        midi(AUEventSampleTimeImmediate + off, 0, bytes.count, &bytes)
        ei += 1
    }
    let s = try engine.renderOffline(n, to: buf)
    guard s == .success else { die("render status \(s.rawValue) at \(pos)") }
    let l = buf.floatChannelData![0], r = buf.floatChannelData![1]
    for i in 0..<Int(n) { outL.append(l[i]); outR.append(r[i]) }
    pos += Int64(n)
}
engine.stop()

// ---- write float WAV ----
var peak: Float = 0
for i in 0..<outL.count { peak = max(peak, abs(outL[i]), abs(outR[i])) }
// plain RIFF/WAVE, format 3 (IEEE float), interleaved stereo
var inter = [Float](repeating: 0, count: outL.count * 2)
for i in 0..<outL.count { inter[2 * i] = outL[i]; inter[2 * i + 1] = outR[i] }
var wav = Data()
func u32(_ v: UInt32) { var x = v.littleEndian; wav.append(Data(bytes: &x, count: 4)) }
func u16(_ v: UInt16) { var x = v.littleEndian; wav.append(Data(bytes: &x, count: 2)) }
let dataBytes = UInt32(inter.count * 4)
wav.append("RIFF".data(using: .ascii)!); u32(36 + dataBytes); wav.append("WAVE".data(using: .ascii)!)
wav.append("fmt ".data(using: .ascii)!); u32(16); u16(3); u16(2); u32(UInt32(SR)); u32(UInt32(SR) * 8); u16(8); u16(32)
wav.append("data".data(using: .ascii)!); u32(dataBytes)
inter.withUnsafeBufferPointer { wav.append(Data(buffer: $0)) }
try wav.write(to: URL(fileURLWithPath: outPath))
print(String(format: "rendered %.2fs in %.1fs, %d events, peak %.1f dBFS -> %@",
             Double(outL.count) / SR, Date().timeIntervalSince(started), events.count,
             20 * log10(max(peak, 1e-9)), outPath))
