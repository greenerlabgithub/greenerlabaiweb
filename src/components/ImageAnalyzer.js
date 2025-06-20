import React, { useState, useRef } from 'react';
import axios from 'axios';

export default function ImageAnalyzer() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

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

  // 파일 선택 또는 카메라 앱 호출
  const handleFileChange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const b64 = await toBase64(file);
    await analyzeImage(b64);
  };

  // 모바일에서 카메라 기본 앱 열기
  const openNativeCamera = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div style={{ padding: 16 }}>
      {/* 숨겨진 파일 입력: 모바일 카메라 앱 호출용 */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 네이티브 카메라 앱 호출 버튼 */}
      <button onClick={openNativeCamera} disabled={loading}>
        {loading ? '분석 중…' : '카메라 앱으로 찍기'}
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
            <img src={result.imageUrl} alt="분석된 결과" style={{ maxWidth: '100%', border: '1px solid #ccc' }} />
          </div>
        </div>
      )}
    </div>
  );
}
