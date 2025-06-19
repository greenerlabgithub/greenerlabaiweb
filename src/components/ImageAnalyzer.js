import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

export default function ImageAnalyzer() {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const videoRef = useRef(null);
  const [streaming, setStreaming] = useState(false);

  // File to Base64
  const toBase64 = file =>
    new Promise((res, rej) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.onerror = rej;
    });

  // REST 분석 호출
  const analyzeImage = async base64 => {
    setLoading(true);
    try {
      const { data } = await axios.post('/api/analyze', { imageBase64: base64 });
      setResult(data);
    } catch (err) {
      console.error(err);
      alert('분석 중 오류 발생');
    } finally {
      setLoading(false);
    }
  };

  // 파일 업로드 분석
  const analyzeFromFile = async () => {
    if (!file) return alert('이미지를 선택하세요');
    const b64 = await toBase64(file);
    await analyzeImage(b64);
  };

  // 카메라 스트림 시작
  const startCamera = async () => {
    if (streaming) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute('playsinline', ''); // iOS compatibility
      video.muted = true;
      await video.play();
      setStreaming(true);
    } catch (err) {
      console.error(err);
      alert('카메라 권한을 허용해주세요');
    }
  };

  // 캡처 후 분석
  const captureAndAnalyze = () => {
    const video = videoRef.current;
    if (!video || video.readyState !== 4) {
      return alert('비디오 스트림이 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    analyzeImage(base64);
  };

  // 컴포넌트 언마운트시 스트림 정리
  useEffect(() => {
    return () => {
      const video = videoRef.current;
      if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return (
    <div style={{ padding: 16 }}>
      {/* 파일 업로드 */}
      <div>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={e => setFile(e.target.files[0])}
        />
        <button onClick={analyzeFromFile} disabled={loading} style={{ marginLeft: 10 }}>
          {loading ? '분석 중…' : '파일로 분석'}
        </button>
      </div>

      {/* 카메라 촬영 */}
      <div style={{ marginTop: 20 }}>
        <button onClick={startCamera} disabled={streaming}>
          카메라 촬영 시작
        </button>
        {streaming && (
          <>
            <video
              ref={videoRef}
              style={{ width: '100%', marginTop: 10 }}
              autoPlay
              muted
              playsInline
            />
            <button onClick={captureAndAnalyze} disabled={loading} style={{ marginTop: 10 }}>
              {loading ? '분석 중…' : '촬영 후 분석'}
            </button>
          </>
        )}
      </div>

      {/* 결과 출력 */}
      {result && (
        <div style={{ marginTop: 20 }}>
          {result.results.map((item, i) => (
            <div key={i} style={{ marginBottom: 24 }}>
              <h4>후보 #{i + 1}: {item.이름}</h4>
              <p><strong>정보:</strong> {item.정보}</p>
              <p><strong>방제방법:</strong></p>
              <ul>
                {item.방제방법.map((r, j) => (<li key={j}>{r}</li>))}
              </ul>
            </div>
          ))}
          <div>
            <p><strong>분석된 이미지:</strong></p>
            <img src={result.imageUrl} alt="분석된 결과" style={{ maxWidth: '100%', border: '1px solid #ccc' }} />
          </div>
        </div>
      )}
    </div>
  );
}
