import { useState, useMemo } from "react";

const OPEN_STRINGS = [4, 11, 7, 2, 9, 4]; // 1E, 2B, 3G, 4D, 5A, 6E

function buildFretMap(scaleSemitones, noteNames) {
  const semiToName = {};
  scaleSemitones.forEach((s, i) => { semiToName[s] = noteNames[i]; });
  const result = [];
  for (let strIdx = 0; strIdx < 6; strIdx++) {
    const open = OPEN_STRINGS[strIdx];
    const notes = [];
    for (let fret = 1; fret <= 21; fret++) {
      const semi = (open + fret) % 12;
      if (semiToName[semi] !== undefined) {
        notes.push([semiToName[semi], fret, semi]);
      }
    }
    result.push(notes);
  }
  return result;
}

function generatePositions(fretMap, scaleNotes) {
  const bNotes = fretMap[1];
  const allPairs = [];
  for (let i = 0; i < bNotes.length - 1; i++) {
    const n1 = bNotes[i], n2 = bNotes[i + 1];
    const idx1 = scaleNotes.indexOf(n1[0]);
    const idx2 = scaleNotes.indexOf(n2[0]);
    if (idx2 === (idx1 + 1) % 7) {
      if (allPairs.length === 0 || allPairs[allPairs.length - 1][0][0] !== n1[0]) {
        allPairs.push([n1, n2]);
      }
    }
  }
  const wantedPairs = allPairs.slice(1, 8);

  function getOrderedTrios(strIdx) {
    const available = fretMap[strIdx];
    const validTrios = [];
    for (let i = 0; i < available.length - 2; i++) {
      const trio = [available[i], available[i + 1], available[i + 2]];
      const i0 = scaleNotes.indexOf(trio[0][0]);
      const i1 = scaleNotes.indexOf(trio[1][0]);
      const i2 = scaleNotes.indexOf(trio[2][0]);
      if (i1 === (i0 + 1) % 7 && i2 === (i1 + 1) % 7) {
        validTrios.push(trio);
      }
    }
    return validTrios;
  }

  const e1T = getOrderedTrios(0), gT = getOrderedTrios(2);
  const dT = getOrderedTrios(3), aT = getOrderedTrios(4);

  return wantedPairs.map((bPair, i) => {
    const strings = [e1T[i]||null, bPair, gT[i]||null, dT[i]||null, aT[i]||null, e1T[i]||null];
    const frets = strings.filter(Boolean).flatMap(s => s.map(([, f]) => f));
    return {
      id: i + 1,
      bPair: bPair.map(([n]) => n).join(", "),
      range: frets.length ? `${Math.min(...frets)}–${Math.max(...frets)}` : "?",
      strings,
    };
  });
}

const MODES = [
  { key: "ionian", name: "Ionian", semi: [0,2,4,5,7,9,11], notes: ["C","D","E","F","G","A","B"],
    degrees: { C:"1", D:"2", E:"3", F:"4", G:"5", A:"6", B:"7" },
    chord: "Cmaj7", chordTones: ["C","E","G","B"], chordSub: "1 3 5 7" },
  { key: "dorian", name: "Dorian", semi: [0,2,3,5,7,9,10], notes: ["C","D","E♭","F","G","A","B♭"],
    degrees: { C:"1", D:"2", "E♭":"♭3", F:"4", G:"5", A:"6", "B♭":"♭7" },
    chord: "Cm7", chordTones: ["C","E♭","G","B♭"], chordSub: "1 ♭3 5 ♭7" },
  { key: "phrygian", name: "Phrygian", semi: [0,1,3,5,7,8,10], notes: ["C","D♭","E♭","F","G","A♭","B♭"],
    degrees: { C:"1", "D♭":"♭2", "E♭":"♭3", F:"4", G:"5", "A♭":"♭6", "B♭":"♭7" },
    chord: "Cm7", chordTones: ["C","E♭","G","B♭"], chordSub: "1 ♭3 5 ♭7" },
  { key: "lydian", name: "Lydian", semi: [0,2,4,6,7,9,11], notes: ["C","D","E","F#","G","A","B"],
    degrees: { C:"1", D:"2", E:"3", "F#":"#4", G:"5", A:"6", B:"7" },
    chord: "Cmaj7", chordTones: ["C","E","G","B"], chordSub: "1 3 5 7" },
  { key: "mixolydian", name: "Mixolydian", semi: [0,2,4,5,7,9,10], notes: ["C","D","E","F","G","A","B♭"],
    degrees: { C:"1", D:"2", E:"3", F:"4", G:"5", A:"6", "B♭":"♭7" },
    chord: "C7", chordTones: ["C","E","G","B♭"], chordSub: "1 3 5 ♭7" },
  { key: "aeolian", name: "Aeolian", semi: [0,2,3,5,7,8,10], notes: ["C","D","E♭","F","G","A♭","B♭"],
    degrees: { C:"1", D:"2", "E♭":"♭3", F:"4", G:"5", "A♭":"♭6", "B♭":"♭7" },
    chord: "Cm7", chordTones: ["C","E♭","G","B♭"], chordSub: "1 ♭3 5 ♭7" },
  { key: "locrian", name: "Locrian", semi: [0,1,3,5,6,8,10], notes: ["C","D♭","E♭","F","G♭","A♭","B♭"],
    degrees: { C:"1", "D♭":"♭2", "E♭":"♭3", F:"4", "G♭":"♭5", "A♭":"♭6", "B♭":"♭7" },
    chord: "Cm7♭5", chordTones: ["C","E♭","G♭","B♭"], chordSub: "1 ♭3 ♭5 ♭7" },
];

