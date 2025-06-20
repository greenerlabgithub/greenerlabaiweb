import React, { useState, useRef } from 'react';
import axios from 'axios';

export default function ImageAnalyzer() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

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
      console.error('analyzeImage error:', err);
      alert('분석 중 오류 발생');
    } finally {
      setLoading(false);
    }
  };

  // 선택된 파일 처리 (카메라 또는 갤러리)
  const handleFileChange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const b64 = await toBase64(file);
    await analyzeImage(b64);
  };

  // 카메라 앱 호출
  const openNativeCamera = () => cameraInputRef.current && cameraInputRef.current.click();
  // 갤러리에서 사진 선택
  const openGallery = () => galleryInputRef.current && galleryInputRef.current.click();

  return (
    <div style={{ padding: 16 }}>
      {/* 숨겨진 파일 입력 - 카메라 */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={cameraInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
      {/* 숨겨진 파일 입력 - 갤러리 */}
      <input
        type="file"
        accept="image/*"
        ref={galleryInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 버튼 */}
      <button onClick={openNativeCamera} disabled={loading}>
        {loading ? '분석 중…' : '카메라 앱으로 찍기'}
      </button>
      <button onClick={openGallery} disabled={loading} style={{ marginLeft: 10 }}>
        {loading ? '분석 중…' : '사진 업로드'}
      </button>

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
            <img
              src={result.imageUrl}
              alt="분석된 결과"
              style={{ maxWidth: '100%', border: '1px solid #ccc' }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
