const fs = require('fs');
const content = fs.readFileSync('src/components/SyncAudioPlayer.tsx', 'utf8');

const startMarker = '{/* Unified Vertical Mixing Console (EQ + Processing) */}';
const endMarker = '<strong>טיפ לתמלול מדויק:</strong> השתמש ב\"תמלול מדויק\" או \"דיבור ברור\" — חיזוק תדרי דיבור (1-5kHz) מעלה משמעותית את דיוק זיהוי המילים. לקול טלפוני השתמש ב\"תיקון טלפון\". שלב עם הפחתת רעש ברמה 40-60% לתוצאה מיטבית.\\n                  </span>\\n                </div>';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker) + endMarker.length;

if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
  console.error('Markers not found');
  process.exit(1);
}

const newStr = \{/* Unified Mixing Console (EQ + Processing) */}
                <div className="space-y-3">
                  {/* EQ Section */}
                  {eqViewMode === 'vertical' && (
                    <div className="grid grid-cols-[repeat(15,minmax(0,1fr))] gap-0.5 overflow-x-auto pb-2">
                      {[
                        { label: '31', freq: '31Hz', value: eq31, set: setEq31, min: -12, max: 12, step: 0.5, color: 'text-red-400' },
                        { label: '63', freq: '63Hz', value: eq63, set: setEq63, min: -12, max: 12, step: 0.5, color: 'text-red-400' },
                        { label: '125', freq: '125Hz', value: eq125, set: setEq125, min: -12, max: 12, step: 0.5, color: 'text-orange-400' },
                        { label: '250', freq: '250Hz', value: eq250, set: setEq250, min: -12, max: 12, step: 0.5, color: 'text-orange-400' },
                        { label: '500', freq: '500Hz', value: eq500, set: setEq500, min: -12, max: 12, step: 0.5, color: 'text-yellow-400' },
                        { label: '1k', freq: '1kHz', value: eq1k, set: setEq1k, min: -12, max: 12, step: 0.5, color: 'text-yellow-400' },
                        { label: '2k', freq: '2kHz', value: eq2k, set: setEq2k, min: -12, max: 12, step: 0.5, color: 'text-green-400' },
                        { label: '4k', freq: '4kHz', value: eq4k, set: setEq4k, min: -12, max: 12, step: 0.5, color: 'text-green-400' },
                        { label: '8k', freq: '8kHz', value: eq8k, set: setEq8k, min: -12, max: 12, step: 0.5, color: 'text-blue-400' },
                        { label: '16k', freq: '16kHz', value: eq16k, set: setEq16k, min: -12, max: 12, step: 0.5, color: 'text-blue-400' },
                      ].map((band) => (
                        <div key={band.freq} className="flex flex-col items-center gap-0.5 min-w-[20px]">
                          <span className={\\\	ext-[7px] font-mono \\\\}>{band.value > 0 ? '+' : ''}{band.value}</span>
                          <div className="h-24 flex items-center">
                            <Slider
                              orientation="vertical"
                              value={[band.value]}
                              min={band.min}
                              max={band.max}
                              step={band.step}
                              onValueChange={([v]) => band.set(v)}
                              className="h-full w-2"
                            />
                          </div>
                          <span className="text-[7px] font-medium leading-tight text-center">{band.label}</span>
                        </div>
                      ))}
                      <div className="w-px bg-border/40 min-h-[4rem] self-center mx-1"></div>
                      {[
                        { label: 'HP', freq: 'חתך', value: manualHighpass, min: 20, max: 400, step: 10, color: 'text-purple-400',
                          display: \\\\\\\, set: (v) => { setManualHighpass(v); if (isManualMode && highpassRef.current) highpassRef.current.frequency.value = v; } },
                        { label: 'LP', freq: 'חתך', value: manualLowpass, min: 6000, max: 20000, step: 250, color: 'text-pink-400',
                          display: \\\\k\\\, set: (v) => { setManualLowpass(v); if (isManualMode && lowpassRef.current) lowpassRef.current.frequency.value = v; } },
                        { label: 'קול', freq: 'חיזוק', value: manualVoiceBoost, min: 0, max: 12, step: 0.5, color: 'text-cyan-400',
                          display: \\\+\\\\, set: (v) => { setManualVoiceBoost(v); if (isManualMode && voiceBoostRef.current) voiceBoostRef.current.gain.value = v; } },
                        { label: 'יחס', freq: 'דחיסה', value: manualCompRatio, min: 1, max: 12, step: 0.5, color: 'text-amber-400',
                          display: \\\\:1\\\, set: (v) => { setManualCompRatio(v); if (isManualMode && compressorRef.current) { compressorRef.current.ratio.value = v; compressorRef.current.threshold.value = -50 + (v > 1 ? -(v * 3) : 0); } } },
                        { label: 'Gate', freq: 'סף', value: manualGate, min: -80, max: 0, step: 5, color: 'text-emerald-400',
                          display: manualGate === 0 ? 'כבוי' : \\\\\\\, set: (v) => setManualGate(v) },
                      ].map((ctrl) => (
                        <div key={ctrl.label} className="flex flex-col items-center gap-0.5 min-w-[24px]">
                          <span className={\\\	ext-[7px] font-mono \\\\}>{ctrl.display}</span>
                          <div className="h-24 flex items-center">
                            <Slider
                              orientation="vertical"
                              value={[ctrl.value]}
                              min={ctrl.min}
                              max={ctrl.max}
                              step={ctrl.step}
                              onValueChange={([v]) => ctrl.set(v)}
                              className="h-full w-2"
                            />
                          </div>
                          <span className="text-[7px] font-medium leading-tight text-center">{ctrl.label}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {eqViewMode === 'horizontal' && (
                    <div className="space-y-3">
                      <p className="text-[10px] font-medium text-muted-foreground">אקולייזר לרוחב</p>
                      {[
                        { label: '31Hz', value: eq31, set: setEq31 },
                        { label: '63Hz', value: eq63, set: setEq63 },
                        { label: '125Hz', value: eq125, set: setEq125 },
                        { label: '250Hz', value: eq250, set: setEq250 },
                        { label: '500Hz', value: eq500, set: setEq500 },
                        { label: '1kHz', value: eq1k, set: setEq1k },
                        { label: '2kHz', value: eq2k, set: setEq2k },
                        { label: '4kHz', value: eq4k, set: setEq4k },
                        { label: '8kHz', value: eq8k, set: setEq8k },
                        { label: '16kHz', value: eq16k, set: setEq16k },
                      ].map((band) => (
                        <div key={band.label} className="space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-muted-foreground">{band.value > 0 ? '+' : ''}{band.value}dB</span>
                            <span className="text-[10px] font-medium">{band.label}</span>
                          </div>
                          <Slider
                            value={[band.value]}
                            min={-12}
                            max={12}
                            step={0.5}
                            onValueChange={([v]) => band.set(v)}
                          />
                        </div>
                      ))}
                      <Separator />
                      <p className="text-[10px] font-medium text-muted-foreground">עיבוד נוסף</p>
                      {[
                        { label: 'חתך בסים (Highpass)', value: manualHighpass, min: 20, max: 400, step: 10, display: \\\\Hz\\\, set: (v) => { setManualHighpass(v); if (isManualMode && highpassRef.current) highpassRef.current.frequency.value = v; } },
                        { label: 'חתך היי (Lowpass)', value: manualLowpass, min: 6000, max: 20000, step: 250, display: \\\\k\\\, set: (v) => { setManualLowpass(v); if (isManualMode && lowpassRef.current) lowpassRef.current.frequency.value = v; } },
                        { label: 'חיזוק קול', value: manualVoiceBoost, min: 0, max: 12, step: 0.5, display: \\\\\dB\\\, set: (v) => { setManualVoiceBoost(v); if (isManualMode && voiceBoostRef.current) voiceBoostRef.current.gain.value = v; } },
                        { label: 'דחיסה', value: manualCompRatio, min: 1, max: 12, step: 0.5, display: \\\\:1\\\, set: (v) => { setManualCompRatio(v); if (isManualMode && compressorRef.current) { compressorRef.current.ratio.value = v; compressorRef.current.threshold.value = -50 + (v > 1 ? -(v * 3) : 0); } } },
                        { label: 'סף שער רעש (Gate)', value: manualGate, min: -80, max: 0, step: 5, display: manualGate === 0 ? 'כבוי' : \\\\dB\\\, set: (v) => setManualGate(v) },
                      ].map((ctrl) => (
                        <div key={ctrl.label} className="space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-mono text-muted-foreground">{ctrl.display}</span>
                            <span className="text-[10px] font-medium">{ctrl.label}</span>
                          </div>
                          <Slider
                            value={[ctrl.value]}
                            min={ctrl.min}
                            max={ctrl.max}
                            step={ctrl.step}
                            onValueChange={([v]) => ctrl.set(v)}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {eqViewMode === 'circular' && (
                    <div className="flex flex-col gap-4 overflow-x-auto pb-2 items-center">
                      <div className="flex flex-wrap items-center justify-center gap-4 max-w-[280px]">
                        {[
                          { label: '31', value: eq31, set: setEq31 },
                          { label: '63', value: eq63, set: setEq63 },
                          { label: '125', value: eq125, set: setEq125 },
                          { label: '250', value: eq250, set: setEq250 },
                          { label: '500', value: eq500, set: setEq500 },
                          { label: '1k', value: eq1k, set: setEq1k },
                          { label: '2k', value: eq2k, set: setEq2k },
                          { label: '4k', value: eq4k, set: setEq4k },
                          { label: '8k', value: eq8k, set: setEq8k },
                          { label: '16k', value: eq16k, set: setEq16k },
                        ].map((b) => (
                          <Knob key={b.label} label={b.label} value={b.value} min={-12} max={12} onChange={(v) => b.set(v)} />
                        ))}
                      </div>
                      <Separator className="w-full" />
                      <div className="flex flex-wrap items-center justify-center gap-4 max-w-[280px]">
                        {[
                          { label: 'HP', value: manualHighpass, min: 20, max: 400, set: (v) => { setManualHighpass(v); if (isManualMode && highpassRef.current) highpassRef.current.frequency.value = v; } },
                          { label: 'LP', value: manualLowpass / 100, min: 60, max: 200, set: (v) => { setManualLowpass(v * 100); if (isManualMode && lowpassRef.current) lowpassRef.current.frequency.value = v * 100; } },
                          { label: 'Voc', value: manualVoiceBoost, min: 0, max: 12, set: (v) => { setManualVoiceBoost(v); if (isManualMode && voiceBoostRef.current) voiceBoostRef.current.gain.value = v; } },
                          { label: 'Comp', value: manualCompRatio, min: 1, max: 12, set: (v) => { setManualCompRatio(v); if (isManualMode && compressorRef.current) { compressorRef.current.ratio.value = v; compressorRef.current.threshold.value = -50 + (v > 1 ? -(v * 3) : 0); } } },
                          { label: 'Gate', value: manualGate, min: -80, max: 0, set: (v) => setManualGate(v) },
                        ].map((c) => (
                          <Knob key={c.label} label={c.label} value={c.value} min={c.min} max={c.max} onChange={(v) => c.set(v)} />
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-center gap-2 pt-2">
                    <Button variant="ghost" size="sm" className="h-6 px-3 text-[10px]" onClick={() => {
                      setEq31(0); setEq63(0); setEq125(0); setEq250(0); setEq500(0); setEq1k(0); setEq2k(0); setEq4k(0); setEq8k(0); setEq16k(0);
                    }}>
                      אפס אקולייזר
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 px-3 text-[10px]" onClick={() => {
                      setManualHighpass(80); setManualLowpass(16000); setManualVoiceBoost(0); setManualCompRatio(1); setManualGate(0);
                    }}>
                      אפס עיבוד
                    </Button>
                  </div>

                  <div className="text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2 flex items-start gap-1.5">
                    <Brain className="w-3 h-3 mt-0.5 shrink-0 text-primary no-theme-icon" />
                    <span>
                      <strong>טיפ לתמלול מדויק:</strong> השתמש ב"תמלול מדויק" או "דיבור ברור" — חיזוק תדרי דיבור (1-5kHz) מעלה משמעותית את דיוק זיהוי המילים. לקול טלפוני השתמש ב"תיקון טלפון". שלב עם הפחתת רעש ברמה 40-60% לתוצאה מיטבית.
                    </span>
                  </div>
                </div>\;

const newContent = content.slice(0, startIndex) + newStr + content.slice(endIndex);
fs.writeFileSync('src/components/SyncAudioPlayer.tsx', newContent);
console.log('Replaced successfully!');