const POS_COLORS = ["#E74C3C","#E67E22","#F1C40F","#27AE60","#2980B9","#8E44AD","#16A085"];
const MODE_COLORS = {
  ionian: "#E74C3C", dorian: "#E67E22", phrygian: "#F1C40F", lydian: "#27AE60",
  mixolydian: "#2980B9", aeolian: "#8E44AD", locrian: "#16A085"
};
const STR_LABELS = ["e","B","G","D","A","E"];

export default function App() {
  const [modeIdx, setModeIdx] = useState(0);
  const [selPosId, setSelPosId] = useState(null);
  const [overlay, setOverlay] = useState(false);
  const [showCT, setShowCT] = useState(false);
  const [labelMode, setLabelMode] = useState("note");

  const mode = MODES[modeIdx];
  const fretMap = useMemo(() => buildFretMap(mode.semi, mode.notes), [modeIdx]);
  const allPos = useMemo(() => generatePositions(fretMap, mode.notes), [fretMap]);
  const ctSet = useMemo(() => new Set(mode.chordTones), [modeIdx]);
  const deg = mode.degrees;
  const selPos = selPosId != null ? allPos.find(p => p.id === selPosId) : null;

  const FC = 21, FW = 42, SG = 32, TP = 46, LP = 40;
  const W = LP + FC * FW + 20, H = TP + 5 * SG + 36;
  const DOTS = [3,5,7,9,12,15,17,19,21];
  const visible = overlay ? allPos : (selPos ? [selPos] : allPos);
  const dim = selPos && !overlay;

  function getLabel(nn) { return labelMode === "degree" ? (deg[nn] || nn) : nn; }

  function renderNote(pos, sIdx, n, f, posColor) {
    if (f < 1 || f > FC) return null;
    const cx = LP + (f - 0.5) * FW, cy = TP + sIdx * SG;
    const label = getLabel(n);
    const isRoot = n === "C";
    const isCT = showCT && ctSet.has(n);
    let fill = posColor, tc = "#FFF", r = 12, sk = "none", sw = 0;
    if (isRoot) { fill = "#FFF"; tc = posColor; r = 13; sk = posColor; sw = 2.5; }
    else if (showCT && !isCT) { fill = "#1a1a1a"; tc = "#555"; sk = posColor; sw = 1.5; r = 11; }
    return (
      <g key={`${pos.id}-${sIdx}-${f}`}>
        <circle cx={cx} cy={cy} r={r} fill={fill} stroke={sk} strokeWidth={sw}/>
        <text x={cx} y={cy + 3.5} textAnchor="middle"
          fontSize={label.length > 2 ? "7" : label.length > 1 ? "8" : "10"}
          fontWeight="700" fill={tc} fontFamily="monospace">{label}</text>
      </g>
    );
  }

  const btn = (active, extra = {}) => ({
    borderRadius: 4, cursor: "pointer", fontSize: 10,
    fontFamily: "'JetBrains Mono',monospace", padding: "5px 10px",
    border: "1px solid #444", background: active ? "#3a3a3a" : "#1a1a1a",
    color: "#CCC", ...extra
  });

  const handleModeChange = (i) => { setModeIdx(i); };

  return (
    <div style={{ background: "#0f0f0f", color: "#DDD", minHeight: "100vh",
      fontFamily: "'JetBrains Mono','Fira Code',monospace", padding: "16px" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 2, letterSpacing: 1 }}>
          Berklee 7-Position System
        </h2>
        <p style={{ fontSize: 10, color: "#555", marginBottom: 12 }}>
          B弦2音 + 他弦3音 ｜ 7モード対応
        </p>

        {/* Mode selector */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {MODES.map((m, i) => {
              const active = modeIdx === i;
              const c = MODE_COLORS[m.key];
              return <button key={m.key} onClick={() => handleModeChange(i)}
                style={btn(active, { border: `1px solid ${c}`,
                  background: active ? c : "#1a1a1a", color: active ? "#FFF" : c,
                  fontWeight: active ? 700 : 400 })}>C {m.name}</button>;
            })}
          </div>
        </div>

        <div style={{ fontSize: 11, color: "#777", marginBottom: 4 }}>
          <span style={{ color: MODE_COLORS[mode.key], fontWeight: 700 }}>C {mode.name}</span>
          <span style={{ color: "#555", marginLeft: 8 }}>{mode.notes.join(" ")}</span>
        </div>
        <div style={{ fontSize: 10, color: "#555", marginBottom: 10 }}>
          {mode.chord}: {mode.chordTones.join(" ")} ({mode.chordSub})
        </div>

        {/* Positions */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
          <button onClick={() => { setSelPosId(null); setOverlay(false); }} style={btn(!selPos && !overlay)}>全表示</button>
          {allPos.map((p, i) => {
            const c = POS_COLORS[i];
            return <button key={p.id} onClick={() => { setSelPosId(p.id); setOverlay(false); }}
              style={btn(selPosId === p.id, { border: `1px solid ${c}`,
                background: selPosId === p.id ? c : "#1a1a1a",
                color: selPosId === p.id ? "#FFF" : c,
                fontWeight: selPosId === p.id ? 700 : 400 })}>Pos {p.id}</button>;
          })}
          <button onClick={() => { setOverlay(true); setSelPosId(null); }}
            style={btn(overlay, { border: "1px solid #666" })}>重ねる</button>
        </div>

        {/* Options */}
        <div style={{ display: "flex", gap: 14, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontSize: 10, color: "#666", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={showCT} onChange={e => setShowCT(e.target.checked)}/>
            {mode.chord} コードトーン強調
          </label>
          <div style={{ display: "flex", gap: 4 }}>
            <span style={{ fontSize: 10, color: "#666" }}>ラベル:</span>
            {[["note","音名"],["degree","度数"]].map(([k, v]) =>
              <button key={k} onClick={() => setLabelMode(k)}
                style={btn(labelMode === k, { padding: "3px 8px", fontSize: 9 })}>{v}</button>
            )}
          </div>
          {showCT && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 10 }}>
              <span style={{ color: "#666" }}>|</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ display: "inline-block", width: 13, height: 13, borderRadius: "50%",
                  background: "#FFF", border: "2px solid #888" }}/><span style={{ color: "#999" }}>Root</span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ display: "inline-block", width: 13, height: 13, borderRadius: "50%",
                  background: "#888" }}/><span style={{ color: "#999" }}>CT</span>
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                <span style={{ display: "inline-block", width: 11, height: 11, borderRadius: "50%",
                  background: "#1a1a1a", border: "1.5px solid #888" }}/><span style={{ color: "#666" }}>非CT</span>
              </span>
            </div>
          )}
        </div>

        {/* SVG Fretboard */}
        <div style={{ overflowX: "auto", marginBottom: 14 }}>
          <svg width={W} height={H} style={{ background: "#161616", borderRadius: 8, display: "block" }}>
            {Array.from({ length: FC }, (_, i) => i + 1).map(f =>
              <text key={f} x={LP + (f - 0.5) * FW} y={TP - 26} textAnchor="middle"
                fontSize="9" fill="#444" fontFamily="monospace">{f}</text>)}
            <line x1={LP} y1={TP - 4} x2={LP} y2={TP + 5 * SG + 4} stroke="#999" strokeWidth="5"/>
            {Array.from({ length: FC }, (_, i) => i + 1).map(f =>
              <line key={f} x1={LP + f * FW} y1={TP - 4} x2={LP + f * FW} y2={TP + 5 * SG + 4}
                stroke="#2a2a2a" strokeWidth="1"/>)}
            {DOTS.map(f => f === 12 ? (
              <g key={f}>
                <circle cx={LP + (f - 0.5) * FW} cy={TP + 1.5 * SG} r="3" fill="#2a2a2a"/>
                <circle cx={LP + (f - 0.5) * FW} cy={TP + 3.5 * SG} r="3" fill="#2a2a2a"/>
              </g>
            ) : <circle key={f} cx={LP + (f - 0.5) * FW} cy={TP + 2.5 * SG} r="3" fill="#2a2a2a"/>)}
            {Array.from({ length: 6 }, (_, s) => (
              <g key={s}>
                <line x1={LP} y1={TP + s * SG} x2={LP + FC * FW} y2={TP + s * SG}
                  stroke={s === 1 ? "#887766" : "#555"} strokeWidth={s === 1 ? 1.2 : 0.7 + s * 0.3}/>
                <text x={LP - 22} y={TP + s * SG + 4} textAnchor="middle"
                  fontSize="11" fill={s === 1 ? "#aa9977" : "#666"} fontWeight="600" fontFamily="monospace">
                  {STR_LABELS[s]}</text>
              </g>
            ))}
            <text x={LP + FC * FW + 12} y={TP + 1 * SG + 4} textAnchor="start"
              fontSize="8" fill="#665544" fontFamily="monospace">★2音</text>
            {visible.map(pos => {
              const c = POS_COLORS[pos.id - 1];
              return (
                <g key={pos.id} opacity={(!dim || selPosId === pos.id) ? 1 : 0.07}>
                  {pos.strings.map((notes, sIdx) =>
                    notes && notes.map(([n, f]) => renderNote(pos, sIdx, n, f, c))
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {/* Detail panel */}
        {selPos && (
          <div style={{ background: "#1a1a1a", borderRadius: 8, padding: 14,
            borderLeft: `4px solid ${POS_COLORS[selPos.id - 1]}`, marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: POS_COLORS[selPos.id - 1], marginBottom: 6 }}>
              C {mode.name} — Position {selPos.id}
            </div>
            <div style={{ fontSize: 10, color: "#555", marginBottom: 8 }}>
              fret {selPos.range} ｜ B弦: {selPos.bPair}
            </div>
            <div style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.7, color: "#666",
              background: "#141414", padding: "8px 10px", borderRadius: 4 }}>
              {STR_LABELS.map((sl, sIdx) => {
                const notes = selPos.strings[sIdx];
                if (!notes) return null;
                const is2 = notes.length === 2;
                return (
                  <div key={sIdx} style={{ color: is2 ? POS_COLORS[selPos.id - 1] : "#777" }}>
                    <span style={{ display: "inline-block", width: 16, fontWeight: is2 ? 700 : 400 }}>{sl}</span>
                    |{notes.map(([n, f]) => {
                      const lbl = getLabel(n);
                      const isRoot = n === "C";
                      const isCT = showCT && ctSet.has(n);
                      const m = isRoot ? "●" : (isCT ? "◆" : " ");
                      return `--${String(f).padStart(2)}(${lbl.padEnd(2)})${m}`;
                    }).join("")}--|{is2 ? " ★" : ""}
                  </div>
                );
              })}
            </div>
            {showCT && (
              <div style={{ fontSize: 10, color: "#666", marginTop: 6 }}>
                {mode.chord}: {mode.chordTones.map(n => `${n}(${deg[n]})`).join(" ")}
              </div>
            )}
          </div>
        )}

        {/* Position grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
          gap: 6, marginBottom: 14 }}>
          {allPos.map((p, i) => {
            const c = POS_COLORS[i];
            return (
              <div key={p.id} onClick={() => { setSelPosId(p.id); setOverlay(false); }}
                style={{ background: selPosId === p.id ? "#222" : "#181818",
                  borderRadius: 6, padding: "8px 12px", cursor: "pointer",
                  borderLeft: `3px solid ${c}`, transition: "all 0.15s" }}>
                <span style={{ color: c, fontWeight: 700, fontSize: 12 }}>Pos {p.id}</span>
                <div style={{ color: "#555", fontSize: 10, marginTop: 2 }}>
                  fret {p.range} ｜ B弦: {p.bPair}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ fontSize: 10, color: "#444", lineHeight: 1.8, borderTop: "1px solid #222", paddingTop: 10 }}>
          <strong style={{ color: "#666" }}>使い方:</strong>{" "}
          7つのポジション形状は全モード共通。モード切替で音名・フレット位置が変化し、同じ形が指板上の異なる場所に現れる。
          コードトーン強調で Cmaj7 / C7 / Cm7 / Cm7♭5 を比較可能。
        </div>
      </div>
    </div>
  );
}
