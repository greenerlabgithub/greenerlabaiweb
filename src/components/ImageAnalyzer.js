// src/components/ImageAnalyzer.jsx
import React, { useState, useRef } from 'react';
import axios from 'axios';
import './ImageAnalyzer.css';

export default function ImageAnalyzer() {
  // 상태: 'idle' | 'analyzing' | 'done'
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  // File → Base64
  const toBase64 = file =>
    new Promise((res, rej) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.onerror = rej;
    });

  // 분석 호출 함수
  const analyzeImage = async base64 => {
    setStatus('analyzing');
    try {
      const { data } = await axios.post('/api/analyze', { imageBase64: base64 });
      setResult(data);
      setStatus('done');
    } catch (err) {
      console.error(err);
      alert('분석 중 오류 발생');
      setStatus('idle');
    }
  };

  // 파일 선택 처리 (카메라/갤러리 공통)
  const handleFileChange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    const b64 = await toBase64(file);
    analyzeImage(b64);
  };

  // 버튼 핸들러
  const openNativeCamera = () => cameraInputRef.current.click();
  const openGallery = () => galleryInputRef.current.click();

  // 화면 분기 렌더링
  let content;
  switch (status) {
    case 'idle':
      content = (
        <div className="ia-idle">
          {/* 숨겨진 input */}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            ref={cameraInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <input
            type="file"
            accept="image/*"
            ref={galleryInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          <div className="ia-buttons">
            <button onClick={openNativeCamera}>카메라 앱으로 찍기</button>
            <button onClick={openGallery}>사진 업로드</button>
          </div>
        </div>
      );
      break;

    case 'analyzing':
      content = (
        <div className="ia-loading">
          <div className="spinner" />
          <p>GreenerLab의 AI가 올려주신 이미지를 분석중입니다.</p>
        </div>
      );
      break;

    case 'done':
      content = (
        <div className="ia-result">
          {result.results.map((item, i) => (
            <div key={i} className="ia-candidate">
              <h4>후보 #{i + 1}: {item.이름}</h4>
              <p><strong>정보:</strong> {item.정보}</p>
              <p><strong>방제방법:</strong></p>
              <ul>
                {item.방제방법.map((r, j) => <li key={j}>{r}</li>)}
              </ul>
            </div>
          ))}
          <div className="ia-final-image">
            <img src={result.imageUrl} alt="분석된 결과" />
          </div>
        </div>
      );
      break;
  }

  return (
    <div className="image-analyzer">
      {content}
    </div>
  );
}
