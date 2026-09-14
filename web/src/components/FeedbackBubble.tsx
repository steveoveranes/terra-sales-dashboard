import { useEffect, useRef, useState } from 'react';

// 🐛 Feedback / bug bubble — a faithful rebuild of TerraFlow's floating feedback
// button. A red→orange FAB (bottom-right) opens a 2-step recorder:
//   1. Record: share a screen/tab/window + microphone, with a live Dutch speech
//      transcript (Web Speech API). Max 1:30.
//   2. Review: watch the clip, edit the transcript, add a note, and send.
// The submission (video + text + transcript + page context) is POSTed to our own
// backend and stored in Postgres (video on disk).

const API_BASE = ((import.meta as any).env?.VITE_API_BASE ?? '').replace(/\/+$/, '');
const MAX_SECONDS = 90;

type Step = 'record' | 'review';

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const r = String(s % 60).padStart(2, '0');
  return `${m}:${r}`;
}

export default function FeedbackBubble() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('record');

  const [recording, setRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [videoUrl, setVideoUrl] = useState('');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [transcript, setTranscript] = useState('');
  const [text, setText] = useState('');
  const [recordError, setRecordError] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [successMsg, setSuccessMsg] = useState('');
  const [allowSkip, setAllowSkip] = useState(false);

  // refs for the live recording machinery
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const videoBlobRef = useRef<Blob | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);
  const liveTranscriptRef = useRef('');

  const recordingSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    !!navigator.mediaDevices.getDisplayMedia &&
    typeof (window as any).MediaRecorder !== 'undefined';
  const speechSupported =
    typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  useEffect(() => {
    return () => cleanupStreams();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cleanupStreams() {
    [screenStreamRef.current, micStreamRef.current].forEach((s) => {
      if (s) try { s.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
    });
    screenStreamRef.current = null;
    micStreamRef.current = null;
  }

  function resetAll() {
    stopRecordingInternal();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoBlobRef.current = null;
    chunksRef.current = [];
    setStep('record');
    setRecording(false);
    setRecordDuration(0);
    setVideoUrl('');
    setLiveTranscript('');
    liveTranscriptRef.current = '';
    setTranscript('');
    setText('');
    setRecordError('');
    setError('');
    setSubmitting(false);
    setUploadProgress(0);
    setSuccessMsg('');
    setAllowSkip(false);
  }

  function closeModal() {
    if (recording) stopRecordingInternal();
    cleanupStreams();
    setOpen(false);
    // give the close animation a beat, then reset for next time
    setTimeout(resetAll, 50);
  }

  async function startRecording() {
    setRecordError('');
    if (!recordingSupported) {
      setRecordError('Deze browser ondersteunt geen schermopname.');
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: true,
      });
      screenStreamRef.current = screen;
      try {
        micStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        micStreamRef.current = null;
      }

      const tracks: MediaStreamTrack[] = [...screen.getVideoTracks()];
      // include the shared-audio track if any, plus the microphone
      screen.getAudioTracks().forEach((t) => tracks.push(t));
      if (micStreamRef.current) micStreamRef.current.getAudioTracks().forEach((t) => tracks.push(t));
      const combined = new MediaStream(tracks);

      let mimeType = '';
      const MR: typeof MediaRecorder = (window as any).MediaRecorder;
      if (MR.isTypeSupported('video/webm;codecs=vp9,opus')) mimeType = 'video/webm;codecs=vp9,opus';
      else if (MR.isTypeSupported('video/webm;codecs=vp8,opus')) mimeType = 'video/webm;codecs=vp8,opus';
      else if (MR.isTypeSupported('video/webm')) mimeType = 'video/webm';

      const recorder = new MR(combined, mimeType ? { mimeType, videoBitsPerSecond: 800000 } : { videoBitsPerSecond: 800000 });
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => finalizeRecording();
      screen.getVideoTracks()[0].onended = () => {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') stopRecording();
      };

      recorder.start(1000);
      startRef.current = Date.now();
      setRecordDuration(0);
      setRecording(true);
      setLiveTranscript('');
      liveTranscriptRef.current = '';
      startSpeech();

      timerRef.current = setInterval(() => {
        const d = Math.floor((Date.now() - startRef.current) / 1000);
        setRecordDuration(d);
        if (d >= MAX_SECONDS) stopRecording();
      }, 500);
    } catch (err: any) {
      setRecordError('Opname geannuleerd: ' + (err?.message || err?.name || 'onbekend'));
      cleanupStreams();
    }
  }

  function startSpeech() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    try {
      const rec = new SR();
      rec.lang = 'nl-NL';
      rec.continuous = true;
      rec.interimResults = true;
      let finalText = '';
      rec.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) finalText += res[0].transcript + ' ';
          else interim += res[0].transcript;
        }
        const t = (finalText + interim).trim();
        liveTranscriptRef.current = t;
        setLiveTranscript(t);
      };
      rec.onerror = () => { /* ignore */ };
      rec.onend = () => {
        if (recorderRef.current && recorderRef.current.state === 'recording' && speechRef.current) {
          try { speechRef.current.start(); } catch { /* noop */ }
        }
      };
      speechRef.current = rec;
      rec.start();
    } catch {
      speechRef.current = null;
    }
  }

  function stopRecordingInternal() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (speechRef.current) {
      try { speechRef.current.onend = null; speechRef.current.stop(); } catch { /* noop */ }
      speechRef.current = null;
    }
    try {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    } catch { /* noop */ }
  }

  function stopRecording() {
    setRecording(false);
    stopRecordingInternal();
    cleanupStreams();
  }

  function finalizeRecording() {
    if (chunksRef.current.length) {
      const type = recorderRef.current?.mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type });
      videoBlobRef.current = blob;
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(blob));
    }
    if (liveTranscriptRef.current && !transcript) setTranscript(liveTranscriptRef.current.trim());
    setStep('review');
  }

  function discardRecording() {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoBlobRef.current = null;
    chunksRef.current = [];
    setVideoUrl('');
    setRecordDuration(0);
    setLiveTranscript('');
    liveTranscriptRef.current = '';
  }

  function goToReview() {
    if (liveTranscriptRef.current && !transcript) setTranscript(liveTranscriptRef.current.trim());
    setStep('review');
  }
  function skipToReview() {
    setAllowSkip(true);
    setStep('review');
  }

  async function submit() {
    const hasVideo = !!videoBlobRef.current;
    if (!text.trim() && !hasVideo && !transcript.trim()) return;
    setSubmitting(true);
    setError('');
    setUploadProgress(0);
    try {
      const fd = new FormData();
      fd.append('text', text.trim());
      fd.append('transcript', transcript.trim());
      fd.append('url', typeof location !== 'undefined' ? location.pathname + location.search : '');
      fd.append('viewport', `${window.screen.width}x${window.screen.height}`);
      if (videoBlobRef.current) {
        fd.append('video', videoBlobRef.current, 'feedback_' + Date.now() + '.webm');
        fd.append('video_duration_seconds', String(recordDuration));
      }
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/api/feedback`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data.success) {
              setSuccessMsg('Verstuurd — bedankt!');
              setTimeout(closeModal, 2500);
            } else {
              setError(data.error || 'Er ging iets mis');
            }
          } catch {
            setError('Onverwacht antwoord (' + xhr.status + ')');
          }
          resolve();
        };
        xhr.onerror = () => { setError('Netwerkfout'); resolve(); };
        xhr.send(fd);
      });
    } catch (e: any) {
      setError('Netwerkfout: ' + (e?.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  const canSend = !submitting && (!!text.trim() || !!videoBlobRef.current || !!transcript.trim());

  return (
    <>
      <button
        className="fb-fab"
        type="button"
        title="Meld een bug of feedback"
        aria-label="Meld een bug of feedback"
        onClick={() => setOpen(true)}
      >
        <span className="fb-fab-emoji" aria-hidden="true">🐛</span>
      </button>

      {open && (
        <div className="fb-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !recording) closeModal(); }}>
          <div className="fb-modal" onMouseDown={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="fb-header">
              <span className="fb-header-emoji" aria-hidden="true">🐛</span>
              <div className="fb-header-txt">
                <div className="fb-header-title">Bug melden / feedback</div>
                <div className="fb-steps">
                  <span className={step === 'record' ? 'on' : ''}>1. Opnemen</span>
                  <span className="arrow">→</span>
                  <span className={step === 'review' ? 'on' : ''}>2. Review</span>
                </div>
              </div>
              <button className="fb-x" onClick={closeModal} aria-label="Sluiten">×</button>
            </div>

            {/* Body */}
            <div className="fb-body">
              {successMsg ? (
                <div className="fb-success">
                  <div className="fb-success-icon">✅</div>
                  <div className="fb-success-msg">{successMsg}</div>
                  <div className="fb-success-sub">Dit venster sluit vanzelf…</div>
                </div>
              ) : step === 'record' ? (
                <div className={'fb-reccard' + (videoUrl ? ' done' : recording ? ' rec' : '')}>
                  <div className="fb-reccard-head">
                    <span className="fb-reccard-title">
                      {videoUrl ? '✅ Opname klaar' : recording ? '🔴 Bezig…' : '🎥 Neem op'}
                    </span>
                    {recording && <span className="fb-timer">{fmtDuration(recordDuration)} / 1:30</span>}
                  </div>

                  {videoUrl && !recording && (
                    <div className="fb-col">
                      <video src={videoUrl} controls className="fb-video" />
                      <div className="fb-video-meta">
                        <span>{fmtDuration(recordDuration)}</span>
                        <button className="fb-link-danger" onClick={discardRecording}>Wis opname</button>
                      </div>
                    </div>
                  )}

                  {!videoUrl && !recording && (
                    <div className="fb-col">
                      <button className="fb-btn-rec" onClick={startRecording} disabled={!recordingSupported}>
                        🎥 Start opname
                      </button>
                      <p className="fb-hint">
                        Kies welk tabblad/venster/scherm je wilt delen. <b>Praat gewoon</b> terwijl je het
                        probleem laat zien — je kunt vrij door de tool klikken, dit venster blijft opnemen.
                      </p>
                      {!recordingSupported && (
                        <p className="fb-warn">Deze browser ondersteunt geen schermopname.</p>
                      )}
                      {recordError && <p className="fb-err">{recordError}</p>}
                    </div>
                  )}

                  {recording && (
                    <div className="fb-col">
                      <button className="fb-btn-stop" onClick={stopRecording}>⏹ Stop opname</button>
                      {speechSupported && (
                        <div className="fb-live">
                          <div className="fb-live-label">🎤 Live transcript</div>
                          <span className="fb-live-txt">{liveTranscript || 'Wacht op geluid…'}</span>
                        </div>
                      )}
                      <p className="fb-hint-sm">💡 Demonstreer het probleem in de tool; dit venster kun je desnoods minimaliseren.</p>
                    </div>
                  )}
                </div>
              ) : (
                // review
                <div className="fb-col">
                  {videoUrl && <video src={videoUrl} controls className="fb-video" />}
                  {speechSupported && videoBlobRef.current && (
                    <div>
                      <label className="fb-label">🎤 Wat je zei <span className="fb-label-sub">(bewerkbaar)</span></label>
                      <textarea
                        className="fb-textarea fb-textarea-speech"
                        rows={3}
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                        placeholder="Geen spraak gedetecteerd…"
                      />
                    </div>
                  )}
                  <div>
                    <label className="fb-label">{transcript ? 'Extra opmerking' : 'Wat ging er mis?'}</label>
                    <textarea
                      className="fb-textarea"
                      rows={3}
                      maxLength={4000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder={transcript ? 'Bijv: dit gebeurde ook eerder' : 'Beschrijf het zo duidelijk mogelijk'}
                    />
                  </div>
                  {error && <div className="fb-err-box">{error}</div>}
                </div>
              )}
            </div>

            {/* Footer */}
            {!successMsg && (
              <div className="fb-footer">
                {step === 'record' ? (
                  <>
                    <button className="fb-ghost" onClick={closeModal}>Annuleren</button>
                    <div className="fb-footer-right">
                      {!videoUrl && !recording && (
                        <button className="fb-link" onClick={skipToReview}>Zonder video</button>
                      )}
                      <button
                        className="fb-next"
                        onClick={goToReview}
                        disabled={recording || (!videoUrl && !allowSkip)}
                      >
                        Volgende →
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <button className="fb-ghost" onClick={() => setStep('record')} disabled={submitting}>← Terug</button>
                    <button className="fb-send" onClick={submit} disabled={!canSend}>
                      {submitting
                        ? uploadProgress > 0 && uploadProgress < 100
                          ? `Upload ${uploadProgress}%`
                          : 'Versturen…'
                        : '✅ Versturen'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
